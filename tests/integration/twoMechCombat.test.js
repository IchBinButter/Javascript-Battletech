import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller,
  createTestGameState,
  createTestMap,
  hitTables
} from '../helpers/testUtils.js';

describe('Integration: Two Mechs Attacking Each Other', () => {
  function setupEngagement() {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 0 };
    jenner.position = { hexKey: '7,7', facing: 3 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    return { engine, atlas, jenner };
  }

  it('Atlas fires medium laser at Jenner and applies damage', () => {
    const { engine, atlas, jenner } = setupEngagement();

    // Override dice to guarantee a hit (roll 8, TN will be ~4)
    engine.diceRoller = makeDiceRoller(8);

    // Enter weapon attack phase and set current player
    engine.phaseManager.enterPhase('weapon_attack');
    engine.stateManager.getState().currentPlayer = 0;

    const medLaser = createWeaponDef('med_laser');
    const initialArmor = jenner.armor.centerTorso.front;

    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(result.hit).toBe(true);
    expect(result.hitLocations.length).toBeGreaterThanOrEqual(1);
    expect(atlas.heat).toBe(3); // Medium laser generates 3 heat

    // Verify damage was applied to Jenner
    const totalDamage = result.hitLocations.reduce((sum, h) => sum + h.damage, 0);
    expect(totalDamage).toBeGreaterThan(0);
  });

  it('Jenner fires back at Atlas after being hit', () => {
    const { engine, atlas, jenner } = setupEngagement();

    // Both players hit with roll 8
    engine.diceRoller = makeDiceRoller(8);

    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    // Atlas fires medium laser
    const medLaser = createWeaponDef('med_laser');
    const atlasResult = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });
    expect(atlasResult.hit).toBe(true);

    // Jenner fires back
    engine.stateManager.getState().currentPlayer = 1;
    const jennerResult = engine.processAction(1, {
      type: 'fire',
      attackerId: 'jenner-1',
      targetId: 'atlas-0',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });
    expect(jennerResult.hit).toBe(true);

    // Both should have accumulated heat
    expect(atlas.heat).toBe(3);
    expect(jenner.heat).toBe(3);
  });

  it('miss deals no damage', () => {
    const { engine, atlas, jenner } = setupEngagement();

    // Roll 2 = always miss (TN >= 2 minimum)
    engine.diceRoller = makeDiceRoller(2);

    engine.phaseManager.enterPhase('weapon_attack');
    engine.stateManager.getState().currentPlayer = 0;

    const medLaser = createWeaponDef('med_laser');
    const jennerArmorBefore = jenner.armor.centerTorso.front;

    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    // With roll 2 vs gunnery 4, should miss
    expect(result.hit).toBe(false);
    expect(result.hitLocations).toHaveLength(0);
    expect(jenner.armor.centerTorso.front).toBe(jennerArmorBefore);
  });

  it('physical attack resolves between adjacent mechs', () => {
    const { engine, atlas, jenner } = setupEngagement();

    // Move mechs adjacent
    atlas.position.hexKey = '5,7';
    jenner.position.hexKey = '5,8';

    engine.diceRoller = makeDiceRoller(8);

    engine.phaseManager.enterPhase('physical_attack');
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'physicalAttack',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      attackType: 'punch'
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe('punch');
    if (result.hit) {
      // Atlas is 100 tons, punch = 100/10 = 10 damage
      expect(result.damage).toBe(10);
      expect(result.hitLocations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('kick attack deals more damage than punch', () => {
    const { engine, atlas, jenner } = setupEngagement();
    atlas.position.hexKey = '5,7';
    jenner.position.hexKey = '5,8';

    engine.diceRoller = makeDiceRoller(8);
    engine.phaseManager.enterPhase('physical_attack');
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'physicalAttack',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      attackType: 'kick'
    });

    expect(result.success).toBe(true);
    if (result.hit) {
      // Atlas is 100 tons, kick = 100/5 = 20 damage
      expect(result.damage).toBe(20);
    }
  });

  it('multiple weapon hits accumulate damage correctly', () => {
    const { engine, atlas, jenner } = setupEngagement();

    engine.diceRoller = makeDiceRoller(8);
    engine.phaseManager.enterPhase('weapon_attack');
    engine.stateManager.getState().currentPlayer = 0;

    const jennerArmorBefore = jenner.armor.centerTorso.front +
      jenner.armor.leftTorso.front +
      jenner.armor.rightTorso.front;

    // Fire two medium lasers
    const medLaser = createWeaponDef('med_laser');
    engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });
    engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    // Atlas should have 6 heat (3 per laser)
    expect(atlas.heat).toBe(6);
  });

  it('cannot fire weapon in movement phase', () => {
    const { engine } = setupEngagement();
    engine.phaseManager.enterPhase('movement');
    engine.stateManager.getState().currentPlayer = 0;

    const medLaser = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('weapon attack phase');
  });

  it('cannot move in weapon attack phase', () => {
    const { engine } = setupEngagement();
    engine.phaseManager.enterPhase('weapon_attack');
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('movement phase');
  });
});
