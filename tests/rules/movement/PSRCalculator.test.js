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
    it('returns empty array for a normal unit with no movement', () => {
      const unit = makeUnit();
      const triggers = calc.getPSRTriggers(unit, null, null);
      expect(triggers).toEqual([]);
    });

    it('detects gyro damage with +3 modifier for a single hit', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const gyro = triggers.find(t => t.trigger === 'Gyro Damage');
      expect(gyro).toBeDefined();
      expect(gyro.baseModifier).toBe(3);
    });

    it('gyro with 2+ hits gives auto-fail (999 modifier)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const gyro = triggers.find(t => t.trigger === 'Gyro Damage');
      expect(gyro).toBeDefined();
      expect(gyro.baseModifier).toBe(999);
    });

    it('detects overheating when running and heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 16 });
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeDefined();
    });

    it('detects overheating when jumping and heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 15 });
      const movement = { type: 'jump' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeDefined();
    });

    it('does not trigger overheating when walking and heat >= 15', () => {
      const unit = makeUnit(50, 5, { heat: 16 });
      const movement = { type: 'walk' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeUndefined();
    });

    it('does not trigger overheating when heat < 15 even when running', () => {
      const unit = makeUnit(50, 5, { heat: 14 });
      const movement = { type: 'run' };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const overheat = triggers.find(t => t.trigger === 'Overheating');
      expect(overheat).toBeUndefined();
    });

    it('detects physical attack received', () => {
      const unit = makeUnit(50, 5, { _physicalAttackReceived: true });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const phys = triggers.find(t => t.trigger === 'Physical Attack Received');
      expect(phys).toBeDefined();
    });

    it('does not trigger physical attack if flag is false', () => {
      const unit = makeUnit(50, 5, { _physicalAttackReceived: false });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const phys = triggers.find(t => t.trigger === 'Physical Attack Received');
      expect(phys).toBeUndefined();
    });

    it('detects 20+ damage received', () => {
      const unit = makeUnit(50, 5, { _damageThisPhase: 20 });
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

    it('entered water depth 3 = +2 modifier', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true, waterDepth: 3 };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(2);
    });

    it('entered water depth (unknown/unset) defaults to +0', () => {
      const unit = makeUnit();
      const movement = { enteredWater: true };
      const triggers = calc.getPSRTriggers(unit, movement, null);
      const water = triggers.find(t => t.trigger === 'Entered Water');
      expect(water).toBeDefined();
      expect(water.baseModifier).toBe(0);
    });

    it('detects hip actuator damage', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      const triggers = calc.getPSRTriggers(unit, null, null);
      const hip = triggers.find(t => t.trigger === 'Hip Actuator Damage');
      expect(hip).toBeDefined();
      expect(hip.baseModifier).toBe(2);
    });

    it('detects missing leg', () => {
      const unit = makeUnit(50, 5, { isLocationDestroyed: (loc) => loc === 'leftLeg' });
      const triggers = calc.getPSRTriggers(unit, null, null);
      const leg = triggers.find(t => t.trigger === 'Missing Leg');
      expect(leg).toBeDefined();
      expect(leg.baseModifier).toBe(5);
    });
  });

  describe('calculatePSRModifier', () => {
    it('returns base piloting with no triggers', () => {
      const unit = makeUnit(50, 5);
      const { targetNumber } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(5);
    });

    it('adds gyro +3 modifier to target', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 1 } });
      const triggers = [{ trigger: 'Gyro Damage', baseModifier: 3 }];
      const { targetNumber } = calc.calculatePSRModifier(unit, triggers);
      expect(targetNumber).toBe(8);
    });

    it('returns 999 for destroyed gyro (2+ hits)', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 2 } });
      const { targetNumber } = calc.calculatePSRModifier(unit, []);
      expect(targetNumber).toBe(999);
    });

    it('adds multiple trigger modifiers', () => {
      const unit = makeUnit(50, 5);
      const triggers = [
        { trigger: 'Gyro Damage', baseModifier: 3 },
        { trigger: 'Hip Actuator Damage', baseModifier: 2 }
      ];
      const { targetNumber } = calc.calculatePSRModifier(unit, triggers);
      expect(targetNumber).toBe(10);
    });
  });

  describe('makePSR', () => {
    it('passes when roll meets target', () => {
      const unit = makeUnit(50, 5);
      const dr = makeDiceRoller([5]);
      const result = calc.makePSR(unit, dr, []);
      expect(result.passed).toBe(true);
      expect(result.roll).toBe(5);
      expect(result.targetNumber).toBe(5);
    });

    it('fails when roll is below target', () => {
      const unit = makeUnit(50, 5);
      const dr = makeDiceRoller([4]);
      const result = calc.makePSR(unit, dr, []);
      expect(result.passed).toBe(false);
    });

    it('auto-fails when gyro destroyed', () => {
      const unit = makeUnit(50, 5, { gyro: { hits: 3 } });
      const dr = makeDiceRoller([12]);
      const result = calc.makePSR(unit, dr);
      expect(result.passed).toBe(false);
      expect(result.targetNumber).toBe(999);
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

    it('calculates base fall damage as ceil(tonnage/10)', () => {
      const unit = makeUnit(55, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 1);
      expect(result.damage).toBe(6); // ceil(55/10) * 1
    });

    it('multiplies fall damage by levels fallen', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 3);
      expect(result.damage).toBe(15); // ceil(50/10) * 3 = 5*3
    });

    it('defaults levelsFallen to 1', () => {
      const unit = makeUnit(50, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller());
      expect(result.damage).toBe(5); // ceil(50/10) * 1
    });

    it('damage scales with tonnage', () => {
      const unit = makeUnit(100, 5);
      const result = calc.resolveFall(unit, 0, makeDiceRoller(), 2);
      expect(result.damage).toBe(20); // ceil(100/10) * 2 = 10*2
    });
  });

  describe('hasLegActuatorDamage', () => {
    it('returns false for undamaged actuators', () => {
      const unit = makeUnit();
      expect(calc.hasLegActuatorDamage(unit)).toBe(false);
    });

    it('returns true when any leg actuator is destroyed', () => {
      const unit = makeUnit();
      unit.criticalSlots.leftLeg[1].status = 'destroyed';
      expect(calc.hasLegActuatorDamage(unit)).toBe(true);
    });
  });
});
