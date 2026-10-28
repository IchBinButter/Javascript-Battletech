import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  makeDiceRoller,
  makeSequencedDiceRoller,
  advanceToPhase
} from '../helpers/testUtils.js';

describe('Integration: Full Turn Simulation', () => {
  it('completes a full turn cycle with per-unit alternation', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    const phaseHistory = [];
    engine.eventBus.on('phaseChanged', (data) => {
      phaseHistory.push(data.phase);
    });

    // Phase 1: Initiative
    engine.phaseManager.enterPhase('initiative');
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(0);

    // End initiative -> movement (builds per-unit alternating queue)
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('movement');

    const moveQueue = engine.phaseManager.phaseUnitQueue;
    expect(moveQueue.length).toBe(2);
    // Default: initiative winner (P0) goes LAST, loser (P1) goes FIRST
    expect(moveQueue[0].playerId).toBe(1);
    expect(moveQueue[0].unitId).toBe('jenner-1');
    expect(moveQueue[1].playerId).toBe(0);
    expect(moveQueue[1].unitId).toBe('atlas-0');

    // Player 1 moves jenner (first in queue)
    const jennerMove = engine.processAction(1, {
      type: 'move',
      unitId: 'jenner-1',
      path: ['10,7', '10,8'],
      movementType: 'walk'
    });
    expect(jennerMove.success).toBe(true);

    // Queue auto-advances; player 0 moves atlas (second in queue)
    const atlasMove = engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });
    expect(atlasMove.success).toBe(true);

    // Queue exhausted after last unit -> auto-advance to weapon_attack
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');

    // Skip weapon fire; endPhase -> physical_attack
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('physical_attack');

    // Physical attack: winner goes first (P0=atlas first, P1=jenner second)
    const physQueue = engine.phaseManager.phaseUnitQueue;
    expect(physQueue[0].playerId).toBe(0);

    // Skip physical attacks; endPhase -> heat (auto-resolve)
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('heat');

    // Heat auto-resolved by _enterHeatPhase; endPhase -> end
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('end');

    // End phase (checks/cleanup); endPhase -> new turn
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(engine.stateManager.getState().turn).toBe(2);

    // Verify all phases visited
    for (const p of ['movement', 'weapon_attack', 'physical_attack', 'heat', 'end', 'initiative']) {
      expect(phaseHistory).toContain(p);
    }
  });

  it('respects initiative winner choice to go first', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    // P0 rolls 8, P1 rolls 5 -> P0 wins initiative
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(0);

    // Winner chooses to go FIRST instead of last
    engine.phaseManager.chooseInitiative(true);
    expect(engine.phaseManager.initiativeWinnerGoesFirst).toBe(true);

    // End initiative -> movement
    engine.processAction(0, { type: 'endPhase' });

    // With goFirst=true, winner (P0) moves first
    const moveQueue = engine.phaseManager.phaseUnitQueue;
    expect(moveQueue[0].playerId).toBe(0);
    expect(moveQueue[0].unitId).toBe('atlas-0');
    expect(moveQueue[1].playerId).toBe(1);
    expect(moveQueue[1].unitId).toBe('jenner-1');

    // Player 0 moves atlas first
    const atlasMove = engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });
    expect(atlasMove.success).toBe(true);

    // Player 1 moves jenner second; advances to weapon_attack
    const jennerMove = engine.processAction(1, {
      type: 'move',
      unitId: 'jenner-1',
      path: ['10,7', '10,8'],
      movementType: 'walk'
    });
    expect(jennerMove.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');

    // Weapon attack phase also respects goFirst choice
    const weaponQueue = engine.phaseManager.phaseUnitQueue;
    expect(weaponQueue[0].playerId).toBe(0);
    expect(weaponQueue[0].unitId).toBe('atlas-0');
  });

  it('auto-resolves heat during heat phase', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.heat = 8;

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    const heatEvents = [];
    engine.eventBus.on('heatResolved', (results) => {
      heatEvents.push(results);
    });

    // Enter heat phase triggers auto-resolution
    engine.phaseManager.enterPhase('heat');
    expect(engine.phaseManager.currentPhase).toBe('heat');

    // Heat should be dissipated (20 single heat sinks -> dissipates 20)
    expect(atlas.heat).toBe(0);
    expect(heatEvents.length).toBe(1);
    expect(heatEvents[0].length).toBe(1);
    expect(heatEvents[0][0].unitId).toBe('atlas-0');
  });

  it('auto-resolves heat with shutdown check when remaining heat >= 20', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    // Atlas has 20 single heat sinks. Set heat to 40 so after
    // dissipating 20, 20 remains -> shutdown check at avoid target 6+.
    atlas.heat = 40;

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    // Roll low (2): fails the shutdown check (avoid on 6+)
    engine.diceRoller = makeDiceRoller(2);

    const heatResults = [];
    engine.eventBus.on('heatResolved', (results) => {
      heatResults.push(results);
    });

    engine.phaseManager.enterPhase('heat');

    // 40 heat - 20 dissipation = 20 remaining
    expect(atlas.heat).toBe(20);
    expect(atlas.shutdown).toBe(true);
    expect(heatResults.length).toBe(1);
    expect(heatResults[0][0].effects).toContain('Unit SHUTDOWN (rolled 2, needed 6+)');
  });

  it('handles consciousness checks in end phase', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.pilot.hits = 3; // target 7

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    // Roll 6 (< 7): pilot goes unconscious
    engine.diceRoller = makeDiceRoller(6);

    const unconsciousEvents = [];
    engine.eventBus.on('pilotUnconscious', (data) => {
      unconsciousEvents.push(data);
    });

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(unconsciousEvents.length).toBe(1);
    expect(unconsciousEvents[0].unitId).toBe('atlas-0');
    expect(unconsciousEvents[0].roll).toBe(6);
    expect(unconsciousEvents[0].target).toBe(7);
    expect(unconsciousEvents[0].hits).toBe(3);
    expect(unconsciousEvents[0].auto).toBe(false);
  });

  it('a pilot with six hits is out of the fight', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.pilot.hits = 6; // p58: the sixth point of damage kills

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    const unconsciousEvents = [];
    engine.eventBus.on('pilotUnconscious', (data) => {
      unconsciousEvents.push(data);
    });

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(unconsciousEvents.length).toBe(1);
    expect(unconsciousEvents[0].auto).toBe(true);
  });

  it('handles shutdown restart in end phase', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.shutdown = true;

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    // Roll 9 (>= 8): restart succeeds
    engine.diceRoller = makeDiceRoller(9);

    const restartEvents = [];
    engine.eventBus.on('unitRestarted', (data) => {
      restartEvents.push(data);
    });

    engine.phaseManager.enterPhase('end');

    expect(atlas.shutdown).toBe(false);
    expect(restartEvents.length).toBe(1);
    expect(restartEvents[0].unitId).toBe('atlas-0');
    expect(restartEvents[0].roll).toBe(9);
  });

  it('handles failed shutdown restart in end phase', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.shutdown = true;

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    // Roll 7 (< 8): restart fails
    engine.diceRoller = makeDiceRoller(7);

    const failEvents = [];
    engine.eventBus.on('unitRestartFailed', (data) => {
      failEvents.push(data);
    });

    engine.phaseManager.enterPhase('end');

    // Shutdown persists since roll < 8
    expect(atlas.shutdown).toBe(true);
    expect(failEvents.length).toBe(1);
    expect(failEvents[0].unitId).toBe('atlas-0');
    expect(failEvents[0].roll).toBe(7);
  });

  it('re-seeds dice roller at new turn', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    const initialDice = engine.diceRoller;

    // Use sequenced dice to guarantee distinct initiative rolls per turn
    engine.diceRoller = makeSequencedDiceRoller([10, 3]);

    advanceToPhase(engine, 'initiative');
    // Fast-forward to end phase
    engine.processAction(0, { type: 'endPhase' }); // init -> move
    engine.processAction(0, { type: 'endPhase' }); // move -> weapon (clears move queue)
    engine.processAction(0, { type: 'endPhase' }); // weapon -> phys (clears weapon queue)
    engine.processAction(0, { type: 'endPhase' }); // phys -> heat
    engine.processAction(0, { type: 'endPhase' }); // heat -> end

    const diceBeforeNewTurn = engine.diceRoller;

    // End phase -> new turn (dice re-seeded)
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.stateManager.getState().turn).toBe(2);

    // Dice roller instance is replaced
    expect(engine.diceRoller).not.toBe(diceBeforeNewTurn);
    expect(engine.diceRoller).not.toBe(initialDice);
  });

  it('completes multiple turn cycles', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    // Dice: P0 always wins initiative (rolls higher)
    engine.diceRoller = makeSequencedDiceRoller([9, 4]);
    advanceToPhase(engine, 'initiative');

    const turnCountBefore = engine.stateManager.getState().turn;

    // Helper: process one full turn
    const runFullTurn = () => {
      // Initiative -> movement
      engine.processAction(0, { type: 'endPhase' });

      // Movement: each unit moves in queue order
      const moveQ = engine.phaseManager.phaseUnitQueue;
      for (const entry of moveQ) {
        const unit = engine.stateManager.getState().getUnit(entry.unitId);
        const [col, row] = unit.position.hexKey.split(',').map(Number);
        engine.processAction(entry.playerId, {
          type: 'move',
          unitId: entry.unitId,
          path: [unit.position.hexKey, `${col},${row + 1}`],
          movementType: 'walk'
        });
      }

      // Weapon attack -> physical attack
      engine.processAction(0, { type: 'endPhase' });
      // Physical attack -> heat
      engine.processAction(0, { type: 'endPhase' });
      // Heat -> end
      engine.processAction(0, { type: 'endPhase' });
      // End -> initiative (new turn)
      engine.processAction(0, { type: 'endPhase' });
    };

    // Run 3 turns
    runFullTurn();
    expect(engine.stateManager.getState().turn).toBe(turnCountBefore + 1);

    runFullTurn();
    expect(engine.stateManager.getState().turn).toBe(turnCountBefore + 2);

    runFullTurn();
    expect(engine.stateManager.getState().turn).toBe(turnCountBefore + 3);
    expect(engine.phaseManager.currentPhase).toBe('initiative');
  });

  it('handles end phase cleanup: resets movement modifiers, torso twist, arms reversed', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas._movementModifier = 2;
    atlas._targetMovementModifier = 3;
    atlas.torsoTwist = 1;
    atlas.armsReversed = true;
    atlas.hexesMoved = 5;
    atlas.movementMode = 'run';

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    advanceToPhase(engine, 'end');

    expect(atlas._movementModifier).toBe(0);
    expect(atlas._targetMovementModifier).toBe(0);
    expect(atlas.torsoTwist).toBe(0);
    expect(atlas.armsReversed).toBe(false);
    expect(atlas.hexesMoved).toBe(0);
    expect(atlas.movementMode).toBe('walk');
  });

  it('records action log through the turn', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    advanceToPhase(engine, 'initiative');
    engine.processAction(0, { type: 'endPhase' }); // init -> movement

    engine.processAction(1, {
      type: 'move',
      unitId: 'jenner-1',
      path: ['10,7', '10,8'],
      movementType: 'walk'
    });
    engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });

    expect(engine.actionLog.length).toBeGreaterThanOrEqual(3);
    expect(engine.actionLog[0].action.type).toBe('endPhase');
    expect(engine.actionLog[1].action.type).toBe('move');
    expect(engine.actionLog[2].action.type).toBe('move');
  });

  it('emits events during turn progression', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 3 };
    jenner.position = { hexKey: '10,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    const events = [];
    engine.eventBus.on('phaseChanged', () => events.push('phaseChanged'));
    engine.eventBus.on('initiativeRolled', () => events.push('initiativeRolled'));
    engine.eventBus.on('movementPhase', () => events.push('movementPhase'));
    engine.eventBus.on('actionProcessed', () => events.push('actionProcessed'));

    advanceToPhase(engine, 'initiative');
    engine.processAction(0, { type: 'endPhase' }); // init -> movement
    engine.processAction(1, {
      type: 'move',
      unitId: 'jenner-1',
      path: ['10,7', '10,8'],
      movementType: 'walk'
    });

    expect(events).toContain('phaseChanged');
    expect(events).toContain('initiativeRolled');
    expect(events).toContain('movementPhase');
    expect(events).toContain('actionProcessed');
  });
});
