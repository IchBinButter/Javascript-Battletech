import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  makeDiceRoller,
  makeSequencedDiceRoller
} from '../helpers/testUtils.js';
import { PHASES } from '../../src/models/GameState.js';

function createTwoMechEngine(opts = {}) {
  const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
  const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
  atlas.position = opts.atlasHex ? { hexKey: opts.atlasHex, facing: 3 } : { hexKey: '5,7', facing: 3 };
  jenner.position = opts.jennerHex ? { hexKey: opts.jennerHex, facing: 3 } : { hexKey: '10,7', facing: 3 };

  const engine = createTestEngine({
    units: { 'atlas-0': atlas, 'jenner-1': jenner }
  });

  return { engine, atlas, jenner };
}

function createThreeMechEngine() {
  const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
  const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
  const wolverine = createTestUnit('wolverine-wvr6r', 0, 'wolverine-0');
  atlas.position = { hexKey: '5,7', facing: 3 };
  jenner.position = { hexKey: '10,7', facing: 3 };
  wolverine.position = { hexKey: '6,7', facing: 1 };

  const engine = createTestEngine({
    units: { 'atlas-0': atlas, 'jenner-1': jenner, 'wolverine-0': wolverine }
  });

  return { engine, atlas, jenner, wolverine };
}

// =============================================================================
// Per-Unit Alternation Queue
// =============================================================================

