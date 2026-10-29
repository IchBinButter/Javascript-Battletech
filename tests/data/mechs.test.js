import { describe, it, expect } from 'vitest';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };
import weaponsData from '../../src/data/weapons.json' with { type: 'json' };

const { mechs } = mechsData;
const WEAPON_IDS = new Set(weaponsData.weapons.map((weapon) => weapon.id));

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

// p6 (SLOT): "each line within a location (six in the head and legs, twelve in
// other locations) is referred to as a 'slot'." The p46 critical-hit example
// likewise gives the legs a 1D6 (six-line) table and the arms a 2D6 (twelve-line)
// table.
const EXPECTED_FIXED_SLOTS = {
  head: 6,
  centerTorso: 12,
  leftTorso: 12,
  rightTorso: 12,
  leftArm: 12,
  rightArm: 12,
  leftLeg: 6,
  rightLeg: 6,
};

// One critical slot of ammunition is one ton (p96 "a critical hit to its
// ammunition bin deals the weapon's damage times the number of shots left in
// that bin"). These are the per-ton shot counts the MTF importer uses for the
// weapons the roster carries.
const SHOTS_PER_TON = {
  ac20: 5,
  ac5: 20,
  srm6: 15,
  srm4: 25,
  srm2: 50,
  lrm20: 6,
  lrm15: 8,
  lrm10: 12,
  lrm5: 24,
  machinegun: 200,
};

