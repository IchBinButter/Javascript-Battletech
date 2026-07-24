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
  atlas.position = opts.atlasHex ? { hexKey: opts.atlasHex, facing: 0 } : { hexKey: '5,7', facing: 0 };
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
  atlas.position = { hexKey: '5,7', facing: 0 };
  jenner.position = { hexKey: '10,7', facing: 3 };
  wolverine.position = { hexKey: '6,7', facing: 1 };

  const engine = createTestEngine({
    units: { 'atlas-0': atlas, 'jenner-1': jenner, 'wolverine-0': wolverine }
  });

  return { engine, atlas, jenner, wolverine };
}

describe('PhaseManager: Per-Unit Queue System', () => {
  describe('phaseUnitQueue building', () => {
    it('buildUnitQueue creates alternating entries from two players', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');

      const players = engine.stateManager.getState().players;
      const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

      expect(queue).toHaveLength(2);
      expect(queue[0]).toEqual({ playerId: 1, unitId: 'jenner-1' });
      expect(queue[1]).toEqual({ playerId: 0, unitId: 'atlas-0' });
    });

    it('buildUnitQueue alternates with uneven unit counts', () => {
      const { engine } = createThreeMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');

      const players = engine.stateManager.getState().players;
      // player 0 has 2 units, player 1 has 1 unit
      const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

      expect(queue).toHaveLength(3);
      expect(queue[0]).toEqual({ playerId: 1, unitId: 'jenner-1' });
      expect(queue[1]).toEqual({ playerId: 0, unitId: 'atlas-0' });
      expect(queue[2]).toEqual({ playerId: 0, unitId: 'wolverine-0' });
    });

    it('_enterMovement builds queue with loser first by default', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue).toHaveLength(2);
      // Initiative winner = 0 (rolled 8), loser = 1 goes first
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

      // advance past last entry
      engine.phaseManager.phaseUnitIndex = 1;

      const advanced = engine.phaseManager.advanceQueueOrNextPhase();
      expect(advanced).toBe(true);
      expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
    });

    it('advanceQueueOrNextPhase does not advance phase when queue still has entries', () => {
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

    it('nextPhase clears the queue during transition', () => {
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
      // clearQueue was called during nextPhase transition
      expect(clearedCalls).toHaveLength(1);
    });

    it('processAction advances queue on successful move', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');
      // Loser (player 1) moves first

      const result = engine.processAction(1, {
        type: 'move',
        unitId: 'jenner-1',
        path: ['10,7', '10,8'],
        movementType: 'walk'
      });

      expect(result.success).toBe(true);
      // Queue should have advanced to winner (player 0)
      const state = engine.stateManager.getState();
      expect(state.currentPlayer).toBe(0);
      expect(engine.phaseManager.phaseUnitIndex).toBe(1);
    });

    it('processAction rejects move for wrong unit in queue', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');
      // Queue: [player1/jenner, player0/atlas]

      // Player 0 tries to move atlas but it's player 1's turn
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
      // Queue: [player1/jenner, player0/atlas]

      // Player 1 tries to fire from atlas (not their unit)
      const result = engine.processAction(1, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: { id: 'med_laser', heat: 3 },
        weaponLocation: 'rightArm'
      });

      // This should fail because atlas belongs to player 0, not player 1
      // Actually, let's check if the queue check catches it first
      expect(result.success).toBe(false);
    });

    it('processAction auto-advances phase when queue exhausted after move', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      // Player 1 (loser) moves jenner
      engine.processAction(1, {
        type: 'move',
        unitId: 'jenner-1',
        path: ['10,7', '10,8'],
        movementType: 'walk'
      });
      expect(engine.phaseManager.currentPhase).toBe('movement');

      // Player 0 moves atlas - queue should exhaust and auto-advance
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
    expect(queue[0].playerId).toBe(1); // loser
  });

  it('when winner goes first, winner is first in queue', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.chooseInitiative(true);
    engine.phaseManager.enterPhase('movement');

    const queue = engine.phaseManager.phaseUnitQueue;
    expect(queue[0].playerId).toBe(0); // winner
  });
});

describe('PhaseManager: Dice Roller Re-Seeding', () => {
  it('re-seeds dice roller when starting a new turn', () => {
    const { engine } = createTwoMechEngine();
    const originalRoller = engine.diceRoller;

    // Cycle through all phases and back to initiative (new turn)
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);
    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    // Now starting turn 2 - dice roller should be re-seeded
    expect(engine.stateManager.getState().turn).toBe(2);
    expect(engine.diceRoller).not.toBe(originalRoller);
  });

  it('uses turn number in dice seed', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    // Advance to turn 2
    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    // Reset and roll - should give deterministic values based on new seed
    engine.diceRoller.reset();
    const roll1 = engine.diceRoller.roll2d6();

    // Advance to turn 3
    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    engine.diceRoller.reset();
    const roll2 = engine.diceRoller.roll2d6();

    // Different turns should produce different seeds
    expect(roll1).not.toBe(roll2);
  });
});

