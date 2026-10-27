/**
 * PhysicalAttackResolver - physical attacks (BMM p34-40).
 *
 * Base target numbers (Physical Attack Modifiers Table, p137):
 *   punch 0, kick -2, push -1, club -1, charge and DFA use the comparative
 *   Piloting Skill modifier (p34).
 *
 * Damage (p38): punch 1 per 10 tons, kick 1 per 5 tons, club 1 per 5 tons,
 * charge attacker tonnage/10 per hex charged. All of these round fractions up.
 * Damaged arm/leg actuators raise the target number and halve the damage
 * (Attack Modifiers Table, p29).
 */

import { hexDistance } from '../../hex/HexMath.js';
import { getTargetArc, ARC } from './ArcRules.js';
import hitTables from '../../data/hitTables.json' with { type: 'json' };

const PUNCH_TABLE = hitTables.hitLocation.punch;
const KICK_TABLE = hitTables.hitLocation.kick;

/** Base target number modifier by attack type (p137). */
const BASE_MODIFIER = {
  punch: 0,
  kick: -2,
  push: -1,
  club: -1,
  charge: 0,
  dfa: 0
};

/** p37: a DFA always applies the +3 jumping modifier; it is not pre-applied. */
const DFA_JUMPING_MODIFIER = 3;

export class PhysicalAttackResolver {
  /**
   * Destroyed actuators in a location, by kind (p29, p47-49).
   */
  getActuatorDamage(unit, location) {
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

  _armDestroyed(unit, location) {
    return typeof unit.isLocationDestroyed === 'function'
      ? unit.isLocationDestroyed(location)
      : false;
  }

  /**
   * Punch modifiers for one arm (p29): a destroyed shoulder forbids punching,
   * each arm actuator adds +2 and halves the damage, a hand actuator adds +1.
   */
  punchModifiers(unit, arm) {
    if (!arm) return { legal: true, tn: 0, damageMultiplier: 1 };
    if (this._armDestroyed(unit, arm)) {
      return { legal: false, reason: `${arm} destroyed` };
    }

    const damage = this.getActuatorDamage(unit, arm);
    if (damage.shoulder) {
      return { legal: false, reason: `Shoulder actuator destroyed on ${arm}` };
    }

    let tn = 0;
    let multiplier = 1;
    if (damage.upperArm) { tn += 2; multiplier *= 0.5; }
    if (damage.lowerArm) { tn += 2; multiplier *= 0.5; }
    if (damage.hand) { tn += 1; }

    return { legal: true, tn, damageMultiplier: multiplier };
  }

  /**
   * Kick modifiers (p29/p38): both hip actuators must be undamaged to kick at
   * all; each upper or lower leg actuator adds +2 and halves the damage
   * cumulatively; a foot actuator adds +1.
   */
  kickModifiers(unit) {
    for (const leg of ['leftLeg', 'rightLeg']) {
      if (this._armDestroyed(unit, leg)) {
        return { legal: false, reason: `${leg} destroyed` };
      }
      if (this.getActuatorDamage(unit, leg).hip) {
        return { legal: false, reason: 'Hip actuator destroyed' };
      }
    }

    let tn = 0;
    let multiplier = 1;
    for (const leg of ['leftLeg', 'rightLeg']) {
      const damage = this.getActuatorDamage(unit, leg);
      if (damage.upperLeg) { tn += 2; multiplier *= 0.5; }
      if (damage.lowerLeg) { tn += 2; multiplier *= 0.5; }
      if (damage.foot) { tn += 1; }
    }

    return { legal: true, tn, damageMultiplier: multiplier };
  }

  /** Is the target in the attacker's forward arc? Torso twists are ignored (p38). */
  _inForwardArc(attacker, target) {
    return getTargetArc(attacker, target.position.hexKey) === ARC.FORWARD;
  }

  /**
   * Resolve a punch attack against one arm.
   * @param {object} [options] - { arm: 'leftArm'|'rightArm' }
   */
  resolvePunch(attacker, target, diceRoller, options = {}) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    // Choose an arm: explicit, otherwise the arm whose side arc holds the target.
    const arm = options.arm || this._pickPunchArm(attacker, target);

    // Punches only reach the forward or side arcs (p38).
    if (getTargetArc(attacker, target.position.hexKey) === ARC.REAR) {
      return { success: false, reason: 'Target not in forward or side arc' };
    }

    const armMods = this.punchModifiers(attacker, arm);
    if (!armMods.legal) {
      return { success: false, reason: armMods.reason };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'punch', { arm });
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];