describe('PhaseManager: Per-Unit Alternation Queue', () => {
  describe('buildUnitQueue', () => {
    it('creates alternating entries from two players with even unit counts', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');

      const players = engine.stateManager.getState().players;
      const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

      expect(queue).toHaveLength(2);
      expect(queue[0]).toEqual({ playerId: 1, unitId: 'jenner-1' });
      expect(queue[1]).toEqual({ playerId: 0, unitId: 'atlas-0' });
    });

    it('alternates with uneven unit counts', () => {
      const { engine } = createThreeMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');

      const players = engine.stateManager.getState().players;
      const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

      expect(queue).toHaveLength(3);
      expect(queue[0]).toEqual({ playerId: 1, unitId: 'jenner-1' });
      expect(queue[1]).toEqual({ playerId: 0, unitId: 'atlas-0' });
      expect(queue[2]).toEqual({ playerId: 0, unitId: 'wolverine-0' });
    });

    it('returns empty queue when both players have no units', () => {
      const engine = createTestEngine({ units: {} });
      const players = engine.stateManager.getState().players;
      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);
      expect(queue).toHaveLength(0);
    });

    it('returns only first player units when second has none', () => {
      const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
      atlas.position = { hexKey: '5,7', facing: 0 };
      const engine = createTestEngine({
        units: { 'atlas-0': atlas },
        players: [{ id: 0, name: 'Player 1' }, { id: 1, name: 'Player 2' }]
      });
      const players = engine.stateManager.getState().players;
      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);
      expect(queue).toHaveLength(1);
      expect(queue[0].unitId).toBe('atlas-0');
    });
  });

  describe('phase entry queue building', () => {
    it('_enterMovement builds queue with loser first by default', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue).toHaveLength(2);
      expect(queue[0].playerId).toBe(1);
      expect(queue[1].playerId).toBe(0);
    });

    it('_enterMovement builds queue with winner first when chosen', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.chooseInitiative(true);
      engine.phaseManager.enterPhase('movement');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue).toHaveLength(2);
      expect(queue[0].playerId).toBe(0);
      expect(queue[1].playerId).toBe(1);
    });

    it('_enterWeaponAttack builds queue respecting initiative choice', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.chooseInitiative(true);
      engine.phaseManager.enterPhase('weapon_attack');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue[0].playerId).toBe(0);
      expect(queue[1].playerId).toBe(1);
    });

    it('_enterPhysicalAttack builds queue with winner first (ignores initiative choice)', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.chooseInitiative(true);
      engine.phaseManager.enterPhase('physical_attack');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue[0].playerId).toBe(0);
      expect(queue[1].playerId).toBe(1);
    });

    it('_enterMovement sets currentPlayer from queue', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const state = engine.stateManager.getState();
      expect(state.currentPlayer).toBe(1);
    });

    it('_enterMovement resets movement mode so MP derives from walk again', () => {
      const { engine, atlas, jenner } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      atlas.movementMode = 'jump';
      jenner.movementMode = 'run';
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      expect(atlas.movementMode).toBe('walk');
      expect(jenner.movementMode).toBe('walk');
      expect(atlas.currentMP).toBe(atlas.movement.walk);
      expect(jenner.currentMP).toBe(jenner.movement.walk);
    });

    it('_enterMovement emits movementPhase event with queue', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');

      const events = [];
      engine.eventBus.on('movementPhase', (data) => events.push(data));
      engine.phaseManager.enterPhase('movement');

      expect(events).toHaveLength(1);
      expect(events[0].queue).toEqual(engine.phaseManager.phaseUnitQueue);
    });
  });

  describe('phaseUnitIndex tracking and advancement', () => {
    it('advanceQueue moves to next entry and updates currentPlayer', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      expect(engine.phaseManager.phaseUnitIndex).toBe(0);
      const state = engine.stateManager.getState();
      expect(state.currentPlayer).toBe(1);

      const done = engine.phaseManager.advanceQueue();
      expect(done).toBe(false);
      expect(engine.phaseManager.phaseUnitIndex).toBe(1);
      expect(state.currentPlayer).toBe(0);
    });

    it('advanceQueue returns true when queue exhausted', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      engine.phaseManager.phaseUnitIndex = 1;
      const done = engine.phaseManager.advanceQueue();
      expect(done).toBe(true);
      expect(engine.phaseManager.getCurrentQueueEntry()).toBeNull();
    });

    it('advanceQueue does NOT emit queueAdvanced when exhausted', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      engine.phaseManager.phaseUnitIndex = 1;
      const events = [];
      engine.eventBus.on('queueAdvanced', (data) => events.push(data));

      const done = engine.phaseManager.advanceQueue();
      expect(done).toBe(true);
      expect(events).toHaveLength(0);
    });

    it('advanceQueue returns false on empty queue', () => {
      const { engine } = createTwoMechEngine();
      expect(engine.phaseManager.advanceQueue()).toBe(false);
    });

    it('getCurrentQueueEntry returns null when queue is empty', () => {
      const { engine } = createTwoMechEngine();
      expect(engine.phaseManager.getCurrentQueueEntry()).toBeNull();
    });

    it('getCurrentQueueEntry returns null when index is past end', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');
      engine.phaseManager.phaseUnitIndex = 5;
      expect(engine.phaseManager.getCurrentQueueEntry()).toBeNull();
    });

    it('advanceQueue emits queueAdvanced event with new entry', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const events = [];
      engine.eventBus.on('queueAdvanced', (data) => events.push(data));

      engine.phaseManager.advanceQueue();

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ playerId: 0, unitId: 'atlas-0' });
    });

    it('advanceQueueOrNextPhase auto-advances phase when queue exhausted', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      engine.phaseManager.phaseUnitIndex = 1;
      const advanced = engine.phaseManager.advanceQueueOrNextPhase();
      expect(advanced).toBe(true);
      expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
    });

    it('advanceQueueOrNextPhase does not advance phase when queue has more entries', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const advanced = engine.phaseManager.advanceQueueOrNextPhase();
      expect(advanced).toBe(false);
      expect(engine.phaseManager.currentPhase).toBe('movement');
    });

    it('clearQueue resets queue and index', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      expect(engine.phaseManager.phaseUnitQueue).toHaveLength(2);
      engine.phaseManager.clearQueue();
      expect(engine.phaseManager.phaseUnitQueue).toHaveLength(0);
      expect(engine.phaseManager.phaseUnitIndex).toBe(0);
    });

    it('nextPhase calls clearQueue during transition', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      expect(engine.phaseManager.phaseUnitQueue).toHaveLength(2);

      const clearedCalls = [];
      const originalClearQueue = engine.phaseManager.clearQueue.bind(engine.phaseManager);
      engine.phaseManager.clearQueue = function () {
        clearedCalls.push(true);
        originalClearQueue();
      };

      engine.phaseManager.nextPhase();
      expect(clearedCalls).toHaveLength(1);
    });

    it('processAction advances queue on successful move', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const result = engine.processAction(1, {
        type: 'move',
        unitId: 'jenner-1',
        path: ['10,7', '10,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(true);
      const state = engine.stateManager.getState();
      expect(state.currentPlayer).toBe(0);
      expect(engine.phaseManager.phaseUnitIndex).toBe(1);
    });

    it('processAction rejects move for wrong unit in queue', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const result = engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not your turn');
    });

    it('processAction rejects fire for wrong unit in queue', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('weapon_attack');

      const result = engine.processAction(1, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: { id: 'med_laser', heat: 3 },
        weaponLocation: 'rightArm'
      });

      expect(result.success).toBe(false);
    });

    it('processAction auto-advances phase when queue exhausted after move', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      engine.processAction(1, {
        type: 'move',
        unitId: 'jenner-1',
        path: ['10,7', '10,8'],
        movementType: 'walk'
      });
      expect(engine.phaseManager.currentPhase).toBe('movement');

      const result = engine.processAction(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '5,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(true);
      expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
    });
  });
});

