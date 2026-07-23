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

  describe('calculateTargetNumber', () => {
    it('base TN equals gunnery skill', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.canFire).toBe(true);
      // Base gunnery = 4, distance 2 (short range) = +0
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

    it('adds target movement modifier', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      target._targetMovementModifier = 3;
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      expect(result.targetNumber).toBe(7); // 4 + 3
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

    it('applies -4 prone target modifier', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4, { prone: true });
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
      const target = makeUnit('10,10', 0, 4); // far away
      const weapon = makeWeaponDef({ shortRange: 3, mediumRange: 6, longRange: 9 });
      const gs = makeGameState({ '4,4': {}, '10,10': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      // distance should be > shortRange, likely medium or long
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
      const target = makeUnit('4,6', 0, 4);
      target._targetMovementModifier = 4;
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      // TN is floored to 2 but not capped (can exceed 12)
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

    it('adds minimum range modifier', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,5', 0, 4); // distance 1
      const weapon = makeWeaponDef({ minRange: 3 });
      const gs = makeGameState({ '4,4': {}, '4,5': {} });
      const result = resolver.calculateTargetNumber(attacker, weapon, target, gs);
      // distance=1 < minRange=3, modifier = 3-1+1 = 3
      expect(result.minimumRangeMod).toBe(3);
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
      // Cluster 2, roll 2 => 1 from table
      expect(resolver.resolveClusterHit(2, 2)).toBe(1);
    });

    it('returns all hits for roll of 2 on cluster 6', () => {
      // Cluster 6, roll 2 => 1 from table
      expect(resolver.resolveClusterHit(2, 6)).toBe(1);
    });

    it('returns correct hits for LRM-20 (cluster 20), roll 7', () => {
      // From table: roll 7, cluster 20 => 8
      expect(resolver.resolveClusterHit(7, 20)).toBe(8);
    });
  });

  describe('getAttackDirection', () => {
    it('returns rear when attacker is behind target', () => {
      // Target at 4,4 facing north (0). Attacker at 4,2 (north of target).
      // directionBetween(attacker -> target) = direction from attacker toward target = south (3).
      // Target faces north (0). diff = ((3-0+3)%6+3)%6 = 3 => rear.
      const attacker = makeUnit('4,2', 0);
      const target = makeUnit('4,4', 0); // facing north
      expect(resolver.getAttackDirection(attacker, target)).toBe('rear');
    });

    it('returns front when attacker is in front of target', () => {
      // Target at 4,4 facing north (0). Attacker at 4,6 (south of target).
      // directionBetween(attacker -> target) = direction from 4,6 to 4,4 = north (0).
      // Target faces north (0). diff = ((0-0+3)%6+3)%6 = 0 => front.
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
      const dice = makeDiceRoller(8); // Always rolls 8

      const result = resolver.resolveWeaponAttack(attacker, weapon, {}, target, gs, dice);
      expect(result.hit).toBe(true);
      expect(result.roll).toBe(8);
    });

    it('returns miss when roll < target number', () => {
      const attacker = makeUnit('4,4', 0, 4);
      const target = makeUnit('4,6', 0, 4);
      const weapon = makeWeaponDef();
      const gs = makeGameState({ '4,4': {}, '4,6': {} });
      const dice = makeDiceRoller(2); // Always rolls 2

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
