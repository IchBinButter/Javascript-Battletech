/**
 * PSRCalculator - Piloting Skill Roll resolution.
 * Handles PSR triggers, modifiers, and fall damage.
 */

import { parseHexKey } from '../../utils/helpers.js';

export class PSRCalculator {
  /**
   * Get all PSR triggers applicable to a unit.
   * Returns array of { trigger: string, baseModifier: number }
   */
  getPSRTriggers(unit, movement, gameState) {
    const triggers = [];

    if (movement) {
      // p54: entering light jungle/woods +1, heavy +2
      if (movement.enteredLightWoods) {
        triggers.push({ trigger: 'Light Woods', baseModifier: 1 });
      }

      if (movement.enteredHeavyWoods) {
        triggers.push({ trigger: 'Heavy Woods', baseModifier: 2 });
      }

      if (movement.enteredRubble) {
        triggers.push({ trigger: 'Rubble', baseModifier: 0 });
      }

      if (movement.largeLevelDrop) {
        triggers.push({ trigger: 'Large Level Drop', baseModifier: 0 });
      }

      if (movement.isSkidding) {
        triggers.push({ trigger: 'Skidding', baseModifier: 0 });
      }

      if (movement.rapidTurnWhileRunning) {
        triggers.push({ trigger: 'Rapid Turn (Running)', baseModifier: 0 });
      }

      // p54: running or jumping with damaged leg/foot actuators, +1 each
      if ((movement.type === 'run' || movement.type === 'jump') && this.hasLegActuatorDamage(unit)) {
        const legHits = this._countActuatorHits(unit, 'leftLeg') + this._countActuatorHits(unit, 'rightLeg');
        if (legHits > 0) {
          triggers.push({ trigger: 'Damaged Leg Actuators', baseModifier: legHits });
        }
      }

      if (movement.jumpedIntoWoods) {
        triggers.push({ trigger: 'Jumped Into Woods', baseModifier: 0 });
      }

      if (movement.enteredWater) {
        // p54: entering Depth 1 water is -1, Depth 2 is 0, Depth 3+ is +1
        const depth = movement.waterDepth || 0;
        const waterMod = depth === 1 ? -1 : depth >= 3 ? 1 : 0;
        triggers.push({ trigger: 'Entered Water', baseModifier: waterMod });
      }

      if (movement.standingUp) {
        triggers.push({ trigger: 'Standing Up', baseModifier: 0 });
      }

    }

    if (unit._damageThisPhase >= 20) {
      // p54: 20+ points of damage in one phase is +1, once, however much it is
      triggers.push({ trigger: '20+ Damage Received', baseModifier: 1 });
    }

    if (unit._physicalAttackReceived) {
      // p54: being kicked or pushed is 0, being charged or hit by a DFA is +2
      const kind = typeof unit._physicalAttackReceived === 'string'
        ? unit._physicalAttackReceived
        : '';
      const physicalMod = kind === 'charge' || kind === 'dfa' ? 2 : 0;
      triggers.push({ trigger: 'Physical Attack Received', baseModifier: physicalMod });
    }

    if (unit.gyro.hits >= 1) {
      triggers.push({ trigger: 'Gyro Damage', baseModifier: unit.gyro.hits === 1 ? 3 : 999 });
    }

    if (this.hasHipActuatorDamage(unit)) {
      triggers.push({ trigger: 'Hip Actuator Damage', baseModifier: 2 });
    }

    if (this.isLegMissing(unit)) {
      triggers.push({ trigger: 'Missing Leg', baseModifier: 5 });
    }

    return triggers;
  }

  /**
   * Calculate the final PSR target number.
   * @param {Unit} unit
   * @param {Array} triggers - Array of trigger objects
   * @returns {{ targetNumber: number, modifiers: string[] }}
   */
  calculatePSRModifier(unit, triggers) {
    const basePiloting = unit.pilot.piloting;
    let modifier = 0;
    const modList = [];

    modList.push(`Base Pilot: ${basePiloting}`);

    for (const trigger of triggers) {
      modifier += trigger.baseModifier;
      if (trigger.baseModifier !== 0) {
        modList.push(`${trigger.trigger}: ${trigger.baseModifier > 0 ? '+' : ''}${trigger.baseModifier}`);
      } else {
        modList.push(`${trigger.trigger}`);
      }
    }

    // Gyro hit already handled in triggers, but add standard gyro PSR if needed
    if (unit.gyro.hits === 1) {
      modList.push('Gyro Hit: +3 (PSR required)');
    } else if (unit.gyro.hits >= 2) {
      modList.push('Gyro Destroyed: Auto-fail');
      return { targetNumber: 999, modifiers: modList };
    }

    const targetNumber = basePiloting + modifier;
    return { targetNumber, modifiers: modList };
  }

  /**
   * Make a PSR roll.
   * @returns {{ passed: boolean, roll: number, targetNumber: number, details: string }}
   */
  makePSR(unit, diceRoller, triggers = null) {
    const triggerList = triggers || this.getPSRTriggers(unit, null, null);
    const { targetNumber, modifiers } = this.calculatePSRModifier(unit, triggerList);

    if (targetNumber >= 999) {
      return { passed: false, roll: 0, targetNumber: 999, details: 'Auto-fail (Gyro destroyed)' };
    }

    const roll = diceRoller.roll2d6();
    const passed = roll >= targetNumber;

    return {
      passed,
      roll,
      targetNumber,
      details: `Rolled ${roll} (need ${targetNumber}): ${passed ? 'PASS' : 'FAIL'} - ${modifiers.join(', ')}`
    };
  }

  /**
   * Resolve a fall.
   * Applies pilot hit and location damage.
   */
  resolveFall(unit, fallDirection, diceRoller, levelsFallen = 1) {
    unit.prone = true;

    unit.pilot.hits++;
    if (unit.pilot.hits >= 6) {
      unit.pilot.conscious = false;
    }

    const baseDamage = Math.ceil(unit.tonnage / 10);
    const fallDamage = baseDamage * levelsFallen;

    const result = {
      pilotHit: true,
      prone: true,
      locations: ['leftLeg', 'rightLeg'],
      damage: fallDamage
    };

    return result;
  }

  hasLegActuatorDamage(unit) {
    return this._countActuatorHits(unit, 'leftLeg') > 0 ||
           this._countActuatorHits(unit, 'rightLeg') > 0;
  }

  hasHipActuatorDamage(unit) {
    const left = unit.criticalSlots.leftLeg || [];
    const right = unit.criticalSlots.rightLeg || [];
    for (const slot of [...left, ...right]) {
      if ((slot.item || '').includes('hip') && slot.status === 'destroyed') return true;
    }
    return false;
  }

  isLegMissing(unit) {
    return unit.isLocationDestroyed('leftLeg') || unit.isLocationDestroyed('rightLeg');
  }

  _countActuatorHits(unit, leg) {
    const slots = unit.criticalSlots[leg] || [];
    // A hip has its own +2 modifier and replaces the other leg modifiers
    // (p54, footnote 3), so it must not also count as a leg/foot actuator.
    return slots.filter(s =>
      (s.item || '').includes('actuator') &&
      !(s.item || '').includes('hip') &&
      s.status === 'destroyed'
    ).length;
  }
}