// =============================================================================
// Initiative Winner Choice
// =============================================================================

describe('PhaseManager: Initiative Winner Choice', () => {
  it('chooseInitiative sets the flag and emits event', () => {
    const { engine } = createTwoMechEngine();
    const events = [];
    engine.eventBus.on('initiativeChoice', (data) => events.push(data));

    engine.phaseManager.chooseInitiative(true);

    expect(engine.phaseManager.initiativeWinnerGoesFirst).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].goFirst).toBe(true);
  });

  it('chooseInitiative(false) sets flag to false', () => {
    const { engine } = createTwoMechEngine();
    engine.phaseManager.initiativeWinnerGoesFirst = true;
    engine.phaseManager.chooseInitiative(false);
    expect(engine.phaseManager.initiativeWinnerGoesFirst).toBe(false);
  });

  it('_enterInitiative resets choice to false at start of each turn', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    engine.phaseManager.chooseInitiative(true);
    expect(engine.phaseManager.initiativeWinnerGoesFirst).toBe(true);

    engine.phaseManager.enterPhase('initiative');
    expect(engine.phaseManager.initiativeWinnerGoesFirst).toBe(false);
  });

  it('default (no choice) means loser goes first in movement', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    const queue = engine.phaseManager.phaseUnitQueue;
    expect(queue[0].playerId).toBe(1);
  });

  it('when winner goes first, winner is first in queue', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.chooseInitiative(true);
    engine.phaseManager.enterPhase('movement');

    const queue = engine.phaseManager.phaseUnitQueue;
    expect(queue[0].playerId).toBe(0);
  });

  it('initiative winner is set on state after roll', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');

    const state = engine.stateManager.getState();
    expect(state.initiativeWinner).toBe(0);
  });

  it('emits initiativeRolled event with rolls and winner', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    const events = [];
    engine.eventBus.on('initiativeRolled', (data) => events.push(data));

    engine.phaseManager.enterPhase('initiative');

    expect(events).toHaveLength(1);
    expect(events[0].winner).toBe(0);
    expect(events[0].rolls).toHaveLength(2);
  });
});

// =============================================================================
// Consciousness Checks
// =============================================================================

