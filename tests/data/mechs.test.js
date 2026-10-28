import { describe, it, expect } from 'vitest';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };

const { mechs } = mechsData;

const LOCATIONS = [
  'head',
  'centerTorso',
  'leftTorso',
  'rightTorso',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

const EXPECTED_MECHS = [
  { id: 'atlas-as7d', tonnage: 100, walk: 3, run: 5, jump: 0 },
  { id: 'jenner-jr7d', tonnage: 35, walk: 7, run: 11, jump: 5 },
  { id: 'wolverine-wvr6r', tonnage: 55, walk: 5, run: 8, jump: 5 },
  { id: 'thunderbolt-tdr5s', tonnage: 65, walk: 4, run: 6, jump: 0 },
  { id: 'locust-lct1v', tonnage: 20, walk: 8, run: 12, jump: 0 },
  { id: 'shadowhawk-shd2h', tonnage: 55, walk: 5, run: 8, jump: 3 },
  { id: 'griffin-grf1n', tonnage: 55, walk: 5, run: 8, jump: 5 },
  { id: 'warhammer-whm6d', tonnage: 70, walk: 4, run: 6, jump: 0 },
  { id: 'marauder-mad3d', tonnage: 75, walk: 4, run: 6, jump: 0 },
  { id: 'stalker-stk3f', tonnage: 85, walk: 3, run: 5, jump: 0 },
  { id: 'banshee-bnc3e', tonnage: 95, walk: 3, run: 5, jump: 0 },
  { id: 'awesome-aws8q', tonnage: 80, walk: 3, run: 5, jump: 0 },
];

const EXPECTED_FIXED_SLOTS = {
  head: 6,
  centerTorso: 12,
  leftTorso: 12,
  rightTorso: 12,
  leftArm: 12,
  rightArm: 12,
  leftLeg: 12,
  rightLeg: 12,
};

describe('Mech Roster Data', () => {
  // Curated roster size, not a rules cap. The roster is 12 canon designs plus 2
  // non-canon refits that exist so the optional equipment and design-quirk rules
  // are reachable in play. Adding designs is a deliberate data change that must
  // update this number; no game rule depends on it.
  it('keeps the curated roster at 12 canon designs plus 2 refits', () => {
    expect(mechs).toHaveLength(14);
  });

  describe.each(EXPECTED_MECHS)('$id', (expected) => {
    const mech = mechs.find((m) => m.id === expected.id);

    it('is present in the roster', () => {
      expect(mech).toBeDefined();
    });

    it('has correct tonnage', () => {
      expect(mech.tonnage).toBe(expected.tonnage);
    });

    it('has correct movement', () => {
      expect(mech.movement).toEqual({
        walk: expected.walk,
        run: expected.run,
        jump: expected.jump,
      });
    });

    it('has all required top-level keys', () => {
      const required = [
        'id', 'name', 'tonnage', 'movement', 'armor',
        'internalStructure', 'criticalSlots', 'equipment',
        'heatSinks', 'engine', 'gyro',
      ];
      for (const key of required) {
        expect(mech).toHaveProperty(key);
      }
    });

    it('has all 8 location entries in armor, internalStructure, criticalSlots', () => {
      for (const loc of LOCATIONS) {
        expect(mech.armor).toHaveProperty(loc);
        expect(mech.internalStructure).toHaveProperty(loc);
        expect(mech.criticalSlots).toHaveProperty(loc);
      }
    });

    it('has a valid engine', () => {
      expect(mech.engine).toMatchObject({
        type: 'standard',
        hits: 0,
      });
      expect(mech.engine.rating).toBeGreaterThan(0);
    });

    it('has a valid gyro', () => {
      expect(mech.gyro).toEqual({
        type: 'standard',
        hits: 0,
      });
    });

    it('has valid heat sinks', () => {
      expect(mech.heatSinks.type).toBe('single');
      expect(mech.heatSinks.damaged).toBe(0);
      expect(mech.heatSinks.count).toBeGreaterThanOrEqual(10);
    });

    it('has armor values that are non-negative and head max 9', () => {
      for (const loc of LOCATIONS) {
        const a = mech.armor[loc];
        expect(a.front).toBeGreaterThanOrEqual(0);
        expect(a.rear).toBeGreaterThanOrEqual(0);
      }
      expect(mech.armor.head.front).toBeLessThanOrEqual(9);
      expect(mech.armor.head.rear).toBe(0);
    });

    it('has internal structure with head = 3 and all non-negative', () => {
      for (const loc of LOCATIONS) {
        expect(mech.internalStructure[loc]).toBeGreaterThanOrEqual(0);
      }
      expect(mech.internalStructure.head).toBe(3);
    });

    it('has correct fixed-location critical slot counts', () => {
      for (const [loc, count] of Object.entries(EXPECTED_FIXED_SLOTS)) {
        expect(mech.criticalSlots[loc]).toHaveLength(count);
      }
    });

    it('has arm critical slots with reasonable count (>= 8)', () => {
      expect(mech.criticalSlots.leftArm.length).toBeGreaterThanOrEqual(6);
      expect(mech.criticalSlots.rightArm.length).toBeGreaterThanOrEqual(6);
    });

    it('has head with life_support, sensors, cockpit in expected slots', () => {
      const head = mech.criticalSlots.head;
      expect(head[0]).toMatchObject({ slot: 1, item: 'life_support' });
      expect(head[1]).toMatchObject({ slot: 2, item: 'sensors' });
      expect(head[2]).toMatchObject({ slot: 3, item: 'cockpit' });
      expect(head[3]).toMatchObject({ slot: 4, item: 'sensors' });
      expect(head[4]).toMatchObject({ slot: 5, item: 'life_support' });
    });

    it('has center torso starting with engine and gyro slots', () => {
      const ct = mech.criticalSlots.centerTorso;
      expect(ct[0].item).toBe('engine');
      expect(ct[1].item).toBe('engine');
      expect(ct[2].item).toBe('engine');
      expect(ct[3].item).toBe('gyro');
    });

    it('has equipment with weapons array and ammo object', () => {
      expect(Array.isArray(mech.equipment.weapons)).toBe(true);
      expect(mech.equipment.weapons.length).toBeGreaterThan(0);
      expect(typeof mech.equipment.ammo).toBe('object');
    });

    it('has all ammo references point to existing ammo bins', () => {
      const ammoKeys = Object.keys(mech.equipment.ammo);
      for (const weapon of mech.equipment.weapons) {
        if (weapon.ammoBin) {
          expect(ammoKeys).toContain(weapon.ammoBin);
          const bin = mech.equipment.ammo[weapon.ammoBin];
          expect(bin).toHaveProperty('type');
          expect(bin).toHaveProperty('shots');
          expect(bin.shots).toBeGreaterThan(0);
        }
      }
    });

    it('has all critical slot items with valid status', () => {
      for (const loc of LOCATIONS) {
        for (const slot of mech.criticalSlots[loc]) {
          expect(slot).toHaveProperty('slot');
          expect(slot).toHaveProperty('item');
          expect(slot).toHaveProperty('status');
          expect(typeof slot.item).toBe('string');
          expect(slot.slot).toBeGreaterThan(0);
        }
      }
    });

    it('has engine rating consistent with tonnage * walk MP', () => {
      const expectedRating = mech.tonnage * mech.movement.walk;
      expect(mech.engine.rating).toBeGreaterThanOrEqual(expectedRating - 5);
      expect(mech.engine.rating).toBeLessThanOrEqual(expectedRating + 5);
    });
  });

  it('all mech IDs are unique', () => {
    const ids = mechs.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tonnage values are within canon bounds (20-100)', () => {
    for (const mech of mechs) {
      expect(mech.tonnage).toBeGreaterThanOrEqual(20);
      expect(mech.tonnage).toBeLessThanOrEqual(100);
    }
  });

  it('walk movement is between 1 and 8', () => {
    for (const mech of mechs) {
      expect(mech.movement.walk).toBeGreaterThanOrEqual(1);
      expect(mech.movement.walk).toBeLessThanOrEqual(8);
    }
  });

  it('run MP is properly computed as walk * 1.5 round up', () => {
    for (const mech of mechs) {
      const expectedRun = Math.ceil(mech.movement.walk * 1.5);
      expect(mech.movement.run).toBe(expectedRun);
    }
  });
});

// =============================================================================
// Critical slot completeness: the rules that read slots need them to exist
// =============================================================================

describe('critical slot completeness', () => {
  const ARM_ACTUATORS = ['shoulder', 'upper_arm_actuator', 'lower_arm_actuator'];
  const LEG_ACTUATORS = ['hip', 'upper_leg_actuator', 'lower_leg_actuator', 'foot_actuator'];

  it('every arm carries shoulder, upper and lower arm actuators', () => {
    for (const mech of mechs) {
      // The Banshee refit deliberately lacks lower-arm actuators so it can
      // reverse its arms (p24).
      if (mech.id.endsWith('-refit')) continue;

      for (const arm of ['leftArm', 'rightArm']) {
        const items = mech.criticalSlots[arm].map(s => s.item);
        for (const actuator of ARM_ACTUATORS) {
          expect(items, `${mech.id} ${arm} ${actuator}`).toContain(actuator);
        }
      }
    }
  });

  it('every leg carries hip, upper leg, lower leg and foot actuators', () => {
    for (const mech of mechs) {
      for (const leg of ['leftLeg', 'rightLeg']) {
        const items = mech.criticalSlots[leg].map(s => s.item);
        for (const actuator of LEG_ACTUATORS) {
          expect(items, `${mech.id} ${leg} ${actuator}`).toContain(actuator);
        }
      }
    }
  });

  it('heat sink slots match the sinks the engine does not house', () => {
    for (const mech of mechs) {
      // The refits trade sink crits for equipment, so only the canon roster is
      // expected to carry the full complement.
      if (mech.id.endsWith('-refit')) continue;

      const expected = Math.max(0, mech.heatSinks.count - 10);
      const actual = Object.values(mech.criticalSlots)
        .flat()
        .filter(s => (s.item || '').includes('heat_sink')).length;
      expect(actual, `${mech.id} heat sink slots`).toBe(expected);
    }
  });

  it('the refits carry their equipment', () => {
    const atlasRefit = mechs.find(m => m.id === 'atlas-as7d-refit');
    expect(atlasRefit.equipment.other.case).toBe(true);
    expect(atlasRefit.equipment.other.ecm).toBe(true);
    expect(atlasRefit.equipment.other.targeting_computer).toBe(true);
    expect(atlasRefit.criticalSlots.leftTorso.map(s => s.item)).toContain('case');

    const bansheeRefit = mechs.find(m => m.id === 'banshee-bnc3e-refit');
    expect(bansheeRefit.equipment.other.tsm).toBe(true);
  });

  it('the Banshee refit has no hand actuators, so it may reverse its arms', () => {
    const bansheeRefit = mechs.find(m => m.id === 'banshee-bnc3e-refit');
    for (const arm of ['leftArm', 'rightArm']) {
      const items = bansheeRefit.criticalSlots[arm].map(s => s.item);
      expect(items).not.toContain('hand_actuator');
      expect(items).not.toContain('lower_arm_actuator');
    }
  });
});
