/**
 * Battlefield rules through the engine: terrain modifications (p61), weather
 * (p62-63) and fire/smoke (p63-64).
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller } from '../helpers/testUtils.js';
import { Hex } from '../../src/models/Hex.js';

function engineWith({ playerHex = '5,5', targetHex = '5,4', weather = null } = {}) {
  const attacker = createTestUnit('atlas-as7d', 0, 'atlas');
  const target = createTestUnit('locust-lct1v', 1, 'locust');
  attacker.position = { hexKey: playerHex, facing: 0 };
  target.position = { hexKey: targetHex, facing: 3 };

  const engine = createTestEngine({ units: { atlas: attacker, locust: target } });
  if (weather) engine.stateManager.getState().weather = weather;
  return { engine, attacker, target };
}

describe('terrain modifications (p61)', () => {
  it('ice forces a PSR that can put the Mech on the ground', () => {
    const unit = createTestUnit('locust-lct1v', 0, 'locust');
    unit.position = { hexKey: '4,5', facing: 2 }; // facing the ice hex

    const engine = createTestEngine({ units: { locust: unit } });
    engine.diceRoller = makeDiceRoller(7); // 5 piloting + 3 ice = 8, so 7 fails
    engine.stateManager.getState().map.hexes.get('5,5').modifiers.ice = true;

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(unit.prone).toBe(true);
  });
});

describe('weather conditions (p62)', () => {
  it('adds the night modifier to weapon attacks', () => {
    const { engine, attacker, target } = engineWith({ weather: { light: 'moonless' } });
    const calc = engine.attackResolver.calculateTargetNumber(
      attacker, createWeaponDef('med_laser'), target, engine.stateManager.getState(), {}
    );

    expect(calc.modifiers).toContain('Weather: +3');
  });

  it('penalises PSRs in heavy rain', () => {
    const unit = createTestUnit('locust-lct1v', 0, 'locust');
    unit.position = { hexKey: '4,5', facing: 2 };

    const engine = createTestEngine({ units: { locust: unit } });
    engine.diceRoller = makeDiceRoller(5); // 5 piloting + 1 rain = 6, so 5 fails
    engine.stateManager.getState().weather = { precipitation: 'heavy_rain' };

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(unit.prone).toBe(true);
  });

  it('charges extra MP in heavy fog', () => {
    const unit = createTestUnit('locust-lct1v', 0, 'locust');
    unit.position = { hexKey: '4,5', facing: 2 };

    const engine = createTestEngine({ units: { locust: unit } });
    engine.stateManager.getState().weather = { fog: 'heavy' };

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    // 1 MP to enter + 2 for heavy fog.
    expect(result.success).toBe(true);
    expect(result.remainingMP).toBe(unit.currentMP - 3);
  });
});

describe('fire and smoke (p63-64)', () => {
  const burning = () => {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas');
    const target = createTestUnit('locust-lct1v', 1, 'locust');
    attacker.position = { hexKey: '5,5', facing: 0 };
    target.position = { hexKey: '5,4', facing: 3 };

    const engine = createTestEngine({ units: { atlas: attacker, locust: target } });
    engine.diceRoller = makeDiceRoller(7);
    engine.stateManager.getState().map.hexes.get('5,4').terrainType = 'light_woods';

    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust',
      weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
    });

    return { engine, target };
  };

  it('ignites a woods hex when a laser hits it', () => {
    const { engine } = burning();
    const state = engine.stateManager.getState();

    engine.resolveEndPhaseFire();

    expect(state.fireHexes).toContain('5,4');
    // Smoke fills the two hexes downwind.
    expect(Object.keys(state.smokeHexes).length).toBe(2);
  });

  it('burns a unit standing in the fire', () => {
    const { engine, target } = burning();
    const armourBefore = JSON.stringify(target.armor);

    engine.resolveEndPhaseFire();
    engine.resolveFireDamage();

    expect(JSON.stringify(target.armor)).not.toBe(armourBefore);
  });

  it('costs a burning building 2 CF per End Phase', () => {
    const { engine } = burning();
    const state = engine.stateManager.getState();
    const hex = state.map.hexes.get('5,4');
    hex.terrainType = 'clear';
    hex.building = { id: 'b1', type: 'light', levels: 1, cf: 15, currentCF: 15 };

    engine.resolveEndPhaseFire();

    expect(state.fireHexes).toContain('5,4');
    expect(hex.building.currentCF).toBe(13);
  });
});
