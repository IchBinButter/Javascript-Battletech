/**
 * UnitDamage - reads a Mech's critical damage the way the rules need it.
 *
 * Critical hit effects live in the critical slots (BMM p47-49); several other
 * rules consult that state: physical attack modifiers (p29), weapon attack
 * modifiers (p28), walking MP for a hip (p48) and pilot damage from life
 * support (p52).
 */

/** Destroyed actuators in a location, by kind. */
export function getActuatorDamage(unit, location) {
  const slots = (unit.criticalSlots && unit.criticalSlots[location]) || [];
  const destroyed = (pattern) =>
    slots.some(s => s.status === 'destroyed' && pattern.test(s.item || ''));

  return {
    shoulder: destroyed(/shoulder/),
    upperArm: destroyed(/upper_arm_actuator/),
    lowerArm: destroyed(/lower_arm_actuator/),
    hand: destroyed(/hand_actuator/),
    hip: destroyed(/hip/),
    upperLeg: destroyed(/upper_leg_actuator/),
    lowerLeg: destroyed(/lower_leg_actuator/),
    foot: destroyed(/foot_actuator/)
  };
}

/** Does this location even have that actuator fitted? (arm flipping, p24) */
export function hasActuatorSlot(unit, location, namePattern) {
  const slots = (unit.criticalSlots && unit.criticalSlots[location]) || [];
  return slots.some(s => namePattern.test(s.item || ''));
}

/** Sensor critical hit: +2 to all weapon attacks (p28/p49). */
export function hasSensorHit(unit) {
  const head = (unit.criticalSlots && unit.criticalSlots.head) || [];
  return head.some(s => /sensor/.test(s.item || '') && s.status === 'destroyed');
}

/** Life support critical hit (p48): heat now hurts the MechWarrior. */
export function hasLifeSupportHit(unit) {
  const head = (unit.criticalSlots && unit.criticalSlots.head) || [];
  return head.some(s => /life_support/.test(s.item || '') && s.status === 'destroyed');
}

/** Number of destroyed hip actuators (0, 1 or 2). */
export function getHipHits(unit) {
  return ['leftLeg', 'rightLeg']
    .filter(leg => getActuatorDamage(unit, leg).hip)
    .length;
}

/**
 * Weapon attack modifier for damage in the weapon's own arm (p28).
 * A destroyed shoulder is +4 and ignores the other actuators in that arm;
 * otherwise each upper or lower arm actuator adds +1.
 */
export function armWeaponModifier(unit, location) {
  if (location !== 'leftArm' && location !== 'rightArm') return 0;

  const damage = getActuatorDamage(unit, location);
  if (damage.shoulder) return 4;

  let modifier = 0;
  if (damage.upperArm) modifier += 1;
  if (damage.lowerArm) modifier += 1;
  return modifier;
}
