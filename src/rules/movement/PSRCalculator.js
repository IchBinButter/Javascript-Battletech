/**
 * PSRCalculator - Piloting Skill Roll resolution.
 * Handles PSR triggers, modifiers, and fall damage.
 *
 * The Piloting Skill Roll Table (BMM p54/p142) separates two things that must
 * not be mixed up:
 *
 *  - Causes (what makes the player roll): taking 20+ damage in a phase,
 *    entering woods/water, running after a facing change on pavement, running
 *    with a damaged hip or gyro, jumping with damaged actuators, and so on.
 *  - Preexisting damage modifiers (footnote 9): "These cases do not cause
 *    PSRs, but their modifiers apply to all PSRs made." A damaged gyro, a
 *    destroyed hip and a destroyed leg are standing modifiers, not extra
 *    triggers — a walking 'Mech with a damaged gyro does not roll once per hex.
 */

import { quirkPSRModifier } from '../quirks/Quirks.js';
import { getActuatorDamage } from '../combat/UnitDamage.js';

/**
 * Facing After Fall Table (BMM p143). The roll also picks the Hit Location
 * column used for the falling damage (p56).
 */
const FACING_AFTER_FALL = {
  1: { hexsides: 0, column: 'front', label: 'Same Direction' },
  2: { hexsides: 1, column: 'right', label: '1 Hexside Right' },
  3: { hexsides: 2, column: 'right', label: '2 Hexsides Right' },
  4: { hexsides: 3, column: 'rear', label: 'Opposite Direction' },
  5: { hexsides: -2, column: 'left', label: '2 Hexsides Left' },
  6: { hexsides: -1, column: 'left', label: '1 Hexside Left' }
};

/** Split a damage value into 5-point Damage Value groupings (p42/p74). */
function splitIntoGroupings(damage, size = 5) {
  const groupings = [];
  let remaining = damage;
  while (remaining > 0) {
    const grouping = Math.min(size, remaining);
    groupings.push(grouping);
    remaining -= grouping;
  }
  return groupings;
}

export class PSRCalculator {
  /**
   * Get all PSR triggers applicable to a unit.
   * Returns array of { trigger: string, baseModifier: number }
   *
   * Preexisting gyro/hip/leg damage is deliberately absent: it modifies every
   * PSR (calculatePSRModifier) but only *causes* one when the 'Mech runs with a
   * damaged hip or gyro, or jumps with damaged actuators (p142).
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

      // p54/p142: "Ran with damaged hip or gyro" and "Jumped with damaged
      // gyro or leg/foot/hip actuators". The +2/+3 etc. are preexisting damage
      // modifiers and are added by calculatePSRModifier; the trigger itself
      // carries no modifier so nothing is counted twice.
      if (movement.type === 'run' && this._hasDamagedHipOrGyro(unit)) {
        triggers.push({ trigger: 'Ran with damaged hip or gyro', baseModifier: 0 });
      }

      if (movement.type === 'jump' && this._hasJumpPSRDamage(unit)) {
        triggers.push({ trigger: 'Jumped with damaged actuators', baseModifier: 0 });
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

      // p61: terrain modifications (ice +3, mud +1, deep snow +1, swamp +1).
      if (movement.terrainPSR && movement.terrainPSR.reasons && movement.terrainPSR.reasons.length) {
        triggers.push({
          trigger: movement.terrainPSR.reasons.join(', '),
          baseModifier: movement.terrainPSR.modifier
        });
      }

      // p62: heavy rain +1, torrential downpour +2 to every PSR.
      if (movement.weatherPSR) {
        triggers.push({ trigger: 'Weather Conditions', baseModifier: movement.weatherPSR });
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

    return triggers;
  }

  /**
   * Calculate the final PSR target number.
   * @param {Unit} unit
   * @param {Array} triggers - Array of trigger objects
   * @returns {{ targetNumber: number, modifiers: string[] }}
   */
  calculatePSRModifier(unit, triggers = []) {
    const basePiloting = unit.pilot.piloting;
    let modifier = 0;
    const modList = [];

    modList.push(`Base Pilot: ${basePiloting}`);

    // p52: "If a 'Mech shuts down involuntarily, a Piloting Skill Roll is
    // immediately required, with a +3 Target Number modifier. Regardless of how
    // it shut down, any other PSR required while shutdown fails automatically."
    // So the involuntary-shutdown roll is the one PSR that is not auto-failed.
    const isShutdownRoll = triggers.some(t =>
      t.trigger === 'Involuntary shutdown' || t.shutdown === true
    );
    if (unit.shutdown && !isShutdownRoll) {
      modList.push('Shutdown: automatic failure');
      return { targetNumber: 999, modifiers: modList };
    }

    // Preexisting damage (p142 footnote 9): standing modifiers on every PSR.
    const preexisting = this.preexistingDamageModifiers(unit);
    modifier += preexisting.modifier;
    modList.push(...preexisting.reasons);

    // p48: a destroyed gyro means the 'Mech automatically falls and is always
    // prone; there is no PSR it can pass (the fall-avoid roll is moot too).
    if (unit.gyro && (unit.gyro.hits || 0) >= 2) {
      modList.push('Gyro Destroyed: Auto-fail');
      return { targetNumber: 999, modifiers: modList };
    }

    for (const trigger of triggers) {
      modifier += trigger.baseModifier;
      if (trigger.baseModifier !== 0) {
        modList.push(`${trigger.trigger}: ${trigger.baseModifier > 0 ? '+' : ''}${trigger.baseModifier}`);
      } else {
        modList.push(`${trigger.trigger}`);
      }
    }

    // Negative design quirks (p86-89): Cramped Cockpit and Hard to Pilot raise
    // every PSR; Unbalanced only the ones for entering a hex. Passing the
    // triggers along lets the quirk code tell those apart.
    const quirkMod = quirkPSRModifier(unit, { triggers });
    modifier += quirkMod.modifier;
    modList.push(...quirkMod.reasons);

    const targetNumber = basePiloting + modifier;
    return { targetNumber, modifiers: modList };
  }

