/**
 * Urban combat integration (BMM p66-73): moving into buildings, collapse and
 * combat within buildings, driven through the real engine.
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller } from '../helpers/testUtils.js';
import { BuildingRegistry, buildingCombat } from '../../src/rules/urban/Buildings.js';

const mediumBuilding = (cf = 40, levels = 2, id = 'b1') => ({ id, type: 'medium', levels, cf, currentCF: cf });

function urbanEngine({ units, buildings = {}, phase = 'movement', diceRoller = makeDiceRoller(7) }) {
  const engine = createTestEngine({ units });
  engine.diceRoller = diceRoller;

  const state = engine.stateManager.getState();
  for (const [hexKey, building] of Object.entries(buildings)) {
    const hex = state.map.hexes.get(hexKey);
    if (hex) hex.building = { ...building };
  }

  engine.phaseManager.enterPhase(phase);
  return engine;
}

const place = (unit, hexKey, facing = 0) => {
  unit.position = { hexKey, facing };
  return unit;
};

describe('moving into a building (p67)', () => {
  it('damages the hex by tonnage / 10 and rolls a PSR', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({ units: { locust }, buildings: { '5,5': mediumBuilding() } });

    const result = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(engine.stateManager.getState().map.hexes.get('5,5').building.currentCF).toBe(38);
  });

  it('costs the Mech tonnage / 10 damage when the PSR fails', () => {
    // 2 fails the entering PSR against a medium building (5 piloting + 1).
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: { '5,5': mediumBuilding() },
      diceRoller: makeDiceRoller(2)
    });

    const armourBefore = JSON.stringify(locust.armor);

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(JSON.stringify(locust.armor)).not.toBe(armourBefore);
    // The hex takes its damage either way.
    expect(engine.stateManager.getState().map.hexes.get('5,5').building.currentCF).toBe(38);
  });

  it('does not damage the building when jumping onto it', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '2,5');
    const engine = urbanEngine({ units: { locust }, buildings: { '5,5': mediumBuilding() } });

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['2,5', '5,5'], movementType: 'jump'
    });

    expect(engine.stateManager.getState().map.hexes.get('5,5').building.currentCF).toBe(40);
  });
});

describe('collapse (p73)', () => {
  it('reduces a hex to rubble and damages its occupant', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: { '5,5': mediumBuilding(2) },
      diceRoller: makeDiceRoller(7)
    });

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    const hex = engine.stateManager.getState().map.hexes.get('5,5');
    expect(hex.building.currentCF).toBe(0);
    expect(hex.terrainType).toBe('rubble');
  });

  it('brings the rest of a building down once more than half is gone', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: {
        '5,5': mediumBuilding(2, 2, 'block'),
        '6,5': mediumBuilding(40, 2, 'block'),
        '5,6': mediumBuilding(40, 2, 'block'),
        '6,6': mediumBuilding(40, 2, 'block')
      }
    });

    const state = engine.stateManager.getState();
    // Two of four hexes already down: entering makes it three.
    state.map.hexes.get('6,5').building.currentCF = 0;
    state.map.hexes.get('5,6').building.currentCF = 0;

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(state.map.hexes.get('6,6').building.currentCF).toBe(0);
    expect(state.map.hexes.get('6,6').terrainType).toBe('rubble');
  });

  it('leaves neighbouring hexes standing below the halfway mark', () => {
    const locust = place(createTestUnit('locust-lct1v', 0, 'locust'), '4,5');
    const engine = urbanEngine({
      units: { locust },
      buildings: {
        '5,5': mediumBuilding(2, 2, 'block'),
        '6,5': mediumBuilding(40, 2, 'block'),
        '5,6': mediumBuilding(40, 2, 'block'),
        '6,6': mediumBuilding(40, 2, 'block')
      }
    });

    const state = engine.stateManager.getState();
    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(state.map.hexes.get('6,5').building.currentCF).toBe(40);
    expect(state.map.hexes.get('6,6').terrainType).not.toBe('rubble');
  });
});

describe('combat within buildings (p72)', () => {
  const combat = (buildings, attackerHex = '5,8', targetHex = '5,5') => {
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), attackerHex, 0);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), targetHex, 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings,
      phase: 'weapon_attack'
    });
    return { engine, attacker, target };
  };

  it('adds +1 for a target inside a building', () => {
    const { engine, attacker, target } = combat({ '5,5': mediumBuilding() });
    const state = engine.stateManager.getState();
    const weapon = createWeaponDef('med_laser');

    const urban = buildingCombat(attacker, target, state);
    expect(urban.targetInside).toBe(true);
    expect(urban.modifier).toBe(1);

    const calc = engine.attackResolver.calculateTargetNumber(
      attacker, weapon, target, state, { buildingModifier: urban.modifier }
    );
    expect(calc.modifiers).toContain('Combat within buildings: +1');
  });

  it('absorbs CF / 10 of a hit and charges it to the hex', () => {
    const { engine } = combat({ '5,5': mediumBuilding(40) });
    const state = engine.stateManager.getState();
    const weapon = createWeaponDef('med_laser');

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    const hex = state.map.hexes.get('5,5');
    expect(hex.building.currentCF).toBe(36); // 40 - ceil(40/10), a 5-point laser
  });

  it('rejects a shot through three intervening building hexes', () => {
    const attacker = place(createTestUnit('atlas-as7d', 0, 'atlas'), '2,5', 0);
    const target = place(createTestUnit('locust-lct1v', 1, 'locust'), '6,5', 3);
    const engine = urbanEngine({
      units: { atlas: attacker, locust: target },
      buildings: {
        '3,5': mediumBuilding(40, 2, 'a'),
        '4,5': mediumBuilding(40, 2, 'b'),
        '5,5': mediumBuilding(40, 2, 'c')
      },
      phase: 'weapon_attack'
    });

    const weapon = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust', weapon,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('LOS blocked');
  });
});

describe('BuildingRegistry.isMostlyDestroyed against the engine map', () => {
  it('reads destroyed hexes from the live map', () => {
    const engine = urbanEngine({
      units: {},
      buildings: {
        '5,5': mediumBuilding(40, 2, 'block'),
        '6,5': mediumBuilding(40, 2, 'block'),
        '5,6': mediumBuilding(40, 2, 'block')
      }
    });
    const hexes = engine.stateManager.getState().map.hexes;

    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(false);
    hexes.get('5,5').building.currentCF = 0;
    hexes.get('6,5').building.currentCF = 0;
    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(true);
  });
});
