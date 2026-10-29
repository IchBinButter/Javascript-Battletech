/**
 * UnitDamage - reads a Mech's critical damage the way the rules need it.
 *
 * Critical hit effects live in the critical slots (BMM p47-49); several other
 * rules consult that state: physical attack modifiers (p29), weapon attack
 * modifiers (p28), walking MP for a hip (p48) and pilot damage from life
 * support (p52).
 */

/** The three torso locations, the only ones with rear armour (p42/p139). */
export const TORSO_LOCATIONS = ['centerTorso', 'leftTorso', 'rightTorso'];

/** The four limb locations. A 12 on the crit table blows one of these off (p46). */
export const LIMB_LOCATIONS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export function isTorsoLocation(location) {
  return TORSO_LOCATIONS.includes(location);
}

export function isLimbLocation(location) {
  return LIMB_LOCATIONS.includes(location);
}

/**
 * What sits in a critical slot, in the terms p46-49 use. The kind decides how a
 * critical hit resolves and which slots share one physical component.
 */
export function classifyCriticalItem(item) {
  const name = item || '';
  if (name === 'empty' || name === '') return 'empty';
  if (name === 'engine') return 'engine';
  if (name === 'gyro') return 'gyro';
  if (name === 'cockpit') return 'cockpit';
  if (/sensor/.test(name)) return 'sensors';
  if (/life_support/.test(name)) return 'life_support';
  if (/heat_sink/.test(name)) return 'heat_sink';
  if (/_ammo$|(^|_)ammo(_|$)/.test(name)) return 'ammo';
  if (/jump_jet/.test(name)) return 'jump_jet';
  if (/shoulder|actuator/.test(name)) return 'actuator';
  if (/^case(_ii)?$/.test(name)) return 'case';
  if (/endo_steel|ferro_fibrous|^tsm$|triple_strength/.test(name)) return 'structure';
  if (name === 'ecm') return 'ecm';
  return 'equipment';
}

/**
 * p46 Inapplicable Slots: a slot that has already taken a critical hit, is
 * empty, or cannot take critical damage (endo-steel, CASE, TSM, ferro-fibrous).
 */
export function isCritImmuneItem(item) {
  const kind = classifyCriticalItem(item);
  return kind === 'empty' || kind === 'case' || kind === 'structure';
}

/**
 * p46 Multi-slot Components: "Some items, such as double heat sinks, take up
 * multiple slots on the Critical Hit Table. A single critical hit disables any
 * item or structural component except the engine, gyro, or sensors, regardless
 * of its number of slots. Critical hits on additional slots occupied by the
 * item have no further effect, but soak up the hit."
 *
 * Equipment and the life-support package are therefore one component across all
 * their slots, and a double heat sink is one component across its three slots
 * (p46's own example). Sensors are excepted: each sensor slot is its own
 * component. Single heat sinks, ammunition bins, jump jets and actuators are one
 * component per slot, and the engine (three hits) and gyro (two) have their own
 * damage tracks.
 *
 * @param {string} item - critical slot item name
 * @param {object} [unit] - needed to tell a double heat sink from a single one
 */
export function isMultiSlotItem(item, unit = null) {
  const kind = classifyCriticalItem(item);
  if (kind === 'heat_sink') {
    const type = String((unit && unit.heatSinks && unit.heatSinks.type) || '').toLowerCase();
    return type === 'double';
  }
  if (kind === 'sensors') return false; // p46 exception: separate components
  return kind === 'equipment' || kind === 'life_support';
}

/**
 * Does a critical hit on this item explode? Ammunition bins do (p96). p118 also
 * names Gauss rifles as explosive components, but the roster carries none, so
 * only ammunition is modelled here.
 */
export function isExplosiveItem(item) {
  return classifyCriticalItem(item) === 'ammo';
}

/**
 * CASE in the location that holds the ammunition protects it (p118). A CASE
 * slot that has itself been destroyed no longer protects anything.
 */
export function hasCASE(unit, location) {
  const slots = (unit.criticalSlots && unit.criticalSlots[location]) || [];
  return slots.some(s => classifyCriticalItem(s.item) === 'case' && s.status !== 'destroyed');
}

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
