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
 */

import equipmentData from '../../data/equipment.json' with { type: 'json' };
import { getHeatEffects } from '../heat/HeatScale.js';
import { getHipHits } from '../combat/UnitDamage.js';

const MASC = equipmentData.equipment.find(e => e.id === 'masc') || { mpMultiplier: 2 };
const TSM = equipmentData.equipment.find(e => e.id === 'tsm') || { heatThreshold: 9, walkMPBonus: 2 };

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
 * Maximum MP available in a movement mode after heat, hip/leg damage, MASC
 * and TSM.
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
  // jets available to a one-legged 'Mech.
  if (movementType === 'jump') {
    const jump = Number.isFinite(movement.jump) ? movement.jump : 0;
    return Math.max(0, jump);
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
