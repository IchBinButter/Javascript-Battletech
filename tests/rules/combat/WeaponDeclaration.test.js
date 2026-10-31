/**
 * Weapon declaration checks (p24 once per turn, p31 ammunition, p46 destroyed
 * weapons). These fixtures run with enforcement ON; the shared test engine
 * defaults it off so other suites can fire arbitrary weapons in isolation.
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller } from '../../helpers/testUtils.js';

function setup() {
  const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
  const locust = createTestUnit('locust-lct1v', 1, 'locust');
  atlas.position = { hexKey: '5,7', facing: 0 };
  locust.position = { hexKey: '5,5', facing: 3 };

  const engine = createTestEngine({
    units: { atlas, locust },
    enforceWeaponDeclarations: true
  });
  engine.diceRoller = makeDiceRoller(8);
  engine.phaseManager.enterPhase('weapon_attack');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = 0;

  return { engine, atlas, locust };
}

const fire = (engine, weapon, extra = {}) => engine.processAction(0, {
  type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon, ...extra
});

/**
 * Weapon Attack Phase with `mechId` (player 0) against an Atlas two hexes due
 * north: forward arc, short range, clear line of sight. The target is sturdy
 * enough to take a whole volley without being destroyed mid-test.
 */
function setupDuel(mechId) {
  const attacker = createTestUnit(mechId, 0, 'attacker');
  const target = createTestUnit('atlas-as7d', 1, 'target');
  attacker.position = { hexKey: '5,7', facing: 0 };
  target.position = { hexKey: '5,5', facing: 3 };

  const engine = createTestEngine({
    units: { attacker, target },
    enforceWeaponDeclarations: true
  });
  engine.diceRoller = makeDiceRoller(8);
  engine.phaseManager.enterPhase('weapon_attack');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = 0;

  return { engine, attacker, target };
}

const fireAt = (engine, attackerId, weapon, extra = {}) => engine.processAction(0, {
  type: 'fire', attackerId, targetId: 'target', weapon, ...extra
});

/** Destroy the record-sheet slot `slotNumber` of `item` in `location`. */
function destroySlot(unit, location, item, slotNumber) {
  const slot = unit.criticalSlots[location]
    .find(entry => entry.item === item && entry.slot === slotNumber);
  if (!slot) throw new Error(`No ${item} slot ${slotNumber} in ${location}`);
  slot.status = 'destroyed';
  return slot;
}