  /**
   * Preexisting damage modifiers from the PSR Table (p142), applied to every
   * PSR whether or not the damage caused this particular roll:
   *   gyro previously hit +3, per hip actuator previously destroyed +2,
   *   per leg/foot actuator previously destroyed +1, leg previously destroyed +5.
   * @returns {{ modifier: number, reasons: string[] }}
   */
  preexistingDamageModifiers(unit) {
    const reasons = [];
    let modifier = 0;

    const gyroHits = (unit.gyro && unit.gyro.hits) || 0;
    if (gyroHits >= 1) {
      modifier += 3;
      reasons.push('Gyro previously hit: +3');
    }

    let missingLeg = false;
    for (const leg of ['leftLeg', 'rightLeg']) {
      // p44/p142 footnote 11: a destroyed leg is +5 and ignores the other
      // critical modifiers from that leg.
      if (typeof unit.isLocationDestroyed === 'function' && unit.isLocationDestroyed(leg)) {
        missingLeg = true;
        continue;
      }

      const damage = getActuatorDamage(unit, leg);
      // p142 footnote 10: the hip's +2 replaces the other actuator modifiers
      // from that leg.
      if (damage.hip) {
        modifier += 2;
        reasons.push(`Hip previously destroyed (${leg}): +2`);
        continue;
      }

      let actuators = 0;
      if (damage.upperLeg) actuators++;
      if (damage.lowerLeg) actuators++;
      if (damage.foot) actuators++;
      if (actuators > 0) {
        modifier += actuators;
        reasons.push(`Leg/foot actuator previously destroyed (${leg}): +${actuators}`);
      }
    }

    if (missingLeg) {
      modifier += 5;
      reasons.push('Leg previously destroyed: +5');
    }

    return { modifier, reasons };
  }

