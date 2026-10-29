/**
 * maxMP - the single function that decides how much MP a unit has.
 *
 * Movement validation, the unit's currentMP getter and the UI all call this,
 * so heat penalties, hip damage, leg loss, MASC and TSM can never disagree
 * with each other.
 *
 * Walking MP is computed once from the damage/heat state, and Running MP is
 * always derived from it (p14 Critical Damage: "If damage reduces a 'Mech's
 * Walking MP rating, the player must recalculate the 'Mech's Running MP
 * rating"; p48: "Recalculate its Running MP accordingly by multiplying the new
 * Walking MP by 1.5, rounding up"). Jumping MP is a separate rating.
 *
 * Leg damage (p44):
 *   one leg  -> 1 Walking MP (overrides all MP increases), cannot run, can
 *               still jump once it has stood up;
 *   both legs -> 0 MP in every mode ("it has 0 MP available"). The 'Mech is
 *               NOT destroyed and NOT immobile - it falls and stays in play.
 *
 * Jumping MP (p14/p18/p19):
 *   It is the number of operational jump jets ("'Mechs lose one Jumping MP for
 *   each jump jet destroyed"), but jump jets cannot fire while submerged: at
 *   Depth 1 only the leg-mounted jets are lost, and at Depth 2+ the 'Mech
 *   cannot jump at all. Water needs the map, so `getAvailableJumpMP` takes the
 *   standing hex's depth while `getMaxMP(unit, 'jump')` is the dry-land rating.
 */

import equipmentData from '../../data/equipment.json' with { type: 'json' };
import { getHeatEffects } from '../heat/HeatScale.js';
import { getHipHits } from '../combat/UnitDamage.js';

const MASC = equipmentData.equipment.find(e => e.id === 'masc') || { mpMultiplier: 2 };
const TSM = equipmentData.equipment.find(e => e.id === 'tsm') || { heatThreshold: 9, walkMPBonus: 2 };

/** Locations whose jump jets are submerged when the 'Mech stands in Depth 1. */
const LEG_LOCATIONS = ['leftLeg', 'rightLeg'];

/** Standard jump jets occupy one critical slot each (p126). */
const JUMP_JET_ITEM = 'jump_jet';

/** How many legs has this 'Mech lost? (p44) */
export function countMissingLegs(unit) {
  if (typeof unit.isLocationDestroyed !== 'function') return 0;
  return ['leftLeg', 'rightLeg'].filter((leg) => unit.isLocationDestroyed(leg)).length;
}

/** Has this 'Mech lost at least one leg? (p44) */
export function hasMissingLeg(unit) {
  return countMissingLegs(unit) > 0;
}

/**
 * A location whose internal structure is gone takes its critical slots with it
 * (p44), even when the slots themselves were not individually marked destroyed.
 */
function locationIsGone(unit, location) {
  const structure = unit && unit.internalStructure && unit.internalStructure[location];
  return typeof structure === 'number' && structure <= 0;
}

/**
 * Count the jump jets actually mounted on the unit.
 *
 * The record-sheet critical slots are the primary source: each standard
 * `jump_jet` slot is one jet, destroyed slots do not count (p14: "'Mechs lose
 * one Jumping MP for each jump jet destroyed"), and jets in a destroyed
 * location are gone with it. `legOperational` is the subset in the legs, which
 * p19 submerges when the 'Mech stands in Depth 1 water.
 *
 * Fallback (documented): data that does not model jump jets per location - test
 * fixtures, older saves, abstract units - reports `modelled: false` and callers
 * use the design Jumping MP rating from `unit.movement.jump` instead. Improved
 * jump jets occupy two critical slots and are not modelled here; a unit whose
 * only jets are such non-standard slots also falls back to the rating.
 *
 * @param {Unit|object} unit
 * @returns {{ modelled: boolean, total: number, operational: number, legOperational: number }}
 */
export function getJumpJetInventory(unit) {
  const inventory = { modelled: false, total: 0, operational: 0, legOperational: 0 };
  const criticalSlots = unit && unit.criticalSlots;
  if (!criticalSlots || typeof criticalSlots !== 'object') return inventory;

  for (const [location, slots] of Object.entries(criticalSlots)) {
    if (!Array.isArray(slots)) continue;
    const inLeg = LEG_LOCATIONS.includes(location);
    const gone = locationIsGone(unit, location);
    for (const slot of slots) {
      if (!slot || slot.item !== JUMP_JET_ITEM) continue;
      inventory.modelled = true;
      inventory.total += 1;
      if (slot.status !== 'ok' || gone) continue;
      inventory.operational += 1;
      if (inLeg) inventory.legOperational += 1;
    }
  }

  return inventory;
}

/** The dry-land Jumping MP rating: operational jets, else the design rating. */
function jumpingRating(unit) {
  const movement = (unit && unit.movement) || {};
  const inventory = getJumpJetInventory(unit);
  const rating = inventory.modelled
    ? inventory.operational
    : (Number.isFinite(movement.jump) ? movement.jump : 0);
  return Math.max(0, rating);
}