describe('PhaseManager: Consciousness Checks', () => {
  it('conscious pilot with 0 hits passes with no roll', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.pilot.hits = 0;
    atlas.pilot.conscious = true;

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
    expect(uncons).toHaveLength(0);
  });

  it('pilot with 1 hit passes consciousness on roll >= 3', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    atlas.pilot.hits = 1;
    atlas.pilot.conscious = true;

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
  });

  it('pilot with 1 hit fails consciousness on roll < 3', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(2);
    atlas.pilot.hits = 1;
    atlas.pilot.conscious = true;

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(uncons).toHaveLength(1);
    expect(uncons[0].unitId).toBe('atlas-0');
    expect(uncons[0].target).toBe(3);
    expect(uncons[0].roll).toBe(2);
    expect(uncons[0].hits).toBe(1);
    expect(uncons[0].auto).toBe(false);
  });

  it('pilot with 2 hits has target 5', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(4);
    atlas.pilot.hits = 2;
    atlas.pilot.conscious = true;

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
  });

  it('pilot with 3 hits has target 7', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(6);
    atlas.pilot.hits = 3;
    atlas.pilot.conscious = true;

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
  });

  it('pilot with 4 hits has target 10', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(9);
    atlas.pilot.hits = 4;
    atlas.pilot.conscious = true;

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
  });

  it('pilot with 5 hits is automatically unconscious', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.pilot.hits = 5;
    atlas.pilot.conscious = true;

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(uncons).toHaveLength(1);
    expect(uncons[0].auto).toBe(true);
    expect(uncons[0].roll).toBe(0);
    expect(uncons[0].hits).toBe(5);
  });

  it('pilot with 6+ hits is automatically unconscious', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.pilot.hits = 6;
    atlas.pilot.conscious = true;

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
  });

  it('already unconscious pilot does not roll again', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.pilot.hits = 1;
    atlas.pilot.conscious = false;

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    engine.phaseManager.enterPhase('end');

    expect(uncons).toHaveLength(0);
  });

  it('checks consciousness for all units', () => {
    const { engine, atlas, jenner } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(2);
    atlas.pilot.hits = 1;
    atlas.pilot.conscious = true;
    jenner.pilot.hits = 1;
    jenner.pilot.conscious = true;

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    engine.phaseManager.enterPhase('end');

    expect(uncons).toHaveLength(2);
  });
});

// =============================================================================
// Shutdown Restart Checks
// =============================================================================

describe('PhaseManager: Shutdown Restart Checks', () => {
  it('shutdown unit restarts on roll >= 8', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    atlas.shutdown = true;

    const restarts = [];
    engine.eventBus.on('unitRestarted', (data) => restarts.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.shutdown).toBe(false);
    expect(restarts).toHaveLength(1);
    expect(restarts[0].unitId).toBe('atlas-0');
    expect(restarts[0].roll).toBe(8);
  });

  it('shutdown unit fails restart on roll < 8', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(7);
    atlas.shutdown = true;

    const fails = [];
    engine.eventBus.on('unitRestartFailed', (data) => fails.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.shutdown).toBe(true);
    expect(fails).toHaveLength(1);
    expect(fails[0].unitId).toBe('atlas-0');
    expect(fails[0].roll).toBe(7);
  });

  it('active unit does not trigger restart check', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.shutdown = false;

    const restarts = [];
    const fails = [];
    engine.eventBus.on('unitRestarted', (data) => restarts.push(data));
    engine.eventBus.on('unitRestartFailed', (data) => fails.push(data));

    engine.phaseManager.enterPhase('end');

    expect(restarts).toHaveLength(0);
    expect(fails).toHaveLength(0);
  });

  it('restart exactly at threshold 8 succeeds', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    atlas.shutdown = true;

    engine.phaseManager.enterPhase('end');

    expect(atlas.shutdown).toBe(false);
  });

  it('check restart for all shutdown units', () => {
    const { engine, atlas, jenner } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(7);
    atlas.shutdown = true;
    jenner.shutdown = true;

    const fails = [];
    engine.eventBus.on('unitRestartFailed', (data) => fails.push(data));

    engine.phaseManager.enterPhase('end');

    expect(fails).toHaveLength(2);
  });
});

// =============================================================================
// Auto-Heat Resolution
// =============================================================================

