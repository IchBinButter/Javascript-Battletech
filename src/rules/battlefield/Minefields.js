/**
 * Minefields (BMM p.75-79).
 *
 * `state.minefields` maps a hex key to one field record:
 *
 *   { type: 'light' | 'medium' | 'heavy', strength: <damage groupings left> }
 *
 * The Minefield Support rows of the Battlefield Support Table (p.78) give the
 * Target Number for the 2D6 attack roll and the number of Damage Value
 * groupings.  Footnote ** on that table is important: every grouping is five
 * points of damage, so a light field that triggers rolls two 5-point groups
 * (10 damage in total), a medium four (20) and a heavy six (30).
 *
 * Hit-location assumption (not verified against the project KB): the KB page
 * set does not contain the p.79 minefield body, so this module resolves each
 * Damage Value grouping with a 1D6 roll on the front column of the p139 Kick
 * Location Table.  That hit-location rule is an assumption encoded here, not a
 * quoted manual rule; re-check it if a p.79 extract is added to the KB.
 *
 * Entering a mined hex triggers the field immediately, whether the moving
 * 'Mech is friendly or hostile; jumping only triggers a field in the hex the
 * jump ends in (p.79).  A triggered field that inflicts damage loses one
 * Damage Value grouping, and a field at zero has no further effect.
 *
 * Out of scope: active-probe detection, clearing with LRM-20/MRM/ATM/artillery
 * salvos, and two sides stacking fields in one hex (the state shape stores one
 * field per hex).
 */

import hitTables from '../../data/hitTables.json' with { type: 'json' };
import { BATTLEFIELD_SUPPORT_TABLE, DAMAGE_PER_GROUPING } from './BattlefieldSupport.js';

/**
 * Minefield density table (Minefield Support, p.79).  The rows are shared with
 * the Battlefield Support Table so the Target Numbers cannot drift apart.
 */
export const MINEFIELD_DENSITIES = {
  light: { ...BATTLEFIELD_SUPPORT_TABLE.light_density, type: 'light' },
  medium: { ...BATTLEFIELD_SUPPORT_TABLE.medium_density, type: 'medium' },
  heavy: { ...BATTLEFIELD_SUPPORT_TABLE.heavy_density, type: 'heavy' }
};

const DENSITY_ALIASES = {
  light: 'light',
  lightdensity: 'light',
  medium: 'medium',
  mediumdensity: 'medium',
  heavy: 'heavy',
  heavydensity: 'heavy'
};

/** Canonical density key ('light', 'medium', 'heavy') or null. */
export function normalizeMinefieldType(type) {
  if (typeof type !== 'string') return null;

  const key = type.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (Object.prototype.hasOwnProperty.call(MINEFIELD_DENSITIES, key)) {
    return key;
  }

  const compact = key.replace(/_/g, '');
  return Object.prototype.hasOwnProperty.call(DENSITY_ALIASES, compact)
    ? DENSITY_ALIASES[compact]
    : null;
}

/** Density data for a field type, or null. */
export function minefieldDensity(type) {
  const key = normalizeMinefieldType(type);
  return key ? MINEFIELD_DENSITIES[key] : null;
}

/**
 * Build a minefield record for scenario setup.  `strength` defaults to the
 * density's Damage Value groupings (2/4/6).
 */
export function createMinefield(type, options = {}) {
  const density = minefieldDensity(type);
  if (!density) throw new Error(`Unknown minefield density: ${type}`);

  const strength = options.strength === undefined
    ? density.damageGroupings
    : Number(options.strength);
  if (!Number.isInteger(strength) || strength < 0) {
    throw new Error(`Invalid minefield strength: ${options.strength}`);
  }

  const field = { type: density.type, strength };
  if (options.owner !== undefined) field.owner = options.owner;
  return field;
}

