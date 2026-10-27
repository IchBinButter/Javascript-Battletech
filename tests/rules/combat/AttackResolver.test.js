import { describe, it, expect } from 'vitest';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWeaponDef(overrides = {}) {
  return {
    id: 'test_weapon',
    name: 'Test Weapon',
    type: 'DE',
    heat: 5,
    damage: 10,
    minRange: 0,
    shortRange: 6,
    mediumRange: 12,
    longRange: 18,
    cluster: false,
    clusterSize: null,
    ammoPerShot: 0,
    getRangeModifier(distance) {
      if (distance <= this.shortRange) return 0;
      if (distance <= this.mediumRange) return 2;
      if (distance <= this.longRange) return 4;
      return null;
    },
    getRangeBracket(distance) {
      if (distance < this.minRange) return 'min';
      if (distance <= this.shortRange) return 'short';
      if (distance <= this.mediumRange) return 'medium';
      if (distance <= this.longRange) return 'long';
      return 'out';
    },
    ...overrides
  };
}

function makeUnit(hexKey, facing = 0, gunnery = 4, overrides = {}) {
  return {
    pilot: { gunnery, piloting: 5, hits: 0, conscious: true },
    position: { hexKey, facing },
    heat: 0,
    prone: false,
    shutdown: false,
    immobile: false,
    hexesMoved: 0,
    movementMode: 'walk',
    equipment: null,
    _movementModifier: 0,
    _targetMovementModifier: 0,
    getAttackerMovementModifier() { return this._movementModifier; },
    getTargetMovementModifier() { return this._targetMovementModifier; },
    ...overrides
  };
}

function makeGameState(hexEntries) {
  const hexes = new Map();
  for (const [key, data] of Object.entries(hexEntries)) {
    hexes.set(key, {
      hexKey: key,
      terrainType: data.terrainType || 'clear',
      level: data.level || 0,
      getHeight() { return this.level; },
      modifiers: {},
      ...data
    });
  }
  return { map: { hexes } };
}

