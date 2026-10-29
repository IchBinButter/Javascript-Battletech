/**
 * Quirks - data-driven BattleMech design quirks (BMM p82-95).
 *
 * The rule metadata lives in `src/data/quirks.json`; a Mech carries the quirks
 * it has in `unit.quirks`, copied from its mech definition by `Unit`. Entries
 * are either ids (string) or objects with an `id` plus per-Mech parameters:
 *
 *   "quirks": [
 *     "cramped_cockpit",
 *     { "id": "poor_cooling_jacket", "weapon": "ac20" }
 *   ]
 *
 * Weapon-scoped quirks (Inaccurate Weapon, Poor Cooling Jacket) must name their
 * weapon in the entry; an entry that omits it is inert rather than silently
 * applying to every weapon the Mech carries.
 *
 * Everything here is pure: it reads the unit and the quirk table and returns
 * modifiers together with the reasons to print on the Target Number breakdown.
 * Nothing mutates the unit or the game state, so the same helpers serve the
 * attack resolver, the PSR calculator and the heat manager.
 */

import quirksData from '../../data/quirks.json' with { type: 'json' };

const QUIRK_TABLE = new Map(quirksData.quirks.map(quirk => [quirk.id, quirk]));

/**
 * PSR trigger names that mean "entering a hex that requires a PSR", which is
 * the only case Unbalanced applies to (p89). The names come from
 * PSRCalculator.getPSRTriggers: the movement triggers and the terrain/building
 * entry triggers; weather, skidding, standing up and damage triggers are not
 * hex entries and deliberately do not match.
 */
const HEX_ENTRY_TRIGGER = [
  /woods/i,
  /jungle/i,
  /sand/i,
  /rubble/i,
  /water/i,
  /level drop/i,
  /building/i,
  /basement/i,
  /ice/i,
  /mud/i,
  /snow/i,
  /swamp/i,
  /terrain/i
];

/** The full quirk table as plain data (data validation, UI). */
export function getQuirkTable() {
  return quirksData.quirks;
}

/** Rule metadata for a quirk id, or null when the table does not know it. */
export function getQuirkDefinition(id) {
  return QUIRK_TABLE.get(id) || null;
}

/** The raw quirk entries a unit carries; never the shared JSON array. */
export function getUnitQuirks(unit) {
  const quirks = unit && unit.quirks;
  return Array.isArray(quirks) ? quirks : [];
}

function quirkEntryId(entry) {
  if (typeof entry === 'string') return entry;
  return entry && typeof entry === 'object' ? entry.id : null;
}

/**
 * Resolve one unit entry against the table: the definition plus the per-Mech
 * parameters (`weapon`). Unknown ids resolve to null and are inert, so a typo
 * in the data cannot invent a rule.
 */
export function resolveQuirkEntry(entry) {
  const id = quirkEntryId(entry);
  const definition = id ? QUIRK_TABLE.get(id) : null;
  if (!definition) return null;

  return typeof entry === 'string'
    ? { ...definition }
    : { ...definition, ...entry, id };
}

/** Every known quirk on the unit, resolved and ready to apply. */
export function getActiveQuirks(unit) {
  return getUnitQuirks(unit).map(resolveQuirkEntry).filter(Boolean);
}

/** Definition plus per-Mech parameters for quirk `id`, or null. */
export function getQuirk(unit, id) {
  const entry = getUnitQuirks(unit).find(candidate => quirkEntryId(candidate) === id);
  return entry ? resolveQuirkEntry(entry) : null;
}

/** Does the unit carry quirk `id`? Unknown ids are inert and answer false. */
export function hasQuirk(unit, id) {
  return getQuirk(unit, id) !== null;
}

/** The quirk's modifier, defaulting to +1 when the data omits it. */
function quirkModifier(quirk) {
  return Number.isFinite(quirk.modifier) ? quirk.modifier : 1;
}

/** A weapon id from a Weapon instance, a mech weapon entry, or a plain id. */
function weaponIdOf(weapon) {
  if (!weapon) return null;
  if (typeof weapon === 'string') return weapon;
  return weapon.id || weapon.type || null;
}

/**
 * Does a weapon-scoped quirk bite on this weapon?
 *
 * Inaccurate Weapon (p87) and Poor Cooling Jacket (p88) are bought for one
 * named weapon, and quirks.json marks them `requiresWeapon`. An entry that
 * does not name that weapon is inert: a typo or a missing parameter must not
 * silently turn a per-weapon rule into a Mech-wide one. Quirks that are not
 * weapon-scoped (Sensor Ghosts, Poor Targeting) ignore the weapon entirely.
 */