describe('PhaseManager: Auto-Heat Resolution', () => {
  it('_enterHeatPhase resolves heat without requiring an action', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
    atlas.heat = 10;

    const heatResolved = [];
    const heatPhaseEvents = [];
    engine.eventBus.on('heatResolved', (data) => heatResolved.push(data));
    engine.eventBus.on('heatPhase', (data) => heatPhaseEvents.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(heatResolved).toHaveLength(1);
    expect(heatPhaseEvents).toHaveLength(1);
    expect(atlas.heat).toBeLessThan(10);
  });

  it('heat dissipation reduces heat by unit heat sinks', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
    atlas.heat = 20;
    const sinksBefore = atlas.getHeatDissipation();

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(20 - sinksBefore);
  });

  it('heat resolved event contains results for all units', () => {
    const { engine, atlas, jenner } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5]);
    atlas.heat = 15;
    jenner.heat = 5;

    const heatResolved = [];
    engine.eventBus.on('heatResolved', (data) => heatResolved.push(data));

    engine.phaseManager.enterPhase('heat');

    const result = heatResolved[0];
    expect(Array.isArray(result)).toBe(true);
    expect(result.find(r => r.unitId === 'atlas-0')).toBeDefined();
    expect(result.find(r => r.unitId === 'jenner-1')).toBeDefined();
  });

  it('heat cannot go below 0', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
    atlas.heat = 1;

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(0);
  });

  it('heat phase sets game phase to heat', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('heat');

    expect(engine.stateManager.getState().phase).toBe('heat');
  });

  it('shutdown unit at high heat (20+) triggers shutdown check via heat phase', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([2, 5, 8, 5]); // low roll for shutdown
    atlas.heat = 23;

    engine.phaseManager.enterPhase('heat');

    const heatResolved = [];
    engine.eventBus.on('heatResolved', (data) => heatResolved.push(data));
  });
});

// =============================================================================
// Dice Re-Seeding
// =============================================================================

describe('PhaseManager: Dice Re-Seeding', () => {
  it('re-seeds dice roller when starting a new turn', () => {
    const { engine } = createTwoMechEngine();
    const originalRoller = engine.diceRoller;

    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);
    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    expect(engine.stateManager.getState().turn).toBe(2);
    expect(engine.diceRoller).not.toBe(originalRoller);
  });

  it('uses turn number in dice seed for different rolls', () => {
    const { engine } = createTwoMechEngine();
    // Pin the game id: it normally contains Date.now(), so this test used to
    // compare two time-dependent seeds and failed whenever the first roll of
    // both streams happened to match. With a fixed id the turn number is the
    // only variable, which is what the test is about.
    engine.gameId = 'seed-test-game';

    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    engine.diceRoller.reset();
    const first = [1, 2, 3, 4].map(() => engine.diceRoller.roll2d6()).join(',');

    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    engine.diceRoller.reset();
    const second = [1, 2, 3, 4].map(() => engine.diceRoller.roll2d6()).join(',');

    expect(first).not.toBe(second);
  });

  it('new turn dice roller is a DiceRoller instance', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    expect(typeof engine.diceRoller.roll2d6).toBe('function');
    expect(typeof engine.diceRoller.reset).toBe('function');
  });
});

// =============================================================================
// Fire/Smoke Hex Timers
// =============================================================================

