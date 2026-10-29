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

describe('weapon declaration (p24)', () => {
  it('rejects a weapon the Mech does not mount', () => {
    const { engine } = setup();
    const result = fire(engine, createWeaponDef('ppc'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not mounted');
  });

  it('rejects firing the same weapon twice in a turn', () => {
    const { engine } = setup();
    const laser = createWeaponDef('med_laser');

    const first = fire(engine, laser, { weaponLocation: 'rightArm' });
    expect(first.success).toBe(true);

    const second = fire(engine, laser, { weaponLocation: 'rightArm' });
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

describe('destroyed weapons (p46)', () => {
  it('rejects a weapon whose critical slots are all destroyed', () => {
    const { engine, atlas } = setup();
    for (const slot of atlas.criticalSlots.rightArm) {
      if (slot.item === 'med_laser') slot.status = 'destroyed';
    }

    const result = fire(engine, createWeaponDef('med_laser'), { weaponLocation: 'rightArm' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('destroyed');
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