    if (hit) {
      // 1 point per 10 tons, fractions rounded up (p38)
      const base = Math.ceil(attacker.tonnage / 10);
      damage = Math.max(1, Math.floor(base * armMods.damageMultiplier));
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage }];
    }

    return {
      success: true,
      type: 'punch',
      arm,
      hit,
      roll,
      targetNumber: tn,
      damage,
      hitLocations: locations
    };
  }

  _pickPunchArm(attacker, target) {
    const arc = getTargetArc(attacker, target.position.hexKey);
    if (arc === ARC.LEFT) return 'leftArm';
    if (arc === ARC.RIGHT) return 'rightArm';
    return 'rightArm';
  }

  /**
   * Resolve a kick attack.
   * Both hips must be undamaged and the target must be in the forward arc.
   * A missed kick forces a PSR.
   */
  resolveKick(attacker, target, diceRoller) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const legMods = this.kickModifiers(attacker);
    if (!legMods.legal) {
      return { success: false, reason: legMods.reason };
    }
    if (!this._inForwardArc(attacker, target)) {
      return { success: false, reason: 'Target not in forward arc' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'kick');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];
    let psrRequired = false;

    if (hit) {
      // 1 point per 5 tons, fractions rounded up (p38)
      const base = Math.ceil(attacker.tonnage / 5);
      damage = Math.max(1, Math.floor(base * legMods.damageMultiplier));
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.kickLocation(locRoll), damage }];
    } else {
      psrRequired = true; // missed kick: PSR (p54, modifier 0)
    }

    return {
      success: true,
      type: 'kick',
      hit,
      roll,
      targetNumber: tn,
      damage,
      hitLocations: locations,
      psrRequired
    };
  }

  /**
   * Resolve a charge attack.
   * Damage = attacker tonnage / 10 per hex charged (rounded up, p38 example);
   * the attacker takes the target's tonnage / 10.
   */
  resolveCharge(attacker, target, distanceCharged, diceRoller) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }
    if (!this._inForwardArc(attacker, target)) {
      return { success: false, reason: 'Target not in forward arc' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'charge');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let attackerDamage = 0;
    let targetDamage = 0;
    let locations = [];

    if (hit) {
      targetDamage = Math.ceil((attacker.tonnage / 10) * distanceCharged);
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage: targetDamage }];
      attackerDamage = Math.ceil(target.tonnage / 10);
    }

    return {
      success: true,
      type: 'charge',
      hit,
      roll,
      targetNumber: tn,
      attackerDamage,
      targetDamage,
      hitLocations: locations,
      distanceCharged
    };
  }

  /**
   * Resolve a Death From Above attack.
   * TN uses the comparative modifier plus the +3 jumping modifier, no terrain.
   */
  resolveDFA(attacker, target, diceRoller) {
    if (!attacker.movement || !attacker.movement.jump || attacker.movement.jump <= 0) {
      return { success: false, reason: 'No jump jets' };
    }
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'dfa');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let targetDamage = 0;
    let attackerDamage = 0;
    let locations = [];

    if (hit) {
      // DFA damage is left as-is: the KB chunk for p37 does not state the
      // formula, and guessing it would be worse than keeping the old value.
      targetDamage = Math.floor(attacker.tonnage / 10) + Math.floor(attacker.tonnage / 5);
      attackerDamage = Math.floor(attacker.tonnage / 10);
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage: targetDamage }];
    } else {
      attackerDamage = Math.floor(attacker.tonnage / 10);
    }

    return {
      success: true,
      type: 'dfa',
      hit,
      roll,
      targetNumber: tn,
      targetDamage,
      attackerDamage,
      hitLocations: locations,
      attackerProne: true
    };
  }

  /**
   * Resolve a push attack.
   * The target must be adjacent and directly in front of the pusher (p40).
   */
  resolvePush(attacker, target, diceRoller) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }
    if (hexDistance(attacker.position.hexKey, target.position.hexKey) !== 1) {
      return { success: false, reason: 'Push target must be adjacent' };
    }
    if (!this._inForwardArc(attacker, target)) {
      return { success: false, reason: 'Push target must be directly in front' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'push');
    const roll = diceRoller.roll2d6();
    const success = roll >= tn;

    return {
      success,
      type: 'push',
      roll,
      targetNumber: tn,
      targetPsrRequired: success
    };
  }

  /**
   * Base target number for a physical attack (p137).
   *
   * Piloting skill, plus the attack type's modifier, plus the physical attack's
   * own modifiers: comparative Piloting Skill for charge and DFA, actuator
   * damage for punch and kick, the standard movement modifiers for all attacks
   * (p28), and +2 for a prone attacker. Heat and gyro do not apply: physical
   * attacks are not PSRs (p130).
   */
  calculatePhysicalTN(attacker, target, type, options = {}) {
    let tn = attacker.pilot.piloting;
    const mods = [];

    tn += BASE_MODIFIER[type] || 0;

    if (type === 'charge' || type === 'dfa') {
      // Comparative modifier (p34): the better pilot is favoured.
      const comparative = attacker.pilot.piloting - target.pilot.piloting;
      tn += comparative;
      if (comparative !== 0) mods.push(`Comparative piloting: ${comparative}`);
    }

    if (type === 'dfa') {
      // p37: always add the jumping modifier, and no terrain modifiers apply.
      tn += DFA_JUMPING_MODIFIER;
      mods.push(`Jumping: +${DFA_JUMPING_MODIFIER}`);
    } else {
      tn += attacker.getAttackerMovementModifier();
    }

    // DFA ignores terrain modifiers (p37) but not the target's movement.
    if (target && typeof target.getTargetMovementModifier === 'function') {
      tn += target.getTargetMovementModifier();
    }

    if (attacker.prone) tn += 2;

    if (type === 'punch') {
      const armMods = this.punchModifiers(attacker, options.arm);
      if (!armMods.legal) return 999;
      tn += armMods.tn;
    } else if (type === 'kick') {
      const legMods = this.kickModifiers(attacker);
      if (!legMods.legal) return 999;
      tn += legMods.tn;
    }

    return Math.max(2, Math.min(12, tn));
  }

  punchLocation(roll) {
    const entry = PUNCH_TABLE[roll.toString()];
    return entry ? entry.location : 'centerTorso';
  }

  kickLocation(roll) {
    const entry = KICK_TABLE[roll.toString()];
    return entry ? entry.location : 'leftLeg';
  }

  chargeLocation(roll) {
    return this.punchLocation(roll);
  }
}
