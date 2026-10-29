import { describe, it, expect } from 'vitest';
import { PSRCalculator } from '../../../src/rules/movement/PSRCalculator.js';

function makeUnit(tonnage = 50, piloting = 5, overrides = {}) {
  return {
    id: 'test_unit',
    tonnage,
    pilot: { piloting, hits: 0, conscious: true },
    gyro: { hits: 0 },
    heat: 0,
    _damageThisPhase: 0,
    _physicalAttackReceived: false,
    position: { hexKey: '4,4', facing: 0 },
    prone: false,
    criticalSlots: {
      leftLeg: [
        { item: 'hip_actuator', status: 'ok' },
        { item: 'upper_leg_actuator', status: 'ok' },
        { item: 'lower_leg_actuator', status: 'ok' },
        { item: 'foot_actuator', status: 'ok' }
      ],
      rightLeg: [
        { item: 'hip_actuator', status: 'ok' },
        { item: 'upper_leg_actuator', status: 'ok' },
        { item: 'lower_leg_actuator', status: 'ok' },
        { item: 'foot_actuator', status: 'ok' }
      ]
    },
    isLocationDestroyed(loc) { return false; },
    ...overrides
  };
}

/** Dice double whose 2D6 rolls come from a scripted sequence. */
function makeDiceRoller(sequence = []) {
  let idx = 0;
  return {
    roll2d6() {
      if (idx < sequence.length) return sequence[idx++];
      return 7;
    }
  };
}

/**
 * Dice double for a fall: the 1D6 is the Facing After Fall roll, the 2D6
 * sequence feeds the MechWarrior's fall-damage PSR.
 */
function makeFallDice({ facingRoll = 1, psrRolls = [] } = {}) {
  let idx = 0;
  return {
    roll1d6() { return facingRoll; },
    roll2d6() {
      if (idx < psrRolls.length) return psrRolls[idx++];
      return 7;
    }
  };
}

