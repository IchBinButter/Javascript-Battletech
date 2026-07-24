import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller,
  hitTables
} from '../helpers/testUtils.js';
import { PHASES } from '../../src/models/GameState.js';

describe('Integration: Full Turn Simulation', () => {
  it('completes a full turn cycle through all phases without errors', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    // Override dice to avoid infinite loop in initiative tie-breaking
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    // Explicitly enter initiative to trigger initiative roll
    engine.phaseManager.enterPhase('initiative');

    const phaseHistory = [];
    engine.eventBus.on('phaseChanged', (data) => {
      phaseHistory.push(data.phase);
    });

    // Phase 1: Initiative (already entered)
    expect(engine.phaseManager.currentPhase).toBe('initiative');

    // End initiative -> movement
    const initResult = engine.processAction(0, { type: 'endPhase' });
    expect(initResult.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('movement');

    // Phase 2: Movement - move atlas south (facing 3 = south, no turning cost)
    // _enterMovement builds a queue. Clear it so we can set currentPlayer manually.
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    const moveResult = engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });
    expect(moveResult.success).toBe(true);

    // End movement -> weapon_attack (player 0 is current)
    const endMoveResult = engine.processAction(0, { type: 'endPhase' });
    expect(endMoveResult.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');

    // Phase 3: Weapon Attack - end without firing
    // _enterWeaponAttack sets currentPlayer to initiative loser (player 1)
    const endWeaponResult = engine.processAction(1, { type: 'endPhase' });
    expect(endWeaponResult.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('physical_attack');

    // Phase 4: Physical Attack - end without attacking
    // _enterPhysicalAttack sets currentPlayer to initiative winner (player 0)
    const endPhysResult = engine.processAction(0, { type: 'endPhase' });
    expect(endPhysResult.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('heat');

    // Phase 5: Heat - end phase triggers heat resolution (any player can end)
    const endHeatResult = engine.processAction(0, { type: 'endPhase' });
    expect(endHeatResult.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('end');

    // Phase 6: End - advance to next turn
    const endTurnResult = engine.processAction(0, { type: 'endPhase' });
    expect(endTurnResult.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(engine.stateManager.getState().turn).toBe(2);

    // Verify all phases were visited
    expect(phaseHistory).toContain('movement');
    expect(phaseHistory).toContain('weapon_attack');
    expect(phaseHistory).toContain('physical_attack');
    expect(phaseHistory).toContain('heat');
    expect(phaseHistory).toContain('end');
    expect(phaseHistory).toContain('initiative');
  });

  it('tracks heat correctly through weapon fire and heat phase', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 0 };
    jenner.position = { hexKey: '6,7', facing: 3 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    // Skip to weapon_attack phase
    engine.phaseManager.enterPhase('weapon_attack');
    engine.stateManager.getState().currentPlayer = 0;

    // Fire a medium laser (3 heat)
    const medLaser = createWeaponDef('med_laser');
    const fireResult = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });
    expect(fireResult).toBeDefined();
    expect(atlas.heat).toBe(3);

    // End weapon phase, skip physical, enter heat
    engine.phaseManager.enterPhase('heat');
    const endHeatResult = engine.processAction(0, { type: 'endPhase' });
    expect(endHeatResult.success).toBe(true);

    // Atlas has 20 single heat sinks, so 3 heat should be fully dissipated
    expect(atlas.heat).toBe(0);
  });

  it('records action log through the turn', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    engine.phaseManager.enterPhase('initiative');
    engine.processAction(0, { type: 'endPhase' }); // initiative -> movement
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });
    engine.processAction(0, { type: 'endPhase' });

    expect(engine.actionLog.length).toBeGreaterThanOrEqual(3);
    expect(engine.actionLog[0].action.type).toBe('endPhase');
    expect(engine.actionLog[1].action.type).toBe('move');
  });

  it('emits events during turn progression', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    // Override dice to avoid infinite loop in initiative tie-breaking
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    const events = [];
    engine.eventBus.on('phaseChanged', () => events.push('phaseChanged'));
    engine.eventBus.on('initiativeRolled', () => events.push('initiativeRolled'));
    engine.eventBus.on('movementPhase', () => events.push('movementPhase'));
    engine.eventBus.on('actionProcessed', () => events.push('actionProcessed'));

    // Must explicitly enter initiative to trigger _enterInitiative hooks
    engine.phaseManager.enterPhase('initiative');
    engine.processAction(0, { type: 'endPhase' }); // initiative -> movement

    expect(events).toContain('phaseChanged');
    expect(events).toContain('initiativeRolled');
    expect(events).toContain('movementPhase');
    expect(events).toContain('actionProcessed');
  });
});
