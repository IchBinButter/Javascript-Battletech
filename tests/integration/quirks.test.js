/**
 * Design quirks end to end: the roster data, the unit hand-off, and the rules
 * actually applying them when a shot, a PSR or a heat bill is resolved.
 */

import { describe, it, expect } from 'vitest';
import { Unit } from '../../src/models/Unit.js';
import { PSRCalculator } from '../../src/rules/movement/PSRCalculator.js';
import { getQuirkDefinition } from '../../src/rules/quirks/Quirks.js';
import {
  createTestUnit,
  createTestEngine,
  createWeaponDef,
  fireWeaponAtTarget,
  makeDiceRoller,
  mechsData
} from '../helpers/testUtils.js';

// ---------------------------------------------------------------------------
// Roster data
// ---------------------------------------------------------------------------

describe('roster quirk data', () => {
  const quirked = mechsData.mechs.filter(mech => Array.isArray(mech.quirks) && mech.quirks.length);

  it('only names quirks the table knows', () => {
    for (const mech of quirked) {
      for (const entry of mech.quirks) {
        const id = typeof entry === 'string' ? entry : entry.id;
        expect(getQuirkDefinition(id), `${mech.id}: ${id}`).not.toBeNull();
      }
    }
  });

  it('only names weapons the Mech actually carries', () => {
    for (const mech of quirked) {
      const weaponIds = mech.equipment.weapons.map(weapon => weapon.type || weapon.id);
      for (const entry of mech.quirks) {
        if (typeof entry === 'string' || !entry.weapon) continue;
        expect(weaponIds, `${mech.id}: ${entry.weapon}`).toContain(entry.weapon);
      }
    }
  });

  it('gives every weapon-scoped quirk a weapon', () => {
    for (const mech of quirked) {
      for (const entry of mech.quirks) {
        if (typeof entry === 'string') continue;
        const definition = getQuirkDefinition(entry.id);
        if (definition.requiresWeapon) {
          expect(entry.weapon, `${mech.id}: ${entry.id}`).toBeTruthy();
        }
      }
    }
  });

  it('carries the canon Wolverine Cramped Cockpit and the two refit test-beds', () => {
    expect(mechsData.mechs.find(mech => mech.id === 'wolverine-wvr6r').quirks)
      .toEqual(['cramped_cockpit']);

    const atlasRefit = mechsData.mechs.find(mech => mech.id === 'atlas-as7d-refit');
    expect(atlasRefit.quirks).toEqual([
      'sensor_ghosts',
      { id: 'poor_cooling_jacket', weapon: 'ac20' },
      { id: 'inaccurate_weapon', weapon: 'lrm20' }
    ]);

    const bansheeRefit = mechsData.mechs.find(mech => mech.id === 'banshee-bnc3e-refit');
    expect(bansheeRefit.quirks).toEqual(['hard_to_pilot', 'unbalanced', 'poor_targeting_long']);
  });

  it('defaults a Mech without quirk data to an empty quirk list', () => {
    // A Unit contract, not a roster policy: adding quirks to more canon designs
    // is a deliberate data change, and no test may depend on a design staying
    // quirk-free.
    const mechDef = { ...mechsData.mechs.find(mech => mech.id === 'atlas-as7d') };
    delete mechDef.quirks;
    expect(new Unit(mechDef, 0, 'no-quirk-data').quirks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit hand-off
// ---------------------------------------------------------------------------

describe('Unit copying quirks', () => {
  it('copies the mech definition quirks onto the unit', () => {
    const wolverine = createTestUnit('wolverine-wvr6r', 0, 'wolverine');
    expect(wolverine.quirks).toEqual(['cramped_cockpit']);

    const atlasRefit = createTestUnit('atlas-as7d-refit', 0, 'refit');
    expect(atlasRefit.quirks).toEqual(expect.arrayContaining([
      'sensor_ghosts',
      { id: 'poor_cooling_jacket', weapon: 'ac20' },
      { id: 'inaccurate_weapon', weapon: 'lrm20' }
    ]));
  });

  it('deep-copies them, so a unit cannot mutate the roster data', () => {
    const mechDef = mechsData.mechs.find(mech => mech.id === 'atlas-as7d-refit');
    const first = new Unit(mechDef, 0, 'first');
    first.quirks.push('sensor_ghosts');
    first.quirks[1].weapon = 'ppc';

    const second = new Unit(mechDef, 0, 'second');
    expect(second.quirks.filter(entry => entry === 'sensor_ghosts')).toHaveLength(1);
    expect(second.quirks[1]).toEqual({ id: 'poor_cooling_jacket', weapon: 'ac20' });
  });

  it('survives a toJSON / fromJSON round trip', () => {
    const unit = createTestUnit('banshee-bnc3e-refit', 0, 'banshee');
    const clone = Unit.fromJSON(unit.toJSON());
    expect(clone.quirks).toEqual(unit.quirks);
  });
});

// ---------------------------------------------------------------------------
// Engine-level effects
// ---------------------------------------------------------------------------

describe('quirks in the engine', () => {
  // The canon Atlas and the refit both carry an LRM-20 in the left torso. Firing
  // the same weapon at an identical target must show up as the quirk difference.
  // The control's quirks are forced to [] so that adding quirks to more roster
  // designs cannot silently break the comparison.
  function fireLrm20(mechId, unitId, quirks = undefined) {
    const attacker = createTestUnit(mechId, 0, unitId);
    if (quirks !== undefined) attacker.quirks = quirks;
    const target = createTestUnit('jenner-jr7d', 1, 'target');
    attacker.position = { hexKey: '9,12', facing: 0 };
    target.position = { hexKey: '9,2', facing: 0 };

    const engine = createTestEngine({ units: { [attacker.id]: attacker, [target.id]: target } });
    engine.diceRoller = makeDiceRoller(7);

    const result = fireWeaponAtTarget(
      engine, attacker.id, target.id, createWeaponDef('lrm20'), 0, 'leftTorso'
    );
    expect(result.success).toBe(true);
    return result;
  }

  it('a quirked Mech has a higher Target Number than a clean one', () => {
    const quirked = fireLrm20('atlas-as7d-refit', 'refit');
    const clean = fireLrm20('atlas-as7d', 'clean', []);

    // Sensor Ghosts + Inaccurate Weapon (LRM-20) are both +1 (p87-88).
    expect(quirked.targetNumber).toBe(clean.targetNumber + 2);
    expect(quirked.modifiers).toContain('Sensor Ghosts: +1');
    expect(quirked.modifiers).toContain('Inaccurate Weapon (lrm20): +1');
    expect(clean.modifiers).not.toContain('Sensor Ghosts: +1');
    expect(clean.modifiers).not.toContain('Inaccurate Weapon (lrm20): +1');
  });

  it('only the quirk lines differ; the shot itself is set up identically', () => {
    const quirked = fireLrm20('atlas-as7d-refit', 'refit');
    const clean = fireLrm20('atlas-as7d', 'clean', []);

    const rangeOf = result => result.modifiers.find(line => line.startsWith('Range:'));
    expect(rangeOf(quirked)).toBe(rangeOf(clean));
    expect(quirked.roll).toBe(clean.roll);
  });

  it('treats a minimum-range shot as Short range for Poor Targeting (Short)', () => {
    function fireAtDistance3(quirks) {
      const attacker = createTestUnit('atlas-as7d', 0, 'attacker');
      attacker.quirks = quirks;
      const target = createTestUnit('jenner-jr7d', 1, 'target');
      attacker.position = { hexKey: '9,9', facing: 0 };
      target.position = { hexKey: '9,6', facing: 0 };

      const engine = createTestEngine({ units: { [attacker.id]: attacker, [target.id]: target } });
      engine.diceRoller = makeDiceRoller(7);

      const result = fireWeaponAtTarget(
        engine, attacker.id, target.id, createWeaponDef('lrm20'), 0, 'leftTorso'
      );
      expect(result.success).toBe(true);
      return result;
    }

    // The LRM-20's minimum range is 6, so distance 3 sits inside it; the attack
    // is still Short range, and Poor Targeting (Short) adds its +1 (p27, p88).
    const quirked = fireAtDistance3(['poor_targeting_short']);
    const clean = fireAtDistance3([]);

    expect(quirked.targetNumber).toBe(clean.targetNumber + 1);
    expect(quirked.modifiers).toContain('Poor Targeting (Short): +1');
  });

  it('quirk PSRs are harder, and Unbalanced only bites on hex entries', () => {
    const psr = new PSRCalculator();

    const wolverine = createTestUnit('wolverine-wvr6r', 0, 'wolverine');
    const clean = createTestUnit('atlas-as7d', 0, 'clean');
    clean.quirks = []; // control unit: same skill, no quirks
    const mud = { type: 'walk', terrainPSR: { modifier: 1, reasons: ['Mud: +1'] } };

    const wolverineTriggers = psr.getPSRTriggers(wolverine, mud, null);
    const cleanTriggers = psr.getPSRTriggers(clean, mud, null);
    expect(wolverineTriggers).toEqual(cleanTriggers);

    const wolverinePsr = psr.calculatePSRModifier(wolverine, wolverineTriggers);
    const cleanPsr = psr.calculatePSRModifier(clean, cleanTriggers);
    expect(wolverinePsr.targetNumber).toBe(cleanPsr.targetNumber + 1);
    expect(wolverinePsr.modifiers).toContain('Cramped Cockpit: +1');
    expect(wolverinePsr.modifiers).not.toContain('Unbalanced: +1');

    const banshee = createTestUnit('banshee-bnc3e-refit', 0, 'banshee');
    const woodsPsr = psr.calculatePSRModifier(
      banshee,
      psr.getPSRTriggers(banshee, { type: 'walk', enteredHeavyWoods: true }, null)
    );
    expect(woodsPsr.modifiers).toContain('Hard to Pilot: +1');
    expect(woodsPsr.modifiers).toContain('Unbalanced: +1');
  });

  it('firing the refit AC/20 through GameEngine gains 7 weapon heat + 1 jacket heat', () => {
    function fireAc20(mechId, unitId, quirks = undefined) {
      const attacker = createTestUnit(mechId, 0, unitId);
      if (quirks !== undefined) attacker.quirks = quirks;
      const target = createTestUnit('jenner-jr7d', 1, 'target');
      // AC/20 medium range is 6, so distance 4 is a legal forward-arc shot.
      attacker.position = { hexKey: '9,9', facing: 0 };
      target.position = { hexKey: '9,5', facing: 0 };

      const engine = createTestEngine({ units: { [attacker.id]: attacker, [target.id]: target } });
      engine.diceRoller = makeDiceRoller(7);

      const result = fireWeaponAtTarget(
        engine, attacker.id, target.id, createWeaponDef('ac20'), 0, 'rightTorso'
      );
      expect(result.success).toBe(true);
      return attacker;
    }

    // The live path: GameEngine._handleFire applies weapon heat plus quirks.
    const refit = fireAc20('atlas-as7d-refit', 'refit');
    expect(refit.heat).toBe(8); // AC/20 heat 7 + Poor Cooling Jacket 1 (p88)

    // Control: the same shot from a quirk-free Atlas pays only weapon heat.
    const clean = fireAc20('atlas-as7d', 'clean', []);
    expect(clean.heat).toBe(7);
  });

  it('scopes weapon quirks to the named weapon in the live path', () => {
    const attacker = createTestUnit('atlas-as7d-refit', 0, 'refit');
    const target = createTestUnit('jenner-jr7d', 1, 'target');
    attacker.position = { hexKey: '9,9', facing: 0 };
    target.position = { hexKey: '9,4', facing: 0 };

    const engine = createTestEngine({ units: { [attacker.id]: attacker, [target.id]: target } });
    engine.diceRoller = makeDiceRoller(7);

    // Inaccurate Weapon names the LRM-20 and the jacket names the AC/20, so a
    // medium laser shot keeps Sensor Ghosts but neither of those (p87-88).
    const result = fireWeaponAtTarget(
      engine, attacker.id, target.id, createWeaponDef('med_laser'), 0, 'rightArm'
    );

    expect(result.success).toBe(true);
    expect(result.modifiers).toContain('Sensor Ghosts: +1');
    expect(result.modifiers).not.toContain('Inaccurate Weapon (lrm20): +1');
    expect(attacker.heat).toBe(3); // med laser heat only; no Poor Cooling Jacket
  });
});