describe('PhaseManager: Fire/Smoke Hex Timers', () => {
  it('smoke hex timers decrement each end phase', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const state = engine.stateManager.getState();

    state.smokeHexes = {
      '10,5': { turnsRemaining: 3, level: 'heavy' },
      '11,5': { turnsRemaining: 2, level: 'light' }
    };

    engine.phaseManager.enterPhase('end');

    expect(state.smokeHexes['10,5'].turnsRemaining).toBe(2);
    expect(state.smokeHexes['11,5'].turnsRemaining).toBe(1);
  });

  it('smoke hex removed when turnsRemaining reaches 0', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const state = engine.stateManager.getState();

    state.smokeHexes = {
      '10,5': { turnsRemaining: 1, level: 'heavy' }
    };

    engine.phaseManager.enterPhase('end');

    expect(state.smokeHexes['10,5']).toBeUndefined();
    expect(Object.keys(state.smokeHexes)).toHaveLength(0);
  });

  it('smoke hex with exactly 1 turn remaining is removed after end phase', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const state = engine.stateManager.getState();

    state.smokeHexes = {
      '10,5': { turnsRemaining: 1, level: 'light' }
    };

    engine.phaseManager.enterPhase('end');

    expect(state.smokeHexes).toEqual({});
  });

  it('multiple smoke hexes decrement independently', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const state = engine.stateManager.getState();

    state.smokeHexes = {
      '10,5': { turnsRemaining: 1, level: 'heavy' },
      '12,3': { turnsRemaining: 3, level: 'light' }
    };

    engine.phaseManager.enterPhase('end');

    expect(state.smokeHexes['10,5']).toBeUndefined();
    expect(state.smokeHexes['12,3'].turnsRemaining).toBe(2);
  });

  it('smoke timer decrements each turn end phase', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const state = engine.stateManager.getState();

    state.smokeHexes = { '10,5': { turnsRemaining: 2, level: 'heavy' } };

    engine.phaseManager.enterPhase('end');
    expect(state.smokeHexes['10,5'].turnsRemaining).toBe(1);

    // Advance through new turn to next end phase
    for (let i = 0; i < PHASES.length - 1; i++) {
      engine.phaseManager.nextPhase();
    }
    // Now at end phase of the new turn, enter it
    engine.phaseManager.enterPhase('end');
    expect(state.smokeHexes['10,5']).toBeUndefined();
  });

  it('end phase resets unit state properties', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    atlas.torsoTwist = 2;
    atlas.armsReversed = true;
    atlas._movementModifier = 3;
    atlas._targetMovementModifier = 2;
    atlas.hexesMoved = 5;
    atlas.movementMode = 'jump';

    engine.phaseManager.enterPhase('end');

    expect(atlas.torsoTwist).toBe(0);
    expect(atlas.armsReversed).toBe(false);
    expect(atlas._movementModifier).toBe(0);
    expect(atlas._targetMovementModifier).toBe(0);
    expect(atlas.hexesMoved).toBe(0);
    expect(atlas.movementMode).toBe('walk');
  });

  it('end phase resets all units', () => {
    const { engine, atlas, jenner } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    atlas.torsoTwist = 2;
    jenner.torsoTwist = 2;
    atlas.hexesMoved = 5;
    jenner.hexesMoved = 7;

    engine.phaseManager.enterPhase('end');

    expect(atlas.torsoTwist).toBe(0);
    expect(jenner.torsoTwist).toBe(0);
    expect(atlas.hexesMoved).toBe(0);
    expect(jenner.hexesMoved).toBe(0);
  });

  it('end phase emits endPhase event', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const events = [];
    engine.eventBus.on('endPhase', (data) => events.push(data));

    engine.phaseManager.enterPhase('end');

    expect(events).toHaveLength(1);
  });

  it('no-op when smokeHexes is empty', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(8);
    const state = engine.stateManager.getState();
    state.smokeHexes = {};

    expect(() => engine.phaseManager.enterPhase('end')).not.toThrow();
    expect(Object.keys(state.smokeHexes)).toHaveLength(0);
  });
});

// =============================================================================
// Queue-Based Action Validation
// =============================================================================

