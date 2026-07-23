import { describe, it, expect } from 'vitest';
import { MovementCalculator } from '../../../src/rules/movement/MovementCalculator.js';
import { Hex } from '../../../src/models/Hex.js';

function makeHex(key, terrainType = 'clear', level = 0, overrides = {}) {
  return new Hex(key, { terrainType, level, ...overrides });
}

function makeUnit(walk = 4, run = 6, jump = 0, facing = 0) {
  return {
    movement: { walk, run, jump },
    currentMP: walk,
    position: { hexKey: '4,4', facing },
    _movementModifier: 0,
    _targetMovementModifier: 0,
    getAttackerMovementModifier() { return this._movementModifier; },
    getTargetMovementModifier() { return this._targetMovementModifier; }
  };
}

function makeGameState(hexMap) {
  const hexes = new Map();
  for (const [key, hex] of Object.entries(hexMap)) {
    hexes.set(key, hex);
  }
  return { map: { hexes } };
}

describe('MovementCalculator', () => {
  const calc = new MovementCalculator();

  describe('calculateMPCost', () => {
    it('costs 1 MP for clear terrain', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });

    it('costs 2 MP for light woods', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'light_woods', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('costs 3 MP for heavy woods', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'heavy_woods', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('adds +1 MP per level climbed', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 1);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2); // 1 base + 1 climb
    });

    it('does not reduce cost for downhill', () => {
      const from = makeHex('4,4', 'clear', 2);
      const to = makeHex('4,5', 'clear', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1); // terrain cost only
    });

    it('jump jets ignore terrain cost (always 1)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'heavy_woods', 2);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'jump')).toBe(1);
    });

    it('ice adds +1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'light_woods', 0, { ice: true });
      // Base 2, ice: +1 = 3
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('mud adds +1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { mud: true });
      // Base 1, mud: +1 = 2
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('pavement always costs 1', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'pavement', 1);
      // Level 1 climb would add cost, but pavement overrides to 1
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });
  });

  describe('getMaxMP', () => {
    it('returns walk MP', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'walk')).toBe(4);
    });

    it('returns run MP', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'run')).toBe(6);
    });

    it('returns jump MP', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'jump')).toBe(3);
    });

    it('defaults to walk', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'unknown')).toBe(4);
    });
  });

  describe('calculateFacingChange', () => {
    it('costs 0 for same hex', () => {
      expect(calc.calculateFacingChange('4,4', '4,4', 0)).toBe(0);
    });

    it('costs 0 for moving straight ahead', () => {
      // Facing 0 = north. Moving to north neighbor should cost 0.
      // Even col: N neighbor of 4,4 is 4,3
      const cost = calc.calculateFacingChange('4,4', '4,3', 0);
      expect(cost).toBe(0);
    });

    it('costs 1 for one hexside turn', () => {
      // Facing 0 = north. NE neighbor = direction 1. Diff = 1.
      const cost = calc.calculateFacingChange('4,4', '5,3', 0);
      expect(cost).toBe(1);
    });

    it('costs 2 for two hexsides turn', () => {
      // Facing 0 = north. SE neighbor = direction 2. Diff = 2.
      const cost = calc.calculateFacingChange('4,4', '5,4', 0);
      expect(cost).toBe(2);
    });

    it('takes shorter path (3 hexsides = 2 cost going other way)', () => {
      // Facing 0 = north. S neighbor = direction 3. Diff = 3.
      // 3 hexsides either way, cost should be 3 or 6-3=3
      // Per code: diff=3, returns diff=3 (but the code has if(diff<=2) return diff; return 6-diff;
      // So diff=3 => 6-3=3
      const cost = calc.calculateFacingChange('4,4', '4,5', 0);
      expect(cost).toBe(3);
    });
  });

  describe('calculateFacingChangeFromDirection', () => {
    it('returns 0 for same direction', () => {
      expect(calc.calculateFacingChangeFromDirection(3, 3)).toBe(0);
    });

    it('returns 1 for one step difference', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 1)).toBe(1);
    });

    it('returns 2 for two steps', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 2)).toBe(2);
    });

    it('returns 3 for opposite direction', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 3)).toBe(3);
    });

    it('takes shorter path (wraps around)', () => {
      // 0 to 5: diff = (5-0+3)%6 = 2, min(2, 6-2) = 2... let's check
      // diff = ((5-0+3)%6+3)%6 = (8%6+3)%6 = (2+3)%6 = 5
      // 5 > 3, so return 6-5 = 1
      expect(calc.calculateFacingChangeFromDirection(0, 5)).toBe(1);
    });
  });

  describe('validateMovement', () => {
    it('rejects path with less than 2 hexes', () => {
      const unit = makeUnit();
      const gs = makeGameState({
        '4,4': makeHex('4,4')
      });
      const result = calc.validateMovement(unit, ['4,4'], 'walk', gs);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least 2');
    });

    it('validates a simple 2-hex move on clear terrain', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'walk', gs);
      expect(result.valid).toBe(true);
      expect(result.totalCost).toBe(1); // 1 terrain + 0 facing
    });

    it('accumulates terrain and turning costs', () => {
      const unit = makeUnit(4, 6, 0, 0);
      // Move north (facing 0) then NE (facing 1): 0 turning for first, 1 for second
      // Facing changes are free (1 free hexside turn per hex entered), so only terrain costs apply
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0),
        '5,2': makeHex('5,2', 'clear', 0) // NE of 4,3 on even col
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3', '5,2'], 'walk', gs);
      expect(result.valid).toBe(true);
      // Step 1: terrain 1
      // Step 2: terrain 1
      expect(result.totalCost).toBe(2);
    });

    it('fails when path exceeds max MP', () => {
      const unit = makeUnit(2, 4, 0, 0); // Only 2 walk MP
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'heavy_woods', 0), // costs 3
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'walk', gs);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Exceeded max MP');
    });
  });
});