describe('PhaseManager: Auto-Resolve Heat Phase', () => {
  it('_enterHeatPhase resolves heat without requiring an action', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);

    // Set up heat on a unit
    atlas.heat = 10;

    const heatResolved = [];
    const heatPhaseEvents = [];
    engine.eventBus.on('heatResolved', (data) => heatResolved.push(data));
    engine.eventBus.on('heatPhase', (data) => heatPhaseEvents.push(data));

    engine.phaseManager.enterPhase('heat');

    // Both events should fire
    expect(heatResolved).toHaveLength(1);
    expect(heatPhaseEvents).toHaveLength(1);

    // Heat should have been dissipated
    expect(atlas.heat).toBeLessThan(10);
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
});

describe('PhaseManager: Consciousness Checks', () => {
  it('conscious pilot passes check with no rolls', () => {
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
    // dice roller returns 8 always (2d6 = 8 from makeDiceRoller default)
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

  it('pilot with 5+ hits is automatically unconscious', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.pilot.hits = 5;
    atlas.pilot.conscious = true;

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(uncons).toHaveLength(1);
    expect(uncons[0].auto).toBe(true);
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
});

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
});

describe('PhaseManager: ValidateAction with Queue', () => {
  it('validates against queue entry when queue is active', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    // Queue: [player1/jenner, player0/atlas]
    // state.currentPlayer = 1

    // Player 1 moving jenner is valid (queue entry matches)
    expect(engine.phaseManager.validateAction('move', 1, 'jenner-1').valid).toBe(true);

    // Player 1 moving atlas is invalid (wrong unit for queue entry)
    expect(engine.phaseManager.validateAction('move', 1, 'atlas-0').valid).toBe(false);

    // Player 0 trying to act is invalid (not their turn in queue)
    expect(engine.phaseManager.validateAction('move', 0, 'atlas-0').valid).toBe(false);
  });

  it('falls back to currentPlayer when no queue', () => {
    const { engine } = createTwoMechEngine();
    const state = engine.stateManager.getState();
    state.phase = 'movement';
    state.currentPlayer = 0;
    // No queue built - falls back to currentPlayer

    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(true);
    expect(engine.phaseManager.validateAction('move', 1).valid).toBe(false);
  });

  it('selectUnit is not restricted to current queue unit', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    // Queue has player 1 at front

    // Player 1 can select their unit even for different actions
    expect(engine.phaseManager.validateAction('selectUnit', 1, 'jenner-1').valid).toBe(true);
  });

  it('endPhase is always valid regardless of queue or player', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    // Queue has player 1 first, but endPhase bypasses queue

    expect(engine.phaseManager.validateAction('endPhase', 0).valid).toBe(true);
    expect(engine.phaseManager.validateAction('endPhase', 1).valid).toBe(true);
    expect(engine.phaseManager.validateAction('endPhase', 99).valid).toBe(true);
  });
});

describe('PhaseManager: Full Turn Integration', () => {
  it('completes full turn with per-unit alternation', () => {
    const { engine } = createTwoMechEngine({
      atlasHex: '5,7',
      jennerHex: '10,7'
    });
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    engine.phaseManager.enterPhase('initiative');
    expect(engine.phaseManager.currentPhase).toBe('initiative');

    // End initiative
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('movement');

    // Movement: player 1 (loser) moves jenner
    engine.processAction(1, {
      type: 'move', unitId: 'jenner-1',
      path: ['10,7', '10,8'], movementType: 'walk'
    });
    expect(engine.phaseManager.currentPhase).toBe('movement');

    // Player 0 moves atlas - queue exhausts, auto-advances to weapon_attack
    engine.processAction(0, {
      type: 'move', unitId: 'atlas-0',
      path: ['5,7', '5,8'], movementType: 'walk'
    });
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');

    // End weapon attack
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('physical_attack');

    // End physical attack
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('heat');

    // End heat (auto-resolved, manually advance to end)
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('end');

    // End phase - advance to new turn
    engine.processAction(0, { type: 'endPhase' });
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(engine.stateManager.getState().turn).toBe(2);
  });

  it('three-mech alternation handles uneven unit counts', () => {
    const { engine } = createThreeMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    // Queue: player1/jenner, player0/atlas, player0/wolverine
    expect(engine.phaseManager.phaseUnitQueue).toHaveLength(3);

    // Player 1 moves jenner
    engine.processAction(1, {
      type: 'move', unitId: 'jenner-1',
      path: ['10,7', '10,8'], movementType: 'walk'
    });

    // Player 0 moves atlas
    engine.processAction(0, {
      type: 'move', unitId: 'atlas-0',
      path: ['5,7', '5,8'], movementType: 'walk'
    });

    // Player 0 moves wolverine - should auto-advance to weapon_attack after this
    engine.processAction(0, {
      type: 'move', unitId: 'wolverine-0',
      path: ['6,7', '6,8'], movementType: 'walk'
    });
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
  });
});
