import { describe, it, expect } from 'vitest';
import { MovementCalculator } from '../../../src/rules/movement/MovementCalculator.js';
import { Hex } from '../../../src/models/Hex.js';
import { hexNeighbors, directionBetween } from '../../../src/hex/HexMath.js';
import { createTestUnit, createTestEngine } from '../../helpers/testUtils.js';
import terrainData from '../../../src/data/terrain.json' with { type: 'json' };

// =============================================================================
// Helpers
// =============================================================================

function makeHex(key, terrainType = 'clear', level = 0, overrides = {}) {
  return new Hex(key, { terrainType, level, ...overrides });
}

function makeUnit(walk = 4, run = 6, jump = 3, facing = 0, heat = 0) {
  return {
    movement: { walk, run, jump },
    heat,
    position: { hexKey: '4,4', facing },
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
    }
  };
}

function makeGameState(hexMap) {
  const hexes = new Map();
  for (const [key, hex] of Object.entries(hexMap)) {
    hexes.set(key, hex);
  }
  return { map: { hexes } };
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

/**
 * Build a hex map centered on centerKey with radius hexes around it.
 * Default: all clear, level 0.
 */
function buildSimpleHexMap(centerKey, radius, terrainType = 'clear', level = 0) {
  const hexes = {};
  hexes[centerKey] = makeHex(centerKey, terrainType, level);
  for (let r = 1; r <= radius; r++) {
    const keys = new Set();
    for (const [key] of Object.entries(hexes)) {
      for (const n of hexNeighbors(key)) {
        if (!keys.has(n) && !hexes[n]) {
          keys.add(n);
        }
      }
    }
    for (const k of keys) {
      hexes[k] = makeHex(k, terrainType, level);
    }
  }
  return hexes;
}

// =============================================================================
// Even-column (4,4) hex neighbor layout:
//   N(dir0): 4,3   NE(dir1): 5,3   SE(dir2): 5,4
//   S(dir3): 4,5   SW(dir4): 3,4   NW(dir5): 3,3
// =============================================================================

describe('MovementCalculator', () => {
  const calc = new MovementCalculator();

  // ==========================================================
  // TERRAIN COSTS (calculateMPCost)
  // ==========================================================
  describe('terrain costs (calculateMPCost)', () => {
    // p136 Movement Costs Table: 1 MP to enter any hex, plus the terrain cost
    // (Clear +0, Light Woods +1, Heavy Woods +2, Light Jungle +2, Heavy Jungle
    // +3, Rough +1, Rubble +1, Sand +0, Paved/Bridge +0). p60 repeats the
    // woods/jungle/clear/sand values.
    it('clear costs 1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });

    it('light_woods costs 2 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'light_woods', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('heavy_woods costs 3 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'heavy_woods', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    // p136: "Light jungle +2", "Heavy jungle +3" on top of the 1 MP to enter
    // any hex; terrain.json stores those totals (3 and 4).
    it('light_jungle costs 3 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'light_jungle', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('heavy_jungle costs 4 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'heavy_jungle', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(4);
    });

    // p128 worked example: "entering Depth 1 water from a Level 0 hex costs
    // 3 MP. It always costs 1 MP to enter any hex. In addition, it costs 1 MP
    // for changing from Level 0 to Depth 1, and 1 MP to enter a Depth 1 water
    // hex." Water depth is a level offset (p64: "treating depth as negative
    // numbers"), so the entry cost is 1 (hex) + water + level change.
    it('water_depth1 costs 3 MP from Level 0 (p128)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'water_depth1', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('water_depth2 costs 6 MP from Level 0 (p128)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'water_depth2', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(6);
    });

    it('water_depth3 uses the Depth 2+ row: +3 water and a 2-level change', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'water_depth3', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(6);
    });

    it('moving between Depth 2 hexes costs 4 MP (p20 pond example)', () => {
      // p20: "This would cost 4 MP (1 for the hex, and 3 MP for entering
      // Depth 2+ water)" — no level change between two Depth 2 hexes.
      const from = makeHex('4,4', 'water_depth2', 0);
      const to = makeHex('4,5', 'water_depth2', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(4);
    });

    it('water entry adds the hex level change to the depth change', () => {
      // Level 1 shore down into the pond: two levels down to Depth 1 water.
      const from = makeHex('4,4', 'clear', 1);
      const to = makeHex('4,5', 'water_depth1', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(4);
    });

    it('rough costs 2 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'rough', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('rubble costs 2 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'rubble', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    // p60/p136: "SAND ... MP Modifier: 0" — only the 1 MP to enter any hex.
    it('sand costs 1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'sand', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });

    // p136 lists Swamp as a *terrain modification* (+1 MP and +1 PSR), i.e. 2
    // MP over clear ground; terrain.json stores 2 and the rules table derives
    // from it (M-31).
    it('swamp costs 2 MP (p61/p136)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'swamp', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('pavement costs 1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'pavement', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });

    it('bridge costs 1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'bridge', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });

    // p60: "If a hex is not marked as containing another terrain type, assume
    // it is clear. ... It costs only 1 MP to enter a clear hex."
    it('unknown terrain defaults to 1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'magma_field', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(1);
    });

    // The rules table is built from terrain.json's mpCost, so a data edit and
    // the movement rules cannot drift apart again (t12). Water is skipped: its
    // depth is a level offset priced by calculateMPCost, not a flat row.
    it('every dry terrain cost equals its terrain.json mpCost', () => {
      const from = makeHex('4,4', 'clear', 0);
      for (const [type, def] of Object.entries(terrainData.terrain)) {
        if (type.startsWith('water')) continue;
        const to = makeHex('4,5', type, 0);
        expect(calc.calculateMPCost(from, to, makeUnit(), 'walk'), type).toBe(def.mpCost);
      }
    });
  });

  // ==========================================================
  // LEVEL CHANGE COSTS
  // ==========================================================
  // p17/p136: "Level change (up or down) 1 level +1 - 2 levels +2".
  describe('level change costs', () => {
    it('adds +1 MP per level climbed', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 1);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('adds +2 MP for 2-level climb', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 2);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('adds +1 MP per level descended too (p17: up or down)', () => {
      const from = makeHex('4,4', 'clear', 2);
      const to = makeHex('4,5', 'clear', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('adds +1 MP for a one-level descent', () => {
      const from = makeHex('4,4', 'clear', 1);
      const to = makeHex('4,5', 'clear', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('level change on heavy_woods: 3 terrain + 1 climb = 4', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'heavy_woods', 1);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(4);
    });

    it('pavement keeps the level change cost (p20 Road Movement)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'pavement', 2);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('pavement keeps ice, mud and deep snow costs (p20)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'pavement', 0, { ice: true, mud: true, deepSnow: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(4);
    });

    it('pavement keeps the weather MP modifier (p62)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'pavement', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk', { fog: 'heavy' })).toBe(3);
    });

    it('a road only waives the terrain cost, not the level change', () => {
      // p20: "'Mechs traveling on roads pay only 1 MP per hex; however, any MP
      // costs for changing levels are still required."
      const flat = calc.calculateMPCost(
        makeHex('4,4', 'pavement', 0), makeHex('4,5', 'pavement', 0), makeUnit(), 'walk');
      const climbing = calc.calculateMPCost(
        makeHex('4,4', 'pavement', 0), makeHex('4,5', 'pavement', 1), makeUnit(), 'walk');
      expect(flat).toBe(1);
      expect(climbing).toBe(2);
    });
  });

  // ==========================================================
  // LEVEL 3+ RESTRICTION
  // ==========================================================
  // The 3+ level prohibition itself is unverified: BMM p15 (Ground Movement) is
  // absent from the KB and only the +1/+2 rows are quotable (sweep §4.4). The
  // rule is kept as the project's adopted model; a 3+ change is a fall, not a
  // move, in both directions (M-02).
  describe('level 3+ restriction', () => {
    it('returns Infinity for exactly 3-level climb', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 3);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(Infinity);
    });

    it('returns Infinity for 4-level climb', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 4);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(Infinity);
    });

    it('returns Infinity for running into hex 3+ levels higher', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 3);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'run')).toBe(Infinity);
    });

    it('returns Infinity for a 3-level descent too (no free falls)', () => {
      const from = makeHex('4,4', 'clear', 10);
      const to = makeHex('4,5', 'clear', 7);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(Infinity);
    });

    it('returns Infinity for a 3+ level drop of any magnitude', () => {
      const from = makeHex('4,4', 'clear', 10);
      const to = makeHex('4,5', 'clear', 0);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(Infinity);
    });

    it('jump jets bypass level 3+ restriction', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 5);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'jump')).toBe(1);
    });

    it('getValidMoves blocks 3+ level climb hex', () => {
      const unit = makeUnit(8, 12, 0, 0);
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 3)
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('4,3')).toBe(false);
    });

    it('getValidMoves allows 2-level climb hex', () => {
      const unit = makeUnit(8, 12, 0, 0);
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 2)
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('4,3')).toBe(true);
    });
  });

  // ==========================================================
  // TERRAIN MODIFIERS
  // ==========================================================
  // p136 Terrain Modifications: Ice +1 MP (+3 PSR), Mud +1 (+1 PSR),
  // Deep Snow +1 (+1 PSR).
  describe('terrain modifiers', () => {
    it('ice adds +1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { ice: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('ice on light_woods adds +1 (total 3)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'light_woods', 0, { ice: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('mud adds +1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { mud: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('deepSnow adds +1 MP', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { deepSnow: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(2);
    });

    it('ice + mud stack (+2 total)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { ice: true, mud: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('ice + deepSnow stack (+2 total)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { ice: true, deepSnow: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('mud + deepSnow stack (+2 total)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { mud: true, deepSnow: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'walk')).toBe(3);
    });

    it('jump ignores terrain modifiers', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 0, { ice: true, mud: true, deepSnow: true });
      expect(calc.calculateMPCost(from, to, makeUnit(), 'jump')).toBe(1);
    });
  });

  // ==========================================================
  // FACING CHANGE COSTS (calculateFacingChange)
  // ==========================================================
  // p14: "Changing facing costs 1 MP per hexside. For example, ... a
  // 180-degree turn (three facings, from Hex A to Hex B) costs 3 MP." The
  // shortest way round is used, so 4-5 hexsides cost 2-1 (M-04 was withdrawn).
  describe('facing change cost (calculateFacingChange)', () => {
    it('returns 0 for same hex', () => {
      expect(calc.calculateFacingChange('4,4', '4,4', 0)).toBe(0);
    });

    it('returns 0 when moving straight ahead (facing 0, N to N neighbor)', () => {
      const cost = calc.calculateFacingChange('4,4', '4,3', 0);
      expect(cost).toBe(0);
    });

    it('returns 1 for one hexside turn (facing 0, NE neighbor = dir 1)', () => {
      const cost = calc.calculateFacingChange('4,4', '5,3', 0);
      expect(cost).toBe(1);
    });

    it('returns 2 for two hexsides turn (facing 0, SE neighbor = dir 2)', () => {
      const cost = calc.calculateFacingChange('4,4', '5,4', 0);
      expect(cost).toBe(2);
    });

    it('returns 3 for three hexsides turn (facing 0, S neighbor = dir 3)', () => {
      const cost = calc.calculateFacingChange('4,4', '4,5', 0);
      expect(cost).toBe(3);
    });

    it('wraps: 4 hexsides = cost 2, because 6-4=2 shorter path', () => {
      const cost = calc.calculateFacingChange('4,4', '3,4', 0);
      expect(cost).toBe(2);
    });

    it('wraps: 5 hexsides = cost 1, because 6-5=1 shorter path', () => {
      const cost = calc.calculateFacingChange('4,4', '3,3', 0);
      expect(cost).toBe(1);
    });

    it('returns 0 when both hexes share the same direction as another facing', () => {
      expect(calc.calculateFacingChange('4,4', '4,3', 0)).toBe(0);
      expect(calc.calculateFacingChange('4,4', '5,3', 1)).toBe(0);
      expect(calc.calculateFacingChange('4,4', '5,4', 2)).toBe(0);
      expect(calc.calculateFacingChange('4,4', '4,5', 3)).toBe(0);
      expect(calc.calculateFacingChange('4,4', '3,4', 4)).toBe(0);
      expect(calc.calculateFacingChange('4,4', '3,3', 5)).toBe(0);
    });

    it('cost for opposite-direction hex (facing 2 to NW=dir 5) = 3 hexsides', () => {
      expect(calc.calculateFacingChange('4,4', '5,4', 0)).toBe(2); // 0->2 = 2
      expect(calc.calculateFacingChange('4,4', '3,3', 2)).toBe(3); // 2->5 = 3 hexsides
    });

    it('returns correct cost for non-zero starting facing', () => {
      // Facing 2 (SE). To N neighbor (dir 0): diff = ((0-2+3)%6+3)%6 = (1%6+3)%6 = 4. 4 > 2, 6-4=2
      expect(calc.calculateFacingChange('4,4', '4,3', 2)).toBe(2);
      // Facing 2 (SE). To S neighbor (dir 3): diff = ((3-2+3)%6+3)%6 = (4%6+3)%6 = 1. cost=1
      expect(calc.calculateFacingChange('4,4', '4,5', 2)).toBe(1);
    });
  });

  // ==========================================================
  // FACING CHANGE FROM DIRECTION (internal helper)
  // ==========================================================
  describe('facing change from direction', () => {
    it('returns 0 for same direction', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 0)).toBe(0);
      expect(calc.calculateFacingChangeFromDirection(3, 3)).toBe(0);
      expect(calc.calculateFacingChangeFromDirection(5, 5)).toBe(0);
    });

    it('returns 1 for one step difference', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 1)).toBe(1);
      expect(calc.calculateFacingChangeFromDirection(3, 4)).toBe(1);
    });

    it('returns 2 for two steps', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 2)).toBe(2);
      expect(calc.calculateFacingChangeFromDirection(1, 3)).toBe(2);
    });

    it('returns 3 for opposite direction (180 degrees)', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 3)).toBe(3);
      expect(calc.calculateFacingChangeFromDirection(1, 4)).toBe(3);
      expect(calc.calculateFacingChangeFromDirection(2, 5)).toBe(3);
    });

    it('wraps around: 0 to 5 = 1 hexside', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 5)).toBe(1);
      expect(calc.calculateFacingChangeFromDirection(5, 0)).toBe(1);
    });

    it('wraps around: 0 to 4 = 2 hexsides', () => {
      expect(calc.calculateFacingChangeFromDirection(0, 4)).toBe(2);
      expect(calc.calculateFacingChangeFromDirection(4, 0)).toBe(2);
    });
  });

  // ==========================================================
  // MAX MP (getMaxMP)
  // ==========================================================
  describe('getMaxMP', () => {
    it('returns walk MP', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'walk')).toBe(4);
    });

    it('returns run MP derived from walk MP (p48: x1.5, round up)', () => {
      // p68: "Walking MP of 6 and a Running MP of 9"; a 4-walk Mech runs 6.
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'run')).toBe(6);
      expect(calc.getMaxMP(makeUnit(5, 8, 3), 'run')).toBe(8);
      expect(calc.getMaxMP(makeUnit(3, 5, 3), 'run')).toBe(5);
    });

    it('ignores a stale stored run rating and derives it from walk', () => {
      expect(calc.getMaxMP(makeUnit(4, 99, 3), 'run')).toBe(6);
    });

    it('returns jump MP', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'jump')).toBe(3);
    });

    it('defaults to walk for unknown movement type', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 3), 'sprint')).toBe(4);
    });

    it('zero jump MP means cannot jump', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 0), 'jump')).toBe(0);
    });

    // p44 Leg Destruction: "A 'Mech with one leg is reduced to 1 Walking MP
    // (this overrides all MP increases) and cannot run."
    it('a destroyed leg leaves 1 Walking MP and no running (p44)', () => {
      const unit = makeUnit(5, 8, 0);
      unit.internalStructure = { leftLeg: 0, rightLeg: 10 };
      unit.isLocationDestroyed = (loc) => loc === 'leftLeg';
      expect(calc.getMaxMP(unit, 'walk')).toBe(1);
      expect(calc.getMaxMP(unit, 'run')).toBe(0);
    });

    it('a destroyed leg overrides TSM and MASC increases (p44)', () => {
      const unit = makeUnit(5, 8, 0, 0, 9);
      unit.equipment = { other: { masc: {}, tsm: { installed: true } } };
      unit.mascActive = true;
      unit.internalStructure = { leftLeg: 10, rightLeg: 0 };
      unit.isLocationDestroyed = (loc) => loc === 'rightLeg';
      expect(calc.getMaxMP(unit, 'walk')).toBe(1);
      expect(calc.getMaxMP(unit, 'run')).toBe(0);
    });

    it('a one-legged Mech keeps its Jumping MP (p44)', () => {
      const unit = makeUnit(5, 8, 3);
      unit.internalStructure = { leftLeg: 0, rightLeg: 10 };
      unit.isLocationDestroyed = (loc) => loc === 'leftLeg';
      expect(calc.getMaxMP(unit, 'jump')).toBe(3);
    });

    // p44 Leg Destruction: "A 'Mech that loses both of its legs automatically
    // falls as well. It is not considered immobile (see p. 18), but it has
    // 0 MP available." R-06: both legs gone is not a destruction.
    it('both legs destroyed: 0 Walking MP, 0 Running MP and no MASC/TSM rescue (p44)', () => {
      const unit = makeUnit(5, 8, 3, 0, 9);
      unit.equipment = { other: { masc: {}, tsm: { installed: true } } };
      unit.mascActive = true;
      unit.internalStructure = { leftLeg: 0, rightLeg: 0 };
      unit.isLocationDestroyed = (loc) => loc === 'leftLeg' || loc === 'rightLeg';

      expect(calc.getMaxMP(unit, 'walk')).toBe(0);
      expect(calc.getMaxMP(unit, 'run')).toBe(0);
      // "0 MP available" covers jumping too: a legless 'Mech cannot stand up
      // to use its jump jets.
      expect(calc.getMaxMP(unit, 'jump')).toBe(0);
    });

    it('both legs destroyed is not a destruction in the movement layer (p44, R-06)', () => {
      const unit = makeUnit(5, 8, 0);
      unit.internalStructure = { leftLeg: 0, rightLeg: 0 };
      unit.isLocationDestroyed = (loc) => loc === 'leftLeg' || loc === 'rightLeg';

      expect(calc.getMaxMP(unit, 'walk')).toBe(0);
      // p44: 0 MP, but still in play and not immobile - maxMP must not mark it.
      expect(unit.destroyed).toBeUndefined();
      expect(unit.immobile).toBeUndefined();
    });

    it('a both-legs Mech still owns its hex but cannot move out of it (0 MP)', () => {
      const unit = makeUnit(5, 8, 0);
      unit.position = { hexKey: '4,4', facing: 0 };
      unit.internalStructure = { leftLeg: 0, rightLeg: 0 };
      unit.isLocationDestroyed = (loc) => loc === 'leftLeg' || loc === 'rightLeg';
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0)
      });

      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('4,4')).toBe(true);  // still on the board
      expect(moves.size).toBe(1);           // 0 MP, no destination
    });

    // p44/R-06: both legs gone is NOT a destruction (Unit.isDestroyed only
    // covers the head and centre torso). The board-presence half of this
    // regression test lives in tests/engine/phaseSystem.test.js, where the
    // PhaseManager removal hook runs.
    it('a real both-legs Mech is not isDestroyed() and keeps 0 MP (p44, R-06)', () => {
      const unit = createTestUnit('atlas-as7d', 0, 'two-legs');
      unit.position = { hexKey: '5,7', facing: 0 };
      unit.internalStructure.leftLeg = 0;
      unit.internalStructure.rightLeg = 0;

      expect(unit.isLocationDestroyed('leftLeg')).toBe(true);
      expect(unit.isLocationDestroyed('rightLeg')).toBe(true);
      // p44: 0 MP available, but the 'Mech is not destroyed and not immobile.
      expect(unit.isDestroyed()).toBe(false);
      expect(unit.currentMP).toBe(0);
      expect(calc.getMaxMP(unit, 'walk')).toBe(0);
      expect(calc.getMaxMP(unit, 'run')).toBe(0);
      expect(calc.getMaxMP(unit, 'jump')).toBe(0);
    });

    // p48 Hip: "its Walking MP is cut in half (round up) ... Recalculate its
    // Running MP accordingly by multiplying the new Walking MP by 1.5,
    // rounding up."
    it('a destroyed hip halves walking MP and recalculates running MP (p48)', () => {
      const unit = makeUnit(5, 8, 0);
      unit.criticalSlots.leftLeg[0].status = 'destroyed'; // hip_actuator
      expect(calc.getMaxMP(unit, 'walk')).toBe(3);  // ceil(5 / 2)
      expect(calc.getMaxMP(unit, 'run')).toBe(5);   // ceil(3 x 1.5)
    });

    it('a second destroyed hip leaves no ground MP (p48)', () => {
      const unit = makeUnit(5, 8, 0);
      unit.criticalSlots.leftLeg[0].status = 'destroyed';
      unit.criticalSlots.rightLeg[0].status = 'destroyed';
      expect(calc.getMaxMP(unit, 'walk')).toBe(0);
      expect(calc.getMaxMP(unit, 'run')).toBe(0);
    });
  });

  // ==========================================================
  // MASC
  // ==========================================================
  describe('MASC', () => {
    describe('hasMASC', () => {
      it('returns true when unit has MASC equipment', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        expect(calc.hasMASC(unit)).toBe(true);
      });

      it('returns false when unit has no equipment', () => {
        expect(calc.hasMASC(makeUnit())).toBe(false);
      });

      it('returns false when equipment.other is empty', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: {} };
        expect(calc.hasMASC(unit)).toBe(false);
      });
    });

    describe('activation', () => {
      it('activates and sets mascActive + mascTurnsActive', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        expect(calc.activateMASC(unit)).toBe(true);
        expect(unit.mascActive).toBe(true);
        expect(unit.mascTurnsActive).toBe(1);
      });

      it('increments mascTurnsActive on successive activations', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        calc.activateMASC(unit);
        calc.activateMASC(unit);
        expect(unit.mascTurnsActive).toBe(2);
        expect(unit.mascActive).toBe(true);
      });

      it('fails when unit has no MASC', () => {
        const unit = makeUnit(4, 6, 3);
        expect(calc.activateMASC(unit)).toBe(false);
        expect(unit.mascActive).toBeUndefined();
      });
    });

    describe('deactivation', () => {
      it('deactivates MASC and resets counters', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        unit.mascActive = true;
        unit.mascTurnsActive = 5;
        calc.deactivateMASC(unit);
        expect(unit.mascActive).toBe(false);
        expect(unit.mascTurnsActive).toBe(0);
      });
    });

    // p116 MASC: "On a result of 3 or higher, the 'Mech can run that turn at a
    // speed equal to double its current Walking MP." Walking MP is unchanged.
    describe('MASC doubles running MP', () => {
      it('walk MP is unchanged when MASC is active', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        unit.mascActive = true;
        expect(calc.getMaxMP(unit, 'walk')).toBe(4);
      });

      it('run MP is doubled by MASC (p116)', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        unit.mascActive = true;
        expect(calc.getMaxMP(unit, 'run')).toBe(8);
      });

      it('running MP without MASC stays at 1.5 x walk', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        expect(calc.getMaxMP(unit, 'run')).toBe(6);
      });

      it('jump MP is NOT affected by MASC', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        unit.mascActive = true;
        expect(calc.getMaxMP(unit, 'jump')).toBe(3);
      });
    });

    // p116 MASC Table: the Avoid Number is 3+ on the first consecutive turn,
    // 5+ on the second, 7+ on the third, 11+ on the fourth and automatic on
    // the fifth. A roll below it assigns a critical hit to each surviving leg.
    describe('MASC failure scaling (p116 MASC Table)', () => {
      function mascUnit(turnsActive) {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        unit.mascActive = true;
        unit.mascTurnsActive = turnsActive;
        return unit;
      }

      it('turn 1: a 3+ avoids the critical hits, a 2 does not (p116)', () => {
        const pass = calc.rollMASC(mascUnit(1), makeDiceRoller([3]));
        expect(pass.roll).toBe(3);
        expect(pass.failed).toBe(false);

        const fail = calc.rollMASC(mascUnit(1), makeDiceRoller([2]));
        expect(fail.failed).toBe(true);
      });

      it('turn 2: the avoid number rises to 5+ (p116)', () => {
        expect(calc.rollMASC(mascUnit(2), makeDiceRoller([5])).failed).toBe(false);
        expect(calc.rollMASC(mascUnit(2), makeDiceRoller([4])).failed).toBe(true);
      });

      it('turn 3: the avoid number rises to 7+ (p116)', () => {
        expect(calc.rollMASC(mascUnit(3), makeDiceRoller([7])).failed).toBe(false);
        expect(calc.rollMASC(mascUnit(3), makeDiceRoller([6])).failed).toBe(true);
      });

      it('turn 4: the avoid number rises to 11+ (p116)', () => {
        expect(calc.rollMASC(mascUnit(4), makeDiceRoller([11])).failed).toBe(false);
        expect(calc.rollMASC(mascUnit(4), makeDiceRoller([10])).failed).toBe(true);
      });

      it('turn 5: a critical hit is assigned automatically (p116)', () => {
        const result = calc.rollMASC(mascUnit(5), makeDiceRoller([12]));
        expect(result.failed).toBe(true);
      });

      it('returns null roll when MASC is not active', () => {
        const unit = makeUnit(4, 6, 3);
        unit.equipment = { other: { masc: {} } };
        unit.mascActive = false;
        const result = calc.rollMASC(unit, makeDiceRoller([2]));
        expect(result.roll).toBeNull();
        expect(result.failed).toBe(false);
      });
    });

    // p116: on a failed activation "the player automatically assigns one
    // critical hit to each leg that has not yet been destroyed" and the failure
    // threshold decays by one interval per idle turn. The current MASC failure
    // damage (single actuator, counter reset to 0) does not match that text and
    // MASC has no live caller (M-19, open), so no test pins the wrong count or
    // the invented counter reset until the source fix lands.
  });

  // ==========================================================
  // HEAT-BASED MP REDUCTION
  // ==========================================================
  // The p52 Hatamoto-Chi example confirms only the 5-9 (-1) and 10-14 (-2)
  // bands ("must reduce its Walking MP by 1 ... to 2"). The 15+/20+/25+ bands
  // come from the project's heat scale: BMM p51 is absent from the KB, so they
  // are unverified constants rather than manual values (sweep §4.4).
  describe('heat-based MP reduction', () => {
    it('no reduction below heat 5', () => {
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 0), 'walk')).toBe(5);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 4), 'walk')).toBe(5);
    });

    it('reduces walk MP by 1 at 5-9 heat', () => {
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 5), 'walk')).toBe(4);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 7), 'walk')).toBe(4);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 9), 'walk')).toBe(4);
    });

    it('reduces walk MP by 2 at 10-14 heat', () => {
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 10), 'walk')).toBe(3);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 12), 'walk')).toBe(3);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 14), 'walk')).toBe(3);
    });

    it('reduces walk MP by 3 at 15-19 heat', () => {
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 15), 'walk')).toBe(2);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 17), 'walk')).toBe(2);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 19), 'walk')).toBe(2);
    });

    it('reduces walk MP by 4 at 20-24 and by 5 from 25', () => {
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 20), 'walk')).toBe(1);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 24), 'walk')).toBe(1);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 25), 'walk')).toBe(0);
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 30), 'walk')).toBe(0);
    });

    // p14: "If damage reduces a 'Mech's Walking MP rating, the player must
    // recalculate the 'Mech's Running MP rating" — so run MP is derived from
    // the heat-reduced walk MP (x1.5, round up), not reduced independently.
    it('derives run MP from the heat-reduced walk MP', () => {
      // walk 4 - 2 = 2 -> run ceil(3) = 3
      expect(calc.getMaxMP(makeUnit(4, 8, 0, 0, 10), 'run')).toBe(3);
      // walk 4 - 3 = 1 -> run ceil(1.5) = 2
      expect(calc.getMaxMP(makeUnit(4, 8, 0, 0, 15), 'run')).toBe(2);
      // walk 4 - 4 = 0 -> run 0
      expect(calc.getMaxMP(makeUnit(4, 8, 0, 0, 20), 'run')).toBe(0);
    });

    it('does NOT reduce jump MP at any heat', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 4, 0, 10), 'jump')).toBe(4);
      expect(calc.getMaxMP(makeUnit(4, 6, 4, 0, 15), 'jump')).toBe(4);
      expect(calc.getMaxMP(makeUnit(4, 6, 4, 0, 20), 'jump')).toBe(4);
      expect(calc.getMaxMP(makeUnit(4, 6, 4, 0, 30), 'jump')).toBe(4);
    });

    it('floors MP at 0 (never negative)', () => {
      expect(calc.getMaxMP(makeUnit(1, 0, 0, 0, 15), 'walk')).toBe(0);
      expect(calc.getMaxMP(makeUnit(1, 0, 0, 0, 20), 'walk')).toBe(0);
    });

    it('MASC doubles the heat-reduced walking MP', () => {
      // p116: "double its current Walking MP" — 4 - 3 = 1, so the MASC run is 2.
      const unit = makeUnit(4, 6, 0, 0, 15);
      unit.mascActive = true;
      expect(calc.getMaxMP(unit, 'walk')).toBe(1);
      expect(calc.getMaxMP(unit, 'run')).toBe(2);
    });
  });

  // ==========================================================
  // TSM (moved here from HeatManager, which no longer computes MP)
  // ==========================================================
  // TSM's +2 Walking MP and the heat-9 threshold are project constants: the KB
  // has no p117 body, so these are unverified rather than quoted (sweep §4.4).
  describe('TSM walk MP bonus', () => {
    function withTSM(walk, heat) {
      const unit = makeUnit(walk, Math.ceil(walk * 1.5), 0, 0, heat);
      unit.equipment = { other: { tsm: true } };
      return unit;
    }

    it('adds 2 walk MP at heat 9 (5 - 1 + 2 = 6)', () => {
      expect(calc.getMaxMP(withTSM(5, 9), 'walk')).toBe(6);
    });

    it('nets out the -2 at heat 10 (5 - 2 + 2 = 5)', () => {
      expect(calc.getMaxMP(withTSM(5, 10), 'walk')).toBe(5);
    });

    it('still loses MP at heat 18 (5 - 3 + 2 = 4)', () => {
      expect(calc.getMaxMP(withTSM(5, 18), 'walk')).toBe(4);
    });

    it('applies at extreme heat (5 - 5 + 2 = 2)', () => {
      expect(calc.getMaxMP(withTSM(5, 25), 'walk')).toBe(2);
    });

    it('does not activate below heat 9', () => {
      expect(calc.getMaxMP(withTSM(5, 8), 'walk')).toBe(4); // -1 MP, no bonus
    });

    it('does nothing without the equipment', () => {
      expect(calc.getMaxMP(makeUnit(5, 8, 0, 0, 9), 'walk')).toBe(4);
    });

    it('floors at 0', () => {
      expect(calc.getMaxMP(withTSM(1, 25), 'walk')).toBe(0);
    });
  });

  // ==========================================================
  // JUMP MOVEMENT (BMM p18)
  // ==========================================================
  describe('jump movement', () => {
    it('calculateMPCost: always 1 regardless of terrain', () => {
      const from = makeHex('4,4', 'clear', 0);
      expect(calc.calculateMPCost(from, makeHex('4,5', 'heavy_woods', 2, { ice: true }), makeUnit(), 'jump')).toBe(1);
      expect(calc.calculateMPCost(from, makeHex('4,5', 'swamp', 3, { mud: true }), makeUnit(), 'jump')).toBe(1);
      expect(calc.calculateMPCost(from, makeHex('4,5', 'water_depth2', 1), makeUnit(), 'jump')).toBe(1);
    });

    it('calculateMPCost: costs 1 regardless of level (3+)', () => {
      const from = makeHex('4,4', 'clear', 0);
      const to = makeHex('4,5', 'clear', 5);
      expect(calc.calculateMPCost(from, to, makeUnit(), 'jump')).toBe(1);
    });

    it('getMaxMP returns jump MP', () => {
      expect(calc.getMaxMP(makeUnit(4, 6, 4), 'jump')).toBe(4);
    });

    it('getValidMoves with jump can reach any hex within jump MP', () => {
      const unit = makeUnit(4, 6, 3, 0);
      const hexes = buildSimpleHexMap('4,4', 3);
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,4')).toBe(true);
      // The start hex is the "no move" entry; it is not entered, so it is free.
      expect(moves.get('4,4').cost).toBe(0);
      expect(moves.size).toBeGreaterThan(1);
    });

    it('getValidMoves with jump: max cost equals jump MP', () => {
      const unit = makeUnit(4, 6, 3, 0);
      const hexes = buildSimpleHexMap('4,4', 3);
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'jump');
      for (const [, data] of moves) {
        expect(data.cost).toBeLessThanOrEqual(3);
      }
    });

    // ----------------------------------------------------------
    // p18: "A jumping 'Mech also ignores facing: it can jump in any
    // direction for the same MP cost, regardless of its initial facing,
    // and when it lands it chooses any facing desired."
    // ----------------------------------------------------------
    it('does not charge a facing change when jumping', () => {
      const hexes = buildSimpleHexMap('4,4', 2);
      const gs = makeGameState(hexes);
      // 3,4 (SW, dir 4) is two hexsides from facing 0, so a walk would pay
      // 2 facing MP on top of the terrain cost.
      const unit = makeUnit(1, 2, 1, 0);
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('3,4')).toBe(true);
      expect(moves.get('3,4').cost).toBe(1);
      expect(moves.get('3,4').path).toEqual(['4,4', '3,4']);
    });

    it('jump reach and cost do not depend on the starting facing', () => {
      const gs = makeGameState(buildSimpleHexMap('4,4', 2));
      for (const facing of [0, 1, 2, 3, 4, 5]) {
        const moves = calc.getValidMoves(makeUnit(4, 6, 2, facing), gs, 'jump');
        expect(moves.has('3,4')).toBe(true);
        expect(moves.get('3,4').cost).toBe(1);
      }
    });

    it('lets the player choose the landing facing, not the last hop direction', () => {
      const unit = makeUnit(4, 6, 3, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '5,4': makeHex('5,4', 'clear', 0) // SE = dir 2, one hex away
      });

      // No choice given: the 'Mech keeps the facing it took off with (a legal
      // "any facing desired" choice), and pays no facing MP.
      const defaultFacing = calc.validateMovement(unit, ['4,4', '5,4'], 'jump', gs);
      expect(defaultFacing.valid).toBe(true);
      expect(defaultFacing.totalCost).toBe(1);
      expect(defaultFacing.finalFacing).toBe(0);

      const chosen = calc.validateMovement(unit, ['4,4', '5,4'], 'jump', gs, { landingFacing: 4 });
      expect(chosen.valid).toBe(true);
      expect(chosen.totalCost).toBe(1);
      expect(chosen.finalFacing).toBe(4);
    });

    it('reports the chosen landing facing in the move preview', () => {
      const gs = makeGameState(buildSimpleHexMap('4,4', 2));
      const moves = calc.getValidMoves(makeUnit(4, 6, 2, 3), gs, 'jump', { landingFacing: 5 });
      expect(moves.get('4,3').facing).toBe(5);
    });

    // ----------------------------------------------------------
    // p18: "Terrain does not affect this MP cost: if a hex is legal to
    // enter, it costs 1 MP to move over or into it, period." The start
    // hex is not entered, so it costs nothing.
    // ----------------------------------------------------------
    it('charges 1 MP per hex entered and nothing for the start hex', () => {
      const unit = makeUnit(4, 6, 3, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0),
        '4,2': makeHex('4,2', 'clear', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3', '4,2'], 'jump', gs);
      expect(result.valid).toBe(true);
      expect(result.totalCost).toBe(2);
    });

    it('charges 1 MP for the landing hex of a one-hex jump', () => {
      const unit = makeUnit(4, 6, 1, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'jump', gs);
      expect(result.valid).toBe(true);
      expect(result.totalCost).toBe(1); // the landing hex, not the start hex
    });

    it('charges 1 MP for a jump that stays in the starting hex (p18)', () => {
      // p18: "A 'Mech may jump into the same hex it began the turn in, for 1 MP."
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({ '4,4': makeHex('4,4', 'clear', 0) });
      const result = calc.validateMovement(unit, ['4,4', '4,4'], 'jump', gs);
      expect(result.valid).toBe(true);
      expect(result.totalCost).toBe(1);
    });

    it('charges 1 MP to land on a higher level instead of the level-change cost', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 2)
      });
      const from = gs.map.hexes.get('4,4');
      const to = gs.map.hexes.get('4,3');
      expect(calc.calculateMPCost(from, to, unit, 'walk')).toBe(3); // 1 + 2 levels
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.get('4,3').cost).toBe(1);
    });

    it('ignores terrain costs when jumping over or into terrain', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'heavy_woods', 1, { ice: true }),
        '4,2': makeHex('4,2', 'water_depth1', 0)
      });
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.get('4,3').cost).toBe(1);
      expect(moves.get('4,2').cost).toBe(2);
    });

    // ----------------------------------------------------------
    // p18: "A jumping 'Mech ignores terrain (and other 'Mechs) in hexes
    // it jumps over." It "cannot land in an occupied hex" (stacking, p18).
    // ----------------------------------------------------------
    it('flies over occupied hexes but cannot land in one', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0, { occupiedBy: 'enemyUnit' }),
        '4,2': makeHex('4,2', 'clear', 0)
      });

      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,3')).toBe(false); // occupied: no landing
      expect(moves.has('4,2')).toBe(true); // overflight allowed
      expect(moves.get('4,2').cost).toBe(2);
      expect(moves.get('4,2').path).toEqual(['4,4', '4,3', '4,2']);

      const overflight = calc.validateMovement(unit, ['4,4', '4,3', '4,2'], 'jump', gs);
      expect(overflight.valid).toBe(true);

      const landing = calc.validateMovement(unit, ['4,4', '4,3'], 'jump', gs);
      expect(landing.valid).toBe(false);
      expect(landing.errors.join(' ')).toContain('Cannot land in an occupied hex');
    });

    // ----------------------------------------------------------
    // p18: "a 'Mech cannot enter a hex with a level higher than the sum
    // of its current Jumping MP plus the level of the hex its jump began in."
    // ----------------------------------------------------------
    it('rejects a landing hex higher than Jumping MP + start level', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 3),
        '4,2': makeHex('4,2', 'clear', 0)
      });

      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,3')).toBe(false);
      // The level-3 hex also blocks the only shortest path to 4,2.
      expect(moves.has('4,2')).toBe(false);

      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'jump', gs);
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Jump height exceeded');
    });

    it('allows a landing hex exactly at the height limit', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 2) // Jumping MP 2 + start level 0
      });
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,3')).toBe(true);
      expect(moves.get('4,3').cost).toBe(1);
    });

    it('adds the starting hex level to the clearable height', () => {
      const unit = makeUnit(4, 6, 3, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 2), // starting level 2
        '4,3': makeHex('4,3', 'clear', 4), // 4 <= 3 + 2
        '4,2': makeHex('4,2', 'clear', 6) // 6 > 5
      });
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,3')).toBe(true);
      expect(moves.has('4,2')).toBe(false);
    });

    it('uses the starting water depth as a negative level (p18 worked example)', () => {
      const unit = makeUnit(4, 6, 4, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'water_depth1', 0), // starting level -1
        '4,3': makeHex('4,3', 'clear', 3), // 3 <= 4 + (-1)
        '4,2': makeHex('4,2', 'clear', 4) // 4 > 3
      });
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,3')).toBe(true);
      expect(moves.has('4,2')).toBe(false);
    });

    it('uses another shortest path when one is blocked by height', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 3), // too high for Jumping MP 2
        '5,3': makeHex('5,3', 'clear', 0), // the other two-hex path
        '5,2': makeHex('5,2', 'clear', 0)
      });
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('5,2')).toBe(true);
      expect(moves.get('5,2').cost).toBe(2);
      expect(moves.get('5,2').path).toEqual(['4,4', '5,3', '5,2']);
    });

    // ----------------------------------------------------------
    // p18: "A 'Mech can move 1 hex for each available Jumping MP."
    // ----------------------------------------------------------
    it('reaches exactly Jumping MP hexes and no farther', () => {
      const unit = makeUnit(4, 6, 3, 0);
      const gs = makeGameState(buildSimpleHexMap('4,4', 5));
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.has('4,7')).toBe(true);
      expect(moves.get('4,7').cost).toBe(3);
      expect(moves.get('4,7').path).toEqual(['4,4', '4,5', '4,6', '4,7']);
      expect(moves.has('4,8')).toBe(false);
    });

    it('rejects a jump path longer than Jumping MP', () => {
      const unit = makeUnit(4, 6, 2, 0);
      const gs = makeGameState(buildSimpleHexMap('4,4', 4));
      const result = calc.validateMovement(unit, ['4,4', '4,5', '4,6', '4,7'], 'jump', gs);
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Exceeded max MP');
    });

    // ----------------------------------------------------------
    // p18: "A 'Mech can only jump to its destination hex via the shortest
    // path (i.e. the fewest number of hexes required to get there)."
    // ----------------------------------------------------------
    it('rejects a detour instead of the shortest path', () => {
      const unit = makeUnit(4, 6, 4, 0);
      const gs = makeGameState(buildSimpleHexMap('4,4', 4));
      // Four hops: 4,4 -> 4,5 -> 5,5 -> 5,6 -> 6,6. 4,4 to 6,6 is three.
      const result = calc.validateMovement(
        unit, ['4,4', '4,5', '5,5', '5,6', '6,6'], 'jump', gs
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('shortest path');
    });

    it('generates jump paths that all pass validation', () => {
      const unit = makeUnit(4, 6, 3, 2);
      const gs = makeGameState(buildSimpleHexMap('4,4', 4));
      const moves = calc.getValidMoves(unit, gs, 'jump');
      for (const [hexKey, data] of moves) {
        if (hexKey === unit.position.hexKey) continue; // the "no move" entry
        const result = calc.validateMovement(unit, data.path, 'jump', gs);
        expect(result.valid, `${hexKey}: ${result.errors.join(', ')}`).toBe(true);
        expect(result.totalCost).toBe(data.cost);
      }
    });
  });

  // ==========================================================
  // JUMP JETS IN WATER (BMM p18 / p19)
  // ==========================================================
  describe('jump jets in water (p18/p19)', () => {
    /** Mount operational standard jump jets in a location. */
    function addJets(unit, location, count) {
      if (!unit.criticalSlots[location]) unit.criticalSlots[location] = [];
      for (let i = 0; i < count; i++) {
        unit.criticalSlots[location].push({ item: 'jump_jet', status: 'ok' });
      }
      return unit;
    }

    /**
     * p18 worked example: Jumping MP 6 with two of the jets in the legs (one
     * per leg) and the other four in the torsos.
     */
    function makeFloodedJumper() {
      const unit = makeUnit(4, 6, 6, 0, 0);
      addJets(unit, 'leftLeg', 1);
      addJets(unit, 'rightLeg', 1);
      addJets(unit, 'centerTorso', 4);
      return unit;
    }

    function mapWithStartWater(depth, radius) {
      const hexes = buildSimpleHexMap('4,4', radius);
      hexes['4,4'] = makeHex('4,4', `water_depth${depth}`, 0);
      return hexes;
    }

    it('p18 example: 6 jets, 2 leg-mounted submerged in Depth 1 -> 4 MP and Level 3 ceiling', () => {
      const unit = makeFloodedJumper();
      const hexes = mapWithStartWater(1, 6);
      hexes['4,3'] = makeHex('4,3', 'clear', 3); // 3 <= 4 + start level (-1)
      hexes['4,2'] = makeHex('4,2', 'clear', 4); // 4 > 3
      const gs = makeGameState(hexes);

      // The rating is 6; the two submerged leg jets leave 4 available.
      expect(calc.getMaxMP(unit, 'jump')).toBe(6);
      expect(calc.getAvailableJumpMP(unit, gs)).toBe(4);

      const moves = calc.getValidMoves(unit, gs, 'jump');
      // "it can only jump over Level 3 terrain and lower this turn"
      expect(moves.get('4,3').cost).toBe(1);
      expect(moves.has('4,2')).toBe(false);
      // Range is the available 4, not the design rating 6.
      expect(moves.get('4,8').cost).toBe(4);
      expect(moves.has('4,9')).toBe(false);

      const jump = calc.validateMovement(unit, ['4,4', '4,5', '4,6', '4,7', '4,8'], 'jump', gs);
      expect(jump.valid).toBe(true);
      expect(jump.totalCost).toBe(4);

      const tooFar = calc.validateMovement(
        unit, ['4,4', '4,5', '4,6', '4,7', '4,8', '4,9'], 'jump', gs
      );
      expect(tooFar.valid).toBe(false);
      expect(tooFar.errors.join(' ')).toContain('Exceeded max MP');
    });

    it('p19 example: 5 jets, one per leg plus three torso locations, leaves 3 in Depth 1', () => {
      // p19 MOVEMENT IN WATER: "a 'Mech with a Jumping MP of 5 that has one
      // jump jet in each leg and one in each torso location may only use 3
      // Jumping MP when jumping out of Depth 1 water."
      const unit = makeUnit(5, 8, 5, 0, 0);
      addJets(unit, 'leftLeg', 1);
      addJets(unit, 'rightLeg', 1);
      addJets(unit, 'centerTorso', 1);
      addJets(unit, 'leftTorso', 1);
      addJets(unit, 'rightTorso', 1);

      const gs = makeGameState(mapWithStartWater(1, 4));
      expect(calc.getAvailableJumpMP(unit, gs)).toBe(3);
    });

    it('Depth 2 and deeper water forbids jumping entirely (p19)', () => {
      for (const depth of [2, 3]) {
        const unit = makeFloodedJumper();
        const gs = makeGameState(mapWithStartWater(depth, 4));

        // "a 'Mech standing in Depth 2 or deeper water cannot jump at all."
        expect(calc.getAvailableJumpMP(unit, gs)).toBe(0);
        expect(calc.getValidMoves(unit, gs, 'jump').size).toBe(0);

        const result = calc.validateMovement(unit, ['4,4', '4,5'], 'jump', gs);
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(
          new RegExp(`Cannot jump from Depth ${depth} water.*submerged`)
        );
      }
    });

    it('dry land keeps the full jet count, range and the free start hex', () => {
      const unit = makeFloodedJumper();
      const gs = makeGameState(buildSimpleHexMap('4,4', 7));

      expect(calc.getAvailableJumpMP(unit, gs)).toBe(6);
      const moves = calc.getValidMoves(unit, gs, 'jump');
      expect(moves.get('4,4').cost).toBe(0);
      expect(moves.get('4,10').cost).toBe(6); // six hexes away
      expect(moves.has('4,11')).toBe(false); // seven away: beyond the rating
    });

    it('subtracts destroyed jump jets from the rating (p14)', () => {
      const unit = makeFloodedJumper();
      unit.criticalSlots.centerTorso[0].status = 'destroyed';

      // "'Mechs lose one Jumping MP for each jump jet destroyed."
      expect(calc.getMaxMP(unit, 'jump')).toBe(5);
      const gs = makeGameState(buildSimpleHexMap('4,4', 4));
      expect(calc.getAvailableJumpMP(unit, gs)).toBe(5);
    });

    it('drops jump jets that are in a destroyed location (p44)', () => {
      const unit = makeFloodedJumper();
      unit.internalStructure = { leftLeg: 0, rightLeg: 4, centerTorso: 12 };

      // The left-leg jet went with the leg; the other five jets remain.
      expect(calc.getMaxMP(unit, 'jump')).toBe(5);
    });

    it('falls back to the design rating when jets are not modelled per location', () => {
      const unit = makeUnit(4, 6, 3, 0); // no jump_jet critical slots
      const gs = makeGameState(buildSimpleHexMap('4,4', 4));
      expect(calc.getMaxMP(unit, 'jump')).toBe(3);
      expect(calc.getAvailableJumpMP(unit, gs)).toBe(3);
    });
  });

  // ==========================================================
  // ENGINE JUMP-MP ACCOUNTING (p19)
  // ==========================================================
  describe('engine jump MP accounting (p19)', () => {
    /**
     * A Jenner whose five torso-mounted jets are rearranged to three torso +
     * two leg-mounted, so Depth 1 water submerges the leg pair (p18/p19).
     */
    function makeLegJetJumper() {
      const unit = createTestUnit('jenner-jr7d', 0, 'jumper');
      const jets = [];
      for (const [location, slots] of Object.entries(unit.criticalSlots)) {
        slots.forEach((slot, index) => {
          if (slot.item === 'jump_jet') jets.push({ location, index });
        });
      }
      ['leftLeg', 'rightLeg'].forEach((leg, k) => {
        unit.criticalSlots[jets[k].location][jets[k].index].item = 'empty';
        unit.criticalSlots[leg].push({ item: 'jump_jet', status: 'ok' });
      });
      return unit;
    }

    function moveEngine(unit, terrainType) {
      unit.position = { hexKey: '4,4', facing: 0 };
      const engine = createTestEngine({ units: { [unit.id]: unit } });
      const state = engine.stateManager.getState();
      if (terrainType !== 'clear') {
        state.map.hexes.get('4,4').terrainType = terrainType;
      }
      engine.phaseManager.enterPhase('movement');
      engine.phaseManager.clearQueue();
      state.currentPlayer = 0;
      return engine;
    }

    it('remaining jump MP comes from the standing hex, not the dry rating', () => {
      const jumper = makeLegJetJumper();
      const engine = moveEngine(jumper, 'water_depth1');

      const result = engine.processAction(0, {
        type: 'move', unitId: jumper.id, path: ['4,4', '4,5'], movementType: 'jump'
      });

      expect(result.success).toBe(true);
      // p19: 5 jets, two submerged leg-mounted jets -> 3 available; one hex
      // spent leaves 2 (the dry rating would have reported 4).
      expect(result.remainingMP).toBe(2);
    });

    it('dry land still reports the full rating minus the hexes jumped', () => {
      const jumper = makeLegJetJumper();
      const engine = moveEngine(jumper, 'clear');

      const result = engine.processAction(0, {
        type: 'move', unitId: jumper.id, path: ['4,4', '4,5'], movementType: 'jump'
      });

      expect(result.success).toBe(true);
      expect(result.remainingMP).toBe(4); // 5 jets - 1 hex
    });
  });

  // ==========================================================
  // VALID MOVE GENERATION (getValidMoves)
  // ==========================================================
  describe('valid move generation (getValidMoves)', () => {
    it('includes start hex with cost 0', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const hexes = buildSimpleHexMap('4,4', 2);
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('4,4')).toBe(true);
      expect(moves.get('4,4').cost).toBe(0);
    });

    it('includes direct neighbor in facing direction (cost=1)', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const hexes = buildSimpleHexMap('4,4', 1);
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('4,3')).toBe(true);
      expect(moves.get('4,3').cost).toBe(1);
    });

    it('does not include hex that requires more MP than available', () => {
      const unit = makeUnit(1, 2, 0, 0);
      const hexes = buildSimpleHexMap('4,4', 1);
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      // SE is dir 2 from facing 0, so facingChange = 2, terrain = 1, total = 3 > 1 MP
      expect(moves.has('5,4')).toBe(false);
    });

    it('respects occupied hexes (cannot move into enemy)', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0, { occupiedBy: 'enemyUnit' })
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('4,3')).toBe(false);
    });

    it('can move through occupied hexes from starting position', () => {
      // Only the start hex is excluded from occupied check
      // But wait, neighborHex.occupiedBy && neighborKey !== startKey blocks occupied hexes for non-start
      // Starting hex is always allowed regardless of occupiedBy
      const unit = makeUnit(4, 6, 0, 0);
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0, { occupiedBy: 'self' })
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      // 4,3 is occupied so blocked except it's not start
      expect(moves.has('4,3')).toBe(false);
    });

    it('faced 2 unit with 2 MP cannot reach SW neighbor (2 facing + 1 terrain = 3 > 2 MP)', () => {
      const unit = makeUnit(2, 4, 0, 2);
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '3,4': makeHex('3,4', 'clear', 0) // SW, dir 4 from 4,4
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      // facingChangeFromDirection(2, 4) = 2, terrain = 1, total = 3 > 2 MP
      expect(moves.has('3,4')).toBe(false);
    });

    it('tracks remainingMP in move data', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const hexes = buildSimpleHexMap('4,4', 2);
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.get('4,3').remainingMP).toBe(3);
    });
  });

  // ==========================================================
  // MOVEMENT VALIDATION (validateMovement)
  // ==========================================================
  describe('movement validation (validateMovement)', () => {
    it('rejects path with fewer than 2 hexes', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = calc.validateMovement(unit, ['4,4'], 'walk', gs);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least 2');
    });

    it('validates a simple 2-hex clear move', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'walk', gs);
      expect(result.valid).toBe(true);
      expect(result.totalCost).toBe(1);
    });

    it('fails when path exceeds max MP', () => {
      const unit = makeUnit(2, 4, 0, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'heavy_woods', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'walk', gs);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Exceeded max MP');
    });

    it('returns final facing as direction of last move', () => {
      const unit = makeUnit(4, 6, 0, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'clear', 0),
        '5,2': makeHex('5,2', 'clear', 0) // NE of 4,3 (even col)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3', '5,2'], 'walk', gs);
      expect(result.finalFacing).toBe(1); // NE = direction 1
    });

    it('reports missing hex errors', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = calc.validateMovement(unit, ['4,4', '99,99'], 'walk', gs);
      expect(result.errors[0]).toContain('Hex not found');
    });

    it('validates path through varied terrain', () => {
      const unit = makeUnit(8, 12, 0, 0);
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'light_woods', 0),
        '4,2': makeHex('4,2', 'heavy_woods', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3', '4,2'], 'walk', gs);
      expect(result.valid).toBe(true);
      expect(result.totalCost).toBe(5); // 1 + 2 + 3... wait, 4->4,3=2, 4,3->4,2: directionBetween from 4,3 to 4,2 is N (dir 0). currentFacing after step1 = 0. same direction. terrain = heavy_woods(3). total = 2+3=5
    });

    it('uses heat-reduced MP for validation threshold', () => {
      const unit = makeUnit(4, 6, 0, 0, 15); // walk MP reduced from 4 to 2
      const gs = makeGameState({
        '4,4': makeHex('4,4', 'clear', 0),
        '4,3': makeHex('4,3', 'heavy_woods', 0)
      });
      const result = calc.validateMovement(unit, ['4,4', '4,3'], 'walk', gs);
      expect(result.valid).toBe(false); // cost 3 > maxMP 2
    });
  });

  // ==========================================================
  // INTEGRATION: HEAT + FACING + TERRAIN IN getValidMoves
  // ==========================================================
  describe('integration: heat + facing + terrain', () => {
    it('heated unit has reduced reachable hexes', () => {
      const cold = makeUnit(4, 6, 0, 0, 0);
      const hot = makeUnit(4, 6, 0, 0, 15);
      const hexes = buildSimpleHexMap('4,4', 2);
      const gs = makeGameState(hexes);

      const coldMoves = calc.getValidMoves(cold, gs, 'walk');
      const hotMoves = calc.getValidMoves(hot, gs, 'walk');

      expect(hotMoves.size).toBeLessThan(coldMoves.size);
    });

    it('heavy woods blocks units with tight facing budgets', () => {
      const unit = makeUnit(3, 4, 0, 0); // 3 walk MP
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '5,4': makeHex('5,4', 'heavy_woods', 0) // SE, dir 2, facingChange=2, terrain=3, total=5 > 3
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('5,4')).toBe(false);
    });

    it('high MP unit can reach through heavy woods with facing change', () => {
      const unit = makeUnit(6, 8, 0, 0);
      const hexes = {
        '4,4': makeHex('4,4', 'clear', 0),
        '5,4': makeHex('5,4', 'heavy_woods', 0) // facing 2, terrain 3, total 5 <= 6
      };
      const gs = makeGameState(hexes);
      const moves = calc.getValidMoves(unit, gs, 'walk');
      expect(moves.has('5,4')).toBe(true);
    });
  });
});