/** Place a field on the state and return it. */
export function placeMinefield(state, hexKey, type, options = {}) {
  if (!state) throw new Error('placeMinefield needs a game state');
  if (typeof hexKey !== 'string' || hexKey.length === 0) {
    throw new Error('A minefield needs a hexKey');
  }

  if (!state.minefields || typeof state.minefields !== 'object') {
    state.minefields = {};
  }

  const field = createMinefield(type, options);
  state.minefields[hexKey] = field;
  return field;
}

/** The field recorded in a hex, or null. */
export function minefieldAt(state, hexKey) {
  const fields = state && state.minefields;
  if (!fields || typeof hexKey !== 'string') return null;

  const field = fields[hexKey];
  if (!field || typeof field !== 'object') return null;
  if (!normalizeMinefieldType(field.type ?? field.density)) return null;
  return field;
}

/**
 * Hexes entered by a move that can trigger a minefield.
 *
 * Walking or running through a mined hex triggers it, so every hex after the
 * starting one counts.  A jumping 'Mech only triggers minefields where it ends
 * its movement (p.79).
 */
export function minefieldHexesEntered(path, movementType = 'walk') {
  if (!Array.isArray(path) || path.length < 2) return [];
  if (movementType === 'jump') return [path[path.length - 1]];
  return path.slice(1);
}

// ASSUMPTION (see the module header): the project KB has no p.79 minefield
// body, so every Damage Value grouping is resolved on the front column of the
// p139 Kick Location Table (1D6) rather than a verified manual citation.
function kickLocationTable() {
  const kick = hitTables.hitLocation.kick;
  return (kick && kick.front) || null;
}

function minefieldStrength(field, density) {
  return Number.isInteger(field && field.strength)
    ? field.strength
    : density.damageGroupings;
}

/**
 * Roll a minefield attack (p.79) without touching the game state.
 *
 * One 2D6 roll is made against the density's Target Number.  On success the
 * field rolls one 1D6 hit location per remaining Damage Value grouping on the
 * front column of the p139 Kick Location Table - an assumption, because the KB
 * has no p.79 minefield body (see the module header); on a miss the field
 * stays active and unchanged.
 *
 * @returns {object} plain-data resolution with `hits` and before/after strength
 */
export function resolveMinefieldTrigger(field, diceRoller) {
  const type = normalizeMinefieldType(field && (field.type ?? field.density));
  const density = type ? MINEFIELD_DENSITIES[type] : null;
  const strengthBefore = density ? minefieldStrength(field, density) : 0;

  const resolution = {
    type: type || null,
    name: density ? density.name : null,
    targetNumber: density ? density.targetNumber : null,
    roll: null,
    triggered: false,
    damageGroupings: strengthBefore,
    groupingDamage: DAMAGE_PER_GROUPING,
    strengthBefore,
    strengthAfter: strengthBefore,
    hits: [],
    reason: null
  };

  if (!density) {
    resolution.reason = 'unknown density';
    return resolution;
  }
  if (strengthBefore <= 0) {
    resolution.reason = 'depleted';
    return resolution;
  }
  if (!diceRoller || typeof diceRoller.roll2d6 !== 'function') {
    throw new Error('resolveMinefieldTrigger needs a dice roller');
  }

  const roll = diceRoller.roll2d6();
  resolution.roll = roll;
  resolution.triggered = roll >= density.targetNumber;
  if (!resolution.triggered) return resolution;

  const table = kickLocationTable();
  for (let group = 0; group < strengthBefore; group++) {
    const locationRoll = diceRoller.roll1d6();
    const entry = (table && table[String(locationRoll)]) || { location: 'leftLeg' };
    resolution.hits.push({
      location: entry.location,
      isRear: false,
      damage: DAMAGE_PER_GROUPING,
      roll: locationRoll
    });
  }

  // "If a minefield is triggered and inflicts damage ... reduce the minefield's
  // total Damage Value groupings by 1" (p.79).
  resolution.strengthAfter = Math.max(0, strengthBefore - 1);
  return resolution;
}
