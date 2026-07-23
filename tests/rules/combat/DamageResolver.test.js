import { describe, it, expect } from 'vitest';
import { DamageResolver } from '../../../src/rules/combat/DamageResolver.js';

function makeUnit(overrides = {}) {
  return {
    armor: {
      head: { front: 9, rear: 0 },
      centerTorso: { front: 31, rear: 10 },
      leftTorso: { front: 21, rear: 7 },
      rightTorso: { front: 21, rear: 7 },
      leftArm: { front: 17, rear: 0 },
      rightArm: { front: 17, rear: 0 },
      leftLeg: { front: 21, rear: 0 },
      rightLeg: { front: 21, rear: 0 }
    },
    internalStructure: {
      head: 3,
      centerTorso: 10,
      leftTorso: 8,
      rightTorso: 8,
      leftArm: 6,
      rightArm: 6,
      leftLeg: 8,
      rightLeg: 8
    },
    criticalSlots: {
      centerTorso: [
        { slot: 1, item: 'engine', status: 'ok' },
        { slot: 2, item: 'engine', status: 'ok' },
        { slot: 3, item: 'gyro', status: 'ok' }
      ],
      leftArm: [
        { slot: 1, item: 'medium_laser', status: 'ok' }
      ],
      rightArm: [
        { slot: 1, item: 'large_laser', status: 'ok' }
      ]
    },
    engine: { hits: 0 },
    gyro: { hits: 0 },
    pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
    equipment: {
      weapons: [],
      ammo: {},
      other: {}
    },
    heatSinks: { count: 10, damaged: 0, type: 'single' },
    prone: false,
    isLocationDestroyed(location) {
      const hasArmor = this.armor[location] && this.armor[location].front > 0;
      const hasInternal = this.internalStructure[location] > 0;
      return !hasArmor && !hasInternal;
    },
    ...overrides
  };
}

function makeDiceRoller(critRoll = 5) {
  return {
    roll2d6() { return critRoll; },
    roll1d6() { return Math.ceil(critRoll / 2); },
    next() { return 0.5; }
  };
}