describe('weapon declaration (p24)', () => {
  it('rejects a weapon the Mech does not mount', () => {
    const { engine } = setup();
    const result = fire(engine, createWeaponDef('ppc'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not mounted');
  });

  it('rejects firing the same mounted instance twice in a turn', () => {
    const { engine, atlas } = setup();
    const laser = createWeaponDef('med_laser');
    const laserIndex = atlas.equipment.weapons.findIndex(w => w.type === 'med_laser');

    const first = fire(engine, laser, { weaponLocation: 'rightArm', weaponIndex: laserIndex });
    expect(first.success).toBe(true);

    const second = fire(engine, laser, { weaponLocation: 'rightArm', weaponIndex: laserIndex });
    expect(second.success).toBe(false);
    expect(second.error).toContain('already fired');
  });

  it('allows different weapons in the same turn', () => {
    const { engine } = setup();
    const first = fire(engine, createWeaponDef('med_laser'), { weaponLocation: 'rightArm' });
    const second = fire(engine, createWeaponDef('ac20'), { weaponLocation: 'rightTorso' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });
});

/**
 * p24's "a 'Mech can fire each weapon only once per turn" is per MOUNTED
 * WEAPON, not per weapon model. The Atlas AS7-D carries two medium lasers in
 * its right arm, and live play rejected the second one with "already fired"
 * because the fired record was keyed by `<weapon id>@<location>`.
 *
 * The fired record is now keyed by the mounted instance index (its position in
 * `unit.equipment.weapons`), with the old model key still honoured as the
 * conservative reading of a record written before per-instance identity.
 */
describe('identical weapons in one location (p24)', () => {
  /** Index of the first mounted `type` in `location` on a test unit. */
  function mountedIndex(unit, type, location) {
    return unit.equipment.weapons.findIndex(w => w.type === type && w.location === location);
  }

  /** The Atlas' two right-arm medium lasers, as [entry, index] pairs. */
  function rightArmLasers(atlas) {
    return atlas.equipment.weapons
      .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
      .filter(entry => entry.weapon.type === 'med_laser' && entry.weapon.location === 'rightArm');
  }

  it('fires both right-arm medium lasers in one turn', () => {
    const { engine, atlas } = setup();
    const laser = createWeaponDef('med_laser');
    const resolved = [];
    engine.eventBus.on('unitAttacked', data => resolved.push(data));

    const first = fire(engine, laser, { weaponLocation: 'rightArm' });
    const second = fire(engine, laser, { weaponLocation: 'rightArm' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    // Two shots, not one: two heat additions and two resolved attacks (each
    // with its own to-hit roll), not one attack recorded twice.
    expect(atlas.heat).toBe(6); // medium laser 3 + 3
    expect(resolved).toHaveLength(2);
    expect(resolved.every(data => typeof data.result.hit === 'boolean')).toBe(true);

    // The two mounts are recorded separately: the Atlas carries the lasers at
    // equipment indices 1 and 2.
    const lasers = rightArmLasers(atlas);
    expect(lasers.map(entry => entry.weaponIndex)).toEqual([1, 2]);
    expect([...atlas.firedWeaponsThisTurn].sort()).toEqual([
      'med_laser@rightArm#1',
      'med_laser@rightArm#2'
    ]);
  });

  it('rolls to hit once per identical instance', () => {
    const { engine } = setup();
    // A roll of 2 misses every legal shot, so the resolver makes exactly one
    // roll per instance (no hit-location or cluster rolls follow a miss).
    const roller = makeDiceRoller(2);
    let toHitRolls = 0;
    engine.diceRoller = {
      ...roller,
      roll2d6: () => { toHitRolls++; return roller.roll2d6(); }
    };
    const laser = createWeaponDef('med_laser');

    expect(fire(engine, laser, { weaponLocation: 'rightArm' }).success).toBe(true);
    expect(fire(engine, laser, { weaponLocation: 'rightArm' }).success).toBe(true);

    expect(toHitRolls).toBe(2);
  });

  it('rejects a third declaration of the same model in that location', () => {
    const { engine, atlas } = setup();
    const laser = createWeaponDef('med_laser');

    expect(fire(engine, laser, { weaponLocation: 'rightArm' }).success).toBe(true);
    expect(fire(engine, laser, { weaponLocation: 'rightArm' }).success).toBe(true);

    const third = fire(engine, laser, { weaponLocation: 'rightArm' });
    expect(third.success).toBe(false);
    expect(third.error).toContain('already fired');
    expect(atlas.heat).toBe(6); // the rejected declaration spends no heat
  });

  it('names one instance with weaponIndex and allocates the rest', () => {
    const { engine, atlas } = setup();
    const laser = createWeaponDef('med_laser');
    const lasers = rightArmLasers(atlas);

    // Explicit instance: the second right-arm laser.
    const explicit = fire(engine, laser, {
      weaponLocation: 'rightArm',
      weaponIndex: lasers[1].weaponIndex
    });
    expect(explicit.success).toBe(true);
    expect(explicit.weaponIndex).toBe(lasers[1].weaponIndex);

    // No index: the remaining unfired instance is allocated, not the first one
    // (which is the mount that just fired).
    const allocated = fire(engine, laser, { weaponLocation: 'rightArm' });
    expect(allocated.success).toBe(true);
    expect(allocated.weaponIndex).toBe(lasers[0].weaponIndex);

    // Both instances are now spent; naming either one fails.
    const reclaimed = fire(engine, laser, {
      weaponLocation: 'rightArm',
      weaponIndex: lasers[1].weaponIndex
    });
    expect(reclaimed.success).toBe(false);
    expect(reclaimed.error).toContain('already fired');
    expect(atlas.heat).toBe(6);
  });

  it('rejects a weaponIndex that does not name the declared mount', () => {
    const { engine, atlas } = setup();
    const laser = createWeaponDef('med_laser');
    const ac20Index = mountedIndex(atlas, 'ac20', 'rightTorso');
    const laserIndex = mountedIndex(atlas, 'med_laser', 'rightArm');

    const outOfRange = fire(engine, laser, { weaponLocation: 'rightArm', weaponIndex: 999 });
    expect(outOfRange.success).toBe(false);
    expect(outOfRange.error).toContain('not mounted at index 999');

    // An index that names a different weapon cannot be used to fire this one.
    const wrongWeapon = fire(engine, laser, { weaponLocation: 'rightTorso', weaponIndex: ac20Index });
    expect(wrongWeapon.success).toBe(false);
    expect(wrongWeapon.error).toContain(`not mounted at index ${ac20Index}`);

    // Nor can an instance be fired from a location it is not mounted in.
    const wrongLocation = fire(engine, laser, { weaponLocation: 'leftTorso', weaponIndex: laserIndex });
    expect(wrongLocation.success).toBe(false);
    expect(wrongLocation.error).toContain(`not mounted in leftTorso at index ${laserIndex}`);
  });

  it('still fires a single mounted weapon when no index is given', () => {
    const { engine, atlas } = setup();
    const laserIndex = mountedIndex(atlas, 'med_laser', 'rightArm');

    const result = fire(engine, createWeaponDef('med_laser'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(true);
    expect(result.weaponIndex).toBe(laserIndex);
    expect(atlas.heat).toBe(3);
  });

  it('leaves different models in one location unaffected', () => {
    const { engine, atlas } = setup();

    // The Atlas carries an SRM-6 and an LRM-20 in the left torso: two different
    // models in one location, each with its own ammunition bin.
    const srm = fire(engine, createWeaponDef('srm6'), { weaponLocation: 'leftTorso' });
    const lrm = fire(engine, createWeaponDef('lrm20'), { weaponLocation: 'leftTorso' });

    expect(srm.success).toBe(true);
    expect(lrm.success).toBe(true);
    expect(atlas.heat).toBe(10); // SRM-6 (4) + LRM-20 (6)
    expect(atlas.equipment.ammo.srm6_ammo.shots).toBe(14); // 15 - 1
    expect(atlas.equipment.ammo['lrm20_ammo'].shots).toBe(5); // 6 - 1
  });

  it('keeps fired-instance records per unit', () => {
    const { engine, atlas } = setup();
    const state = engine.stateManager.getState();
    const laser = createWeaponDef('med_laser');

    expect(fire(engine, laser, { weaponLocation: 'rightArm' }).success).toBe(true);
    expect(fire(engine, laser, { weaponLocation: 'rightArm' }).success).toBe(true);

    // A second 'Mech with the same chassis has its own record: nothing the
    // first one fired can block it.
    const second = createTestUnit('atlas-as7d', 0, 'atlas-2');
    const decision = engine._validateWeaponDeclaration(second, {
      weapon: laser,
      weaponLocation: 'rightArm'
    }, state);

    expect(decision.ok).toBe(true);
    expect(second.firedWeaponsThisTurn).not.toBe(atlas.firedWeaponsThisTurn);
    expect(engine._validateWeaponDeclaration(atlas, {
      weapon: laser,
      weaponLocation: 'rightArm'
    }, state).ok).toBe(false);
  });

  it('honours a pre-instance model key as the conservative reading', () => {
    const { engine, atlas } = setup();
    // A record written before per-instance identity (by old engine code, or by
    // a caller that still uses the old key) records the model key. It must keep
    // blocking until the turn ends (never allow a second shot), while the new
    // records themselves are per instance.
    atlas.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    atlas.firedWeaponsTurn = engine.stateManager.getState().turn;

    const result = fire(engine, createWeaponDef('med_laser'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already fired');
  });
});

/**
 * p46: a critical hit destroys the physical component the mount occupies.
 *
 * - a single-slot weapon is destroyed by its one slot, so one of two identical
 *   mounts can die while its sibling keeps firing;
 * - a multi-slot item is one component: any destroyed slot disables it (AC/20
 *   10 slots, LRM-20 5, LRM-15 3, PPC 3, SRM-6 2, ...);
 * - mounts in the same location are independent per item id.
 */
describe('destroyed weapon components (p46)', () => {
  it('rejects a weapon whose critical-slot component is destroyed', () => {
    // Regression of the pre-component test: with every slot of the item gone,
    // no mount of it can fire.
    const { engine, atlas } = setup();
    for (const slot of atlas.criticalSlots.rightArm) {
      if (slot.item === 'med_laser') slot.status = 'destroyed';
    }

    const result = fire(engine, createWeaponDef('med_laser'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
  });

  it('fires exactly one of two identical lasers when one component is destroyed', () => {
    const { engine, atlas } = setup();
    const laser = createWeaponDef('med_laser');
    // Slot 6 is the second right-arm medium laser (index 2); slot 5 is index 1.
    destroySlot(atlas, 'rightArm', 'med_laser', 6);
    const resolved = [];
    engine.eventBus.on('unitAttacked', data => resolved.push(data));

    // One mount fires: one heat addition (3, not 6) and one to-hit roll.
    const first = fire(engine, laser, { weaponLocation: 'rightArm' });
    expect(first.success).toBe(true);
    expect(first.weaponIndex).toBe(1);

    // The other mount is destroyed, so a second declaration is refused.
    const second = fire(engine, laser, { weaponLocation: 'rightArm' });
    expect(second.success).toBe(false);
    expect(second.error).toContain('destroyed');

    // Naming the destroyed mount explicitly is refused too.
    const explicit = fire(engine, laser, { weaponLocation: 'rightArm', weaponIndex: 2 });
    expect(explicit.success).toBe(false);
    expect(explicit.error).toContain('destroyed');

    expect(atlas.heat).toBe(3);
    expect(resolved).toHaveLength(1);
    expect([...atlas.firedWeaponsThisTurn]).toEqual(['med_laser@rightArm#1']);
  });

  it('fires the surviving sibling when the first identical mount is destroyed', () => {
    const { engine, atlas } = setup();
    destroySlot(atlas, 'rightArm', 'med_laser', 5);

    // Index 1 is the mount in slot 5: destroyed. Index 2 is still intact.
    const destroyed = fire(engine, createWeaponDef('med_laser'), {
      weaponLocation: 'rightArm', weaponIndex: 1
    });
    expect(destroyed.success).toBe(false);
    expect(destroyed.error).toContain('destroyed');

    const intact = fire(engine, createWeaponDef('med_laser'), {
      weaponLocation: 'rightArm', weaponIndex: 2
    });
    expect(intact.success).toBe(true);
    expect(atlas.heat).toBe(3);
  });

  it('falls back to the surviving identical mount when the first is destroyed', () => {
    const { engine, atlas } = setup();
    // Mount 1 is destroyed. A caller that names no instance must still be able
    // to fire the surviving mount, so the allocator skips the dead component.
    destroySlot(atlas, 'rightArm', 'med_laser', 5);

    const result = fire(engine, createWeaponDef('med_laser'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(true);
    expect(result.weaponIndex).toBe(2);
    expect(atlas.heat).toBe(3);
  });

  it('blocks a multi-slot AC/20 when one of its ten slots is destroyed', () => {
    const { engine, atlas } = setup();
    destroySlot(atlas, 'rightTorso', 'ac20', 4);
    const ammoBefore = atlas.equipment.ammo.ac20_ammo.shots;

    const result = fire(engine, createWeaponDef('ac20'), { weaponLocation: 'rightTorso' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
    // A refused declaration spends nothing.
    expect(atlas.equipment.ammo.ac20_ammo.shots).toBe(ammoBefore);
    expect(atlas.heat).toBe(0);
  });

  it('blocks a multi-slot LRM-20 when one of its five slots is destroyed', () => {
    const { engine, atlas } = setup();
    destroySlot(atlas, 'leftTorso', 'lrm20', 4);
    const ammoBefore = atlas.equipment.ammo['lrm20_ammo'].shots;

    const result = fire(engine, createWeaponDef('lrm20'), { weaponLocation: 'leftTorso' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
    expect(atlas.equipment.ammo['lrm20_ammo'].shots).toBe(ammoBefore);
    expect(atlas.heat).toBe(0);
  });

  it('blocks a multi-slot weapon whose whole component is gone', () => {
    const { engine, atlas } = setup();
    for (const slot of atlas.criticalSlots.rightTorso) {
      if (slot.item === 'ac20') slot.status = 'destroyed';
    }
    const ammoBefore = atlas.equipment.ammo.ac20_ammo.shots;

    const result = fire(engine, createWeaponDef('ac20'), { weaponLocation: 'rightTorso' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
    expect(atlas.equipment.ammo.ac20_ammo.shots).toBe(ammoBefore);
  });

  it('leaves a different weapon in the same location unaffected', () => {
    const { engine, atlas } = setup();
    // The Atlas has an SRM-6 (slots 8-9) and an LRM-20 (slots 1-5) in the left
    // torso. One destroyed LRM slot disables only the LRM.
    destroySlot(atlas, 'leftTorso', 'lrm20', 3);

    const srm = fire(engine, createWeaponDef('srm6'), { weaponLocation: 'leftTorso' });
    expect(srm.success).toBe(true);
    expect(atlas.heat).toBe(4);
    expect(atlas.equipment.ammo.srm6_ammo.shots).toBe(14); // 15 - 1

    const lrm = fire(engine, createWeaponDef('lrm20'), { weaponLocation: 'leftTorso' });
    expect(lrm.success).toBe(false);
    expect(lrm.error).toContain('destroyed');
    expect(atlas.equipment.ammo['lrm20_ammo'].shots).toBe(6); // untouched
  });

  it('fires two of three identical arm lasers when one is destroyed (Thunderbolt)', () => {
    const { engine, attacker } = setupDuel('thunderbolt-tdr5s');
    const laser = createWeaponDef('med_laser');
    const lasers = attacker.equipment.weapons
      .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
      .filter(entry => entry.weapon.type === 'med_laser' && entry.weapon.location === 'rightArm');
    expect(lasers.map(entry => entry.weaponIndex)).toEqual([3, 4, 5]);

    // Record-sheet slot 6 is the middle mount of the three.
    destroySlot(attacker, 'rightArm', 'med_laser', 6);
    const resolved = [];
    engine.eventBus.on('unitAttacked', data => resolved.push(data));

    const middle = fireAt(engine, attacker.id, laser, { weaponLocation: 'rightArm', weaponIndex: 4 });
    expect(middle.success).toBe(false);
    expect(middle.error).toContain('destroyed');

    for (const weaponIndex of [3, 5]) {
      const result = fireAt(engine, attacker.id, laser, { weaponLocation: 'rightArm', weaponIndex });
      expect(result.success, `mount ${weaponIndex} should fire`).toBe(true);
    }

    expect(attacker.heat).toBe(6); // two medium lasers, not three
    expect(resolved).toHaveLength(2);
    expect([...attacker.firedWeaponsThisTurn].sort())
      .toEqual(['med_laser@rightArm#3', 'med_laser@rightArm#5']);
  });

  it('splits two lasers per arm so one destroyed mount leaves three (Jenner)', () => {
    const { engine, attacker } = setupDuel('jenner-jr7d');
    const laser = createWeaponDef('med_laser');
    // Equipment order: med_laser leftArm 0,1; med_laser rightArm 2,3; SRM-4 4.
    destroySlot(attacker, 'rightArm', 'med_laser', 5); // mount 2

    const destroyed = fireAt(engine, attacker.id, laser, { weaponLocation: 'rightArm', weaponIndex: 2 });
    expect(destroyed.success).toBe(false);
    expect(destroyed.error).toContain('destroyed');

    const rightSibling = fireAt(engine, attacker.id, laser, { weaponLocation: 'rightArm', weaponIndex: 3 });
    expect(rightSibling.success).toBe(true);
    // The left-arm pair shares no slot with the right arm.
    const leftArm = fireAt(engine, attacker.id, laser, { weaponLocation: 'leftArm', weaponIndex: 0 });
    expect(leftArm.success).toBe(true);

    expect(attacker.heat).toBe(6);
    expect([...attacker.firedWeaponsThisTurn].sort())
      .toEqual(['med_laser@leftArm#0', 'med_laser@rightArm#3']);
  });

  it('splits two right-torso PPCs so one destroyed slot leaves one (Awesome)', () => {
    const { engine, attacker } = setupDuel('awesome-aws8q');
    const ppc = createWeaponDef('ppc');
    // Equipment order: ppc rightArm 0; ppc rightTorso 1,2 (slots 3-5 and 6-8).
    destroySlot(attacker, 'rightTorso', 'ppc', 7); // second right-torso PPC

    const destroyed = fireAt(engine, attacker.id, ppc, { weaponLocation: 'rightTorso', weaponIndex: 2 });
    expect(destroyed.success).toBe(false);
    expect(destroyed.error).toContain('destroyed');

    const intact = fireAt(engine, attacker.id, ppc, { weaponLocation: 'rightTorso', weaponIndex: 1 });
    expect(intact.success).toBe(true);
    // The arm PPC is a separate component and still fires.
    const armPpc = fireAt(engine, attacker.id, ppc, { weaponLocation: 'rightArm', weaponIndex: 0 });
    expect(armPpc.success).toBe(true);

    expect(attacker.heat).toBe(20); // two PPCs of ten heat each
    expect([...attacker.firedWeaponsThisTurn].sort())
      .toEqual(['ppc@rightArm#0', 'ppc@rightTorso#1']);
  });
});

describe('ammunition (p31)', () => {
  it('spends a shot from the mounted bin', () => {
    const { engine, atlas } = setup();
    const before = atlas.equipment.ammo.ac20_ammo.shots;

    const result = fire(engine, createWeaponDef('ac20'), { weaponLocation: 'rightTorso' });

    expect(result.success).toBe(true);
    expect(atlas.equipment.ammo.ac20_ammo.shots).toBe(before - 1);
  });

  it('picks a bin when the caller does not name one', () => {
    const { engine, atlas } = setup();
    const before = atlas.equipment.ammo.ac20_ammo.shots;

    const result = fire(engine, createWeaponDef('ac20'), { weaponLocation: 'rightTorso' });

    expect(result.success).toBe(true);
    expect(atlas.equipment.ammo.ac20_ammo.shots).toBeLessThan(before);
  });

  it('rejects an empty bin', () => {
    const { engine, atlas } = setup();
    atlas.equipment.ammo.ac20_ammo.shots = 0;

    // No other AC/20 bin exists, so the automatic pick must fail.
    const result = fire(engine, createWeaponDef('ac20'), { weaponLocation: 'rightTorso' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ammunition/i);
  });

  it('rejects a bin name that does not exist', () => {
    const { engine } = setup();
    const result = fire(engine, createWeaponDef('ac20'), {
      weaponLocation: 'rightTorso', ammoBin: 'not_a_bin'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not_a_bin');
  });
});

describe('declaration enforcement is on by default', () => {
  it('the engine enforces unless a fixture opts out', () => {
    const { engine } = setup();
    expect(engine.enforceWeaponDeclarations).toBe(true);
  });
});