  /**
   * Make a PSR roll.
   * @param {Unit} unit
   * @param {DiceRoller} diceRoller
   * @param {Array|null} triggers
   * @param {Object|null} movement - used to derive triggers when none are given
   * @param {Object|null} gameState
   * @returns {{ passed: boolean, roll: number, targetNumber: number, details: string }}
   */
  makePSR(unit, diceRoller, triggers = null, movement = null, gameState = null) {
    const triggerList = triggers || this.getPSRTriggers(unit, movement, gameState);
    const { targetNumber, modifiers } = this.calculatePSRModifier(unit, triggerList);

    // p54/p58: an unconscious warrior cannot make Piloting Skill Rolls, so the
    // Mech fails automatically. Consciousness Rolls themselves are not PSRs
    // and never come through here.
    if (unit.pilot && unit.pilot.conscious === false) {
      return { passed: false, roll: 0, targetNumber: 999, details: 'Auto-fail (pilot unconscious)' };
    }

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
   *
   * Sequence from the manual:
   *  1. The 'Mech is prone (p56).
   *  2. Roll 1D6 on the Facing After Fall Table (p56/p143); the result picks
   *     the Hit Location column for the falling damage.
   *  3. Make the MechWarrior's PSR *before* applying any damage to the 'Mech
   *     (p58), with all modifiers of the roll that caused the fall plus +1 in
   *     each level above the first. Only a failed roll injures the warrior;
   *     an immobile 'Mech or a target number above 12 damages automatically.
   *  4. Falling damage is ceil(tonnage / 10) x (levels fallen + 1) for a level
   *     fall (p74 example: 20 tons, 2 levels -> 2 x 3 = 6), and one x
   *     ceil(tonnage / 10) for a 0-level fall, applied in 5-point groupings.
   *
   * The caller applies `damage` using `hitLocationColumn`; the returned shape
   * is data only so the engine can batch the damage with the phase.
   *
   * @param {Unit} unit
   * @param {number} fallDirection - facing before the fall
   * @param {DiceRoller} diceRoller
   * @param {number} levelsFallen
   * @param {{ causeTriggers?: Array }} options - the triggers of the PSR that
   *   caused the fall, so their modifiers carry over to the warrior's roll.
   */
  resolveFall(unit, fallDirection, diceRoller, levelsFallen = 1, options = {}) {
    unit.prone = true;

    const levels = Math.max(0, Math.floor(levelsFallen) || 0);

    // p56/p143: Facing After Fall. A roller without 1D6 support falls back to
    // "same direction", which is the neutral result.
    const facingRoll = typeof diceRoller.roll1d6 === 'function' ? diceRoller.roll1d6() : 1;
    const facing = FACING_AFTER_FALL[facingRoll] || FACING_AFTER_FALL[1];
    const baseFacing = Number.isFinite(fallDirection) ? fallDirection : 0;
    const newFacing = ((baseFacing + facing.hexsides) % 6 + 6) % 6;

    // p58: MechWarrior PSR. The modifiers of the causal PSR apply, plus +1 for
    // each level above 1. A target above 12 (or an immobile 'Mech) avoids the
    // roll: the warrior takes the damage automatically.
    const causeTriggers = Array.isArray(options.causeTriggers) ? options.causeTriggers : [];
    const { targetNumber: causeTarget, modifiers: causeModifiers } =
      this.calculatePSRModifier(unit, causeTriggers);
    const fallModifier = Math.max(0, levels - 1);
    const targetNumber = causeTarget + fallModifier;

    const immobile = Boolean(unit.immobile) || Boolean(unit.shutdown) ||
      Boolean(unit.pilot && unit.pilot.conscious === false);
    const autoDamage = immobile || targetNumber > 12;

    let roll = null;
    let passed = true;
    if (!autoDamage) {
      roll = diceRoller.roll2d6();
      passed = roll >= targetNumber;
    } else {
      passed = false;
    }

    const pilotHit = !passed;
    if (pilotHit) {
      this._applyPilotDamage(unit, 1);
    }

    // p74: falling damage = ceil(tonnage / 10) x (levels fallen + 1).
    const baseDamage = Math.ceil((unit.tonnage || 0) / 10);
    const damage = levels > 0 ? baseDamage * (levels + 1) : baseDamage;

    return {
      prone: true,
      pilotHit,
      pilotPSR: {
        roll,
        targetNumber,
        passed,
        autoDamage,
        modifiers: [
          ...causeModifiers,
          ...(fallModifier > 0 ? [`Fell ${levels} levels: +${fallModifier}`] : [])
        ]
      },
      // The caller applies the damage to this column (p56/p143).
      facingAfterFall: {
        roll: facingRoll,
        label: facing.label,
        hexsides: facing.hexsides,
        facing: newFacing,
        hitLocationColumn: facing.column
      },
      hitLocationColumn: facing.column,
      levelsFallen: levels,
      damage,
      damageGroupings: splitIntoGroupings(damage)
    };
  }

  /**
   * One point of MechWarrior damage (p58). Real Units know how to cap at 6 and
   * kill the warrior; plain test doubles just count hits.
   */
  _applyPilotDamage(unit, points) {
    if (typeof unit.applyPilotDamage === 'function') {
      return unit.applyPilotDamage(points);
    }
    unit.pilot.hits = Math.min(6, (unit.pilot.hits || 0) + points);
    if (unit.pilot.hits >= 6) {
      unit.pilot.conscious = false;
      unit.pilot.dead = true;
    }
    return unit.pilot.hits;
  }

  hasLegActuatorDamage(unit) {
    return this._countActuatorHits(unit, 'leftLeg') > 0 ||
           this._countActuatorHits(unit, 'rightLeg') > 0;
  }

  hasHipActuatorDamage(unit) {
    return this._hipHits(unit) > 0;
  }

  isLegMissing(unit) {
    if (typeof unit.isLocationDestroyed !== 'function') return false;
    return unit.isLocationDestroyed('leftLeg') || unit.isLocationDestroyed('rightLeg');
  }

  /** p142: running forces a PSR when the hip or the gyro is damaged. */
  _hasDamagedHipOrGyro(unit) {
    return this._hipHits(unit) > 0 || Boolean(unit.gyro && (unit.gyro.hits || 0) >= 1);
  }

  /** p142: jumping forces a PSR for damaged gyro/leg/foot/hip actuators. */
  _hasJumpPSRDamage(unit) {
    if (unit.gyro && (unit.gyro.hits || 0) >= 1) return true;
    if (this.isLegMissing(unit)) return true;
    return this.hasLegActuatorDamage(unit) || this._hipHits(unit) > 0;
  }

  _hipHits(unit) {
    return ['leftLeg', 'rightLeg']
      .filter(leg => getActuatorDamage(unit, leg).hip)
      .length;
  }

  _countActuatorHits(unit, leg) {
    const slots = (unit.criticalSlots && unit.criticalSlots[leg]) || [];
    // A hip has its own +2 modifier and replaces the other leg modifiers
    // (p54, footnote 3), so it must not also count as a leg/foot actuator.
    return slots.filter(s =>
      (s.item || '').includes('actuator') &&
      !(s.item || '').includes('hip') &&
      s.status === 'destroyed'
    ).length;
  }
}
