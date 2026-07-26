import { describe, it, expect } from 'vitest';
import { SkiddingRules } from '../../../src/rules/movement/SkiddingRules.js';
import { Hex } from '../../../src/models/Hex.js';
import { getNeighborInDirection } from '../../../src/hex/HexMath.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

/**
 * Build a hex map along a straight line in a given direction.
 * Returns { hexes: obj, terms: Array of keys on the path including start }
 */
function buildLine(startCol, startRow, direction, length, extra = {}) {
  const hexes = {};
  let [col, row] = [startCol, startRow];

  for (let i = 0; i <= length; i++) {
    const key = `${col},${row}`;
    hexes[key] = makeHex(key, 'clear', 0, extra[key] || {});
    const n = getNeighborInDirection(key, direction);
    const parts = n.split(',').map(Number);
    col = parts[0];
    row = parts[1];
  }

  return hexes;
}

/**
 * Build the expected skid-path keys starting from a hex, moving in direction
 * for `count` steps.  Uses getNeighborInDirection so parity matches the engine.
 */
function expectedPath(startKey, direction, count) {
  const path = [];
  let key = startKey;
  for (let i = 0; i < count; i++) {
    const next = getNeighborInDirection(key, direction);
    path.push(next);
    key = next;
  }
  return path;
}

// ---------------------------------------------------------------------------
// SkiddingRules
// ---------------------------------------------------------------------------