describe('DamageResolver', () => {
  const resolver = new DamageResolver();

  describe('applyDamage - armor only', () => {
    it('absorbs damage with armor, no internal penetration', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'centerTorso', 10);
      expect(result.absorbedByArmor).toBe(10);
      expect(result.penetratedInternal).toBe(false);
      expect(unit.armor.centerTorso.front).toBe(21); // 31 - 10
      expect(result.remaining).toBe(0);
    });

    it('fully absorbs damage when armor > damage', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'head', 5);
      expect(result.absorbedByArmor).toBe(5);
      expect(unit.armor.head.front).toBe(4); // 9 - 5
      expect(result.remaining).toBe(0);
    });

    it('absorbs partial armor then penetrates internal', () => {
      const unit = makeUnit();
      // Head has 9 armor, 3 internal. 12 damage = 9 armor + 3 internal
      const result = resolver.applyDamage(unit, 'head', 12, false, makeDiceRoller(3));
      expect(result.absorbedByArmor).toBe(9);
      expect(result.penetratedInternal).toBe(true);
      expect(result.internalDamage).toBe(3);
      expect(unit.armor.head.front).toBe(0);
      expect(unit.internalStructure.head).toBe(0);
      expect(result.locationDestroyed).toBe(true);
    });

    it('applies to rear armor when isRear=true', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'centerTorso', 5, true);
      expect(result.absorbedByArmor).toBe(5);
      expect(unit.armor.centerTorso.rear).toBe(5); // 10 - 5
      expect(unit.armor.centerTorso.front).toBe(31); // unchanged
    });

    it('excess damage after armor goes to internal', () => {
      const unit = makeUnit();
      // LeftTorso: 21 armor front, 8 internal. 25 damage => 21 armor + 4 internal
      const result = resolver.applyDamage(unit, 'leftTorso', 25, false, makeDiceRoller(3));
      expect(result.absorbedByArmor).toBe(21);
      expect(result.penetratedInternal).toBe(true);
      expect(result.internalDamage).toBe(4);
      expect(unit.internalStructure.leftTorso).toBe(4); // 8 - 4
      expect(result.remaining).toBe(0);
    });
  });

  describe('applyDamage - location destruction', () => {
    it('marks location destroyed when internal reaches 0', () => {
      const unit = makeUnit();
      // Head: 9 armor, 3 internal. 15 damage => destroys it
      const result = resolver.applyDamage(unit, 'head', 15, false, makeDiceRoller(3));
      expect(result.locationDestroyed).toBe(true);
      expect(unit.internalStructure.head).toBe(0);
    });

    it('remaining damage transfers from destroyed limb to torso', () => {
      const unit = makeUnit();
      // LeftArm: 17 armor, 6 internal. 30 damage => 17 armor + 6 internal + 7 transfer
      const result = resolver.applyDamage(unit, 'leftArm', 30, false, makeDiceRoller(3));
      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBe('leftTorso');
      // The 7 damage should have been applied to leftTorso
      expect(result.remaining).toBe(0); // all absorbed by leftTorso armor
    });

    it('remaining damage transfers from destroyed torso to center torso', () => {
      const unit = makeUnit();
      // LeftTorso: 21 armor, 8 internal. 40 damage => 21 + 8 + 11 to CT
      const result = resolver.applyDamage(unit, 'leftTorso', 40, false, makeDiceRoller(3));
      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBe('centerTorso');
      // 11 damage to CT: 11 absorbed by CT armor (31 -> 20)
      expect(unit.armor.centerTorso.front).toBe(20);
    });

    it('head destruction does not transfer damage', () => {
      const unit = makeUnit();
      const result = resolver.applyDamage(unit, 'head', 20, false, makeDiceRoller(3));
      expect(result.locationDestroyed).toBe(true);
      expect(result.transferLocation).toBeUndefined();
    });

    it('center torso destruction does not transfer', () => {
      const unit = makeUnit();
      // CT: 31 armor, 10 internal. 50 damage => 31 + 10 = 41, 9 remaining but CT is special
      const result = resolver.applyDamage(unit, 'centerTorso', 50, false, makeDiceRoller(3));
      expect(result.locationDestroyed).toBe(true);
      // CT destruction = unit destroyed, no transfer
      expect(result.transferLocation).toBeUndefined();
    });
  });

  describe('applyDamage - critical hits', () => {
    it('triggers critical hit check on internal damage to torso', () => {
      const unit = makeUnit();
      // CT: 31 armor, 10 internal. 40 damage => 31 armor + 9 internal
      // Each internal point triggers a crit check (need 8+ to crit)
      const dice = makeDiceRoller(8); // Always crits
      const result = resolver.applyDamage(unit, 'centerTorso', 40, false, dice);
      expect(result.criticalHits.length).toBeGreaterThan(0);
    });

    it('does not crit when internal roll < 8', () => {
      const unit = makeUnit();
      const dice = makeDiceRoller(3); // Never crits
      const result = resolver.applyDamage(unit, 'head', 12, false, dice);
      expect(result.criticalHits).toHaveLength(0);
    });

    it('marks engine hit correctly', () => {
      const unit = makeUnit();
      const dice = makeDiceRoller(8); // Always crits, picks slot 0.5 => index 0-2
      // CT: 31 armor, 10 internal. 40 damage => 31 armor + 9 internal = 9 crit checks
      resolver.applyDamage(unit, 'centerTorso', 40, false, dice);
      // At least some engine hits should have occurred
      expect(unit.engine.hits).toBeGreaterThan(0);
    });
  });

  describe('getTransferLocation', () => {
    it('leftArm transfers to leftTorso', () => {
      expect(resolver.getTransferLocation('leftArm')).toBe('leftTorso');
    });

    it('rightArm transfers to rightTorso', () => {
      expect(resolver.getTransferLocation('rightArm')).toBe('rightTorso');
    });

    it('leftLeg transfers to leftTorso', () => {
      expect(resolver.getTransferLocation('leftLeg')).toBe('leftTorso');
    });

    it('rightLeg transfers to rightTorso', () => {
      expect(resolver.getTransferLocation('rightLeg')).toBe('rightTorso');
    });

    it('leftTorso transfers to leftArm', () => {
      expect(resolver.getTransferLocation('leftTorso')).toBe('leftArm');
    });

    it('rightTorso transfers to rightArm', () => {
      expect(resolver.getTransferLocation('rightTorso')).toBe('rightArm');
    });

    it('head transfers to centerTorso', () => {
      expect(resolver.getTransferLocation('head')).toBe('centerTorso');
    });

    it('centerTorso returns null (no transfer)', () => {
      expect(resolver.getTransferLocation('centerTorso')).toBeNull();
    });
  });

  describe('destroyLocation', () => {
    it('zeros out armor and internal for location', () => {
      const unit = makeUnit();
      resolver.destroyLocation(unit, 'leftArm');
      expect(unit.armor.leftArm.front).toBe(0);
      expect(unit.internalStructure.leftArm).toBe(0);
    });

    it('triggers leg destruction effects (prone)', () => {
      const unit = makeUnit();
      resolver.destroyLocation(unit, 'leftLeg');
      expect(unit.prone).toBe(true);
    });

    it('triggers torso destruction cascading to arm', () => {
      const unit = makeUnit();
      resolver.destroyLocation(unit, 'leftTorso');
      expect(unit.armor.leftTorso.front).toBe(0);
      expect(unit.internalStructure.leftTorso).toBe(0);
      // Left arm should also be destroyed
      expect(unit.armor.leftArm.front).toBe(0);
      expect(unit.internalStructure.leftArm).toBe(0);
    });
  });

  describe('handleLocationDestruction', () => {
    it('leg destruction makes unit prone', () => {
      const unit = makeUnit();
      unit.prone = false;
      resolver.handleLocationDestruction(unit, 'rightLeg');
      expect(unit.prone).toBe(true);
    });

    it('arm destruction removes weapons in that arm', () => {
      const unit = makeUnit();
      unit.equipment.weapons = [
        { id: 'ml', location: 'leftArm' },
        { id: 'll', location: 'rightArm' }
      ];
      resolver.handleLocationDestruction(unit, 'leftArm');
      expect(unit.equipment.weapons).toHaveLength(1);
      expect(unit.equipment.weapons[0].location).toBe('rightArm');
    });
  });
});