describe('PSRCalculator', () => {
  const calc = new PSRCalculator();

  describe('getPSRTriggers', () => {
    // Causes come from the p54/p142 Piloting Skill Roll Table; the preexisting
    // damage rows (footnote 9) never appear here - they are standing modifiers
    // applied by calculatePSRModifier.
    // ── no triggers ──────────────────────────────────────────────
    it('returns empty array for a normal unit with no movement', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers).toEqual([]);
    });

    it('returns empty array for a walking unit at normal heat', () => {
      const unit = makeUnit(50, 5, { heat: 10 });
      const movement = { type: 'walk' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers).toEqual([]);
    });

    // ── Gyro damage: a standing modifier, not a trigger (p48/p142) ──
    it('a damaged gyro does not force a PSR on a walking Mech (p48)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = calc.getPSRTriggers(unit, { type: 'walk' }, null);
      expect(triggers).toEqual([]);
    });

    it('a damaged gyro does not force a PSR for a stationary Mech', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers).toEqual([]);
    });

    it('running with a damaged gyro forces a PSR (p48/p142)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = calc.getPSRTriggers(unit, { type: 'run' }, null);
      const ran = triggers.find(t => t.trigger === 'Ran with damaged hip or gyro');
      expect(ran).toBeDefined();
      // The +3 is preexisting damage, applied by calculatePSRModifier; the
      // cause itself must not add a second +3.
      expect(ran.baseModifier).toBe(0);
      expect(triggers).toHaveLength(1);
    });

    it('jumping with a damaged gyro forces a PSR (p142)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = calc.getPSRTriggers(unit, { type: 'jump' }, null);
      expect(triggers.find(t => t.trigger === 'Jumped with damaged actuators')).toBeDefined();
    });

    it('gyro with no hits adds no trigger', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 0 } });
      const triggers = calc.getPSRTriggers(unit, { type: 'run' }, null);
      expect(triggers.find(t => t.trigger === 'Ran with damaged hip or gyro')).toBeUndefined();
    });

    // ── Hip actuators: standing modifier, cause only on run/jump (p48/p142) ──
    it('a destroyed hip does not force a PSR while walking', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip_actuator
      expect(calc.getPSRTriggers(unit, { type: 'walk' }, null)).toEqual([]);
    });

    it('running with a destroyed hip forces a PSR (p48)', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, { type: 'run' }, null);
      expect(triggers.find(t => t.trigger === 'Ran with damaged hip or gyro')).toBeDefined();
    });

    it('jumping with a destroyed hip forces a PSR (p142)', () => {
      const unit = makeUnit();
      unit.criticalSlots.rightLeg[0].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, { type: 'jump' }, null);
      expect(triggers.find(t => t.trigger === 'Jumped with damaged actuators')).toBeDefined();
    });

    // ── Missing leg: a standing +5, not a per-hex trigger (p44/p142) ──
    it('a missing leg does not force a PSR while walking (p44)', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'leftLeg' });
      expect(calc.getPSRTriggers(unit, { type: 'walk' }, null)).toEqual([]);
    });

    it('jumping with a missing leg forces a PSR (p142)', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'leftLeg' });
      const triggers = calc.getPSRTriggers(unit, { type: 'jump' }, null);
      expect(triggers.find(t => t.trigger === 'Jumped with damaged actuators')).toBeDefined();
    });

    // ── Physical Attack Received ─────────────────────────────────
    it('detects physical attack received', () => {
      const unit = makeUnit(50, 5, { _physicalAttackReceived: true });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const phys = triggers.find(t => t.trigger === 'Physical Attack Received');
      expect(phys).toBeDefined();
      expect(phys.baseModifier).toBe(0);
      expect(triggers).toHaveLength(1);
    });

    it('a charge or DFA is +2 (p54)', () => {
      const unit = makeUnit(50, 5, { _physicalAttackReceived: 'charge' });
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === 'Physical Attack Received').baseModifier).toBe(2);
    });

    it('does not trigger physical attack if flag is false', () => {
      const unit = makeUnit(50, 5, { _physicalAttackReceived: false });
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === 'Physical Attack Received')).toBeUndefined();
    });

    it('does not trigger physical attack if flag is absent', () => {
      const unit = makeUnit();
      delete unit._physicalAttackReceived;
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === 'Physical Attack Received')).toBeUndefined();
    });

    // ── 20+ Damage Received ──────────────────────────────────────
    it('detects 20+ damage received', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 20 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const dmg = triggers.find(t => t.trigger === '20+ Damage Received');
      expect(dmg).toBeDefined();
      // p54: 20+ points of damage in one phase is +1
      expect(dmg.baseModifier).toBe(1);
    });

    it('detects damage above 20', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 35 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === '20+ Damage Received')).toBeDefined();
    });

    it('does not trigger 20+ damage below threshold', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 19 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === '20+ Damage Received')).toBeUndefined();
    });

    it('does not trigger 20+ damage at zero', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 0 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === '20+ Damage Received')).toBeUndefined();
    });

    // ── Water Depth ──────────────────────────────────────────────
    // p54: "Entered Depth 1 water hex -1, Entered Depth 2 water hex 0,
    // Entered Depth 3+ water hex +1". p60: "WATER (DEPTH 0) ... PSR Modifier:
    // No PSR", so shallow water never forces a roll (M-24).
    it('entered water depth 1 = -1 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 1 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      // p54: entering Depth 1 water is -1
      expect(water.baseModifier).toBe(-1);
    });

    it('entered water depth 2 = 0 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 2 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers.find(t => t.trigger === 'Entered Water').baseModifier).toBe(0);
    });

    it('entered water depth 3 = +1 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 3 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers.find(t => t.trigger === 'Entered Water').baseModifier).toBe(1);
    });

    it('entered water depth > 3 = +1 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 5 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers.find(t => t.trigger === 'Entered Water').baseModifier).toBe(1);
    });

    // p60: "WATER (DEPTH 0) ... PSR Modifier: No PSR". Depth 0 water is a
    // level-0 hex, not a hex that forces a PSR, so no trigger may be raised
    // (M-24): the old code pushed a bogus "Entered Water: 0" cause.
    it('entered Depth 0 water is not a PSR at all (p60)', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 0 };
      expect(calc.getPSRTriggers(unit, movement, null)).toEqual([]);
    });

    it('entered water with no recorded depth does not push a 0-modifier cause', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true };
      expect(calc.getPSRTriggers(unit, movement, null)).toEqual([]);
    });

    it('entered water not set = no trigger', () => {
      const unit = makeUnit();
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers.find(t => t.trigger === 'Entered Water')).toBeUndefined();
    });

    // ── Standing Up ──────────────────────────────────────────────
    it('detects standing up', () => {
      const unit = makeUnit();
      const movement = { standingUp: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const stand = triggers.find(t => t.trigger === 'Standing Up');
      expect(stand).toBeDefined();
      expect(stand.baseModifier).toBe(0);
    });

    it('standing up not set = no trigger', () => {
      const unit = makeUnit();
      const movement = { type: 'walk' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers.find(t => t.trigger === 'Standing Up')).toBeUndefined();
    });

    // ── Damaged actuators: a cause only when jumping (p142) ──────
    it('leg actuator damage alone does not force a PSR when running (p142)', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed'; // upper_leg_actuator
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      // p142 only lists "Ran with damaged hip or gyro", not leg/foot actuators.
      expect(triggers).toEqual([]);
    });

    it('jumping with leg actuator damage forces a PSR (p142)', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      const movement = { type: 'jump' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const jump = triggers.find(t => t.trigger === 'Jumped with damaged actuators');
      expect(jump).toBeDefined();
      // The +1 per actuator is a preexisting modifier (calculatePSRModifier),
      // so the cause itself must not carry it.
      expect(jump.baseModifier).toBe(0);
    });

    it('the trigger is not duplicated for several damaged actuators', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      unit.criticalSlots.rightLeg[2].status = 'destroyed';
      unit.criticalSlots.rightLeg[3].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, { type: 'jump' }, null);
      expect(triggers.filter(t => t.trigger === 'Jumped with damaged actuators')).toHaveLength(1);
    });

    it('a hip is not counted as a leg actuator: it has its own +2 (p54)', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip_actuator
      expect(calc.hasLegActuatorDamage(unit)).toBe(false);
      expect(calc.hasHipActuatorDamage(unit)).toBe(true);
    });

    it('leg actuator damage does NOT trigger when stationary', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers.find(t => t.trigger === 'Jumped with damaged actuators')).toBeUndefined();
    });

    // ── Rubble ───────────────────────────────────────────────────
    // p54: "Entered rubble hex 0".
    it('detects entered rubble', () => {
      const unit = makeUnit();
      const movement = { enteredRubble: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const rubble = triggers.find(t => t.trigger === 'Rubble');
      expect(rubble).toBeDefined();
      expect(rubble.baseModifier).toBe(0);
    });

    // ── Terrain types: woods, jungle, sand (p60/p142) ────────────
    // p60: "WOODS, LIGHT ... PSR Modifier: No PSR", "WOODS, HEAVY ... PSR
    // Modifier: No PSR"; only the jungle rows carry a modifier. Woods are
    // therefore not a PSR cause, and woods flags must not be read at all
    // (M-23: the old code applied the jungle +1/+2 to woods).
    it('entering light woods is not a PSR (p60)', () => {
      const unit = makeUnit();
      expect(calc.getPSRTriggers(unit, { enteredLightWoods: true }, null)).toEqual([]);
    });

    it('entering heavy woods is not a PSR (p60)', () => {
      const unit = makeUnit();
      expect(calc.getPSRTriggers(unit, { enteredHeavyWoods: true }, null)).toEqual([]);
    });

    // p60: "JUNGLE, LIGHT ... PSR Modifier: +1", "JUNGLE, HEAVY ... +2";
    // p142: "Entered light jungle hex +1", "Entered heavy jungle hex +2".
    it('entering light jungle = +1 (p60/p142)', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, { enteredLightJungle: true }, null);
      const jungle = triggers.find(t => t.trigger === 'Light Jungle');
      expect(jungle).toBeDefined();
      expect(jungle.baseModifier).toBe(1);
      expect(triggers).toHaveLength(1);
    });

    it('entering heavy jungle = +2 (p60/p142)', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, { enteredHeavyJungle: true }, null);
      const jungle = triggers.find(t => t.trigger === 'Heavy Jungle');
      expect(jungle).toBeDefined();
      expect(jungle.baseModifier).toBe(2);
    });

    // p60: "SAND ... PSR Modifier: +1"; p142: "Entered sand hex +1" (M-24).
    it('entering sand = +1 (p60/p142)', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, { enteredSand: true }, null);
      const sand = triggers.find(t => t.trigger === 'Sand');
      expect(sand).toBeDefined();
      expect(sand.baseModifier).toBe(1);
      expect(triggers).toHaveLength(1);
    });

    it('sand does not modify a PSR caused by something else', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 20 });
      const triggers = calc.getPSRTriggers(unit, { type: 'walk' }, null);
      expect(triggers.find(t => t.trigger === 'Sand')).toBeUndefined();
      expect(triggers.find(t => t.trigger === '20+ Damage Received').baseModifier).toBe(1);
    });

    // ── Skidding ─────────────────────────────────────────────────
    // p54/p142: "Running after facing change while on pavement - see Skidding,
    // p.68". The Skid Modifiers Table is not modelled yet (M-18), so only the
    // cause is asserted here.
    it('detects skidding', () => {
      const unit = makeUnit();
      const movement = { isSkidding: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      expect(triggers.find(t => t.trigger === 'Skidding')).toBeDefined();
    });

    // ── Fabricated causes are gone (M-25) ────────────────────────
    // "Large Level Drop", "Rapid Turn (Running)" and "Jumped Into Woods" are
    // not PSR causes: a 2+ level drop is an accidental fall (p56/p70), the
    // manual has no rapid-turn roll, and p132 states "No PSR is required for a
    // 'Mech to jump into a woods hex". Their flags must stay inert.
    it('never raises the removed level-drop, rapid-turn or jump-into-woods causes', () => {
      const unit = makeUnit();
      const movement = {
        type: 'jump',
        largeLevelDrop: true,
        rapidTurnWhileRunning: true,
        jumpedIntoWoods: true
      };
      const triggerNames = calc.getPSRTriggers(unit, movement, null).map(t => t.trigger);
      expect(triggerNames).not.toContain('Large Level Drop');
      expect(triggerNames).not.toContain('Rapid Turn (Running)');
      expect(triggerNames).not.toContain('Jumped Into Woods');
      // No flag may add a cause for a healthy 'Mech, even while jumping.
      expect(triggerNames).toEqual([]);
    });

    // ── Multiple simultaneous triggers ───────────────────────────
    it('combines causes but keeps preexisting damage out of the trigger list', () => {
      const unit = makeUnit(50, 5, {
        gyro: { hits: 1 },
        _damageThisPhase: 25,
        _physicalAttackReceived: true,
        isLocationDestroyed: (loc) => loc === 'leftLeg'
      });
      const movement = {
        type: 'run',
        enteredWater: true,
        waterDepth: 2,
        enteredRubble: true,
        enteredLightJungle: true,
        enteredSand: true
      };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const triggerNames = triggers.map(t => t.trigger);
      expect(triggerNames).toContain('20+ Damage Received');
      expect(triggerNames).toContain('Physical Attack Received');
      expect(triggerNames).toContain('Ran with damaged hip or gyro');
      expect(triggerNames).toContain('Entered Water');
      expect(triggerNames).toContain('Rubble');
      expect(triggerNames).toContain('Light Jungle');
      expect(triggerNames).toContain('Sand');
      expect(triggerNames).not.toContain('Gyro Damage');
      expect(triggerNames).not.toContain('Missing Leg');
      expect(triggers).toHaveLength(7);
    });
  });

  describe('calculatePSRModifier', () => {
    it('returns base piloting with no triggers', () => {
      const unit = makeUnit(50, 5);
      const { targetNumber } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(5);
    });

    it('returns base piloting for different piloting skill', () => {
      const unit = makeUnit(50, 3);
      const { targetNumber } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(3);
    });

    // ── Preexisting damage: +modifiers on every PSR (p142 footnote 9) ──
    it('a previously hit gyro adds +3 to any PSR', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const { targetNumber, modifiers } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(8);
      expect(modifiers).toContain('Gyro previously hit: +3');
    });

    it('a destroyed hip adds +2 to any PSR', () => {
      const unit = makeUnit(50, 5);
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      expect(calc.calculatePSRModifier(unit, []).targetNumber).toBe(7);
    });

    it('two destroyed hips add +2 each (p142 "per hip")', () => {
      const unit = makeUnit(50, 5);
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      unit.criticalSlots.rightLeg[0].status = 'destroyed';
      const { targetNumber, modifiers } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(9);
      expect(modifiers.filter(m => m.includes('Hip previously destroyed'))).toHaveLength(2);
    });

    it('a destroyed hip replaces the other actuator modifiers from that leg (p142 fn 10)', () => {
      const unit = makeUnit(50, 5);
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip
      unit.criticalSlots.leftLeg[1].status = 'destroyed'; // upper leg actuator, same leg
      expect(calc.calculatePSRModifier(unit, []).targetNumber).toBe(7); // +2 only
    });

    it('leg and foot actuators add +1 each (p142)', () => {
      const unit = makeUnit(50, 5);
      unit.criticalSlots.leftLeg[1].status = 'destroyed'; // upper
      unit.criticalSlots.rightLeg[3].status = 'destroyed'; // foot
      expect(calc.calculatePSRModifier(unit, []).targetNumber).toBe(7);
    });

    it('a destroyed leg adds +5 and ignores that leg\'s actuators (p142 fn 11)', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'leftLeg' });
      unit.criticalSlots.leftLeg[1].status = 'destroyed'; // ignored: leg is gone
      unit.criticalSlots.rightLeg[3].status = 'destroyed'; // +1
      const { targetNumber, modifiers } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(11); // 5 + 5 + 1
      expect(modifiers).toContain('Leg previously destroyed: +5');
    });

    it('preexisting damage applies to a PSR caused by terrain too', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      // A generic terrain cause with a +2 modifier; the specific terrain rows
      // live in the movement tests, this only proves the modifier stack.
      const triggers = [{ trigger: 'Terrain Modification', baseModifier: 2 }];
      expect(calc.calculatePSRModifier(unit, triggers).targetNumber).toBe(10);
    });

    // ── Shutdown (p52) ───────────────────────────────────────────
    it('the involuntary-shutdown PSR resolves at piloting +3 (p52)', () => {
      const unit = makeUnit(50, 5, { shutdown: true });
      const triggers = [{ trigger: 'Involuntary shutdown', baseModifier: 3 }];
      const { targetNumber, modifiers } = calc.calculatePSRModifier(unit, triggers);
      expect(targetNumber).toBe(8);
      expect(modifiers).not.toContain('Shutdown: automatic failure');
    });

    it('any other PSR while shut down fails automatically (p52)', () => {
      const unit = makeUnit(50, 5, { shutdown: true });
      const triggers = [{ trigger: 'Kicked', baseModifier: 0 }];
      expect(calc.calculatePSRModifier(unit, triggers).targetNumber).toBe(999);
    });

    it('a shutdown PSR with no cause fails automatically (p52)', () => {
      const unit = makeUnit(50, 5, { shutdown: true });
      expect(calc.calculatePSRModifier(unit, []).targetNumber).toBe(999);
    });

    // ── Destroyed gyro ───────────────────────────────────────────
    it('returns 999 for destroyed gyro (2 hits)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      expect(calc.calculatePSRModifier(unit, []).targetNumber).toBe(999);
    });

    it('returns 999 for destroyed gyro (3 hits)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 3 } });
      expect(calc.calculatePSRModifier(unit, []).targetNumber).toBe(999);
    });

    // ── Explicit trigger modifiers ───────────────────────────────
    it('adds explicit trigger modifiers cumulatively', () => {
      const unit = makeUnit(50, 5);
      const triggers = [
        { trigger: 'Gyro Damage', baseModifier: 3 },
        { trigger: 'Hip Actuator Damage', baseModifier: 2 }
      ];
      expect(calc.calculatePSRModifier(unit, triggers).targetNumber).toBe(10);
    });

    it('adds three trigger modifiers', () => {
      const unit = makeUnit(50, 4);
      const triggers = [
        { trigger: 'Gyro Damage', baseModifier: 3 },
        { trigger: 'Missing Leg', baseModifier: 5 },
        { trigger: 'Hip Actuator Damage', baseModifier: 2 }
      ];
      expect(calc.calculatePSRModifier(unit, triggers).targetNumber).toBe(14);
    });

    it('returns modifiers list with descriptions', () => {
      const unit = makeUnit(50, 5);
      const triggers = [
        { trigger: 'Gyro Damage', baseModifier: 3 },
        { trigger: 'Hip Actuator Damage', baseModifier: 2 }
      ];
      const { modifiers } = calc.calculatePSRModifier(unit, triggers);
      expect(modifiers).toContain('Base Pilot: 5');
      expect(modifiers.some(m => m.includes('Gyro Damage'))).toBe(true);
      expect(modifiers.some(m => m.includes('+3'))).toBe(true);
      expect(modifiers.some(m => m.includes('Hip Actuator Damage'))).toBe(true);
      expect(modifiers.some(m => m.includes('+2'))).toBe(true);
    });
  });

  describe('makePSR', () => {
    it('passes when roll meets target exactly', () => {
      const unit = makeUnit(50, 5);
      const result = calc.makePSR(unit, makeDiceRoller([5]), []);
      expect(result.passed).toBe(true);
      expect(result.roll).toBe(5);
      expect(result.targetNumber).toBe(5);
    });

    it('passes when roll exceeds target', () => {
      const unit = makeUnit(50, 5);
      const result = calc.makePSR(unit, makeDiceRoller([8]), []);
      expect(result.passed).toBe(true);
      expect(result.roll).toBe(8);
    });

    it('fails when roll is below target', () => {
      const unit = makeUnit(50, 5);
      const result = calc.makePSR(unit, makeDiceRoller([4]), []);
      expect(result.passed).toBe(false);
    });

    it('passes at high target with high roll', () => {
      const unit = makeUnit(50, 5);
      const triggers = [{ trigger: 'Gyro Damage', baseModifier: 3 }];
      const result = calc.makePSR(unit, makeDiceRoller([8]), triggers);
      expect(result.passed).toBe(true);
      expect(result.targetNumber).toBe(8);
    });

    it('fails at high target with low roll', () => {
      const unit = makeUnit(50, 5);
      const triggers = [{ trigger: 'Gyro Damage', baseModifier: 3 }];
      const result = calc.makePSR(unit, makeDiceRoller([7]), triggers);
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(8);
    });

    it('auto-fails when gyro destroyed (hits=3)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 3 } });
      const result = calc.makePSR(unit, makeDiceRoller([12]));
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(999);
      expect(result.details).toContain('Auto-fail');
    });

    it('auto-fails when gyro destroyed (hits=2)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const result = calc.makePSR(unit, makeDiceRoller([12]));
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(999);
    });

    it('includes details string with modifiers', () => {
      const unit = makeUnit(50, 5);
      const triggers = [{ trigger: 'Some Mod', baseModifier: 3 }];
      const result = calc.makePSR(unit, makeDiceRoller([8]), triggers);
      expect(result.details).toBeDefined();
      expect(result.details).toContain('PASS');
    });

    it('derives triggers from movement when none are provided', () => {
      const unit = makeUnit(50, 5);
      const result = calc.makePSR(unit, makeDiceRoller([5]), null, { type: 'walk' });
      expect(result.targetNumber).toBe(5);
    });

    it('derives the run-with-damaged-gyro cause from movement', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const result = calc.makePSR(unit, makeDiceRoller([8]), null, { type: 'run' });
      expect(result.targetNumber).toBe(8); // +3 preexisting, no second +3
      expect(result.passed).toBe(true);
    });

    it('resolves the involuntary-shutdown PSR at piloting +3 (p52)', () => {
      const unit = makeUnit(50, 5, { shutdown: true });
      const triggers = [{ trigger: 'Involuntary shutdown', baseModifier: 3 }];
      const result = calc.makePSR(unit, makeDiceRoller([8]), triggers);
      expect(result.targetNumber).toBe(8);
      expect(result.passed).toBe(true);
    });

    it('auto-fails a different PSR raised while shut down (p52)', () => {
      const unit = makeUnit(50, 5, { shutdown: true });
      const triggers = [{ trigger: 'Kicked', baseModifier: 0 }];
      const result = calc.makePSR(unit, makeDiceRoller([12]), triggers);
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(999);
    });
  });

  describe('resolveFall', () => {
    it('sets the unit prone', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }));
      expect(unit.prone).toBe(true);
      expect(result.prone).toBe(true);
    });

    // p56/p143: Facing After Fall determines the Hit Location column.
    it('rolls 1D6 on the Facing After Fall Table (p56/p143)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ facingRoll: 1, psrRolls: [7] }));
      expect(result.facingAfterFall.roll).toBe(1);
      expect(result.facingAfterFall.facing).toBe(0);
      expect(result.hitLocationColumn).toBe('front');
    });

    it('a 3 turns two hexsides right and uses the right column', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ facingRoll: 3, psrRolls: [7] }));
      expect(result.facingAfterFall.facing).toBe(2);
      expect(result.hitLocationColumn).toBe('right');
    });

    it('a 4 is the opposite direction (rear column)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ facingRoll: 4, psrRolls: [7] }));
      expect(result.facingAfterFall.facing).toBe(3);
      expect(result.hitLocationColumn).toBe('rear');
    });

    it('a 6 is one hexside left and wraps around', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 5, makeFallDice({ facingRoll: 6, psrRolls: [7] }));
      expect(result.facingAfterFall.facing).toBe(4);
      expect(result.hitLocationColumn).toBe('left');
    });

    // p58: the MechWarrior makes a PSR and only takes a hit on failure.
    it('no pilot damage when the warrior PSR passes (p58)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }));
      expect(result.pilotPSR.passed).toBe(true);
      expect(result.pilotHit).toBe(false);
      expect(unit.pilot.hits).toBe(0);
    });

    it('the warrior takes 1 point of damage when the PSR fails (p58)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [4] }));
      expect(result.pilotPSR.passed).toBe(false);
      expect(result.pilotPSR.targetNumber).toBe(5);
      expect(result.pilotHit).toBe(true);
      expect(unit.pilot.hits).toBe(1);
    });

    it('adds +1 per level above the first to the warrior PSR (p58)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [6] }), 3);
      expect(result.pilotPSR.targetNumber).toBe(7); // 5 + 2 levels above 1
      expect(result.pilotHit).toBe(true);
    });

    it('carries the modifiers of the fall-causing PSR into the warrior roll (p58)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [6] }), 1, {
        causeTriggers: [{ trigger: 'Terrain Modification', baseModifier: 2 }]
      });
      expect(result.pilotPSR.targetNumber).toBe(7);
      expect(result.pilotPSR.modifiers).toContain('Terrain Modification: +2');
      expect(result.pilotHit).toBe(true);
    });

    it('an immobile Mech damages the warrior automatically (p58)', () => {
      const unit = makeUnit(50, 5, { immobile: true });
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [12] }));
      expect(result.pilotPSR.autoDamage).toBe(true);
      expect(result.pilotPSR.roll).toBeNull();
      expect(result.pilotHit).toBe(true);
      expect(unit.pilot.hits).toBe(1);
    });

    it('a target number above 12 damages the warrior automatically (p58)', () => {
      const unit = makeUnit(50, 5, {
        gyro: { hits: 1 },
        isLocationDestroyed: (loc) => loc === 'leftLeg'
      });
      // 5 + 3 (gyro) + 5 (leg) = 13.
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [12] }));
      expect(result.pilotPSR.targetNumber).toBe(13);
      expect(result.pilotPSR.autoDamage).toBe(true);
      expect(result.pilotHit).toBe(true);
    });

    it('a sixth point of pilot damage kills the MechWarrior (p58)', () => {
      const unit = makeUnit(50, 5, { pilot: { piloting: 5, hits: 5, conscious: true } });
      calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [2] }));
      expect(unit.pilot.hits).toBe(6);
      expect(unit.pilot.conscious).toBe(false);
      expect(unit.pilot.dead).toBe(true);
    });

    it('caps pilot damage at 6 and stays unconscious', () => {
      const unit = makeUnit(50, 5, { pilot: { piloting: 5, hits: 6, conscious: false } });
      calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [2] }));
      expect(unit.pilot.hits).toBe(6);
      expect(unit.pilot.conscious).toBe(false);
    });

    it('pilot remains conscious at 5 hits after a failed warrior PSR', () => {
      const unit = makeUnit(50, 5, { pilot: { piloting: 5, hits: 4, conscious: true } });
      calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [2] }));
      expect(unit.pilot.conscious).toBe(true);
      expect(unit.pilot.hits).toBe(5);
    });

    // p74: falling damage = ceil(tonnage / 10) x (levels fallen + 1).
    it('0-level fall: ceil(tonnage / 10) once', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }), 0);
      expect(result.damage).toBe(5); // 5 x 1
    });

    it('1-level fall: ceil(tonnage / 10) x 2 (p74 levels + 1)', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }), 1);
      expect(result.damage).toBe(10); // 5 x 2
    });

    it('2-level fall: a 20-ton Mech takes 6 points (p74 Locust example)', () => {
      const unit = makeUnit(20, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }), 2);
      expect(result.damage).toBe(6); // 2 x 3
      expect(result.damageGroupings).toEqual([5, 1]);
    });

    it('3-level fall: a 20-ton Mech takes 8 points (p74 Stinger example)', () => {
      const unit = makeUnit(20, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }), 3);
      expect(result.damage).toBe(8); // 2 x 4
      expect(result.damageGroupings).toEqual([5, 3]);
    });

    it('defaults levelsFallen to 1', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }));
      expect(result.levelsFallen).toBe(1);
      expect(result.damage).toBe(10);
    });

    it('fall damage scales with tonnage: 55-ton Mech, 1 level', () => {
      const unit = makeUnit(55, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }), 1);
      expect(result.damage).toBe(12); // ceil(5.5) x 2
    });

    it('fall damage scales with tonnage: 100-ton Mech, 2 levels', () => {
      const unit = makeUnit(100, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ psrRolls: [7] }), 2);
      expect(result.damage).toBe(30); // 10 x 3
    });

    it('returns the full fall result shape', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeFallDice({ facingRoll: 1, psrRolls: [7] }), 2);
      expect(result).toMatchObject({
        prone: true,
        pilotHit: false,
        hitLocationColumn: 'front',
        levelsFallen: 2,
        damage: 15,
        damageGroupings: [5, 5, 5]
      });
      expect(result.pilotPSR.targetNumber).toBe(6); // 5 + 1 level above 1
    });
  });

  describe('hasLegActuatorDamage', () => {
    it('returns false for undamaged actuators', () => {
      const unit = makeUnit();
      expect(calc.hasLegActuatorDamage(unit)).toBe(false);
    });

    it('returns true when a left leg actuator is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      expect(calc.hasLegActuatorDamage(unit)).toBe(true);
    });

    it('returns true when a right leg actuator is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.rightLeg[2].status = 'destroyed';
      expect(calc.hasLegActuatorDamage(unit)).toBe(true);
    });

    it('does not count a destroyed hip as a leg actuator', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip_actuator
      expect(calc.hasLegActuatorDamage(unit)).toBe(false);
    });

    it('returns true when foot actuator is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.rightLeg[3].status = 'destroyed'; // foot_actuator
      expect(calc.hasLegActuatorDamage(unit)).toBe(true);
    });

    it('returns false when actuator status is something else', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'damaged'; // not 'destroyed'
      expect(calc.hasLegActuatorDamage(unit)).toBe(false);
    });
  });

  describe('hasHipActuatorDamage', () => {
    it('returns false for undamaged hip actuators', () => {
      const unit = makeUnit();
      expect(calc.hasHipActuatorDamage(unit)).toBe(false);
    });

    it('returns true when left hip is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      expect(calc.hasHipActuatorDamage(unit)).toBe(true);
    });

    it('returns true when right hip is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.rightLeg[0].status = 'destroyed';
      expect(calc.hasHipActuatorDamage(unit)).toBe(true);
    });

    it('returns false when a non-hip actuator is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed'; // upper_leg_actuator, not hip
      expect(calc.hasHipActuatorDamage(unit)).toBe(false);
    });
  });

  describe('isLegMissing', () => {
    it('returns false when both legs present', () => {
      const unit = makeUnit();
      expect(calc.isLegMissing(unit)).toBe(false);
    });

    it('returns true when left leg is destroyed', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'leftLeg' });
      expect(calc.isLegMissing(unit)).toBe(true);
    });

    it('returns true when right leg is destroyed', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'rightLeg' });
      expect(calc.isLegMissing(unit)).toBe(true);
    });

    it('returns false when the unit cannot report location destruction', () => {
      const unit = makeUnit();
      delete unit.isLocationDestroyed;
      expect(calc.isLegMissing(unit)).toBe(false);
    });
  });
});
