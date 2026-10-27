/**
 * ArcRules - BattleMech firing arcs (BMM p24).
 *
 * A 'Mech divides the map into four arcs: the forward arc (the three hexsides
 * ahead), the left and right side arcs, and the rear arc. Which arc a target
 * falls into depends on the attacker's facing.
 *
 * Two modifiers move the arcs without moving the 'Mech:
 *  - a torso twist shifts arm- and torso-mounted arcs one hexside (leg-mounted
 *    weapons are unaffected), while the 'Mech's facing, and therefore the
 *    direction attacks come *in* from, stays put;
 *  - reversing (flipping) the arms lets arm-mounted weapons fire into the rear
 *    arc instead of their usual arcs.
 *
 * Weapons:
 *  - forward arc: any weapon that is not rear-mounted;
 *  - side arcs: only the arm on that side (plus the forward arc);
 *  - rear arc: only rear-mounted weapons, or arm weapons when arms are flipped.
 */

import { directionBetween } from '../../hex/HexMath.js';

export const ARC = Object.freeze({
  FORWARD: 'forward',
  LEFT: 'left',
  RIGHT: 'right',
  REAR: 'rear'
});

const ARM_LOCATIONS = new Set(['leftArm', 'rightArm']);
const LEG_LOCATIONS = new Set(['leftLeg', 'rightLeg']);

export function isArmLocation(location) {
  return ARM_LOCATIONS.has(location);
}

export function isLegLocation(location) {
  return LEG_LOCATIONS.has(location);
}

/** Normalise a hexside offset into 0..5. */
export function normalizeHexside(delta) {
  return ((delta % 6) + 6) % 6;
}

/**
 * Map a 0..5 hexside offset from facing to an arc.
 * Front covers three hexsides (180 degrees); the sides and rear one each.
 */
function arcFromHexside(offset) {
  if (offset === 3) return ARC.REAR;
  if (offset === 2) return ARC.RIGHT;
  if (offset === 4) return ARC.LEFT;
  return ARC.FORWARD; // 0, 1, 5
}

/**
 * Arc a target lies in, relative to the attacker's facing.
 *
 * Torso twists are deliberately ignored: they change where weapons bear, not
 * where incoming attacks come from (p24, p32).
 */
export function getTargetArc(attacker, targetHexKey) {
  const direction = directionBetween(attacker.position.hexKey, targetHexKey);
  if (direction === -1) return ARC.FORWARD; // same hex
  return arcFromHexside(normalizeHexside(direction - attacker.position.facing));
}

/**
 * Arc a specific weapon bears into, after torso twist.
 */
export function getWeaponArc(attacker, weaponLocation, targetHexKey, options = {}) {
  const direction = directionBetween(attacker.position.hexKey, targetHexKey);
  if (direction === -1) return ARC.FORWARD;

  // Leg-mounted weapons (and kicks) ignore torso twists.
  const twist = isLegLocation(weaponLocation)
    ? 0
    : (options.torsoTwist ?? attacker.torsoTwist ?? 0);

  return arcFromHexside(normalizeHexside(direction - (attacker.position.facing + twist)));
}

/**
 * Can a weapon bear on a target?
 *
 * @param {Unit} attacker
 * @param {Weapon} weapon - weapon definition/instance; may carry `mount`
 * @param {string} targetHexKey
 * @param {{weaponLocation?: string, mount?: string, torsoTwist?: number, armsReversed?: boolean}} [options]
 * @returns {{ legal: boolean, arc: string, reason: string|null }}
 */
export function canWeaponFireAt(attacker, weapon, targetHexKey, options = {}) {
  const location = options.weaponLocation || (weapon && weapon.location) || null;
  const mount = options.mount || (weapon && weapon.mount) || 'front';
  const armsReversed = options.armsReversed ?? attacker.armsReversed ?? false;

  const arc = getWeaponArc(attacker, location, targetHexKey, options);

  if (mount === 'rear') {
    return arc === ARC.REAR
      ? { legal: true, arc, reason: null }
      : { legal: false, arc, reason: 'Rear-mounted weapon can only fire into the rear arc' };
  }

  if (armsReversed && isArmLocation(location)) {
    return arc === ARC.REAR
      ? { legal: true, arc, reason: null }
      : { legal: false, arc, reason: 'Arms are reversed: arm weapons may only fire into the rear arc' };
  }

  if (arc === ARC.REAR) {
    return { legal: false, arc, reason: 'Only rear-mounted weapons may fire into the rear arc' };
  }

  if (arc === ARC.FORWARD) {
    return { legal: true, arc, reason: null };
  }

  // Side arc: only the arm on that side can bear.
  const armOnThatSide =
    (arc === ARC.LEFT && location === 'leftArm') ||
    (arc === ARC.RIGHT && location === 'rightArm');

  if (armOnThatSide) {
    return { legal: true, arc, reason: null };
  }

  return { legal: false, arc, reason: `Weapon in ${location || 'torso'} cannot fire into the ${arc} arc` };
}
