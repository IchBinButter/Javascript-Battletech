import { describe, it, expect } from 'vitest';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };

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

describe('AttackResolver', () => {
  const resolver = new AttackResolver(hitTables);

  describe('getHeatModifier', () => {
    it('returns 0 for heat < 5', () => {
      expect(resolver.getHeatModifier(0)).toBe(0);
      expect(resolver.getHeatModifier(4)).toBe(0);
    });

    it('returns 1 for heat 5-9', () => {
      expect(resolver.getHeatModifier(5)).toBe(1);
      expect(resolver.getHeatModifier(9)).toBe(1);
    });

    it('returns 2 for heat 10-14', () => {
      expect(resolver.getHeatModifier(10)).toBe(2);
      expect(resolver.getHeatModifier(14)).toBe(2);
    });

    it('returns 3 for heat 15-19', () => {
      expect(resolver.getHeatModifier(15)).toBe(3);
      expect(resolver.getHeatModifier(19)).toBe(3);
    });

    it('returns 4 for heat 20+', () => {
      expect(resolver.getHeatModifier(20)).toBe(4);
      expect(resolver.getHeatModifier(30)).toBe(4);
    });
  });

  describe('_getTargetMovementModifier', () => {
    it('returns 0 for 0-2 hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 2, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(0);
    });

    it('returns 1 for 3-4 hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 3, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(1);
    });

    it('returns 2 for 5-6 hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 6, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(2);
    });

    it('returns 3 for 7-9 hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 7, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(3);
    });

    it('returns 4 for 10-17 hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 10, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(4);
    });

    it('returns 5 for 18-24 hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 18, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(5);
    });

    it('returns 6 for 25+ hexes moved', () => {
      const target = makeUnit('4,4', 0, 4, { hexesMoved: 30, movementMode: 'walk' });
      expect(resolver._getTargetMovementModifier(target)).toBe(6);
    });

    it('returns 1 per hex for jump mode (min 1)', () => {
      const target1 = makeUnit('4,4', 0, 4, { hexesMoved: 3, movementMode: 'jump' });
      expect(resolver._getTargetMovementModifier(target1)).toBe(3);

      const target2 = makeUnit('4,4', 0, 4, { hexesMoved: 0, movementMode: 'jump' });
      expect(resolver._getTargetMovementModifier(target2)).toBe(1);
    });

    it('falls back to getTargetMovementModifier if hexesMoved undefined', () => {
      const target = makeUnit('4,4', 0, 4);
      delete target.hexesMoved;
      target._targetMovementModifier = 2;
      expect(resolver._getTargetMovementModifier(target)).toBe(2);
    });
  });

  describe('calculateTargetNumber', () => {
    it('base TN equals gunnery skill', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(true);
      expect(result.targetNumber).toBe(4);
    });

    it('adds attacker movement modifier', () => {
      const attacker = makeUnit('4,4', 0, 4);
      attacker._movementModifier = 2;
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6); // 4 + 2
    });

    it('computes target movement modifier from hexesMoved', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 5 }); // 5 hexes = +2
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6); // 4 + 2
    });

    it('adds jump movement modifier from hexesMoved', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 4, movementMode: 'jump' }); // 4 hexes jump = +4
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(8); // 4 + 4
    });

    it('uses target movement modifier integrated in TN calculation', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 0 });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).not.toContain('Target moved: +0');
    });

    it('adds light woods terrain modifier for target', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': { terrainType: 'light_woods' } });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(5); // 4 + 1
    });

    it('adds heavy woods terrain modifier for target', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': { terrainType: 'heavy_woods' } });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6); // 4 + 2
    });

    it('applies -4 immobile target modifier', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { immobile: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2); // 4 - 4 = 0, clamped to 2
    });

    it('applies -2 for prone target at adjacent range (distance 1)', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,5', 0, 4, { prone: true }); // distance 1
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,5': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2); // 4 - 2 = 2
      expect(result.modifiers).toContain('Target prone (adjacent): -2');
    });

    it('applies +1 for prone target at non-adjacent range', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { prone: true }); // distance 2
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(5); // 4 + 1
      expect(result.modifiers).toContain('Target prone: +1');
    });

    it('applies shutdown -4 modifier', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { shutdown: true });
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(2); // 4 - 4 = 0, clamped to 2
    });

    it('applies heat modifier to attacker', () => {
      const attacker = makeUnit('4,4', 0, 4, { heat: 12 });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6); // 4 + 2 (heat 10-14)
    });

    it('adds range modifier for medium range', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('10,10', 0, 4);
      const weapon = makeWeaponDef({ shortRange: 3, mediumRange: 6, longRange: 9 });
      const gs = makeGameState({ '4,4': {}, '10,10': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(true);
    });

    it('returns canFire=false for out of range', () => {
      const attacker = makeUnit('0,0', 0, 4);
      const target = makeUnit('20,20', 0, 4);
      const weapon = makeWeaponDef({ shortRange: 3, mediumRange: 6, longRange: 9 });
      const gs = makeGameState({ '0,0': {}, '20,20': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(false);
    });

    it('floors TN to minimum 2', () => {
      const attacker = makeUnit('4,4', 0, 4, { heat: 25 });
      attacker._movementModifier = 4;
      const target = makeUnit('4,6', 0, 4, { hexesMoved: 20 }); // +5
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBeGreaterThanOrEqual(2);
    });

    it('adds pilot hits modifier', () => {
      const attacker = makeUnit('4,4', 0, 4, {});
      attacker.pilot.hits = 2;
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(6); // 4 + 2
    });

    it('adds correct minimum range modifier (off-by-1 fixed)', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,5', 0, 4); // distance 1
      const weapon = makeWeaponDef({ minRange: 3 });
      const gs = makeGameState({ '4,4': {}, '4,5': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      // distance=1 < minRange=3, modifier = 3-1 = 2
      expect(result.minimumRangeMod).toBe(2);
    });

    it('adds minimum range modifier to target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,5', 0, 4); // distance 1
      const weapon = makeWeaponDef({ minRange: 4 });
      const gs = makeGameState({ '4,4': {}, '4,5': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      // distance=1 < minRange=4, modifier = 4-1 = 3. TN = 4 + 3 = 7
      expect(result.targetNumber).toBe(7);
    });

    it('adds +1 for partial cover', () => {
      // Attacker at level 2 (above intermediate), target at level 0,
      // intermediate hex at level 2: not blocked (2 > 2 is false), partial cover (2 >= 0+2)
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({
        '4,4': { level: 2 },
        '4,5': { level: 2 },
        '4,6': { level: 0 }
      });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.modifiers).toContain('Partial cover: +1');
    });

    it('applies targeting computer for DE weapons', () => {
      const attacker = makeUnit('4,4', 0, 4, {
        equipment: { other: { targeting_computer: true } }
      });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef({ type: 'DE' });
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(3); // 4 - 1
      expect(result.modifiers).toContain('Targeting Computer: -1');
    });

    it('applies targeting computer for DB weapons', () => {
      const attacker = makeUnit('4,4', 0, 4, {
        equipment: { other: { targeting_computer: true } }
      });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef({ type: 'DB' });
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(3); // 4 - 1
    });

    it('applies targeting computer for P weapons', () => {
      const attacker = makeUnit('4,4', 0, 4, {
        equipment: { other: { targeting_computer: true } }
      });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef({ type: 'P' });
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(3); // 4 - 1
    });

    it('does not apply targeting computer for M weapons', () => {
      const attacker = makeUnit('4,4', 0, 4, {
        equipment: { other: { targeting_computer: true } }
      });
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef({ type: 'M' });
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(4); // no TC bonus for missile
    });
  });

  describe('determineHitLocation', () => {
    it('returns centerTorso for roll of 7 (front)', () => {
      const loc = resolver.determineHitLocation(7, 'front');
      expect(loc.location).toBe('centerTorso');
    });

    it('returns head for roll of 12 (front)', () => {
      const loc = resolver.determineHitLocation(12, 'front');
      expect(loc.location).toBe('head');
    });

    it('returns centerTorso with critical for roll of 2 (front)', () => {
      const loc = resolver.determineHitLocation(2, 'front');
      expect(loc.location).toBe('centerTorso');
      expect(loc.critical).toBe(true);
    });

    it('returns rightArm for roll of 3 (front)', () => {
      const loc = resolver.determineHitLocation(3, 'front');
      expect(loc.location).toBe('rightArm');
    });

    it('returns leftArm for roll of 10 (front)', () => {
      const loc = resolver.determineHitLocation(10, 'front');
      expect(loc.location).toBe('leftArm');
    });

    it('defaults to centerTorso for invalid roll', () => {
      const loc = resolver.determineHitLocation(13, 'front');
      expect(loc.location).toBe('centerTorso');
    });
  });

  describe('resolveClusterHit', () => {
    it('returns full cluster for roll of 12', () => {
      expect(resolver.resolveClusterHit(12, 20)).toBe(20);
    });

    it('returns reduced hits for low roll on SRM (cluster 2)', () => {
      expect(resolver.resolveClusterHit(2, 2)).toBe(1);
    });

    it('returns all hits for roll of 2 on cluster 6', () => {
      expect(resolver.resolveClusterHit(2, 6)).toBe(1);
    });

    it('returns correct hits for LRM-20 (cluster 20), roll 7', () => {
      expect(resolver.resolveClusterHit(7, 20)).toBe(8);
    });
  });

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

  describe('resolveWeaponAttack', () => {
    it('returns hit when roll >= target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(8);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(true);
      expect(result.roll).toBe(8);
    });

    it('returns miss when roll < target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(2);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(false);
    });

    it('returns canFire=false when out of range', () => {
      const attacker = makeUnit('0,0', 0, 4);
      const target = makeUnit('20,20', 0, 4);
      const weapon = makeWeaponDef({ shortRange: 3, mediumRange: 6, longRange: 9 });
      const gs = makeGameState({ '0,0': {}, '20,20': {} });
      const dice = makeDiceRoller(8);

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(false);
      expect(result.details).toContain('Cannot fire');
    });

    it('determines hit location on a hit', () => {
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
  });
});