function appliesToWeapon(quirk, weapon) {
  const weaponScoped = quirk.scope === 'weapon' || quirk.requiresWeapon === true;
  if (!weaponScoped) return true;

  if (!quirk.weapon) return false;
  const id = weaponIdOf(weapon);
  return id !== null && id === quirk.weapon;
}

function describeModifier(quirk) {
  const amount = quirkModifier(quirk);
  const scope = quirk.weapon ? ` (${quirk.weapon})` : '';
  return `${quirk.name}${scope}: +${amount}`;
}

/**
 * Ranged attack Target Number modifier from design quirks.
 *
 * Handles Poor Targeting by range bracket, Sensor Ghosts on every ranged
 * attack, and Inaccurate Weapon on its one weapon.
 *
 * @param {Unit} unit - attacker
 * @param {{ weapon?: object|string, rangeBracket?: string }} context
 * @returns {{ modifier: number, reasons: string[] }}
 */
export function quirkTargetModifier(unit, context = {}) {
  let modifier = 0;
  const reasons = [];

  for (const quirk of getActiveQuirks(unit)) {
    if (quirk.rule !== 'target') continue;
    if (!appliesToWeapon(quirk, context.weapon)) continue;
    if (quirk.scope === 'rangeBracket' && quirk.rangeBracket !== context.rangeBracket) continue;

    modifier += quirkModifier(quirk);
    reasons.push(describeModifier(quirk));
  }

  return { modifier, reasons };
}

/**
 * Did this PSR come from entering a hex (jungle, sand, rubble, water, a
 * building, a terrain modification)? Unbalanced only applies to those (p89).
 * Woods are absent on purpose: p60 gives both woods rows "PSR Modifier: No
 * PSR", so an ordinary move into woods never forces a roll to modify.
 */
function entersHexRequiringPSR(context) {
  if (typeof context.enteringHex === 'boolean') return context.enteringHex;

  const movement = context.movement;
  if (movement) {
    // The terrain-entry causes PSRCalculator.getPSRTriggers reads (p60/p142).
    if (movement.enteredLightJungle || movement.enteredHeavyJungle ||
        movement.enteredSand || movement.enteredRubble ||
        movement.enteredWater) {
      return true;
    }
    if (movement.terrainPSR && Array.isArray(movement.terrainPSR.reasons) &&
        movement.terrainPSR.reasons.length > 0) {
      return true;
    }
  }

  const triggers = Array.isArray(context.triggers)
    ? context.triggers
    : context.trigger ? [context.trigger] : [];

  return triggers.some(trigger => {
    const name = typeof trigger === 'string' ? trigger : (trigger && trigger.trigger) || '';
    return HEX_ENTRY_TRIGGER.some(pattern => pattern.test(name));
  });
}

/**
 * Piloting Skill Roll modifier from design quirks.
 *
 * Cramped Cockpit and Hard to Pilot raise every PSR the Mech makes; Unbalanced
 * only the PSRs for entering a hex. The caller passes the triggers it is about
 * to resolve (or `enteringHex`) so Unbalanced can tell the two apart.
 *
 * @param {Unit} unit
 * @param {{ triggers?: Array, trigger?: string, movement?: object, enteringHex?: boolean }} context
 * @returns {{ modifier: number, reasons: string[] }}
 */
export function quirkPSRModifier(unit, context = {}) {
  let modifier = 0;
  const reasons = [];

  const entersHex = entersHexRequiringPSR(context);

  for (const quirk of getActiveQuirks(unit)) {
    if (quirk.rule !== 'psr') continue;
    if (quirk.scope === 'hexEntry' && !entersHex) continue;

    modifier += quirkModifier(quirk);
    reasons.push(describeModifier(quirk));
  }

  return { modifier, reasons };
}

/**
 * Extra heat from design quirks when firing a weapon (Poor Cooling Jacket).
 * @param {Unit} unit
 * @param {object|string} weapon - the weapon being fired
 * @returns {number} extra heat points
 */
export function quirkHeatModifier(unit, weapon) {
  let heat = 0;

  for (const quirk of getActiveQuirks(unit)) {
    if (quirk.rule !== 'heat') continue;
    if (!appliesToWeapon(quirk, weapon)) continue;
    heat += quirkModifier(quirk);
  }

  return heat;
}