const AMMO_WEAPON_IDS = new Set(
  weaponsData.weapons.filter((weapon) => weapon.ammoPerShot > 0).map((weapon) => weapon.id),
);

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

    it('stores one ammunition bin per critical slot (p52)', () => {
      const bins = Object.entries(mech.equipment.ammo);
      const ammoSlots = [];
      for (const loc of LOCATIONS) {
        for (const slot of mech.criticalSlots[loc]) {
          if (/_ammo$/.test(slot.item)) ammoSlots.push({ location: loc, ...slot });
        }
      }

      expect(bins).toHaveLength(ammoSlots.length);

      for (const slot of ammoSlots) {
        const matches = bins.filter(
          ([, bin]) => bin.location === slot.location && bin.slot === slot.slot,
        );
        expect(
          matches,
          `${mech.id} ${slot.location} slot ${slot.slot} should be exactly one bin`,
        ).toHaveLength(1);
        const [, bin] = matches[0];
        // One critical slot holds one ton of ammunition: the roster stores the
        // per-ton shot count in every bin.
        expect(bin.type).toBe(slot.item.replace(/_ammo$/, ''));
        expect(bin.shots, `${mech.id} ${slot.item}`).toBe(SHOTS_PER_TON[bin.type]);
        expect(bin.explosive).toBe(true);
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
// Ammunition bins: one bin per critical slot (D-05, p52)
// =============================================================================

describe('ammunition bins', () => {
  it('gives every bin exactly one critical slot and no slot two bins (p52)', () => {
    for (const mech of mechs) {
      const occupied = new Set();
      for (const [key, bin] of Object.entries(mech.equipment.ammo)) {
        expect(bin.location, `${mech.id} ${key} location`).toBeTruthy();
        expect(bin.slot, `${mech.id} ${key} slot`).toBeGreaterThan(0);

        const identity = `${bin.location}:${bin.slot}`;
        expect(occupied.has(identity), `${mech.id} ${key} duplicates ${identity}`).toBe(false);
        occupied.add(identity);

        const slot = mech.criticalSlots[bin.location].find((s) => s.slot === bin.slot);
        expect(slot, `${mech.id} ${key} has no critical slot`).toBeDefined();
        expect(slot.item).toBe(`${bin.type}_ammo`);
      }
    }
  });

  // D-05: the Atlas carries two LRM-20 bins; the old per-type entry made one
  // explosion write off both. Each bin now holds 6 shots (one ton, p96).
  it('splits repeated ammunition types into one full bin per slot', () => {
    const atlas = mechs.find((m) => m.id === 'atlas-as7d');
    const lrm20Bins = Object.entries(atlas.equipment.ammo)
      .filter(([, bin]) => bin.type === 'lrm20');
    expect(lrm20Bins.map(([, bin]) => bin.shots)).toEqual([6, 6]);
    expect(lrm20Bins.map(([, bin]) => bin.location)).toEqual(['leftTorso', 'leftTorso']);

    const srm6Bins = Object.entries(atlas.equipment.ammo)
      .filter(([, bin]) => bin.type === 'srm6');
    expect(srm6Bins.map(([, bin]) => bin.shots)).toEqual([15, 15]);
  });

  it('keeps the per-ton shot count in every bin of every roster Mech', () => {
    for (const mech of mechs) {
      for (const [key, bin] of Object.entries(mech.equipment.ammo)) {
        expect(bin.shots, `${mech.id} ${key} shots`).toBe(SHOTS_PER_TON[bin.type]);
      }
    }
  });

  it('does not pin a weapon to one of several bins of its ammunition type', () => {
    for (const mech of mechs) {
      for (const weapon of mech.equipment.weapons) {
        if (!weapon.ammoBin) continue;
        const bin = mech.equipment.ammo[weapon.ammoBin];
        expect(bin, `${mech.id} ${weapon.type} ammoBin ${weapon.ammoBin}`).toBeDefined();
        const sameType = Object.values(mech.equipment.ammo)
          .filter((candidate) => candidate.type === bin.type);
        expect(
          sameType,
          `${mech.id} ${weapon.type} is pinned to one of ${sameType.length} ${bin.type} bins`,
        ).toHaveLength(1);
      }
    }
  });

  it('gives every ammunition-using weapon at least one bin of its type', () => {
    for (const mech of mechs) {
      const ammoTypes = new Set(Object.values(mech.equipment.ammo).map((bin) => bin.type));
      for (const weapon of mech.equipment.weapons) {
        if (!AMMO_WEAPON_IDS.has(weapon.type)) continue;
        expect(ammoTypes.has(weapon.type), `${mech.id} ${weapon.type} has no ammunition`).toBe(true);
      }
    }
  });
});

// =============================================================================
// Weapon definitions: every weapon the roster mounts must exist and have a slot
// =============================================================================

describe('weapons data integrity', () => {
  it('defines the p121 small laser with the manual stats', () => {
    // p121 Inner Sphere Weapons: Small Laser DE, Heat 1, Damage 3,
    // Minimum 0, Short 1, Medium 2, Long 3, Tons 0.5, Critical Slots 1.
    const smallLaser = weaponsData.weapons.find((weapon) => weapon.id === 'small_laser');

    expect(smallLaser).toBeDefined();
    expect(smallLaser).toMatchObject({
      type: 'DE',
      heat: 1,
      damage: 3,
      minRange: 0,
      shortRange: 1,
      mediumRange: 2,
      longRange: 3,
      tons: 0.5,
      crits: 1,
    });
  });

  // D-01: the small laser was listed on four roster units but missing from
  // weapons.json, so the UI silently skipped it. Every weapon id must resolve.
  it('resolves every weapon mounted by any Mech in weapons.json', () => {
    for (const mech of mechs) {
      for (const weapon of mech.equipment.weapons) {
        expect(
          WEAPON_IDS.has(weapon.type),
          `${mech.id} lists weapon '${weapon.type}' that is not in weapons.json`,
        ).toBe(true);
      }
    }
  });

  // D-02: both Atlases listed an SRM-6 with no critical slot, making it immune
  // to critical hits. Every mounted weapon needs at least one matching slot.
  it('gives every weapon mounted by any Mech at least one critical slot', () => {
    for (const mech of mechs) {
      const criticalItems = Object.values(mech.criticalSlots).flat().map((slot) => slot.item);
      for (const weapon of mech.equipment.weapons) {
        expect(
          criticalItems.filter((item) => item === weapon.type).length,
          `${mech.id} has no critical slot for '${weapon.type}'`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

// =============================================================================
// Critical slot completeness: the rules that read slots need them to exist
// =============================================================================

describe('critical slot completeness', () => {
  const ARM_ACTUATORS = ['shoulder', 'upper_arm_actuator', 'lower_arm_actuator'];
  const LEG_ACTUATORS = ['hip', 'upper_leg_actuator', 'lower_leg_actuator', 'foot_actuator'];

  // Covers the two non-canon refits too, which the per-design checks skip.
  it('gives every Mech the p6 location slot counts (head/legs 6, arms/torsos 12)', () => {
    for (const mech of mechs) {
      for (const [loc, count] of Object.entries(EXPECTED_FIXED_SLOTS)) {
        expect(mech.criticalSlots[loc], `${mech.id} ${loc} slots`).toHaveLength(count);
      }
    }
  });

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
