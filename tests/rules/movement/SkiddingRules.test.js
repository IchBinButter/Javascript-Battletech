import { describe, it, expect } from 'vitest';
import { SkiddingRules } from '../../../src/rules/movement/SkiddingRules.js';
import { Hex } from '../../../src/models/Hex.js';

function makeHex(key, terrainType = 'clear', level = 0, overrides = {}) {
  return new Hex(key, { terrainType, level, ...overrides });
}

function makeUnit(tonnage = 50, facing = 3, position = '0,2', piloting = 5) {
  return {
    tonnage,
    position: { hexKey: position, facing },
    pilot: { piloting }
  };
}

function makeDiceRoller(rolls = [6]) {
  let idx = 0;
  return {
    roll2d6() {
      const r = rolls[idx % rolls.length];
      idx++;
      return r;
    },
    next() {
      return 0.5;
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

function buildStraightPath(startCol, startRow, direction, length) {
  const hexes = {};
  let [col, row] = [startCol, startRow];
  for (let i = 0; i <= length; i++) {
    const key = `${col},${row}`;
    hexes[key] = makeHex(key);
    const next = getNextHex(col, row, direction);
    col = next.col;
    row = next.row;
  }
  return hexes;
}

function getNextHex(col, row, direction) {
  const isEven = col % 2 === 0;
  const dirs = isEven
    ? { 0: [0, -1], 1: [1, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0], 5: [-1, -1] }
    : { 0: [0, -1], 1: [1, 0], 2: [1, 1], 3: [0, 1], 4: [-1, 1], 5: [-1, 0] };
  const [dc, dr] = dirs[direction % 6];
  return { col: col + dc, row: row + dr };
}

// ============================================================================
// Shared test fixture: unit at 0,2 facing S(3), path: 0,3 -> 0,4 -> 0,5 -> 0,6
// ============================================================================

describe('SkiddingRules', () => {
  const rules = new SkiddingRules();

  describe('checkSkid', () => {
    it('returns willSkid false for walk movement', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'walk', gs);
      expect(result.willSkid).toBe(false);
    });

    it('returns willSkid true on ice while running', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4', 'clear', 0, { ice: true }) });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(true);
      expect(result.reason).toContain('ice');
    });

    it('returns willSkid true on pavement while running', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4', 'pavement') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(true);
      expect(result.reason).toContain('pavement');
    });

    it('returns willSkid true for rapid turn while running', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 3;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(true);
      expect(result.reason).toContain('Rapid turn');
    });

    it('returns willSkid false for rapid turn of only 1 hexside', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 1;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(false);
    });
  });

  describe('resolveSkid - basic', () => {
    it('skids the full remaining MP in the facing direction (S)', () => {
      // Unit at 0,2 facing S(3). S from 0,2 -> 0,3 -> 0,4 -> 0,5 -> 0,6
      const hexes = buildStraightPath(0, 2, 3, 5);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 4, gs);

      expect(result.path).toEqual(['0,3', '0,4', '0,5', '0,6']);
      expect(result.collisions).toEqual([]);
      expect(result.finalHex).toBe('0,6');
    });

    it('skids in unit facing direction N', () => {
      // Unit at 0,4 facing N(0). N from 0,4 -> 0,3 -> 0,2 -> 0,1
      const hexes = buildStraightPath(0, 4, 0, 5);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 0, '0,4');
      const result = rules.resolveSkid(unit, 3, gs);

      expect(result.path).toEqual(['0,3', '0,2', '0,1']);
      expect(result.finalHex).toBe('0,1');
    });

    it('returns empty path for zero remainingMP', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 0, gs);

      expect(result.path).toEqual([]);
      expect(result.damage).toBe(0);
      expect(result.finalHex).toBe('0,2');
    });

    it('stops at map edge when next hex does not exist', () => {
      const hexes = buildStraightPath(0, 2, 3, 1);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 4, gs);

      expect(result.path).toEqual(['0,3']);
      expect(result.finalHex).toBe('0,3');
    });

    it('skid damage = ceil(tonnage/10) * hexesSkidded (no collision)', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      const gs = makeGameState(hexes);
      const unit = makeUnit(55, 3, '0,2'); // ceil(55/10)=6, 4 hexes skidded
      const result = rules.resolveSkid(unit, 4, gs);

      expect(result.path.length).toBe(4);
      expect(result.damage).toBe(24); // 6 * 4
    });

    it('skid damage = 0 when no hexes skidded', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      const gs = makeGameState(hexes);
      const unit = makeUnit(100, 3, '0,2');
      const result = rules.resolveSkid(unit, 0, gs);

      expect(result.damage).toBe(0);
    });
  });

  describe('resolveSkid - collisions', () => {
    it('unit collision damage = ceil(tonnage/10) * hexesSkidded to both units', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      hexes['0,5'] = makeHex('0,5', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2'); // ceil(50/10)=5
      const result = rules.resolveSkid(unit, 4, gs);

      // Skid path: 0,3, 0,4, 0,5 (collision at 3rd hex)
      expect(result.path).toEqual(['0,3', '0,4', '0,5']);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].type).toBe('unit');
      expect(result.collisions[0].unitId).toBe('enemy_1');
      expect(result.collisions[0].damageToTarget).toBe(15); // 5 * 3
      expect(result.collisions[0].damageToSelf).toBe(15);
    });

    it('collision on first hex: damage = ceil(tonnage/10) * 1', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(100, 3, '0,2'); // ceil(100/10)=10
      const result = rules.resolveSkid(unit, 4, gs);

      expect(result.path).toEqual(['0,3']);
      expect(result.collisions[0].damageToTarget).toBe(10); // 10 * 1
      expect(result.collisions[0].damageToSelf).toBe(10);
    });

    it('stops skid on collision (does not continue past collision)', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 4, gs);

      expect(result.path.length).toBe(2); // 0,3 and 0,4
      expect(result.finalHex).toBe('0,3'); // finalHex is last hex BEFORE collision
    });

    it('building collision stops skid', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { building: { type: 'medium' } });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 4, gs);

      expect(result.path.length).toBe(2);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].type).toBe('building');
      expect(result.collisions[0].buildingType).toBe('medium');
    });
  });

  describe('resolveSkid - chain skidding', () => {
    it('extends skid on ice when PSR roll fails', () => {
      // Unit skids 2 hexes. On hex 2 (ice), PSR fails -> extend by 2 more hexes
      const hexes = buildStraightPath(0, 2, 3, 10);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2', 4); // piloting 4
      const diceRoller = makeDiceRoller([3]); // roll 3 < 4 -> PSR fail

      // skid 2: path 0,3 -> 0,4(ice,psr fail) -> extend by 2 -> 0,5 -> 0,6
      const result = rules.resolveSkid(unit, 2, gs, diceRoller);

      expect(result.path.length).toBe(4);
      expect(result.path).toEqual(['0,3', '0,4', '0,5', '0,6']);
      expect(result.finalHex).toBe('0,6');
      expect(result.collisions).toEqual([]);
    });

    it('does NOT extend skid on ice when PSR roll passes', () => {
      const hexes = buildStraightPath(0, 2, 3, 10);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2', 4); // piloting 4
      const diceRoller = makeDiceRoller([7]); // roll 7 >= 4 -> PSR pass

      const result = rules.resolveSkid(unit, 2, gs, diceRoller);

      expect(result.path.length).toBe(2);
      expect(result.path).toEqual(['0,3', '0,4']);
      expect(result.finalHex).toBe('0,4');
    });

    it('extends skid on pavement when PSR fails', () => {
      const hexes = buildStraightPath(0, 2, 3, 15);
      hexes['0,3'] = makeHex('0,3', 'pavement', 0);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2', 3); // piloting 3
      const diceRoller = makeDiceRoller([2]); // roll 2 < 3 -> fail

      const result = rules.resolveSkid(unit, 3, gs, diceRoller);

      // original 3 MP: 0,3(pavement,psr fail,totalHexes+=3=6),0,4,0,5,0,6,0,7,0,8
      expect(result.path.length).toBe(6);
      expect(result.path).toEqual(['0,3', '0,4', '0,5', '0,6', '0,7', '0,8']);
    });

    it('does nothing on ice without diceRoller (no crash)', () => {
      const hexes = buildStraightPath(0, 2, 3, 5);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 2, gs); // no diceRoller

      expect(result.path.length).toBe(2);
    });
  });

  describe('resolveSkid - damage combined scenarios', () => {
    it('skid damage + collision damage are both calculated correctly', () => {
      const hexes = buildStraightPath(0, 2, 3, 10);
      hexes['0,6'] = makeHex('0,6', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, 3, '0,2');
      const result = rules.resolveSkid(unit, 6, gs);

      // Path: 0,3, 0,4, 0,5, 0,6 (4 hexes), collision at 4th hex
      // Skid damage: ceil(50/10)=5 * 4 = 20
      // Collision damage: ceil(50/10)=5 * 4 = 20
      expect(result.damage).toBe(20);
      expect(result.collisions[0].damageToTarget).toBe(20);
      expect(result.collisions[0].damageToSelf).toBe(20);
    });
  });
});