describe('PhaseManager: Queue-Based Action Validation', () => {
  it('validates against queue entry when queue is active', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.validateAction('move', 1, 'jenner-1').valid).toBe(true);
    expect(engine.phaseManager.validateAction('move', 1, 'atlas-0').valid).toBe(false);
    expect(engine.phaseManager.validateAction('move', 0, 'atlas-0').valid).toBe(false);
  });

  it('falls back to currentPlayer when no queue', () => {
    const { engine } = createTwoMechEngine();
    const state = engine.stateManager.getState();
    state.phase = 'movement';
    state.currentPlayer = 0;

    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(true);
    expect(engine.phaseManager.validateAction('move', 1).valid).toBe(false);
  });

  it('selectUnit is not restricted to current queue unit', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.validateAction('selectUnit', 1, 'jenner-1').valid).toBe(true);
    expect(engine.phaseManager.validateAction('selectUnit', 0, 'atlas-0').valid).toBe(true);
  });

  it('endPhase is always valid regardless of queue or player', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.validateAction('endPhase', 0).valid).toBe(true);
    expect(engine.phaseManager.validateAction('endPhase', 1).valid).toBe(true);
    expect(engine.phaseManager.validateAction('endPhase', 99).valid).toBe(true);
  });

  it('move only valid in movement phase', () => {
    const { engine } = createTwoMechEngine();
    const state = engine.stateManager.getState();
    state.phase = 'weapon_attack';
    state.currentPlayer = 0;

    const result = engine.phaseManager.validateAction('move', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Only in movement phase');
  });

  it('fire only valid in weapon_attack phase', () => {
    const { engine } = createTwoMechEngine();
    const state = engine.stateManager.getState();
    state.phase = 'movement';
    state.currentPlayer = 0;

    const result = engine.phaseManager.validateAction('fire', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Only in weapon attack phase');
  });

  it('physicalAttack only valid in physical_attack phase', () => {
    const { engine } = createTwoMechEngine();
    const state = engine.stateManager.getState();
    state.phase = 'weapon_attack';
    state.currentPlayer = 0;

    const result = engine.phaseManager.validateAction('physicalAttack', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Only in physical attack phase');
  });

  it('confirmFacing only valid in movement phase', () => {
    const { engine } = createTwoMechEngine();
    const state = engine.stateManager.getState();
    state.phase = 'weapon_attack';
    state.currentPlayer = 0;

    const result = engine.phaseManager.validateAction('confirmFacing', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Only in movement phase');
  });

  it('unknown action type returns invalid', () => {
    const { engine } = createTwoMechEngine();
    const result = engine.phaseManager.validateAction('foobar', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Unknown action: foobar');
  });

  it('validates with no unitId against queue entry player match only', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.validateAction('move', 1).valid).toBe(true);
    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(false);
  });
});

// =============================================================================
// Full Turn Integration
// =============================================================================

describe('PhaseManager: Full Turn Integration', () => {
  it('completes full turn with per-unit alternation', () => {
    const { engine } = createTwoMechEngine({
      atlasHex: '5,7',
      jennerHex: '10,7'
    });
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    engine.phaseManager.enterPhase('initiative');
    expect(engine.phaseManager.currentPhase).toBe('initiative');

    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('movement');

    engine.processAction(1, {
      type: 'move', unitId: 'jenner-1',
      path: ['10,7', '10,8'], movementType: 'walk'
    });
    expect(engine.phaseManager.currentPhase).toBe('movement');

    engine.processAction(0, {
      type: 'move', unitId: 'atlas-0',
      path: ['5,7', '5,8'], movementType: 'walk'
    });
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');

    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('physical_attack');

    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('heat');

    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('end');

    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(engine.stateManager.getState().turn).toBe(2);
  });

  it('three-mech alternation handles uneven unit counts', () => {
    const { engine } = createThreeMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.phaseUnitQueue).toHaveLength(3);

    engine.processAction(1, {
      type: 'move', unitId: 'jenner-1',
      path: ['10,7', '10,8'], movementType: 'walk'
    });

    engine.processAction(0, {
      type: 'move', unitId: 'atlas-0',
      path: ['5,7', '5,8'], movementType: 'walk'
    });

    engine.processAction(0, {
      type: 'move', unitId: 'wolverine-0',
      path: ['6,7', '6,8'], movementType: 'walk'
    });
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
  });

  it('full turn advances all smoke hex timers', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);
    const state = engine.stateManager.getState();
    state.smokeHexes = { '10,5': { turnsRemaining: 3, level: 'heavy' } };

    // Enter initiative (doesn't affect smoke), then cycle through phases
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.enterPhase('physical_attack');
    engine.phaseManager.enterPhase('heat');
    // End phase decrements smoke
    engine.phaseManager.enterPhase('end');
    expect(state.smokeHexes['10,5'].turnsRemaining).toBe(2);
  });
});
