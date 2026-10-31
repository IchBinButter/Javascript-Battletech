/**
 * WeaponMounts (p46): which physical critical-slot component does each mounted
 * weapon occupy?
 *
 * A mount is disabled by a critical hit on its component: one slot for a
 * single-slot weapon, every slot the item fills for a multi-slot weapon.
 * Identical single-slot mounts in one location are separate components, split
 * in equipment order. The roster carries no per-mount slot list and
 * weapons.json no crit count, so the mapping comes from the record sheet.
 */

import { describe, it, expect } from 'vitest';
import {
  weaponMountComponents,
  weaponMountAt,
  weaponMountFor,
  weaponMountKey,
  isWeaponMountDestroyed
} from '../../../src/rules/combat/WeaponMounts.js';
import { createTestUnit, mechsData } from '../../helpers/testUtils.js';

/** Mounts of `type` in `location`, as { weapon, index } pairs in equipment order. */
function mountsOf(unit, type, location) {
  return unit.equipment.weapons
    .map((weapon, index) => ({ weapon, index }))
    .filter(entry => entry.weapon.type === type && entry.weapon.location === location);
}

/** Record-sheet slot numbers a component occupies. */
function slotNumbers(component) {
  return component.slots.map(slot => slot.slot);
}

/** Every (location, weapon type) group with more than one mounted entry. */
function duplicateMountGroups(unit) {
  const groups = new Map();
  unit.equipment.weapons.forEach((weapon, index) => {
    const group = `${weapon.location}|${weapon.type}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(index);
  });
  return [...groups.entries()].filter(([, indices]) => indices.length > 1);
}

/** How many record-sheet slots the item `type` fills in `location`. */
function slotCount(unit, type, location) {
  return ((unit.criticalSlots && unit.criticalSlots[location]) || [])
    .filter(slot => slot.item === type).length;
}

describe('WeaponMounts: component mapping (p46)', () => {
  it('maps every Atlas mount to its own record-sheet component', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    const mounts = weaponMountComponents(atlas);

    expect(mounts.map(mount => mount.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(mounts.map(mount => mount.key)).toEqual([
      'ac20@rightTorso#0',
      'med_laser@rightArm#1',
      'med_laser@rightArm#2',
      'med_laser_rear@centerTorso#3',
      'med_laser_rear@centerTorso#4',
      'srm6@leftTorso#5',
      'lrm20@leftTorso#6'
    ]);
    expect(mounts.map(mount => mount.destroyed)).toEqual(new Array(7).fill(false));

    // Multi-slot items own every slot they fill; identical single-slot mounts
    // own one slot each, in equipment order.
    expect(slotNumbers(mounts[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // AC/20
    expect(slotNumbers(mounts[1])).toEqual([5]);
    expect(slotNumbers(mounts[2])).toEqual([6]);
    expect(slotNumbers(mounts[3])).toEqual([8]);
    expect(slotNumbers(mounts[4])).toEqual([9]);
    expect(slotNumbers(mounts[5])).toEqual([8, 9]); // SRM-6
    expect(slotNumbers(mounts[6])).toEqual([1, 2, 3, 4, 5]); // LRM-20
  });

  it('destroys only the identical mount that occupies the destroyed slot', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    // Record-sheet slot 6 is the second right-arm medium laser.
    atlas.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';

    const mounts = weaponMountComponents(atlas);
    expect(mounts[1].destroyed).toBe(false);
    expect(mounts[2].destroyed).toBe(true);
    expect(isWeaponMountDestroyed(atlas, 1)).toBe(false);
    expect(isWeaponMountDestroyed(atlas, 2)).toBe(true);
    // Nothing else on the 'Mech is affected.
    expect(isWeaponMountDestroyed(atlas, 0)).toBe(false);
    expect(isWeaponMountDestroyed(atlas, 3)).toBe(false);
    expect(isWeaponMountDestroyed(atlas, 5)).toBe(false);
    expect(isWeaponMountDestroyed(atlas, 6)).toBe(false);
  });

  it('destroys every mount when all of the item slots are destroyed', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    for (const slot of atlas.criticalSlots.rightArm) {
      if (slot.item === 'med_laser') slot.status = 'destroyed';
    }

    const mounts = weaponMountComponents(atlas);
    expect(mounts[1].destroyed).toBe(true);
    expect(mounts[2].destroyed).toBe(true);
  });

  it('destroys a multi-slot weapon when any one of its slots is destroyed', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    // One AC/20 slot out of ten: the whole 10-slot item is disabled (p46).
    atlas.criticalSlots.rightTorso
      .find(slot => slot.item === 'ac20' && slot.slot === 5).status = 'destroyed';

    expect(isWeaponMountDestroyed(atlas, 0)).toBe(true);
    // The left torso SRM-6 and LRM-20 are untouched.
    expect(isWeaponMountDestroyed(atlas, 5)).toBe(false);
    expect(isWeaponMountDestroyed(atlas, 6)).toBe(false);
  });

  it('keeps two different items in one location independent', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.criticalSlots.leftTorso
      .find(slot => slot.item === 'lrm20' && slot.slot === 3).status = 'destroyed';

    const mounts = weaponMountComponents(atlas);
    expect(mounts[6].destroyed).toBe(true);  // LRM-20 component
    expect(mounts[5].destroyed).toBe(false); // SRM-6 shares the location, not the slot
    expect(mounts[5].slots.every(slot => slot.item === 'srm6')).toBe(true);
  });

  it('splits three identical arm lasers one slot each (Thunderbolt)', () => {
    const thunderbolt = createTestUnit('thunderbolt-tdr5s', 0, 'thunderbolt');
    const lasers = mountsOf(thunderbolt, 'med_laser', 'rightArm');
    expect(lasers.map(entry => entry.index)).toEqual([3, 4, 5]);

    let mounts = weaponMountComponents(thunderbolt);
    expect(lasers.map(entry => slotNumbers(mounts[entry.index]))).toEqual([[5], [6], [7]]);

    // Slot 6 is the middle mount: only the middle mount dies (p46).
    thunderbolt.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    mounts = weaponMountComponents(thunderbolt);
    expect(lasers.map(entry => mounts[entry.index].destroyed)).toEqual([false, true, false]);

    // The two machine guns in the same arm are their own single-slot mounts.
    const machineguns = mountsOf(thunderbolt, 'machinegun', 'rightArm');
    expect(machineguns.map(entry => entry.index)).toEqual([6, 7]);
    expect(machineguns.map(entry => slotNumbers(mounts[entry.index]))).toEqual([[8], [9]]);
  });

  it('gives multi-slot items in one location their own slot chunks (Thunderbolt)', () => {
    const thunderbolt = createTestUnit('thunderbolt-tdr5s', 0, 'thunderbolt');
    const mounts = weaponMountComponents(thunderbolt);

    // Large laser 2 slots, LRM-15 3 slots, SRM-2 1 slot, all in the right torso.
    expect(slotNumbers(mounts[0])).toEqual([1, 2]);
    expect(slotNumbers(mounts[1])).toEqual([3, 4, 5]);
    expect(slotNumbers(mounts[2])).toEqual([6]);

    thunderbolt.criticalSlots.rightTorso
      .find(slot => slot.item === 'lrm15' && slot.slot === 4).status = 'destroyed';
    const after = weaponMountComponents(thunderbolt);
    expect(after[1].destroyed).toBe(true);
    expect(after[0].destroyed).toBe(false);
    expect(after[2].destroyed).toBe(false);
  });

  it('splits six PPC slots between two right-torso mounts (Awesome)', () => {
    const awesome = createTestUnit('awesome-aws8q', 0, 'awesome');
    const rightTorso = mountsOf(awesome, 'ppc', 'rightTorso');
    expect(rightTorso.map(entry => entry.index)).toEqual([1, 2]);

    let mounts = weaponMountComponents(awesome);
    expect(rightTorso.map(entry => slotNumbers(mounts[entry.index])))
      .toEqual([[3, 4, 5], [6, 7, 8]]);
    // The single PPC in the right arm is its own three-slot component.
    expect(slotNumbers(mounts[0])).toEqual([5, 6, 7]);

    // One destroyed slot in the second PPC's chunk disables that PPC only.
    awesome.criticalSlots.rightTorso
      .find(slot => slot.item === 'ppc' && slot.slot === 7).status = 'destroyed';
    mounts = weaponMountComponents(awesome);
    expect(mounts[0].destroyed).toBe(false);
    expect(mounts[1].destroyed).toBe(false);
    expect(mounts[2].destroyed).toBe(true);
  });

  it('splits two lasers per arm and keeps the SRM separate (Jenner)', () => {
    const jenner = createTestUnit('jenner-jr7d', 0, 'jenner');
    const left = mountsOf(jenner, 'med_laser', 'leftArm');
    const right = mountsOf(jenner, 'med_laser', 'rightArm');
    expect(left.map(entry => entry.index)).toEqual([0, 1]);
    expect(right.map(entry => entry.index)).toEqual([2, 3]);

    let mounts = weaponMountComponents(jenner);
    expect(left.map(entry => slotNumbers(mounts[entry.index]))).toEqual([[5], [6]]);
    expect(right.map(entry => slotNumbers(mounts[entry.index]))).toEqual([[5], [6]]);
    expect(slotNumbers(mounts[4])).toEqual([7]); // SRM-4 in the right arm

    // Destroying one right-arm laser leaves the left-arm pair alone.
    jenner.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 5).status = 'destroyed';
    mounts = weaponMountComponents(jenner);
    expect([0, 1, 2, 3].map(index => mounts[index].destroyed))
      .toEqual([false, false, true, false]);
  });

  it('maps single machine guns on the Locust to their own slots', () => {
    const locust = createTestUnit('locust-lct1v', 0, 'locust');
    const mounts = weaponMountComponents(locust);
    expect(slotNumbers(mounts[0])).toEqual([8]); // medium laser, center torso
    expect(slotNumbers(mounts[1])).toEqual([5]); // machine gun, left arm
    expect(slotNumbers(mounts[2])).toEqual([5]); // machine gun, right arm

    locust.criticalSlots.rightArm
      .find(slot => slot.item === 'machinegun').status = 'destroyed';
    const after = weaponMountComponents(locust);
    expect(after.map(mount => mount.destroyed)).toEqual([false, false, true]);
  });

  it('keeps every duplicate mount in the roster one equal share of its slots', () => {
    for (const mechDef of mechsData.mechs) {
      const unit = createTestUnit(mechDef.id, 0, mechDef.id);
      for (const [group, indices] of duplicateMountGroups(unit)) {
        const [location, type] = group.split('|');
        const total = slotCount(unit, type, location);
        expect(total % indices.length, `${mechDef.id} ${group}: ${total} slots / ${indices.length} mounts`)
          .toBe(0);

        const mounts = weaponMountComponents(unit);
        const perMount = total / indices.length;
        const assigned = indices.flatMap(index => slotNumbers(mounts[index]));
        expect(assigned, `${mechDef.id} ${group} slot shares`)
          .toEqual((unit.criticalSlots[location] || [])
            .filter(slot => slot.item === type)
            .map(slot => slot.slot));
        for (const index of indices) {
          expect(mounts[index].slots, `${mechDef.id} ${group} mount ${index}`)
            .toHaveLength(perMount);
        }

        // Losing one mount's slot never takes a sibling with it.
        const victim = mounts[indices[0]].slots[0];
        victim.status = 'destroyed';
        const after = weaponMountComponents(unit);
        expect(after[indices[0]].destroyed, `${mechDef.id} ${group} mount ${indices[0]}`).toBe(true);
        for (const sibling of indices.slice(1)) {
          expect(after[sibling].destroyed, `${mechDef.id} ${group} mount ${sibling}`).toBe(false);
        }
        victim.status = 'ok';
      }
    }
  });

  it('destroys every single multi-slot mount in the roster with one slot', () => {
    for (const mechDef of mechsData.mechs) {
      const unit = createTestUnit(mechDef.id, 0, mechDef.id);
      const mounts = weaponMountComponents(unit);
      mechDef.equipment.weapons.forEach((weapon, index) => {
        const siblings = mechDef.equipment.weapons
          .filter(other => other.location === weapon.location && other.type === weapon.type).length;
        const total = slotCount(unit, weapon.type, weapon.location);
        if (siblings !== 1 || total < 2) return;

        expect(mounts[index].slots, `${mechDef.id} ${weapon.type}@${weapon.location}`)
          .toHaveLength(total);
        const slot = mounts[index].slots[total - 1];
        slot.status = 'destroyed';
        expect(isWeaponMountDestroyed(unit, index), `${mechDef.id} ${weapon.type}@${weapon.location}`)
          .toBe(true);
        slot.status = 'ok';
      });
    }
  });
});

describe('WeaponMounts: keys and lookups', () => {
  it('keys a mount by weapon type, location and equipment index', () => {
    expect(weaponMountKey('med_laser', 'rightArm', 2)).toBe('med_laser@rightArm#2');

    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    const mounts = weaponMountComponents(atlas);
    expect(new Set(mounts.map(mount => mount.key)).size).toBe(mounts.length);
    expect(mounts.map(mount => mount.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('looks a mount up by index and by the mounted entry itself', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');

    expect(weaponMountAt(atlas, 0).key).toBe('ac20@rightTorso#0');
    expect(weaponMountAt(atlas, 999)).toBeNull();
    expect(weaponMountAt(atlas, -1)).toBeNull();
    expect(weaponMountAt(atlas, null)).toBeNull();
    expect(weaponMountAt(atlas, '')).toBeNull();

    // Identity, not model: the second of two identical lasers resolves to its
    // own component, never the first one.
    expect(weaponMountFor(atlas, atlas.equipment.weapons[2]).key).toBe('med_laser@rightArm#2');
    expect(weaponMountFor(atlas, atlas.equipment.weapons[1]).key).toBe('med_laser@rightArm#1');
    expect(weaponMountFor(atlas, { type: 'med_laser', location: 'rightArm' })).toBeNull();
  });
});

describe('WeaponMounts: record-sheet edge cases', () => {
  it('leaves mounts intact when the unit carries no critical-slot data', () => {
    const unit = {
      equipment: {
        weapons: [
          { type: 'med_laser', location: 'rightArm' },
          { type: 'ac20', location: 'rightTorso' }
        ]
      }
    };

    const mounts = weaponMountComponents(unit);
    expect(mounts.map(mount => mount.destroyed)).toEqual([false, false]);
    expect(mounts.map(mount => mount.slots)).toEqual([[], []]);
  });

  it('ignores critical slots that no mounted weapon occupies', () => {
    const unit = {
      equipment: { weapons: [{ type: 'med_laser', location: 'rightArm' }] },
      criticalSlots: {
        rightArm: [
          { slot: 1, item: 'shoulder', status: 'destroyed' },
          { slot: 5, item: 'med_laser', status: 'ok' },
          { slot: 6, item: 'heat_sink', status: 'destroyed' }
        ]
      }
    };

    const [mount] = weaponMountComponents(unit);
    expect(slotNumbers(mount)).toEqual([5]);
    expect(mount.destroyed).toBe(false);
  });

  it('orders the component slots by record-sheet slot number', () => {
    const unit = {
      equipment: { weapons: [{ type: 'ac20', location: 'rightTorso' }] },
      criticalSlots: {
        // Stored out of order; the component still owns them in slot order.
        rightTorso: [
          { slot: 3, item: 'ac20', status: 'ok' },
          { slot: 1, item: 'ac20', status: 'ok' },
          { slot: 2, item: 'ac20', status: 'ok' }
        ]
      }
    };

    expect(slotNumbers(weaponMountComponents(unit)[0])).toEqual([1, 2, 3]);
  });

  it('is a pure read of the unit', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    const before = JSON.stringify({
      weapons: atlas.equipment.weapons,
      slots: atlas.criticalSlots
    });

    const first = weaponMountComponents(atlas);
    const second = weaponMountComponents(atlas);

    expect(JSON.stringify({
      weapons: atlas.equipment.weapons,
      slots: atlas.criticalSlots
    })).toBe(before);
    expect(second.map(mount => ({ ...mount, slots: slotNumbers(mount) })))
      .toEqual(first.map(mount => ({ ...mount, slots: slotNumbers(mount) })));
  });

  it('ignores null critical-slot entries', () => {
    const unit = {
      equipment: { weapons: [{ type: 'med_laser', location: 'rightArm' }] },
      criticalSlots: { rightArm: [null, { slot: 1, item: 'med_laser', status: 'ok' }] }
    };

    const [mount] = weaponMountComponents(unit);
    expect(slotNumbers(mount)).toEqual([1]);
    expect(mount.destroyed).toBe(false);
  });

  it('gives mounts beyond the available slots an empty, intact component', () => {
    // Malformed record sheet: three mounts but only two slots for the item. The
    // extra mount has nothing to occupy, so nothing can have destroyed it.
    const unit = {
      equipment: {
        weapons: [
          { type: 'med_laser', location: 'rightArm' },
          { type: 'med_laser', location: 'rightArm' },
          { type: 'med_laser', location: 'rightArm' }
        ]
      },
      criticalSlots: {
        rightArm: [
          { slot: 1, item: 'med_laser', status: 'destroyed' },
          { slot: 2, item: 'med_laser', status: 'ok' }
        ]
      }
    };

    const mounts = weaponMountComponents(unit);
    expect(mounts.map(mount => slotNumbers(mount))).toEqual([[1], [2], []]);
    expect(mounts.map(mount => mount.destroyed)).toEqual([true, false, false]);
  });

  it('keeps mounts with no type or location addressable but intact', () => {
    const unit = {
      equipment: { weapons: [{ location: 'rightArm' }, { type: 'med_laser' }] },
      criticalSlots: { rightArm: [{ slot: 1, item: 'med_laser', status: 'destroyed' }] }
    };

    const mounts = weaponMountComponents(unit);
    expect(mounts).toHaveLength(2);
    expect(mounts.map(mount => mount.destroyed)).toEqual([false, false]);
    expect(mounts.map(mount => mount.type)).toEqual([null, 'med_laser']);
    expect(mounts[0].key).toBe('weapon@rightArm#0');
    expect(weaponMountAt(unit, 1.5)).toBeNull();
  });

  it('treats a unit without a weapon list as having no mounts', () => {
    expect(weaponMountComponents({ equipment: {}, criticalSlots: {} })).toEqual([]);
    expect(weaponMountComponents({ equipment: { weapons: null } })).toEqual([]);
    expect(weaponMountComponents(null)).toEqual([]);
  });
});
