/**
 * PhysicalAttackResolver - Physical attack resolution (punch, kick, charge, DFA, push, club).
 */

import { hexDistance, directionBetween } from '../../hex/HexMath.js';
import { PSRCalculator } from '../movement/PSRCalculator.js';

export class PhysicalAttackResolver {
  constructor() {
    this.psrCalc = new PSRCalculator();
  }

  /**
   * Resolve a punch attack.
   * Damages: 1 point per 10 tons of attacker. Hits punch location table.
   * Must have at least one functioning arm.
   * Target must be in front arc.
   */
  resolvePunch(attacker, target, diceRoller) {
    if (attacker.isLocationDestroyed('leftArm') && attacker.isLocationDestroyed('rightArm')) {
      return { success: false, reason: 'No functioning arms' };
    }
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'punch');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];

    if (hit) {
      damage = Math.floor(attacker.tonnage / 10); // 1 per 10 tons
      // Punch hits use punch location table (simplified: use standard)
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage }];
    }

    return {
      success: true,
      type: 'punch',
      hit,
      roll,
      targetNumber: tn,
      damage,
      hitLocations: locations
    };
  }

  /**
   * Resolve a kick attack.
   * Damages: 1 point per 5 tons of attacker. Hits kick location table.
   * Must have at least one functioning leg.
   * If miss: attacker must make PSR or fall.
   */
  resolveKick(attacker, target, diceRoller) {
    if (attacker.isLocationDestroyed('leftLeg') && attacker.isLocationDestroyed('rightLeg')) {
      return { success: false, reason: 'No functioning legs' };
    }
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'kick');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let damage = 0;
    let locations = [];
    let psrRequired = false;

    if (hit) {
      damage = Math.floor(attacker.tonnage / 5); // 1 per 5 tons
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.kickLocation(locRoll), damage }];
    } else {
      // Missed kick: PSR required
      psrRequired = true;
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
   * Attacker moves to target hex, deals damage based on distance charged.
   * Attacker also takes recipient's tonnage / 10 damage.
   */
  resolveCharge(attacker, target, distanceCharged, diceRoller) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'charge');
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let attackerDamage = 0;
    let targetDamage = 0;
    let locations = [];

    if (hit) {
      // Damage = attacker tonnage / 10 * distance charged in hexes
      targetDamage = Math.floor(attacker.tonnage / 10) * distanceCharged;
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.chargeLocation(locRoll), damage: targetDamage }];

      // Attacker takes damage = target tonnage / 10
      attackerDamage = Math.floor(target.tonnage / 10);
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
   * Resolve a Death From Above (DFA) attack.
   */
  resolveDFA(attacker, target, diceRoller) {
    if (!attacker.movement.jump || attacker.movement.jump <= 0) {
      return { success: false, reason: 'No jump jets' };
    }
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    // DFA is high-risk: TN = piloting + 4 (simplified)
    const tn = attacker.pilot.piloting + 4;
    const roll = diceRoller.roll2d6();
    const hit = roll >= tn;

    let targetDamage = 0;
    let kickDamage = 0;
    let attackerDamage = 0;
    let locations = [];

    if (hit) {
      targetDamage = Math.floor(attacker.tonnage / 10); // Punch damage component
      kickDamage = Math.floor(attacker.tonnage / 5); // Kick damage component
      attackerDamage = Math.floor(attacker.tonnage / 10); // Attacker always takes leg damage in DFA
      const locRoll = diceRoller.roll2d6();
      locations = [{ location: this.punchLocation(locRoll), damage: targetDamage }];
      const kickRoll = diceRoller.roll2d6();
      locations.push({ location: this.kickLocation(kickRoll), damage: kickDamage });
    } else {
      // Missed DFA: attacker auto-falls and takes damage
      attackerDamage = Math.floor(attacker.tonnage / 5);
    }

    return {
      success: true,
      type: 'dfa',
      hit,
      roll,
      targetNumber: tn,
      targetDamage: targetDamage + kickDamage,
      attackerDamage,
      hitLocations: locations,
      // DFA always knocks attacker prone
      attackerProne: true
    };
  }

  /**
   * Resolve a push attack.
   * Target must be adjacent. If a PSR is failed, target is pushed back 1 hex in the attack direction.
   */
  resolvePush(attacker, target, diceRoller) {
    if (attacker.prone) {
      return { success: false, reason: 'Attacker is prone' };
    }

    const tn = this.calculatePhysicalTN(attacker, target, 'push');
    const roll = diceRoller.roll2d6();
    const success = roll >= tn;

    let targetPsr = false;

    if (success) {
      targetPsr = true; // Target must make PSR or be pushed
    }

    return {
      success,
      type: 'push',
      roll,
      targetNumber: tn,
      targetPsrRequired: targetPsr
    };
  }

  /**
   * Calculate the base TN for a physical attack.
   * TN = piloting skill + modifiers
   */
  calculatePhysicalTN(attacker, target, type) {
    let tn = attacker.pilot.piloting;

    // Type-specific modifiers
    switch (type) {
      case 'punch':
        // Missing one arm: +1
        if (attacker.isLocationDestroyed('leftArm') || attacker.isLocationDestroyed('rightArm')) {
          tn += 1;
        }
        break;
      case 'kick':
        // Missing one leg: +2 (harder to kick with one leg)
        if (attacker.isLocationDestroyed('leftLeg') || attacker.isLocationDestroyed('rightLeg')) {
          tn += 2;
        }
        break;
      case 'charge':
        break;
      case 'dfa':
        tn += 4; // DFA is inherently difficult
        break;
      case 'push':
        break;
    }

    // Target movement modifier
    if (target) {
      tn += target.getTargetMovementModifier();
    }

    // Attacker movement modifier
    tn += attacker.getAttackerMovementModifier();

    // Gyro damage
    tn += attacker.gyro.hits;

    return Math.max(2, Math.min(12, tn));
  }

  punchLocation(roll) {
    const table = {
      2: 'head', 3: 'head', 4: 'centerTorso', 5: 'rightTorso',
      6: 'leftTorso', 7: 'centerTorso', 8: 'leftArm', 9: 'rightArm',
      10: 'leftTorso', 11: 'rightTorso', 12: 'head'
    };
    return table[roll] || 'centerTorso';
  }

  kickLocation(roll) {
    const table = {
      2: 'leftTorso', 3: 'rightTorso', 4: 'leftLeg', 5: 'rightLeg',
      6: 'leftLeg', 7: 'rightLeg', 8: 'leftLeg', 9: 'rightLeg',
      10: 'leftLeg', 11: 'rightLeg', 12: 'leftLeg'
    };
    return table[roll] || 'leftLeg';
  }

  chargeLocation(roll) {
    return this.punchLocation(roll); // Charges use punch table
  }
}