/**
 * Jumping MP available from the hex the unit is standing in (p18/p19).
 *
 * p19 MOVEMENT IN WATER: "Jump jets cannot be fired while submerged. As such,
 * a 'Mech standing in Depth 1 water may not fire jump jets located in its legs,
 * and a 'Mech standing in Depth 2 or deeper water cannot jump at all." The p18
 * worked example is 6 jets - two of them in the legs - standing in Depth 1
 * water: only 4 Jumping MP remain.
 *
 * When the jets are not modelled per location, the Depth 1 reduction cannot be
 * attributed to specific jets, so the documented fallback treats the dry-land
 * rating as available (no leg-mounted jets assumed).
 *
 * @param {Unit|object} unit
 * @param {number} [waterDepth] - depth of the hex the unit occupies (0 = dry)
 * @returns {number} available Jumping MP (0 means no jump is possible)
 */
export function getAvailableJumpMP(unit, waterDepth = 0) {
  const depth = Number.isFinite(waterDepth) && waterDepth > 0 ? waterDepth : 0;

  // p19: Depth 2 or deeper water submerges every jump jet.
  if (depth >= 2) return 0;

  const rating = jumpingRating(unit);
  if (depth === 1) {
    const inventory = getJumpJetInventory(unit);
    if (inventory.modelled) return Math.max(0, rating - inventory.legOperational);
  }

  return rating;
}

/**
 * Walking MP after heat, hip and leg damage, plus any TSM increase.
 *
 * Order follows p48: the hip halving is applied before any leg actuator MP
 * reductions, and p44's leg rules override all MP increases.
 *
 * @param {Unit} unit
 * @returns {number}
 */
export function getWalkingMP(unit) {
  const movement = unit.movement || {};
  const missingLegs = countMissingLegs(unit);

  // p44: "A 'Mech that loses both of its legs automatically falls as well. It
  // is not considered immobile (see p. 18), but it has 0 MP available."
  if (missingLegs >= 2) return 0;

  let walk = Number.isFinite(movement.walk) ? movement.walk : 0;

  // Heat (p51/p52): each heat band costs 1 Walking MP.
  walk -= getHeatEffects(unit.heat).movementPenalty;

  // p48: a hip hit halves Walking MP, rounded up; a second hip leaves the
  // 'Mech with no MP at all ("a critical hit to the second hip reduces the
  // 'Mech's MP to 0, but the 'Mech is not considered immobile").
  const hipHits = getHipHits(unit);
  if (hipHits >= 2) return 0;
  if (hipHits === 1) walk = Math.ceil(walk / 2);

  // TSM adds Walking MP once the 'Mech is hot enough (p116).
  const hasTSM = Boolean(unit.equipment && unit.equipment.other && unit.equipment.other.tsm);
  if (hasTSM && (unit.heat || 0) >= (TSM.heatThreshold ?? 9)) {
    walk += TSM.walkMPBonus ?? 2;
  }

  // p44: "A 'Mech with one leg is reduced to 1 Walking MP (this overrides all
  // MP increases) and cannot run."
  if (missingLegs === 1) return 1;

  return Math.max(0, walk);
}

/**
 * Maximum MP available in a movement mode after heat, hip/leg damage, MASC,
 * TSM and destroyed jump jets.
 *
 * For jumping this is the dry-land rating. Callers that know the standing
 * hex's water depth must use `getAvailableJumpMP(unit, waterDepth)` instead,
 * because submerged jets cannot fire (p19).
 *
 * @param {Unit} unit
 * @param {'walk'|'run'|'jump'} movementType
 * @returns {number}
 */
export function getMaxMP(unit, movementType = 'walk') {
  const movement = unit.movement || {};

  // p44: a 'Mech that has lost both legs "has 0 MP available" - it cannot
  // walk, run or jump (it cannot even stand to use its jump jets). This is not
  // a destruction: it stays in play and can still fire.
  if (countMissingLegs(unit) >= 2) return 0;

  // Jumping MP is its own rating: heat does not reduce it, and p44 keeps jump
  // jets available to a one-legged 'Mech. p14: "'Mechs lose one Jumping MP for
  // each jump jet destroyed." This is the dry-land rating; water submersion is
  // applied by getAvailableJumpMP, which knows the standing hex.
  if (movementType === 'jump') {
    return jumpingRating(unit);
  }

  const walkMP = getWalkingMP(unit);
  if (movementType !== 'run') return walkMP;

  // p44: a one-legged 'Mech "cannot run", whatever its Walking MP is.
  if (hasMissingLeg(unit)) return 0;

  // p116 MASC: "the 'Mech can run that turn at a speed equal to double its
  // current Walking MP." Walking MP itself is unchanged.
  if (unit.mascActive) return walkMP * (MASC.mpMultiplier || 2);

  // p48: Running MP = current Walking MP x 1.5, rounded up.
  return Math.ceil(walkMP * 1.5);
}
