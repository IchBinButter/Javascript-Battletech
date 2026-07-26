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

function makeDiceRoller(sequence = []) {
  let idx = 0;
  return {
    roll2d6() {
      if (idx < sequence.length) return sequence[idx++];
      return 7;
    }
  };
}

describe('PSRCalculator', () => {
  const calc = new PSRCalculator();

  describe('getPSRTriggers', () => {
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

    // ── Gyro Damage ──────────────────────────────────────────────
    it('gyro with 1 hit: +3 modifier', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const gyro = triggers.find(t => t.trigger === 'Gyro Damage');
      expect(gyro).toBeDefined();
      expect(gyro.baseModifier).toBe(3);
      expect(triggers).toHaveLength(1);
    });

    it('gyro with 2 hits: auto-fail (999 modifier)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const gyro = triggers.find(t => t.trigger === 'Gyro Damage');
      expect(gyro).toBeDefined();
      expect(gyro.baseModifier).toBe(999);
    });

    it('gyro with 3 hits: auto-fail (999 modifier)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 3 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const gyro = triggers.find(t => t.trigger === 'Gyro Damage');
      expect(gyro).toBeDefined();
      expect(gyro.baseModifier).toBe(999);
    });

    it('gyro with 0 hits: no trigger', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 0 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const gyro = triggers.find(t => t.trigger === 'Gyro Damage');
      expect(gyro).toBeUndefined();
    });

    // ── Overheating ──────────────────────────────────────────────
    it('overheating triggers when running and heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 15 });
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeDefined();
      expect(overheat.baseModifier).toBe(0);
    });

    it('overheating triggers when running and heat > 15', () => {
      const unit = makeUnit(50, 5, { heat: 30 });
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeDefined();
    });

    it('overheating triggers when jumping and heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 15 });
      const movement = { type: 'jump' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeDefined();
    });

    it('overheating does NOT trigger when walking even at heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 20 });
      const movement = { type: 'walk' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeUndefined();
    });

    it('overheating does NOT trigger when stationary at heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 16 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeUndefined();
    });

    it('overheating does NOT trigger when running and heat < 15', () => {
      const unit = makeUnit(50, 5, { heat: 14 });
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeUndefined();
    });

    it('overheating does NOT trigger when jumping and heat < 15', () => {
      const unit = makeUnit(50, 5, { heat: 10 });
      const movement = { type: 'jump' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeUndefined();
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

    it('does not trigger physical attack if flag is false', () => {
      const unit = makeUnit(50, 5, { _physicalAttackReceived: false });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const phys = triggers.find(t => t.trigger === 'Physical Attack Received');
      expect(phys).toBeUndefined();
    });

    it('does not trigger physical attack if flag is absent', () => {
      const unit = makeUnit();
      delete unit._physicalAttackReceived;
      const triggers = calc.getPSRTriggers(unit, null, null);
      const phys = triggers.find(t => t.trigger === 'Physical Attack Received');
      expect(phys).toBeUndefined();
    });

    // ── 20+ Damage Received ──────────────────────────────────────
    it('detects 20+ damage received', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 20 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const dmg = triggers.find(t => t.trigger === '20+ Damage Received');
      expect(dmg).toBeDefined();
      expect(dmg.baseModifier).toBe(0);
    });

    it('detects damage above 20', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 35 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const dmg = triggers.find(t => t.trigger === '20+ Damage Received');
      expect(dmg).toBeDefined();
    });

    it('does not trigger 20+ damage below threshold', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 19 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const dmg = triggers.find(t => t.trigger === '20+ Damage Received');
      expect(dmg).toBeUndefined();
    });

    it('does not trigger 20+ damage at zero', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 0 });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const dmg = triggers.find(t => t.trigger === '20+ Damage Received');
      expect(dmg).toBeUndefined();
    });

    // ── Water Depth ──────────────────────────────────────────────
    it('entered water depth 0 = +0 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 0 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(0);
    });

    it('entered water depth 1 = +0 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 1 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(0);
    });

    it('entered water depth 2 = +1 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 2 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(1);
    });

    it('entered water depth 3 = +2 modifier (deep water)', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 3 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(2);
    });

    it('entered water depth > 3 = +2 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 5 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(2);
    });

    it('entered water with no depth set defaults to +0', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(0);
    });

    it('entered water not set = no trigger', () => {
      const unit = makeUnit();
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeUndefined();
    });

    // ── Hip Actuator Damage ──────────────────────────────────────
    it('detects left hip actuator destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, null, null);
      const hip = triggers.find(t => t.trigger === 'Hip Actuator Damage');
      expect(hip).toBeDefined();
      expect(hip.baseModifier).toBe(2);
    });

    it('detects right hip actuator destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.rightLeg[0].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, null, null);
      const hip = triggers.find(t => t.trigger === 'Hip Actuator Damage');
      expect(hip).toBeDefined();
      expect(hip.baseModifier).toBe(2);
    });

    it('hip actuator ok = no trigger', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, null, null);
      const hip = triggers.find(t => t.trigger === 'Hip Actuator Damage');
      expect(hip).toBeUndefined();
    });

    // ── Missing Leg ──────────────────────────────────────────────
    it('detects missing left leg', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'leftLeg' });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const leg = triggers.find(t => t.trigger === 'Missing Leg');
      expect(leg).toBeDefined();
      expect(leg.baseModifier).toBe(5);
    });

    it('detects missing right leg', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'rightLeg' });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const leg = triggers.find(t => t.trigger === 'Missing Leg');
      expect(leg).toBeDefined();
      expect(leg.baseModifier).toBe(5);
    });

    it('both legs present = no trigger', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, null, null);
      const leg = triggers.find(t => t.trigger === 'Missing Leg');
      expect(leg).toBeUndefined();
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
      const stand = triggers.find(t => t.trigger === 'Standing Up');
      expect(stand).toBeUndefined();
    });

    // ── Damaged Leg Actuators (on run) ───────────────────────────
    it('detects leg actuator damage when running - single hit', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed'; // upper_leg_actuator
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeDefined();
      expect(legAct.baseModifier).toBe(1);
    });

    it('detects leg actuator damage when running - multiple hits', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      unit.criticalSlots.rightLeg[2].status = 'destroyed';
      unit.criticalSlots.rightLeg[3].status = 'destroyed';
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeDefined();
      expect(legAct.baseModifier).toBe(3);
    });

    it('leg actuator damage with hip included in count', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip_actuator
      unit.criticalSlots.rightLeg[1].status = 'destroyed'; // upper_leg_actuator
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeDefined();
      expect(legAct.baseModifier).toBe(2);
    });

    it('leg actuator damage does NOT trigger when walking', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      const movement = { type: 'walk' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeUndefined();
    });

    it('leg actuator damage does NOT trigger when jumping', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      const movement = { type: 'jump' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeUndefined();
    });

    it('leg actuator damage does NOT trigger when stationary', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, null, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeUndefined();
    });

    it('leg actuator damage with no destroyed actuators = no trigger', () => {
      const unit = makeUnit();
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const legAct = triggers.find(t => t.trigger === 'Damaged Leg Actuators');
      expect(legAct).toBeUndefined();
    });

    // ── Heavy Woods ──────────────────────────────────────────────
    it('detects entered heavy woods', () => {
      const unit = makeUnit();
      const movement = { enteredHeavyWoods: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const woods = triggers.find(t => t.trigger === 'Heavy Woods');
      expect(woods).toBeDefined();
      expect(woods.baseModifier).toBe(0);
    });

    it('heavy woods not entered = no trigger', () => {
      const unit = makeUnit();
      const movement = { enteredHeavyWoods: false };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const woods = triggers.find(t => t.trigger === 'Heavy Woods');
      expect(woods).toBeUndefined();
    });

    // ── Rubble ───────────────────────────────────────────────────
    it('detects entered rubble', () => {
      const unit = makeUnit();
      const movement = { enteredRubble: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const rubble = triggers.find(t => t.trigger === 'Rubble');
      expect(rubble).toBeDefined();
      expect(rubble.baseModifier).toBe(0);
    });

    // ── Large Level Drop ─────────────────────────────────────────
    it('detects large level drop', () => {
      const unit = makeUnit();
      const movement = { largeLevelDrop: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const drop = triggers.find(t => t.trigger === 'Large Level Drop');
      expect(drop).toBeDefined();
      expect(drop.baseModifier).toBe(0);
    });

    // ── Skidding ─────────────────────────────────────────────────
    it('detects skidding', () => {
      const unit = makeUnit();
      const movement = { isSkidding: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const skid = triggers.find(t => t.trigger === 'Skidding');
      expect(skid).toBeDefined();
      expect(skid.baseModifier).toBe(0);
    });

    // ── Rapid Turn (Running) ─────────────────────────────────────
    it('detects rapid turn while running', () => {
      const unit = makeUnit();
      const movement = { rapidTurnWhileRunning: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const turn = triggers.find(t => t.trigger === 'Rapid Turn (Running)');
      expect(turn).toBeDefined();
      expect(turn.baseModifier).toBe(0);
    });

    // ── Jumped Into Woods ────────────────────────────────────────
    it('detects jumped into woods', () => {
      const unit = makeUnit();
      const movement = { jumpedIntoWoods: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const jump = triggers.find(t => t.trigger === 'Jumped Into Woods');
      expect(jump).toBeDefined();
      expect(jump.baseModifier).toBe(0);
    });

    // ── Multiple simultaneous triggers ───────────────────────────
    it('returns multiple triggers when applicable', () => {
      const unit = makeUnit(50, 5, {
        gyro: { hits: 1 },
        _damageThisPhase: 25,
        _physicalAttackReceived: true,
        heat: 20,
        isLocationDestroyed: (loc) => loc === 'leftLeg'
      });
      const movement = { type: 'run', enteredWater: true, waterDepth: 2, enteredHeavyWoods: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const triggerNames = triggers.map(t => t.trigger);
      expect(triggerNames).toContain('Gyro Damage');
      expect(triggerNames).toContain('20+ Damage Received');
      expect(triggerNames).toContain('Physical Attack Received');
      expect(triggerNames).toContain('Overheating');
      expect(triggerNames).toContain('Missing Leg');
      expect(triggerNames).toContain('Entered Water');
      expect(triggerNames).toContain('Heavy Woods');
    });

    it('multiple triggers have correct modifiers summed', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip
      const triggers = calc.getPSRTriggers(unit, null, null);
      const totalMod = triggers.reduce((sum, t) => sum + t.baseModifier, 0);
      expect(totalMod).toBe(5); // gyro +3, hip +2
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

    it('adds gyro +3 modifier to target', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = [{ trigger: 'Gyro Damage', baseModifier: 3 }];
      const { targetNumber } = calc.calculatePSRModifier(unit, triggers);
      expect(targetNumber).toBe(8);
    });

    it('returns 999 for destroyed gyro (2 hits)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const { targetNumber } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(999);
    });

    it('returns 999 for destroyed gyro (3 hits)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 3 } });
      const { targetNumber } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(999);
    });

    it('adds multiple trigger modifiers cumulatively', () => {
      const unit = makeUnit(50, 5);
      const triggers = [
        { trigger: 'Gyro Damage', baseModifier: 3 },
        { trigger: 'Hip Actuator Damage', baseModifier: 2 }
      ];
      const { targetNumber } = calc.calculatePSRModifier(unit, triggers);
      expect(targetNumber).toBe(10); // 5 + 3 + 2
    });

    it('adds three trigger modifiers', () => {
      const unit = makeUnit(50, 4);
      const triggers = [
        { trigger: 'Gyro Damage', baseModifier: 3 },
        { trigger: 'Missing Leg', baseModifier: 5 },
        { trigger: 'Hip Actuator Damage', baseModifier: 2 }
      ];
      const { targetNumber } = calc.calculatePSRModifier(unit, triggers);
      expect(targetNumber).toBe(14); // 4 + 3 + 5 + 2
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
      const dr = makeDiceRoller([5]);
      const result = calc.makePSR(unit, dr, []);
      expect(result.passed).toBe(true);
      expect(result.roll).toBe(5);
      expect(result.targetNumber).toBe(5);
    });

    it('passes when roll exceeds target', () => {
      const unit = makeUnit(50, 5);
      const dr = makeDiceRoller([8]);
      const result = calc.makePSR(unit, dr, []);
      expect(result.passed).toBe(true);
      expect(result.roll).toBe(8);
    });

    it('fails when roll is below target', () => {
      const unit = makeUnit(50, 5);
      const dr = makeDiceRoller([4]);
      const result = calc.makePSR(unit, dr, []);
      expect(result.passed).toBe(false);
    });

    it('passes at high target with high roll', () => {
      const unit = makeUnit(50, 5);
      const triggers = [{ trigger: 'Gyro Damage', baseModifier: 3 }];
      const dr = makeDiceRoller([8]);
      const result = calc.makePSR(unit, dr, triggers);
      expect(result.passed).toBe(true);
      expect(result.targetNumber).toBe(8);
    });

    it('fails at high target with low roll', () => {
      const unit = makeUnit(50, 5);
      const triggers = [{ trigger: 'Gyro Damage', baseModifier: 3 }];
      const dr = makeDiceRoller([7]);
      const result = calc.makePSR(unit, dr, triggers);
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(8);
    });

    it('auto-fails when gyro destroyed (hits=3)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 3 } });
      const dr = makeDiceRoller([12]);
      const result = calc.makePSR(unit, dr);
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(999);
      expect(result.details).toContain('Auto-fail');
    });

    it('auto-fails when gyro destroyed (hits=2)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const dr = makeDiceRoller([12]);
      const result = calc.makePSR(unit, dr);
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(999);
    });

    it('auto-fails even with maximum roll', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const dr = makeDiceRoller([12]);
      const result = calc.makePSR(unit, dr);
      expect(result.passed).toBe(false);
    });

    it('includes details string with modifiers', () => {
      const unit = makeUnit(50, 5);
      const triggers = [{ trigger: 'Some Mod', baseModifier: 3 }];
      const dr = makeDiceRoller([8]);
      const result = calc.makePSR(unit, dr, triggers);
      expect(result.details).toBeDefined();
      expect(result.details).toContain('PASS');
    });

    it('computes triggers from movement when none provided', () => {
      const unit = makeUnit(50, 5, { heat: 20 });
      const movement = { type: 'run' };
      const dr = makeDiceRoller([5]);
      const result = calc.makePSR(unit, dr, null, movement);
      expect(result).toBeDefined();
      expect(result.targetNumber).toBe(5);
    });
  });

  describe('resolveFall', () => {
    it('sets unit prone and applies pilot hit', () => {
      const unit = makeUnit(50, 5);
      calc.resolveFall(unit, 0, makeDiceRoller());
      expect(unit.prone).toBe(true);
      expect(unit.pilot.hits).toBe(1);
    });

    it('pilot unconscious after 6 hits', () => {
      const unit = makeUnit(50, 5, { pilot: { piloting: 5, hits: 5, conscious: true } });
      calc.resolveFall(unit, 0, makeDiceRoller());
      expect(unit.pilot.conscious).toBe(false);
    });

    it('pilot remains conscious at 5 hits after fall', () => {
      const unit = makeUnit(50, 5, { pilot: { piloting: 5, hits: 4, conscious: true } });
      calc.resolveFall(unit, 0, makeDiceRoller());
      expect(unit.pilot.conscious).toBe(true);
      expect(unit.pilot.hits).toBe(5);
    });

    it('pilot stays unconscious at 7 hits after fall', () => {
      const unit = makeUnit(50, 5, { pilot: { piloting: 5, hits: 6, conscious: false } });
      calc.resolveFall(unit, 0, makeDiceRoller());
      expect(unit.pilot.conscious).toBe(false);
      expect(unit.pilot.hits).toBe(7);
    });

    // ── Fall damage = ceil(tonnage/10) × levelsFallen ────────────
    it('base fall damage: ceil(tonnage/10) × 1 level', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 1);
      expect(result.damage).toBe(5); // ceil(50/10) = 5
    });

    it('fall damage × 2 levels', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 2);
      expect(result.damage).toBe(10); // 5 × 2
    });

    it('fall damage × 3 levels', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 3);
      expect(result.damage).toBe(15); // 5 × 3
    });

    it('fall damage × 5 levels', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 5);
      expect(result.damage).toBe(25); // 5 × 5
    });

    it('fall damage × 0 levels', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 0);
      expect(result.damage).toBe(0);
    });

    it('defaults levelsFallen to 1', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller());
      expect(result.damage).toBe(5);
    });

    it('fall damage scales with tonnage: 20-ton mech', () => {
      const unit = makeUnit(20, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 1);
      expect(result.damage).toBe(2); // ceil(20/10) = 2
    });

    it('fall damage scales with tonnage: 55-ton mech', () => {
      const unit = makeUnit(55, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 1);
      expect(result.damage).toBe(6); // ceil(55/10) = 6
    });

    it('fall damage scales with tonnage: 100-ton mech', () => {
      const unit = makeUnit(100, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 1);
      expect(result.damage).toBe(10); // ceil(100/10) = 10
    });

    it('fall damage: 35-ton mech × 4 levels', () => {
      const unit = makeUnit(35, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 4);
      expect(result.damage).toBe(16); // ceil(35/10) × 4 = 4 × 4 = 16
    });

    it('fall damage: 75-ton mech × 3 levels', () => {
      const unit = makeUnit(75, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 3);
      expect(result.damage).toBe(24); // ceil(75/10) × 3 = 8 × 3 = 24
    });

    // ── Result shape ─────────────────────────────────────────────
    it('resolveFall returns expected result shape', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 2);
      expect(result).toEqual({
        pilotHit: true,
        prone: true,
        locations: ['leftLeg', 'rightLeg'],
        damage: 10
      });
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

    it('returns true when hip actuator is destroyed (included in count)', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip_actuator
      expect(calc.hasLegActuatorDamage(unit)).toBe(true);
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
  });
});