function makeDiceRoller(fixedRoll) {
  return {
    roll2d6() { return fixedRoll; },
    roll1d6() { return Math.ceil(fixedRoll / 2); },
    next() { return 0.5; }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttackResolver', () => {
  const resolver = new AttackResolver(hitTables);

  // =========================================================================
  // getHeatModifier
  // =========================================================================

  describe('getHeatModifier', () => {
    it('returns 0 for heat < 8', () => {
      expect(resolver.getHeatModifier(0)).toBe(0);
      expect(resolver.getHeatModifier(7)).toBe(0);
    });

    it('returns 1 for heat 8-12', () => {
      expect(resolver.getHeatModifier(8)).toBe(1);
      expect(resolver.getHeatModifier(12)).toBe(1);
    });

    it('returns 2 for heat 13-16', () => {
      expect(resolver.getHeatModifier(13)).toBe(2);
      expect(resolver.getHeatModifier(16)).toBe(2);
    });

    it('returns 3 for heat 17-23', () => {
      expect(resolver.getHeatModifier(17)).toBe(3);
      expect(resolver.getHeatModifier(23)).toBe(3);
    });

    it('returns 4 for heat 24+', () => {
      expect(resolver.getHeatModifier(24)).toBe(4);
      expect(resolver.getHeatModifier(30)).toBe(4);
    });
  });

  // =========================================================================
  // _getTargetMovementModifier (hexesMoved)
  // =========================================================================

  describe('_getTargetMovementModifier', () => {
    describe('walk/run movement', () => {
      it('returns 0 for 0-2 hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 0 }))).toBe(0);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 2 }))).toBe(0);
      });

      it('returns 1 for 3-4 hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 3 }))).toBe(1);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 4 }))).toBe(1);
      });

      it('returns 2 for 5-6 hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 5 }))).toBe(2);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 6 }))).toBe(2);
      });

      it('returns 3 for 7-9 hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 7 }))).toBe(3);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 9 }))).toBe(3);
      });

      it('returns 4 for 10-17 hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 10 }))).toBe(4);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 17 }))).toBe(4);
      });

      it('returns 5 for 18-24 hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 18 }))).toBe(5);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 24 }))).toBe(5);
      });

      it('returns 6 for 25+ hexes moved', () => {
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 25 }))).toBe(6);
        expect(resolver._getTargetMovementModifier(makeUnit('4,4', 0, 4, { hexesMoved: 50 }))).toBe(6);
      });
    });

    describe('jump movement', () => {
      it('returns standard TMM + 1, minimum 1', () => {
        const t0 = makeUnit('4,4', 0, 4, { hexesMoved: 0, movementMode: 'jump' });
        expect(resolver._getTargetMovementModifier(t0)).toBe(1);

        const t1 = makeUnit('4,4', 0, 4, { hexesMoved: 1, movementMode: 'jump' });
        expect(resolver._getTargetMovementModifier(t1)).toBe(1);

        const t3 = makeUnit('4,4', 0, 4, { hexesMoved: 3, movementMode: 'jump' });
        expect(resolver._getTargetMovementModifier(t3)).toBe(2);

        const t6 = makeUnit('4,4', 0, 4, { hexesMoved: 6, movementMode: 'jump' });
        expect(resolver._getTargetMovementModifier(t6)).toBe(3);
      });
    });

    it('falls back to getTargetMovementModifier when hexesMoved is undefined', () => {
      const target = makeUnit('4,4', 0, 4);
      delete target.hexesMoved;
      target._targetMovementModifier = 2;
      expect(resolver._getTargetMovementModifier(target)).toBe(2);
    });

    it('returns 0 when neither hexesMoved nor fallback is available', () => {
      const target = makeUnit('4,4', 0, 4);
      delete target.hexesMoved;
      delete target.getTargetMovementModifier;
      expect(resolver._getTargetMovementModifier(target)).toBe(0);
    });
  });

  // =========================================================================
  // calculateTargetNumber  (G.A.T.O.R.)
  // =========================================================================

  describe('calculateTargetNumber', () => {
    // --- Gunnery (base) ----------------------------------------------------

    it('G: base TN equals gunnery skill', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(true);
      expect(result.targetNumber).toBe(4);
      expect(result.modifiers).toContain('Gunnery: 4');
    });

    it('respects gunnery skill different from 4', () => {
      const attacker = makeUnit('4,4', 0, 2);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2);
    });

    // --- Attacker movement -------------------------------------------------

    it('A: adds attacker movement modifier', () => {
      const attacker = makeUnit('4,4', 0, 3);
      attacker._movementModifier = 2;
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(5);
      expect(result.modifiers).toContain('Attacker moved: +2');
    });

    it('A: no modifier text added when attacker did not move', () => {
      const attacker = makeUnit('4,4', 0, 4);
      attacker._movementModifier = 0;
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).not.toContain('Attacker moved: +0');
    });

    // --- Target movement (hexesMoved) --------------------------------------

    it('T: target movement modifier from hexesMoved is added to TN', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 5 }); // +2
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6);
      expect(result.modifiers).toContain('Target moved: +2');
    });

    it('T: jump target movement adds +1 to standard TMM', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 4, movementMode: 'jump' }); // TMM 1 + 1 jump = +2
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6);
    });

    it('T: no target moved modifier when hexesMoved is 0-2', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 0 });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).not.toContain('Target moved: +0');
    });

    // --- Target terrain (woods occupied) -----------------------------------

    it('T: target in light woods adds +1', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': { terrainType: 'light_woods' } });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(5);
      expect(result.modifiers).toContain('Target in light woods: +1');
    });

    it('T: target in heavy woods adds +2', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': { terrainType: 'heavy_woods' } });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6);
      expect(result.modifiers).toContain('Target in heavy woods: +2');
    });

    // --- Target prone ------------------------------------------------------

    it('T: prone target applies flat -4', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,5', 0, 4, { prone: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,5': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2);
      expect(result.modifiers).toContain('Target prone: -4');
    });

    it('T: prone target at non-adjacent hex also gets flat -4', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { prone: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2);
      expect(result.modifiers).toContain('Target prone: -4');
    });

    it('T: prone takes precedence over immobile (else-if chain)', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { prone: true, immobile: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2); // 4 - 4 (prone), clamped to 2
      expect(result.modifiers).toContain('Target prone: -4');
      expect(result.modifiers).not.toContain('Target immobile');
    });

    // --- Target immobile / shutdown ----------------------------------------

    it('T: immobile target applies -4', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { immobile: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2);
      expect(result.modifiers).toContain('Target immobile: -4');
    });

    it('T: shutdown target applies -4', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { shutdown: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2);
      expect(result.modifiers).toContain('Target shutdown: -4');
    });

    // --- Other: heat -------------------------------------------------------

    it('O: attacker heat modifier is added', () => {
      const attacker = makeUnit('4,4', 0, 4, { heat: 13 });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6);
      expect(result.modifiers).toContain('Attacker heat: +2');
    });

    it('O: no heat modifier added when heat < 8', () => {
      const attacker = makeUnit('4,4', 0, 4, { heat: 7 });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).not.toContain('Attacker heat');
    });

    // --- Other: pilot hits -------------------------------------------------

    it('O: pilot hits modifier is added to TN', () => {
      const attacker = makeUnit('4,4', 0, 4);
      attacker.pilot.hits = 3;
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(7);
      expect(result.modifiers).toContain('Pilot hits: +3');
    });

    it('O: no pilot hits modifier when hits is 0', () => {
      const attacker = makeUnit('4,4', 0, 4);
      attacker.pilot.hits = 0;
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).not.toContain('Pilot hits');
    });

    // --- Other: woods between (LOS) ----------------------------------------

    it('O: light woods in intervening hexes add +1 per hex', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({
        '4,4': { level: 0 },
        '4,5': { terrainType: 'light_woods', level: 0 },
        '4,6': { level: 0 }
      });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(5); // 4 + 1 light woods
      expect(result.modifiers).toContain('Woods between: +1');
    });

    it('O: heavy woods in intervening hexes add +2 (density scale)', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({
        '4,4': { level: 0 },
        '4,5': { terrainType: 'heavy_woods', level: 0 },
        '4,6': { level: 0 }
      });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6); // 4 + 2 heavy woods
      expect(result.modifiers).toContain('Woods between: +2');
    });

    it('O: no woods modifier when intervening hexes are clear', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,5': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).not.toContain('Woods between');
    });

    // --- Other: partial cover ----------------------------------------------

    it('O: partial cover from LOS adds +1 to target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      // A Level 1 hex adjacent to the target, along the LOS (p26).
      const gs = makeGameState({
        '4,4': { level: 0 },
        '4,5': { level: 1 },
        '4,6': { level: 0 }
      });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(5); // 4 + 1 partial cover
      expect(result.modifiers).toContain('Partial cover: +1');
    });

    it('O: partial cover appears in result modifiers', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({
        '4,4': { level: 0 },
        '4,5': { level: 1 },
        '4,6': { level: 0 }
      });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).toContain('Partial cover: +1');
    });

    // --- Other: targeting computer -----------------------------------------

    describe('targeting computer', () => {
      const tcAttacker = () => makeUnit('4,4', 0, 4, {
        equipment: { other: { targeting_computer: true } }
      });

      it('O: applies -1 for DE (direct energy) weapons', () => {
        const target = makeUnit('4,6', 0, 4);
        const weapon = makeWeaponDef({ type: 'DE' });
        const gs = makeGameState({ '4,4': {}, '4,6': {} });
        const result = resolver.calculateTargetNumber(tcAttacker(), weapon, target, gs);
        expect(result.targetNumber).toBe(3);
        expect(result.modifiers).toContain('Targeting Computer: -1');
      });

      it('O: applies -1 for DB (direct ballistic) weapons', () => {
        const target = makeUnit('4,6', 0, 4);
        const weapon = makeWeaponDef({ type: 'DB' });
        const gs = makeGameState({ '4,4': {}, '4,6': {} });
        const result = resolver.calculateTargetNumber(tcAttacker(), weapon, target, gs);
        expect(result.targetNumber).toBe(3);
        expect(result.modifiers).toContain('Targeting Computer: -1');
      });

      it('O: applies -1 for P (pulse) weapons', () => {
        const target = makeUnit('4,6', 0, 4);
        const weapon = makeWeaponDef({ type: 'P' });
        const gs = makeGameState({ '4,4': {}, '4,6': {} });
        const result = resolver.calculateTargetNumber(tcAttacker(), weapon, target, gs);
        expect(result.targetNumber).toBe(3);
        expect(result.modifiers).toContain('Targeting Computer: -1');
      });

      it('O: does NOT apply for M (missile) weapons', () => {
        const target = makeUnit('4,6', 0, 4);
        const weapon = makeWeaponDef({ type: 'M' });
        const gs = makeGameState({ '4,4': {}, '4,6': {} });
        const result = resolver.calculateTargetNumber(tcAttacker(), weapon, target, gs);
        expect(result.targetNumber).toBe(4);
        expect(result.modifiers).not.toContain('Targeting Computer');
      });

      it('O: does NOT apply when unit has no targeting computer', () => {
        const attacker = makeUnit('4,4', 0, 4); // no equipment
        const target = makeUnit('4,6', 0, 4);
        const weapon = makeWeaponDef({ type: 'DE' });
        const gs = makeGameState({ '4,4': {}, '4,6': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.targetNumber).toBe(4);
        expect(result.modifiers).not.toContain('Targeting Computer');
      });

      it('O: does NOT apply when equipment structure is missing', () => {
        const attacker = makeUnit('4,4', 0, 4, { equipment: {} });
        const target = makeUnit('4,6', 0, 4);
        const weapon = makeWeaponDef({ type: 'DE' });
        const gs = makeGameState({ '4,4': {}, '4,6': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.targetNumber).toBe(4);
        expect(result.modifiers).not.toContain('Targeting Computer');
      });
    });

    // --- Minimum range (off-by-1 fix) --------------------------------------

    describe('minimum range', () => {
      it('O: modifier = minRange - distance + 1 when distance <= minRange', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,5', 0, 4);
        const weapon = makeWeaponDef({ minRange: 3 });
        const gs = makeGameState({ '4,4': {}, '4,5': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.minimumRangeMod).toBe(3); // 3 - 1 + 1 = 3
      });

      it('O: minimum range modifier scales with distance gap', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const weapon = makeWeaponDef({ minRange: 6 });
        const gs = makeGameState({ '4,4': {}, '4,5': {}, '4,6': {}, '4,7': {}, '4,8': {} });

        // distance 1: mod = 6-1+1 = 6
        const t1 = makeUnit('4,5', 0, 4);
        expect(resolver.calculateTargetNumber(attacker, weapon, t1, gs).minimumRangeMod).toBe(6);

        // distance 3: mod = 6-3+1 = 4
        const t3 = makeUnit('4,7', 0, 4);
        expect(resolver.calculateTargetNumber(attacker, weapon, t3, gs).minimumRangeMod).toBe(4);

        // distance 5: mod = 6-5+1 = 2
        const t5 = makeUnit('4,9', 0, 4);
        expect(resolver.calculateTargetNumber(attacker, weapon, t5, gs).minimumRangeMod).toBe(2);
      });

      it('O: min range modifier applies when distance equals minRange (+1)', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,10', 0, 4); // distance 6
        const weapon = makeWeaponDef({ minRange: 6 });
        const gs = makeGameState({ '4,4': {}, '4,10': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.minimumRangeMod).toBe(1);
        expect(result.modifiers).toContain('Min range: +1');
      });

      it('O: no minimum range modifier when distance > minRange', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,11', 0, 4); // distance 7
        const weapon = makeWeaponDef({ minRange: 6 });
        const gs = makeGameState({ '4,4': {}, '4,11': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.minimumRangeMod).toBe(0);
        expect(result.modifiers).not.toContain('Min range');
      });

      it('O: minimum range modifier is added to target number', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,5', 0, 4);
        const weapon = makeWeaponDef({ minRange: 4 });
        const gs = makeGameState({ '4,4': {}, '4,5': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.targetNumber).toBe(8); // 4 + (4-1+1) = 8
        expect(result.modifiers).toContain('Min range: +4');
      });

      it('O: zero minRange produces no minimum range modifier', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,5', 0, 4);
        const weapon = makeWeaponDef({ minRange: 0 });
        const gs = makeGameState({ '4,4': {}, '4,5': {} });
        const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
        expect(result.minimumRangeMod).toBe(0);
      });
    });

    // --- Range bands (R) ---------------------------------------------------

    describe('range bands', () => {
      const shortWeapon = makeWeaponDef({ shortRange: 3, mediumRange: 6, longRange: 9 });

      it('R: short range adds +0 modifier', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,7', 0, 4); // distance 3
        const gs = makeGameState({ '4,4': {}, '4,7': {} });
        const result = resolver.calculateTargetNumber(attacker, shortWeapon, target, gs);
        expect(result.canFire).toBe(true);
        expect(result.rangeMod).toBe(0);
        expect(result.targetNumber).toBe(4);
      });

      it('R: medium range adds +2 modifier', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,8', 0, 4); // distance 4
        const gs = makeGameState({ '4,4': {}, '4,8': {} });
        const result = resolver.calculateTargetNumber(attacker, shortWeapon, target, gs);
        expect(result.canFire).toBe(true);
        expect(result.rangeMod).toBe(2);
        expect(result.targetNumber).toBe(6);
        expect(result.modifiers).toContain('Range: +2');
      });

      it('R: long range adds +4 modifier', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,11', 0, 4); // distance 7
        const gs = makeGameState({ '4,4': {}, '4,11': {} });
        const result = resolver.calculateTargetNumber(attacker, shortWeapon, target, gs);
        expect(result.canFire).toBe(true);
        expect(result.rangeMod).toBe(4);
        expect(result.targetNumber).toBe(8);
        expect(result.modifiers).toContain('Range: +4');
      });

      it('R: exactly at long range boundary is still long range', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,13', 0, 4); // distance 9
        const gs = makeGameState({ '4,4': {}, '4,13': {} });
        const result = resolver.calculateTargetNumber(attacker, shortWeapon, target, gs);
        expect(result.canFire).toBe(true);
        expect(result.rangeMod).toBe(4);
      });

      it('R: beyond long range returns canFire=false', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,14', 0, 4); // distance 10
        const gs = makeGameState({ '4,4': {}, '4,14': {} });
        const result = resolver.calculateTargetNumber(attacker, shortWeapon, target, gs);
        expect(result.canFire).toBe(false);
        expect(result.reason).toBe('Out of range');
      });

      it('R: range modifier text not included for short range (mod=0)', () => {
        const attacker = makeUnit('4,4', 0, 4);
        const target = makeUnit('4,7', 0, 4); // distance 3, short
        const gs = makeGameState({ '4,4': {}, '4,7': {} });
        const result = resolver.calculateTargetNumber(attacker, shortWeapon, target, gs);
        expect(result.modifiers).not.toContain('Range: +0');
      });
    });

    // --- Comprehensive GATOR calculation -----------------------------------

    it('GATOR: all five components combine correctly', () => {
      const attacker = makeUnit('4,4', 0, 3, {
        heat: 9, // +1 heat mod
        equipment: { other: { targeting_computer: true } }
      });
      attacker._movementModifier = 1; // +1 attacker moved
      attacker.pilot.hits = 1; // +1 pilot hits

      const target = makeUnit('4,8', 0, 4, { hexesMoved: 5 }); // +2 target moved, distance=4
      const weapon = makeWeaponDef({
        type: 'DE',
        shortRange: 3,
        mediumRange: 6,
        longRange: 9
      });

      const gs = makeGameState({
        '4,4': { level: 0 },
        '4,5': { terrainType: 'light_woods', level: 0 },
        '4,6': { level: 0 },
        '4,7': { level: 0 },
        '4,8': { terrainType: 'light_woods', level: 0 }
      });

      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);

      // G = 3
      // A = +1 (attacker moved)
      // T = +2 (target moved 5 hexes) +1 (target in light woods)
      // O = +1 (heat) +1 (pilot hits) +1 (woods between, one light woods) -1 (TC, DE weapon)
      // R = +2 (medium range, distance 4)
      // Total = 3 + 1 + 3 + 2 + 2 = 11
      expect(result.targetNumber).toBe(11);
      expect(result.canFire).toBe(true);
      expect(result.rangeMod).toBe(2);
      expect(result.distance).toBe(4);
    });

    // --- Edge cases --------------------------------------------------------

    it('clamps target number to minimum of 2', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,5', 0, 4, { prone: true, immobile: true, shutdown: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,5': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2);
    });

    it('same-hex attack (distance 0) works', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,4', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(true);
      expect(result.distance).toBe(0);
    });

    it('returns calculated result fields', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(true);
      expect(result.targetNumber).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(result.modifiers)).toBe(true);
      expect(typeof result.rangeMod).toBe('number');
      expect(typeof result.distance).toBe('number');
      expect(result.losResult).toBeDefined();
    });
  });

  // =========================================================================
  // determineHitLocation
  // =========================================================================

  describe('determineHitLocation', () => {
    it('returns centerTorso on roll 7 (front)', () => {
      expect(resolver.determineHitLocation(7, 'front').location).toBe('centerTorso');
    });

    it('returns head on roll 12 (front)', () => {
      expect(resolver.determineHitLocation(12, 'front').location).toBe('head');
    });

    it('returns centerTorso with critical on roll 2 (front)', () => {
      const loc = resolver.determineHitLocation(2, 'front');
      expect(loc.location).toBe('centerTorso');
      expect(loc.critical).toBe(true);
    });

    it('returns rightArm on roll 3 (front)', () => {
      expect(resolver.determineHitLocation(3, 'front').location).toBe('rightArm');
    });

    it('returns leftArm on roll 10 (front)', () => {
      expect(resolver.determineHitLocation(10, 'front').location).toBe('leftArm');
    });

    it('returns rear locations for rear attack direction', () => {
      const loc = resolver.determineHitLocation(7, 'rear');
      expect(loc.location).toBe('centerTorso');
      expect(loc.isRear).toBe(true);
    });

    it('defaults to centerTorso for unknown attack direction', () => {
      const loc = resolver.determineHitLocation(7, 'unknown');
      expect(loc.location).toBe('centerTorso');
    });

    it('defaults to centerTorso for invalid roll', () => {
      expect(resolver.determineHitLocation(13, 'front').location).toBe('centerTorso');
      expect(resolver.determineHitLocation(1, 'front').location).toBe('centerTorso');
    });
  });

  // =========================================================================
  // resolveClusterHit
  // =========================================================================

  describe('resolveClusterHit', () => {
    it('returns full cluster size on roll 12', () => {
      expect(resolver.resolveClusterHit(12, 20)).toBe(20);
      expect(resolver.resolveClusterHit(12, 6)).toBe(6);
      expect(resolver.resolveClusterHit(12, 2)).toBe(2);
    });

    it('returns 1 hit on roll 2 for all cluster sizes', () => {
      expect(resolver.resolveClusterHit(2, 20)).toBe(6);
      expect(resolver.resolveClusterHit(2, 6)).toBe(2);
      expect(resolver.resolveClusterHit(2, 2)).toBe(1);
    });

    it('LRM-20 roll 7 returns 8 hits', () => {
      expect(resolver.resolveClusterHit(7, 20)).toBe(12);
    });

    it('SRM-6 roll 7 returns 4 hits', () => {
      expect(resolver.resolveClusterHit(7, 6)).toBe(4);
    });

    it('SRM-4 roll 5 returns 3 hits', () => {
      expect(resolver.resolveClusterHit(5, 4)).toBe(2);
    });
  });

  // =========================================================================
  // getAttackDirection
  // =========================================================================

  describe('getAttackDirection', () => {
    it('returns rear when attacker is behind target', () => {
      const attacker = makeUnit('4,2', 0);
      const target = makeUnit('4,4', 0);
      expect(resolver.getAttackDirection(attacker, target)).toBe('rear');
    });

    it('returns front when attacker is in front of target', () => {
      const attacker = makeUnit('4,6', 0);
      const target = makeUnit('4,4', 0);
      expect(resolver.getAttackDirection(attacker, target)).toBe('front');
    });

    it('returns front for same hex', () => {
      const attacker = makeUnit('4,4', 0);
      const target = makeUnit('4,4', 0);
      expect(resolver.getAttackDirection(attacker, target)).toBe('front');
    });
  });

  // =========================================================================
  // resolveWeaponAttack
  // =========================================================================

  describe('resolveWeaponAttack', () => {
    it('hit when roll >= target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(8);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(true);
      expect(result.roll).toBe(8);
      expect(result.targetNumber).toBe(4);
    });

    it('miss when roll < target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(2);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(false);
      expect(result.roll).toBe(2);
    });

    it('cannot fire when out of range', () => {
      const attacker = makeUnit('0,0', 0, 4);
      const target = makeUnit('20,20', 0, 4);
      const weapon = makeWeaponDef({ shortRange: 3, mediumRange: 6, longRange: 9 });
      const gs = makeGameState({ '0,0': {}, '20,20': {} });
      const dice = makeDiceRoller(8);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(false);
      expect(result.targetNumber).toBe(999);
      expect(result.details).toContain('Cannot fire');
      expect(result.clusterHits).toBe(0);
    });

    it('determines hit locations on a hit', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(7);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(true);
      expect(result.hitLocations.length).toBeGreaterThanOrEqual(1);
      expect(result.hitLocations[0].location).toBeDefined();
    });

    it('resolves cluster hits for missile weapons on hit', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef({
        type: 'M',
        cluster: true,
        clusterSize: 6
      });
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(12); // roll 12 hits TN 4, cluster roll is also 12

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(true);
      expect(result.clusterHits).toBe(6); // roll 12 = full cluster
      expect(result.hitLocations.length).toBe(6);
    });

    it('no hit locations on a miss', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(2);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(false);
      expect(result.hitLocations.length).toBe(0);
    });

    it('returns weapon definition and instance in result', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef({ id: 'medium_laser' });
      const instance = { name: 'Medium Laser (RA)' };
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(7);

      const result = resolver.resolveWeaponAttack(attacker, weapon, instance, target, gs, dice);
      expect(result.weaponDef).toBe(weapon);
      expect(result.weaponInstance).toBe(instance);
    });
  });
});
