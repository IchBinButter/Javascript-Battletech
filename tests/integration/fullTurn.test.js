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

    // Physical attack: p12 repeats the steps of the Weapon Attack Phase, so
    // the initiative loser (P1=jenner) declares first
    const physQueue = engine.phaseManager.phaseUnitQueue;
    expect(physQueue[0].playerId).toBe(1);

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

  it('has no winner-goes-first choice: the initiative loser acts first (p10)', () => {
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

    // H-11: p10 gives the winner no phase-order choice - "The side that lost
    // Initiative must act first." - so the old house rule is gone.
    expect(engine.phaseManager.chooseInitiative).toBeUndefined();
    expect('initiativeWinnerGoesFirst' in engine.phaseManager).toBe(false);

    // End initiative -> movement
    engine.processAction(0, { type: 'endPhase' });

    // The loser (P1) declares first.
    const moveQueue = engine.phaseManager.phaseUnitQueue;
    expect(moveQueue[0].playerId).toBe(1);
    expect(moveQueue[0].unitId).toBe('jenner-1');
    expect(moveQueue[1].playerId).toBe(0);
    expect(moveQueue[1].unitId).toBe('atlas-0');

    // Player 1 moves jenner first
    const jennerMove = engine.processAction(1, {
      type: 'move',
      unitId: 'jenner-1',
      path: ['10,7', '10,8'],
      movementType: 'walk'
    });
    expect(jennerMove.success).toBe(true);

    // Player 0 moves atlas second; advances to weapon_attack
    const atlasMove = engine.processAction(0, {
      type: 'move',
      unitId: 'atlas-0',
      path: ['5,7', '5,8'],
      movementType: 'walk'
    });
    expect(atlasMove.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');

    // The Weapon Attack Phase repeats the loser-first order (p10).
    const weaponQueue = engine.phaseManager.phaseUnitQueue;
    expect(weaponQueue[0].playerId).toBe(1);
    expect(weaponQueue[0].unitId).toBe('jenner-1');
    expect(weaponQueue[1].playerId).toBe(0);
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

  it('a pilot knocked unconscious on an earlier turn recovers in the End Phase', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.pilot.hits = 3; // p58: a 7+ brings this warrior back
    atlas.pilot.conscious = false;
    atlas.pilot.unconsciousTurn = 0; // lost consciousness before this turn

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    const regained = [];
    engine.eventBus.on('pilotRegainedConsciousness', (data) => {
      regained.push(data);
    });

    // Roll 6 (< 7): the warrior stays out.
    engine.diceRoller = makeDiceRoller(6);
    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(regained).toHaveLength(0);

    // Roll 7: exactly the consciousness number for 3 points of damage.
    engine.diceRoller = makeDiceRoller(7);
    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
    expect(regained).toHaveLength(1);
    expect(regained[0]).toMatchObject({ unitId: 'atlas-0', roll: 7, target: 7, hits: 3 });
  });

  it('a pilot with six hits is dead and the Mech leaves play', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.pilot.hits = 5; // p58: the sixth point of damage kills

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    const killed = [];
    const removed = [];
    engine.eventBus.on('pilotKilled', (data) => killed.push(data));
    engine.eventBus.on('unitRemoved', (data) => removed.push(data));

    // The sixth point of MechWarrior damage kills outright; it is not an
    // "automatically unconscious" result.
    const hitsBefore = atlas.pilot.hits;
    atlas.applyPilotDamage(1);
    engine.rollConsciousnessForNewPilotHits(atlas, hitsBefore);

    expect(atlas.pilot.hits).toBe(6);
    expect(atlas.pilot.dead).toBe(true);
    expect(atlas.pilot.conscious).toBe(false);
    expect(killed).toHaveLength(1);

    // p58: the 'Mech is removed in the End Phase of the turn the warrior died.
    engine.phaseManager.enterPhase('end');

    expect(engine.stateManager.getState().getUnit('atlas-0')).toBeNull();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ unitId: 'atlas-0', playerId: 0 });
  });

  it('restarts a shut-down Mech in the Heat Phase when below 14 heat', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.shutdown = true;
    atlas.heat = 10; // heat dissipates below 14 in the Heat Phase

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    engine.diceRoller = makeDiceRoller(7);

    const restartEvents = [];
    engine.eventBus.on('unitRestarted', (data) => {
      restartEvents.push(data);
    });

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(false);
    expect(restartEvents.length).toBe(1);
    expect(restartEvents[0]).toMatchObject({ unitId: 'atlas-0', auto: true });
  });

  it('a high-heat restart must beat the current shutdown-avoid target', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.shutdown = true;
    atlas.heat = atlas.getHeatDissipation() + 14; // 14 heat left: avoid on 4+

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    // Roll 3: fails both the shutdown-avoid check and the a 4+ restart.
    engine.diceRoller = makeDiceRoller(3);

    const failEvents = [];
    engine.eventBus.on('unitRestartFailed', (data) => {
      failEvents.push(data);
    });

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(14);
    expect(atlas.shutdown).toBe(true);
    expect(failEvents.length).toBe(1);
    expect(failEvents[0]).toMatchObject({ unitId: 'atlas-0', roll: 3, target: 4 });
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

  // ==========================================================
  // Jump landing facing (p18) - engine wiring
  // ==========================================================
  describe('jump landing facing through the engine', () => {
    function jumpEngine() {
      const jumper = createTestUnit('jenner-jr7d', 0, 'jumper');
      jumper.position = { hexKey: '5,5', facing: 0 };
      const engine = createTestEngine({ units: { jumper } });
      engine.phaseManager.enterPhase('movement');
      engine.phaseManager.clearQueue();
      engine.stateManager.getState().currentPlayer = 0;
      return { engine, jumper };
    }

    function jump(engine, extra = {}) {
      return engine.processAction(0, {
        type: 'move',
        unitId: 'jumper',
        path: ['5,5', '5,6', '5,7'],
        movementType: 'jump',
        ...extra
      });
    }

    it('lands facing the hexside chosen in the move action', () => {
      const { engine, jumper } = jumpEngine();
      // The last hop points S (3); p18 lets the player land facing SW (4).
      const result = jump(engine, { landingFacing: 4 });

      expect(result.success).toBe(true);
      expect(result.facing).toBe(4);
      expect(result.landingFacing).toBe(4);
      expect(jumper.position).toEqual({ hexKey: '5,7', facing: 4 });
      expect(jumper.hexesMoved).toBe(2);
    });

    it('defaults to the take-off facing when the action omits the choice', () => {
      const { engine, jumper } = jumpEngine();
      const result = jump(engine);

      expect(result.success).toBe(true);
      expect(result.facing).toBe(0); // take-off facing, not the last hop (3)
      expect(result.landingFacing).toBe(0);
      expect(jumper.position).toEqual({ hexKey: '5,7', facing: 0 });
    });

    it('keeps ground moves deriving facing from the last hex entered', () => {
      const { engine, jumper } = jumpEngine();
      // p18 only changes jumping; a walk still turns into the direction moved.
      const result = engine.processAction(0, {
        type: 'move',
        unitId: 'jumper',
        path: ['5,5', '5,6'],
        movementType: 'walk',
        landingFacing: 4 // ignored for ground movement
      });

      expect(result.success).toBe(true);
      expect(result.facing).toBe(3); // S
      expect(result.landingFacing).toBeUndefined(); // jump-only field
      expect(jumper.position).toEqual({ hexKey: '5,6', facing: 3 });
    });
  });
});