describe('SkiddingRules', () => {
  const rules = new SkiddingRules();

  // ==========================================================================
  // skid triggers (checkSkid)
  // ==========================================================================

  describe('checkSkid — triggers', () => {
    it('returns willSkid false for walk movement', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'walk', gs);
      expect(result.willSkid).toBe(false);
    });

    it('returns willSkid false for jump movement', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'jump', gs);
      expect(result.willSkid).toBe(false);
    });

    it('returns willSkid false for running on clear terrain with no rapid turn', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '0,2': makeHex('0,2') });
      const result = rules.checkSkid(unit, '0,2', '0,3', 'run', gs);
      expect(result.willSkid).toBe(false);
    });

    // -- ice / pavement ------------------------------------------------------

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

    it('ice skid takes precedence over pavement in reason (ice checked first)', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': makeHex('4,4', 'pavement', 0, { ice: true }) });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(true);
      expect(result.reason).toContain('ice');
    });

    it('returns willSkid false on ice when walking', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '0,2': makeHex('0,2', 'clear', 0, { ice: true }) });
      const result = rules.checkSkid(unit, '0,2', '0,3', 'walk', gs);
      expect(result.willSkid).toBe(false);
    });

    it('returns willSkid false on pavement when walking', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '0,2': makeHex('0,2', 'pavement') });
      const result = rules.checkSkid(unit, '0,2', '0,3', 'walk', gs);
      expect(result.willSkid).toBe(false);
    });

    // -- rapid turn ----------------------------------------------------------

    it('returns willSkid true for rapid turn of 2 hexsides while running', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 2;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(true);
      expect(result.reason).toContain('Rapid turn');
    });

    it('returns willSkid true for rapid turn of 3 hexsides while running', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 3;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(true);
      expect(result.reason).toContain('Rapid turn');
    });

    it('returns willSkid false for rapid turn of 1 hexside while running', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 1;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(false);
    });

    it('returns willSkid false for rapid turn of 0 hexsides while running', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 0;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'run', gs);
      expect(result.willSkid).toBe(false);
    });

    it('rapid turn is ignored when walking (movementType is not run)', () => {
      const unit = makeUnit();
      unit._rapidTurnHexsides = 3;
      const gs = makeGameState({ '4,4': makeHex('4,4') });
      const result = rules.checkSkid(unit, '4,4', '4,5', 'walk', gs);
      expect(result.willSkid).toBe(false);
    });

    it('handles missing hex gracefully (no skid)', () => {
      const unit = makeUnit();
      const gs = { map: { hexes: new Map() } };
      const result = rules.checkSkid(unit, '99,99', '99,100', 'run', gs);
      expect(result.willSkid).toBe(false);
    });
  });

  // ==========================================================================
  // skid direction from facing (resolveSkid)
  // ==========================================================================

  describe('resolveSkid — skid direction from facing', () => {
    it('facing S (3): skids south', () => {
      const dir = 3;
      const startKey = '0,2';
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 4));
    });

    it('facing N (0): skids north', () => {
      const dir = 0;
      const startKey = '0,4';
      const hexes = buildLine(0, 4, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 3, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 3));
    });

    it('facing NE (1): skids north-east', () => {
      const dir = 1;
      const startKey = '0,2';
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 4));
    });

    it('facing SE (2): skids south-east', () => {
      const dir = 2;
      const startKey = '0,2';
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 4));
    });

    it('facing SW (4): skids south-west', () => {
      const dir = 4;
      const startKey = '4,4';
      const hexes = buildLine(4, 4, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 4));
    });

    it('facing NW (5): skids north-west', () => {
      const dir = 5;
      const startKey = '4,4';
      const hexes = buildLine(4, 4, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 4));
    });

    it('facing SE (2) from an odd-column origin', () => {
      const dir = 2;
      const startKey = '1,2';
      const hexes = buildLine(1, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, startKey);

      const result = rules.resolveSkid(unit, 3, gs);
      expect(result.path).toEqual(expectedPath(startKey, dir, 3));
    });
  });

  // ==========================================================================
  // skid damage to skidding unit (resolveSkid)
  // ==========================================================================

  describe('resolveSkid — skid damage to skidding unit', () => {
    const dir = 3; // S

    it('damage = ceil(tonnage/10) * hexesSkidded (whole-number tonnage)', () => {
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2'); // ceil(50/10) = 5

      const r4 = rules.resolveSkid(unit, 4, gs);
      expect(r4.damage).toBe(20); // 5 * 4
      expect(r4.path).toHaveLength(4);

      const r2 = rules.resolveSkid(unit, 2, gs);
      expect(r2.damage).toBe(10); // 5 * 2
      expect(r2.path).toHaveLength(2);
    });

    it('damage = ceil(tonnage/10) * hexesSkidded (fractional tonnage)', () => {
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      // ceil(51/10)=6, ceil(55/10)=6, ceil(59/10)=6
      const u51 = makeUnit(51, dir, '0,2');
      const u55 = makeUnit(55, dir, '0,2');
      const u59 = makeUnit(59, dir, '0,2');

      expect(rules.resolveSkid(u51, 4, gs).damage).toBe(24); // 6 * 4
      expect(rules.resolveSkid(u55, 4, gs).damage).toBe(24);
      expect(rules.resolveSkid(u59, 4, gs).damage).toBe(24);
    });

    it('light mech (20 tons): ceil(2)*n', () => {
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(20, dir, '0,2');

      expect(rules.resolveSkid(unit, 5, gs).damage).toBe(10); // 2 * 5
    });

    it('assault mech (100 tons): ceil(10)*n', () => {
      const hexes = buildLine(0, 2, dir, 6);
      const gs = makeGameState(hexes);
      const unit = makeUnit(100, dir, '0,2');

      expect(rules.resolveSkid(unit, 3, gs).damage).toBe(30); // 10 * 3
    });

    it('zero remaining MP → damage is 0', () => {
      const hexes = buildLine(0, 2, dir, 3);
      const gs = makeGameState(hexes);
      const unit = makeUnit(100, dir, '0,2');

      const result = rules.resolveSkid(unit, 0, gs);
      expect(result.path).toEqual([]);
      expect(result.damage).toBe(0);
      expect(result.finalHex).toBe('0,2');
    });

    it('damage still accumulates when path ends at map edge (no collision)', () => {
      const hexes = buildLine(0, 2, dir, 1); // only 0,2; 0,3
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(['0,3']);
      expect(result.damage).toBe(5); // ceil(5)*1
      expect(result.finalHex).toBe('0,3');
    });
  });

  // ==========================================================================
  // collision damage formula: ceil(tonnage/10) * hexes (resolveSkid)
  // ==========================================================================

  describe('resolveSkid — collision damage formula', () => {
    const dir = 3; // S

    it('unit collision on 3rd hex: damage = ceil(tonnage/10) * 3 to both units', () => {
      const hexes = buildLine(0, 2, dir, 5);
      hexes['0,5'] = makeHex('0,5', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2'); // ceil(5) = 5

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(['0,3', '0,4', '0,5']);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].damageToTarget).toBe(15); // 5 * 3
      expect(result.collisions[0].damageToSelf).toBe(15);
    });

    it('collision on first hex: damage = ceil(tonnage/10) * 1', () => {
      const hexes = buildLine(0, 2, dir, 3);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(100, dir, '0,2'); // ceil(10) = 10

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toEqual(['0,3']);
      expect(result.collisions[0].damageToTarget).toBe(10); // 10 * 1
      expect(result.collisions[0].damageToSelf).toBe(10);
    });

    it('fractional tonnage (51t): ceil(5.1)=6 → collision at hex 2 = 12', () => {
      const hexes = buildLine(0, 2, dir, 3);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(51, dir, '0,2');

      const result = rules.resolveSkid(unit, 3, gs);
      // path: 0,3; 0,4(collision) = 2 hexes
      expect(result.path).toHaveLength(2);
      expect(result.collisions[0].damageToTarget).toBe(12); // 6 * 2
      expect(result.collisions[0].damageToSelf).toBe(12);
    });

    it('very heavy unit (95t): ceil(9.5)=10 → collision at hex 5 = 50', () => {
      const hexes = buildLine(0, 2, dir, 7);
      hexes['0,7'] = makeHex('0,7', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(95, dir, '0,2');

      const result = rules.resolveSkid(unit, 6, gs);
      // path: 0,3; 0,4; 0,5; 0,6; 0,7(collision) = 5 hexes
      expect(result.path).toHaveLength(5);
      expect(result.collisions[0].damageToTarget).toBe(50); // 10 * 5
    });

    it('building collision: stops skid, reports type but no damage fields', () => {
      const hexes = buildLine(0, 2, dir, 3);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { building: { type: 'medium' } });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 3, gs);
      expect(result.path).toEqual(['0,3', '0,4']);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].type).toBe('building');
      expect(result.collisions[0].buildingType).toBe('medium');
      expect(result.collisions[0].damageToTarget).toBeUndefined();
      // skidding unit still takes terrain damage for hexes skidded
      expect(result.damage).toBe(10); // 5 * 2
    });

    it('collision stops skid (does not continue past obstacle)', () => {
      const hexes = buildLine(0, 2, dir, 5);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 4, gs);
      expect(result.path).toHaveLength(2); // 0,3; 0,4
      expect(result.finalHex).toBe('0,3');
    });

    it('unit collision before building: unit collision takes priority', () => {
      const hexes = buildLine(0, 2, dir, 3);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, {
        occupiedBy: 'enemy_1',
        building: { type: 'heavy' }
      });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 2, gs);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].type).toBe('unit');
    });
  });

  // ==========================================================================
  // chain skidding on ice / pavement (resolveSkid)
  // ==========================================================================

  describe('resolveSkid — chain skidding (ice / pavement)', () => {
    const dir = 3; // S

    // -- ice ----------------------------------------------------------------

    it('extends skid on ice when PSR roll < piloting (fail)', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      const roller = makeDiceRoller([3]); // 3 < 4 → fail → extend

      const result = rules.resolveSkid(unit, 2, gs, roller);
      // original 2 MP → hit ice at 0,4(hex2), extend by 2 → total 4 hexes
      expect(result.path).toEqual(expectedPath('0,2', dir, 4));
      expect(result.finalHex).toBe('0,6');
    });

    it('does NOT extend skid on ice when PSR roll >= piloting (pass)', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      const roller = makeDiceRoller([6]); // 6 >= 4 → pass → no extend

      const result = rules.resolveSkid(unit, 2, gs, roller);
      expect(result.path).toEqual(expectedPath('0,2', dir, 2));
      expect(result.finalHex).toBe('0,4');
    });

    it('PSR roll exactly equals piloting → no extend (roll < piloting is false)', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 5);
      const roller = makeDiceRoller([5]); // 5 < 5 is false → no extend

      const result = rules.resolveSkid(unit, 2, gs, roller);
      expect(result.path).toHaveLength(2);
    });

    it('extend-by is the original remainingMP, not the current total', () => {
      const hexes = buildLine(0, 2, dir, 20);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      const roller = makeDiceRoller([3]);

      const result = rules.resolveSkid(unit, 3, gs, roller);
      // original 3 MP → hit ice at hex2, fail → totalHexes = 3+3 = 6
      expect(result.path).toHaveLength(6);
      expect(result.path).toEqual(expectedPath('0,2', dir, 6));
    });

    it('multiple chain-skids: ice then ice again further along the path', () => {
      const hexes = buildLine(0, 2, dir, 20);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });  // 3rd hex (i=2)
      hexes['0,6'] = makeHex('0,6', 'clear', 0, { ice: true });  // after extension
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      // roll[0]=3 (fail at first ice), roll[1]=3 (fail at second ice)
      const roller = makeDiceRoller([3, 3]);

      const result = rules.resolveSkid(unit, 2, gs, roller);
      // original 2, extend at 0,4 → 4, extend at 0,6 → 6 total
      expect(result.path).toHaveLength(6);
      expect(result.path).toEqual(expectedPath('0,2', dir, 6));
      expect(result.finalHex).toBe('0,8');
    });

    it('multiple chain-skids: one fail, one pass (different dice rolls)', () => {
      const hexes = buildLine(0, 2, dir, 20);
      hexes['0,4'] = makeHex('0,4', 'clear', 0, { ice: true });
      hexes['0,6'] = makeHex('0,6', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      const roller = makeDiceRoller([3, 8]); // first fail, second pass

      const result = rules.resolveSkid(unit, 2, gs, roller);
      // first extend at 0,4: totalHexes 2→4
      // second at 0,6: roll 8 >= 4, no extend
      expect(result.path).toHaveLength(4);
      expect(result.path).toEqual(expectedPath('0,2', dir, 4));
      expect(result.finalHex).toBe('0,6');
    });

    // -- pavement -----------------------------------------------------------

    it('extends skid on pavement when PSR roll fails', () => {
      const hexes = buildLine(0, 2, dir, 15);
      hexes['0,3'] = makeHex('0,3', 'pavement');
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 3);
      const roller = makeDiceRoller([2]); // 2 < 3 → fail → extend

      const result = rules.resolveSkid(unit, 3, gs, roller);
      // 3 MP → hit pavement at 0,3 (hex1), fail → totalHexes = 6 → 6 hexes
      expect(result.path).toHaveLength(6);
    });

    it('does NOT extend skid on pavement when PSR roll passes', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,3'] = makeHex('0,3', 'pavement');
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      const roller = makeDiceRoller([7]); // 7 >= 4 → pass

      const result = rules.resolveSkid(unit, 3, gs, roller);
      expect(result.path).toHaveLength(3);
      expect(result.path).toEqual(expectedPath('0,2', dir, 3));
    });

    // -- no diceRoller ------------------------------------------------------

    it('ignores ice/pavement chain-skid check when no diceRoller provided', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,3'] = makeHex('0,3', 'pavement');
      hexes['0,5'] = makeHex('0,5', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 3, gs); // no diceRoller
      expect(result.path).toHaveLength(3);
    });

    // -- default piloting ---------------------------------------------------

    it('uses piloting 5 when unit has no pilot property', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = { tonnage: 50, position: { hexKey: '0,2', facing: dir } };
      const roller = makeDiceRoller([4]); // 4 < 5 → fail

      const result = rules.resolveSkid(unit, 2, gs, roller);
      expect(result.path).toHaveLength(4); // extended
    });

    it('unit with no pilot defaults piloting to 5, roll 5 does not extend', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = { tonnage: 50, position: { hexKey: '0,2', facing: dir } };
      const roller = makeDiceRoller([5]); // 5 < 5 is false → no extend

      const result = rules.resolveSkid(unit, 2, gs, roller);
      expect(result.path).toHaveLength(2);
    });
  });

  // ==========================================================================
  // combined / edge-case scenarios
  // ==========================================================================

  describe('resolveSkid — combined / edge cases', () => {
    const dir = 3; // S

    it('collision damage + skid damage are independent', () => {
      const hexes = buildLine(0, 2, dir, 10);
      hexes['0,6'] = makeHex('0,6', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 6, gs);
      // path: 0,3; 0,4; 0,5; 0,6 (4 hexes)
      expect(result.damage).toBe(20); // 5 * 4
      expect(result.collisions[0].damageToTarget).toBe(20); // 5 * 4
      expect(result.collisions[0].damageToSelf).toBe(20);
    });

    it('chain-skid on pavement causes collision further along extended path', () => {
      const hexes = buildLine(0, 2, dir, 20);
      hexes['0,3'] = makeHex('0,3', 'pavement');
      hexes['0,7'] = makeHex('0,7', 'clear', 0, { occupiedBy: 'enemy_1' });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 3);
      const roller = makeDiceRoller([2]); // PSR fail

      const result = rules.resolveSkid(unit, 3, gs, roller);
      // 3 MP → hit pavement at 0,3, fail → totalHexes 6
      // path: 0,3; 0,4; 0,5; 0,6; 0,7(collision) = 5 hexes
      expect(result.path).toHaveLength(5);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].type).toBe('unit');
      expect(result.collisions[0].damageToTarget).toBe(25); // 5 * 5
    });

    it('chain-skid extends totalHexes beyond available map edge', () => {
      // Map has hexes: 0,2; 0,3; 0,4 (only 2 hexes beyond start)
      const hexes = buildLine(0, 2, dir, 2);
      hexes['0,3'] = makeHex('0,3', 'clear', 0, { ice: true });
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2', 4);
      const roller = makeDiceRoller([3]); // would fail PSR

      const result = rules.resolveSkid(unit, 4, gs, roller);
      // i=0: enters 0,3(ice), PSR fails → totalHexes 4→8. currentKey='0,3'
      // i=1: enters 0,4(clear), no chain. currentKey='0,4'
      // i=2: 0,5 doesn't exist → break. finalHex='0,4'
      expect(result.path).toEqual(expectedPath('0,2', dir, 2)); // 0,3; 0,4
      expect(result.finalHex).toBe('0,4');
    });

    it('empty path and damage zero for 0 remainingMP', () => {
      const hexes = buildLine(0, 2, dir, 3);
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 0, gs);
      expect(result.path).toEqual([]);
      expect(result.collisions).toEqual([]);
      expect(result.damage).toBe(0);
      expect(result.finalHex).toBe('0,2');
    });

    it('path stops immediately when first hex is out of bounds', () => {
      const hexes = { '0,2': makeHex('0,2') }; // no neighbor in direction
      const gs = makeGameState(hexes);
      const unit = makeUnit(50, dir, '0,2');

      const result = rules.resolveSkid(unit, 3, gs);
      expect(result.path).toEqual([]);
      expect(result.damage).toBe(0);
      expect(result.finalHex).toBe('0,2');
    });
  });
});
