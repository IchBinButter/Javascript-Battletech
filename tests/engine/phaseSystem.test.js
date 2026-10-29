import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller
} from '../helpers/testUtils.js';
import { PHASES } from '../../src/models/GameState.js';
import {
  consciousnessNumber,
  CONSCIOUSNESS_TARGETS,
  FATAL_PILOT_DAMAGE,
  declarationBlockSizes
} from '../../src/engine/PhaseManager.js';

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

/**
 * Engine with `counts[playerId]` Mechs on each side, for the p12 Unequal
 * Numbers of 'Mechs tables. Units are added in declaration order, so
 * `unit-<player>-0` is that side's first choice.
 */
function createForceEngine(counts) {
  const units = {};
  counts.forEach((count, playerId) => {
    for (let i = 0; i < count; i++) {
      const unitId = `unit-${playerId}-${i}`;
      units[unitId] = createTestUnit('atlas-as7d', playerId, unitId);
    }
  });
  return createTestEngine({ units });
}

/** Engine with explicitly named Mechs, for directed declaration-order probes. */
function createNamedForceEngine(firstUnitIds, secondUnitIds) {
  const units = {};
  for (const unitId of firstUnitIds) {
    units[unitId] = createTestUnit('atlas-as7d', 0, unitId);
  }
  for (const unitId of secondUnitIds) {
    units[unitId] = createTestUnit('atlas-as7d', 1, unitId);
  }
  return createTestEngine({ units });
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

/**
 * Put the engine in the Weapon Attack Phase with no declaration queue, so a
 * single `fire` action can be resolved directly (the way the UI drives it).
 */
function enterFirePhase(engine, playerId = 0) {
  engine.phaseManager.enterPhase('weapon_attack');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = playerId;
  return engine;
}

/**
 * Dice for fall tests: the Facing-After-Fall 1D6 is fixed, and the 2D6 queue
 * feeds the warrior's PSR, his Consciousness Roll and the hit-location rolls.
 */
function makeFallRoller({ facingRoll = 1, twoD6 = [7] } = {}) {
  let index = 0;
  return {
    roll1d6() { return facingRoll; },
    roll2d6() { return twoD6[Math.min(index++, twoD6.length - 1)]; },
    next() { return 0.5; }
  };
}

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

    it('the side with twice as many Mechs declares two per pair (2 vs 1, p12)', () => {
      const { engine } = createThreeMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');

      const players = engine.stateManager.getState().players;
      const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

      expect(queue).toHaveLength(3);
      expect(queue[0]).toEqual({ playerId: 1, unitId: 'jenner-1' });
      // p12: "if ... one team has at least twice as many 'Mechs left to
      // declare for as the other team, the team with twice as many 'Mechs
      // declares for two 'Mechs each time, rather than one."
      expect(queue[1]).toEqual({ playerId: 0, unitId: 'atlas-0' });
      expect(queue[2]).toEqual({ playerId: 0, unitId: 'wolverine-0' });
    });

    it('declares two per pair for a 4 vs 2 force (p12)', () => {
      const engine = createForceEngine([4, 2]);
      const players = engine.stateManager.getState().players;

      // First side has twice as many: it declares two, the other one, twice.
      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);

      expect(queue.map(entry => entry.unitId)).toEqual([
        'unit-0-0', 'unit-0-1', 'unit-1-0',
        'unit-0-2', 'unit-0-3', 'unit-1-1'
      ]);
    });

    it('the larger side declares two even when it declares second (2 vs 4, p12)', () => {
      const engine = createForceEngine([2, 4]);
      const players = engine.stateManager.getState().players;

      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);

      expect(queue.map(entry => entry.unitId)).toEqual([
        'unit-0-0', 'unit-1-0', 'unit-1-1',
        'unit-0-1', 'unit-1-2', 'unit-1-3'
      ]);
    });

    it('declares three per pair for a 3 vs 1 force (p12)', () => {
      const engine = createForceEngine([3, 1]);
      const players = engine.stateManager.getState().players;

      // "If one team has at least three times as many 'Mechs, it declares for
      // three each time, and so on."
      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);

      expect(queue.map(entry => entry.unitId)).toEqual([
        'unit-0-0', 'unit-0-1', 'unit-0-2', 'unit-1-0'
      ]);
    });

    it('the larger side declares three even when it declares second (1 vs 3, p12)', () => {
      const engine = createForceEngine([1, 3]);
      const players = engine.stateManager.getState().players;

      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);

      expect(queue.map(entry => entry.unitId)).toEqual([
        'unit-0-0', 'unit-1-0', 'unit-1-1', 'unit-1-2'
      ]);
    });

    it('re-checks the ratio before every pair (3 vs 2, p12)', () => {
      const engine = createForceEngine([3, 2]);
      const players = engine.stateManager.getState().players;

      // 3 vs 2 is not 2:1, so the first pair is 1:1; that leaves 2 vs 1, which
      // is 2:1, so the next pair has the first side declare its last two.
      const queue = engine.phaseManager.buildUnitQueue(players[0], players[1]);

      expect(queue.map(entry => entry.unitId)).toEqual([
        'unit-0-0', 'unit-1-0',
        'unit-0-1', 'unit-0-2', 'unit-1-1'
      ]);
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
    it('_enterMovement puts the initiative loser first (p10)', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('movement');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue).toHaveLength(2);
      expect(queue[0].playerId).toBe(1);
      expect(queue[1].playerId).toBe(0);
    });

    it('the winner of the initiative roll does not get to declare first (H-11)', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([5, 8]);
      engine.phaseManager.enterPhase('initiative');
      expect(engine.stateManager.getState().initiativeWinner).toBe(1);

      engine.phaseManager.enterPhase('movement');

      // p10: "The side that lost Initiative must act first." - here the loser
      // is player 0, whatever the winner might prefer.
      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue.map(entry => entry.playerId)).toEqual([0, 1]);
    });

    it('_enterWeaponAttack puts the initiative loser first (p10)', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('weapon_attack');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue[0].playerId).toBe(1);
      expect(queue[0].unitId).toBe('jenner-1');
      expect(queue[1].playerId).toBe(0);
    });

    it('_enterPhysicalAttack repeats the weapon attack order: loser first (p12)', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('physical_attack');

      // p12: "Players repeat the steps given for the Weapon Attack Phase,
      // except for torso twisting" - so the initiative loser declares first.
      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue[0].playerId).toBe(1);
      expect(queue[1].playerId).toBe(0);
    });

    it('_enterMovement declares in p12 blocks when the loser has fewer Mechs', () => {
      const engine = createForceEngine([4, 2]);
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      expect(engine.stateManager.getState().initiativeWinner).toBe(0);

      engine.phaseManager.enterPhase('movement');

      // Player 0 won, so player 1 (2 Mechs) declares first; player 0 has
      // twice as many and declares two per pair (p12).
      expect(engine.phaseManager.phaseUnitQueue.map(entry => entry.unitId)).toEqual([
        'unit-1-0', 'unit-0-0', 'unit-0-1',
        'unit-1-1', 'unit-0-2', 'unit-0-3'
      ]);
      expect(engine.stateManager.getState().currentPlayer).toBe(1);
    });

    it('_enterPhysicalAttack defaults to the initiative loser first', () => {
      const { engine } = createTwoMechEngine();
      engine.diceRoller = makeSequencedDiceRoller([8, 5]);
      engine.phaseManager.enterPhase('initiative');
      engine.phaseManager.enterPhase('physical_attack');

      const queue = engine.phaseManager.phaseUnitQueue;
      expect(queue[0].playerId).toBe(1);
      expect(queue[0].unitId).toBe('jenner-1');
      expect(queue[1].playerId).toBe(0);
      expect(queue[1].unitId).toBe('atlas-0');
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
// Initiative order and Unequal Numbers of 'Mechs (p10/p12)
// =============================================================================

describe('PhaseManager: Initiative order (p10/p12)', () => {
  it('does not expose the removed winner-goes-first house rule (H-11)', () => {
    const { engine } = createTwoMechEngine();

    // p10: "The side that lost Initiative must act first." The manual gives the
    // winner no phase-order choice (its only winner choice is the pre-game
    // deployment side), so the house rule is deleted rather than hidden.
    expect(engine.phaseManager.chooseInitiative).toBeUndefined();
    expect('initiativeWinnerGoesFirst' in engine.phaseManager).toBe(false);
  });

  it('InitiativeManager.getInitiativeOrder returns the loser first', () => {
    const { engine } = createTwoMechEngine();
    const players = engine.stateManager.getState().players;

    expect(engine.initiativeManager.getInitiativeOrder(0, players)).toEqual([1, 0]);
    expect(engine.initiativeManager.getInitiativeOrder(1, players)).toEqual([0, 1]);
  });

  it('the loser declares first in all three acting phases (p10/p12)', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(0);

    for (const phase of ['movement', 'weapon_attack', 'physical_attack']) {
      engine.phaseManager.enterPhase(phase);
      expect(engine.phaseManager.phaseUnitQueue.map(entry => entry.playerId)).toEqual([1, 0]);
    }
  });

  it('the order follows the die roll, not a choice', () => {
    const { engine } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([5, 8]);
    engine.phaseManager.enterPhase('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(1);

    engine.phaseManager.enterPhase('movement');
    expect(engine.phaseManager.phaseUnitQueue.map(entry => entry.playerId)).toEqual([0, 1]);
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

describe('PhaseManager: Unequal Numbers of Mechs (p12)', () => {
  /** Replays the p12 pair algorithm, recording the counts before each pair. */
  function declarationPairs(firstCount, secondCount) {
    const pairs = [];
    let first = firstCount;
    let second = secondCount;

    while (first > 0 || second > 0) {
      const blocks = declarationBlockSizes(first, second);
      pairs.push({
        firstLeft: first,
        secondLeft: second,
        first: blocks.first,
        second: blocks.second
      });
      first -= blocks.first;
      second -= blocks.second;
    }

    return pairs;
  }

  // p12 prints two worked tables: "Side B Units Left to Move / Side A Units
  // Left to Move / Side B Moves / Side A Moves". Side B is the smaller force.
  it('replays the printed 10-vs-18 table', () => {
    expect(declarationPairs(10, 18)).toEqual([
      { firstLeft: 10, secondLeft: 18, first: 1, second: 1 },
      { firstLeft: 9, secondLeft: 17, first: 1, second: 1 },
      { firstLeft: 8, secondLeft: 16, first: 1, second: 2 },
      { firstLeft: 7, secondLeft: 14, first: 1, second: 2 },
      { firstLeft: 6, secondLeft: 12, first: 1, second: 2 },
      { firstLeft: 5, secondLeft: 10, first: 1, second: 2 },
      { firstLeft: 4, secondLeft: 8, first: 1, second: 2 },
      { firstLeft: 3, secondLeft: 6, first: 1, second: 2 },
      { firstLeft: 2, secondLeft: 4, first: 1, second: 2 },
      { firstLeft: 1, secondLeft: 2, first: 1, second: 2 }
    ]);
  });

  it('replays the printed 5-vs-14 table', () => {
    expect(declarationPairs(5, 14)).toEqual([
      { firstLeft: 5, secondLeft: 14, first: 1, second: 2 },
      { firstLeft: 4, secondLeft: 12, first: 1, second: 3 },
      { firstLeft: 3, secondLeft: 9, first: 1, second: 3 },
      { firstLeft: 2, secondLeft: 6, first: 1, second: 3 },
      { firstLeft: 1, secondLeft: 3, first: 1, second: 3 }
    ]);
  });

  it('the smaller side always declares one, whatever the ratio', () => {
    for (const [first, second] of [[1, 2], [2, 5], [3, 6], [7, 13], [4, 40]]) {
      const blocks = declarationBlockSizes(first, second);
      expect(blocks.first).toBe(1);
    }
    for (const [first, second] of [[2, 1], [5, 2], [6, 3], [13, 7], [40, 4]]) {
      const blocks = declarationBlockSizes(first, second);
      expect(blocks.second).toBe(1);
    }
  });

  it('a side with nothing left to declare hands the rest to the other side', () => {
    expect(declarationBlockSizes(0, 3)).toEqual({ first: 0, second: 3 });
    expect(declarationBlockSizes(3, 0)).toEqual({ first: 3, second: 0 });
    expect(declarationBlockSizes(0, 0)).toEqual({ first: 0, second: 0 });
  });

  it('builds the printed tables into the full declaration queue exactly', () => {
    const playerRuns = queue => {
      const runs = [];
      for (const entry of queue) {
        const last = runs[runs.length - 1];
        if (last && last.playerId === entry.playerId) last.count++;
        else runs.push({ playerId: entry.playerId, count: 1 });
      }
      return runs.map(run => run.count);
    };

    // Table 1: Side B 10 (first) vs Side A 18. 1:1 for two pairs, then the
    // larger side declares two every pair.
    const table1 = createForceEngine([10, 18]);
    const players1 = table1.stateManager.getState().players;
    const queue1 = table1.phaseManager.buildUnitQueue(players1[0], players1[1]);
    expect(queue1).toHaveLength(28);
    expect(playerRuns(queue1)).toEqual([
      1, 1, 1, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2
    ]);

    // Table 2: Side B 5 (first) vs Side A 14. The larger side declares two on
    // the first pair, then three every pair.
    const table2 = createForceEngine([5, 14]);
    const players2 = table2.stateManager.getState().players;
    const queue2 = table2.phaseManager.buildUnitQueue(players2[0], players2[1]);
    expect(queue2).toHaveLength(19);
    expect(playerRuns(queue2)).toEqual([1, 2, 1, 3, 1, 3, 1, 3, 1, 3]);
  });
});

// =============================================================================
// Mid-phase re-evaluation of the p12 declaration blocks
// =============================================================================

describe('PhaseManager: mid-phase declaration re-evaluation (p12)', () => {
  /** Walk the live queue and return the declaration order it produces. */
  function drainQueue(engine) {
    const order = [];
    let entry = engine.phaseManager.getCurrentQueueEntry();

    while (entry) {
      order.push(entry.unitId);
      engine.phaseManager.advanceQueue();
      entry = engine.phaseManager.getCurrentQueueEntry();
    }

    return order;
  }

  /** p131: destruction removes a 'Mech from the declaration order. */
  function destroy(engine, unitIds) {
    for (const unitId of unitIds) {
      const unit = engine.stateManager.getState().getUnit(unitId);
      unit.internalStructure.centerTorso = 0;
      expect(engine.phaseManager.isDestroyedUnit(unit)).toBe(true);
    }
  }

  /** 4 Mechs (P0, the initiative loser) vs 8 Mechs (P1, the winner). */
  function fourVsEightEngine() {
    const engine = createNamedForceEngine(
      ['a1', 'a2', 'a3', 'a4'],
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']
    );
    engine.diceRoller = makeSequencedDiceRoller([5, 8]); // P1 wins; P0 declares first
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    return engine;
  }

  it('re-plans the remaining pairs after the larger side loses Mechs mid-phase (4 vs 8)', () => {
    const engine = fourVsEightEngine();

    // The phase-entry plan sees 4 vs 8: the larger side declares two per pair.
    expect(engine.phaseManager.phaseUnitQueue.map(entry => entry.unitId)).toEqual([
      'a1', 'b1', 'b2',
      'a2', 'b3', 'b4',
      'a3', 'b5', 'b6',
      'a4', 'b7', 'b8'
    ]);

    // Mid-phase: a1, a2, b1 and b2 are destroyed before the queue reaches their
    // slots. A stale phase-entry plan would resume at b3, b4, a3, ...
    destroy(engine, ['a1', 'a2', 'b1', 'b2']);

    // Re-evaluated "prior to any pair", 2 A Mechs vs 6 B Mechs left to declare
    // for is 3:1, so B declares three for every A Mech from the next pair on.
    expect(drainQueue(engine)).toEqual([
      'a3', 'b3', 'b4', 'b5',
      'a4', 'b6', 'b7', 'b8'
    ]);
  });

  it('re-evaluates the first pair too when the larger side is reduced before it declares', () => {
    const engine = fourVsEightEngine();

    // b1 and b2 die before the queue is first read. With 4 A Mechs vs 6 B Mechs
    // left to declare for there is no 2:1 ratio any more, so the first pair is
    // 1:1 rather than the phase-entry A1/B2.
    destroy(engine, ['b1', 'b2']);

    expect(drainQueue(engine)).toEqual([
      'a1', 'b3',
      'a2', 'b4',
      'a3', 'b5', 'b6',
      'a4', 'b7', 'b8'
    ]);
  });

  it('does not resize a pair that is already under way (p12 "prior to any pair")', () => {
    const engine = fourVsEightEngine();

    // Pair 1 has started: A's a1 declares.
    expect(engine.phaseManager.getCurrentQueueEntry().unitId).toBe('a1');
    engine.phaseManager.advanceQueue();

    // b3 and b4 were planned for pair 2; they are destroyed while pair 1's b1
    // and b2 are still to declare.
    destroy(engine, ['b3', 'b4']);

    // Pair 1 keeps its planned size and finishes as b1, b2. The pair about to
    // start is then re-planned from 3 A Mechs vs 4 B Mechs left to declare for,
    // i.e. 1:1 rather than the stale 1:2.
    expect(drainQueue(engine)).toEqual([
      'b1', 'b2',
      'a2', 'b5',
      'a3', 'b6',
      'a4', 'b7', 'b8'
    ]);
  });
});

// =============================================================================
// Consciousness Rolls (p58) and End-Phase recovery (p12/p58)
// =============================================================================

describe('PhaseManager: Consciousness Rolls', () => {
  it('consciousnessNumber follows the p58 table and is null for a dead warrior', () => {
    expect(CONSCIOUSNESS_TARGETS).toEqual({ 1: 3, 2: 5, 3: 7, 4: 10, 5: 11 });
    expect(consciousnessNumber(0)).toBe(0);
    expect(consciousnessNumber(1)).toBe(3);
    expect(consciousnessNumber(2)).toBe(5);
    expect(consciousnessNumber(3)).toBe(7);
    expect(consciousnessNumber(4)).toBe(10);
    expect(consciousnessNumber(5)).toBe(11);
    expect(consciousnessNumber(FATAL_PILOT_DAMAGE)).toBeNull();
    expect(consciousnessNumber(9)).toBeNull();
  });

  it.each([[1, 3], [2, 5], [3, 7], [4, 10], [5, 11]])(
    'a pilot with %i hits needs a %i+ to stay conscious',
    (hits, target) => {
      const { engine, atlas } = createTwoMechEngine();
      engine.diceRoller = makeDiceRoller(target - 1);
      atlas.pilot.hits = hits;

      const result = engine.phaseManager.rollConsciousness(atlas);

      expect(result).toMatchObject({ rolled: true, target, passed: false, roll: target - 1 });
      expect(atlas.pilot.conscious).toBe(false);
    }
  );

  it('passes when the roll meets the consciousness number', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(11);
    atlas.pilot.hits = 5;

    const result = engine.phaseManager.rollConsciousness(atlas);

    expect(result.passed).toBe(true);
    expect(atlas.pilot.conscious).toBe(true);
  });

  it('records the turn a pilot was knocked out on, for End-Phase recovery', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(2);
    engine.stateManager.getState().turn = 4;
    atlas.pilot.hits = 1;

    engine.phaseManager.rollConsciousness(atlas);

    expect(atlas.pilot.unconsciousTurn).toBe(4);
  });

  it('rolls as soon as a head hit damages the pilot, not in the End Phase', () => {
    const { engine, jenner } = createTwoMechEngine();
    enterFirePhase(engine, 0);
    // Attack 12 (hit), hit location 12 (head), consciousness 2 (< 3).
    engine.diceRoller = makeSequencedDiceRoller([12, 12, 2]);

    const uncons = [];
    engine.eventBus.on('pilotUnconscious', (data) => uncons.push(data));

    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser')
    });

    expect(result.hit).toBe(true);
    expect(jenner.pilot.hits).toBe(1);
    expect(jenner.pilot.conscious).toBe(false);
    expect(uncons).toHaveLength(1);
    expect(uncons[0]).toMatchObject({ unitId: 'jenner-1', roll: 2, target: 3, hits: 1, auto: false });
  });

  it('keeps the pilot conscious when the damage-time roll passes', () => {
    const { engine, jenner } = createTwoMechEngine();
    enterFirePhase(engine, 0);
    engine.diceRoller = makeSequencedDiceRoller([12, 12, 8]);

    const rolls = [];
    engine.eventBus.on('consciousnessRoll', (data) => rolls.push(data));

    engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser')
    });

    expect(jenner.pilot.conscious).toBe(true);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({ roll: 8, target: 3, passed: true });
  });

  it('makes no further rolls that turn once a warrior is knocked out', () => {
    const { engine, jenner } = createTwoMechEngine();
    jenner.pilot.hits = 1;
    jenner.pilot.conscious = false;

    const rolls = [];
    engine.eventBus.on('consciousnessRoll', (data) => rolls.push(data));

    const result = engine.phaseManager.rollConsciousness(jenner, { hits: 2 });

    expect(result.skipped).toBe(true);
    expect(rolls).toHaveLength(0);
  });

  it('kills the warrior on the sixth point of damage', () => {
    const { engine, jenner } = createTwoMechEngine();
    const killed = [];
    engine.eventBus.on('pilotKilled', (data) => killed.push(data));

    const result = engine.phaseManager.rollConsciousness(jenner, { hits: FATAL_PILOT_DAMAGE });

    expect(result).toMatchObject({ dead: true });
    expect(jenner.pilot.dead).toBe(true);
    expect(jenner.pilot.conscious).toBe(false);
    expect(killed).toHaveLength(1);
    expect(killed[0]).toMatchObject({ unitId: 'jenner-1', hits: FATAL_PILOT_DAMAGE });
  });

  it('rolls once per point of damage taken in a single burst', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(12);

    const rolls = [];
    engine.eventBus.on('consciousnessRoll', (data) => rolls.push(data));

    // Two points of MechWarrior damage at once (an ammunition explosion, p52).
    const hitsBefore = atlas.pilot.hits;
    atlas.applyPilotDamage(2);
    engine.rollConsciousnessForNewPilotHits(atlas, hitsBefore);

    expect(rolls.map(r => r.hits)).toEqual([1, 2]);
    expect(rolls.map(r => r.target)).toEqual([3, 5]);
    expect(atlas.pilot.conscious).toBe(true);
  });
});

describe('PhaseManager: End-Phase consciousness recovery (p12/p58)', () => {
  it('a conscious pilot never rolls in the End Phase', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(2); // would fail the 3+ if it rolled
    atlas.pilot.hits = 3;
    atlas.pilot.conscious = true;

    const rolls = [];
    engine.eventBus.on('consciousnessRoll', (data) => rolls.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
    expect(rolls).toHaveLength(0);
  });

  it('an unconscious warrior from an earlier turn rolls to recover', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(7);
    atlas.pilot.hits = 3;
    atlas.pilot.conscious = false;
    atlas.pilot.unconsciousTurn = 0; // knocked out on a previous turn

    const recovered = [];
    engine.eventBus.on('pilotRegainedConsciousness', (data) => recovered.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
    expect(atlas.pilot.unconsciousTurn).toBeUndefined();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ unitId: 'atlas-0', roll: 7, target: 7, hits: 3 });
  });

  it('recovery uses the consciousness number for the current damage total', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(10); // 5 hits needs 11+
    atlas.pilot.hits = 5;
    atlas.pilot.conscious = false;
    atlas.pilot.unconsciousTurn = 0;

    const stillOut = [];
    engine.eventBus.on('pilotStillUnconscious', (data) => stillOut.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(stillOut).toHaveLength(1);
    expect(stillOut[0].target).toBe(11);
  });

  it('does not roll for a warrior knocked out in the current turn', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(12);
    atlas.pilot.hits = 1;
    atlas.pilot.conscious = false;
    atlas.pilot.unconsciousTurn = engine.stateManager.getState().turn;

    const recovered = [];
    engine.eventBus.on('pilotRegainedConsciousness', (data) => recovered.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(recovered).toHaveLength(0);
  });

  it('never recovers a dead warrior', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(12);
    atlas.pilot.hits = FATAL_PILOT_DAMAGE;
    atlas.pilot.conscious = false;
    atlas.pilot.dead = true;
    atlas.pilot.unconsciousTurn = 0;

    const recovered = [];
    engine.eventBus.on('pilotRegainedConsciousness', (data) => recovered.push(data));

    engine.phaseManager.enterPhase('end');

    expect(recovered).toHaveLength(0);
    expect(atlas.pilot.conscious).toBe(false);
  });
});

// =============================================================================
// Restart attempts in the Heat Phase (p12/p52)
// =============================================================================

describe('PhaseManager: Shutdown Restart Checks (Heat Phase, p52)', () => {
  it('restarts automatically below 14 heat, even with an unconscious pilot', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(7);
    atlas.shutdown = true;
    atlas.heat = 10; // the Heat Phase dissipates below 14
    atlas.pilot.conscious = false;

    const restarts = [];
    engine.eventBus.on('unitRestarted', (data) => restarts.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(false);
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({ unitId: 'atlas-0', auto: true });
  });

  it('rolls against the current avoid target at 14-29 heat', () => {
    const { engine, atlas } = createTwoMechEngine();
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 18; // 18 heat after dissipation -> avoid on 6+
    atlas.shutdown = true;
    // 12 keeps the shutdown check from mattering; 5 < 6 fails the restart.
    engine.diceRoller = makeSequencedDiceRoller([12, 5]);

    const fails = [];
    engine.eventBus.on('unitRestartFailed', (data) => fails.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(18);
    expect(atlas.shutdown).toBe(true);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({ unitId: 'atlas-0', roll: 5, target: 6 });
  });

  it('restarts when the roll meets the avoid target', () => {
    const { engine, atlas } = createTwoMechEngine();
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 14; // 14 heat -> avoid on 4+
    atlas.shutdown = true;
    engine.diceRoller = makeSequencedDiceRoller([12, 4]);

    const restarts = [];
    engine.eventBus.on('unitRestarted', (data) => restarts.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(false);
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({ roll: 4, target: 4, auto: false });
  });

  it('cannot restart at 30 or more heat', () => {
    const { engine, atlas } = createTwoMechEngine();
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 30; // the Heat Phase leaves 30 heat: auto shutdown
    atlas.shutdown = true;
    engine.diceRoller = makeDiceRoller(12);

    const blocked = [];
    engine.eventBus.on('unitRestartBlocked', (data) => blocked.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(30);
    expect(atlas.shutdown).toBe(true);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ unitId: 'atlas-0', heat: 30, reason: 'overflow heat' });
  });

  it('an unconscious warrior cannot attempt a restart', () => {
    const { engine, atlas } = createTwoMechEngine();
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 20; // 20 heat -> avoid on 6+
    atlas.shutdown = true;
    atlas.pilot.conscious = false;
    engine.diceRoller = makeDiceRoller(12);

    const blocked = [];
    engine.eventBus.on('unitRestartBlocked', (data) => blocked.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(true);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ reason: 'unconscious pilot' });
  });

  it('no longer restarts in the End Phase', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(12);
    atlas.shutdown = true;
    atlas.heat = 5;

    const events = [];
    engine.eventBus.on('unitRestarted', (data) => events.push(data));
    engine.eventBus.on('unitRestartFailed', (data) => events.push(data));
    engine.eventBus.on('unitRestartBlocked', (data) => events.push(data));

    engine.phaseManager.enterPhase('end');

    expect(atlas.shutdown).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('a Mech that shuts down in this Heat Phase waits for a later Heat Phase (p52)', () => {
    const { engine, atlas } = createTwoMechEngine();
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 14; // after dissipation: 14 heat -> shutdown avoid 4+
    atlas.shutdown = false;
    // 2 fails the shutdown check (shutdown); 12 passes the involuntary-shutdown
    // PSR (8+), and the same 12 would pass the restart roll (4+) if it were
    // attempted now.
    engine.diceRoller = makeSequencedDiceRoller([2, 12, 12]);

    const restarts = [];
    engine.eventBus.on('unitRestarted', (data) => restarts.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(14);
    expect(atlas.shutdown).toBe(true);
    // p52: the restart attempt belongs to "any subsequent Heat Phase".
    expect(restarts).toHaveLength(0);

    // One turn later, the same 'Mech may attempt the restart.
    engine.stateManager.getState().turn = 2;
    atlas.heat = sinks + 14;
    engine.diceRoller = makeSequencedDiceRoller([12, 12]);
    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(false);
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({ unitId: 'atlas-0', roll: 12, target: 4 });
  });

  it('an active Mech is not checked for restart', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeDiceRoller(12);
    atlas.shutdown = false;

    const events = [];
    engine.eventBus.on('unitRestarted', (data) => events.push(data));
    engine.eventBus.on('unitRestartFailed', (data) => events.push(data));
    engine.eventBus.on('unitRestartBlocked', (data) => events.push(data));

    engine.phaseManager.enterPhase('heat');

    expect(events).toHaveLength(0);
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
// Immobile and destroyed Mechs (p10, p52, p58, p131)
// =============================================================================

describe('PhaseManager: Immobile and destroyed Mechs', () => {
  it('buildUnitQueue leaves destroyed Mechs out', () => {
    const { engine, jenner } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    jenner.internalStructure.centerTorso = 0; // head/CT destruction destroys the Mech

    const players = engine.stateManager.getState().players;
    const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

    expect(queue).toEqual([{ playerId: 0, unitId: 'atlas-0' }]);
  });

  it('removes destroyed Mechs from play at the end of the phase', () => {
    const { engine, jenner } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
    engine.phaseManager.enterPhase('initiative');
    jenner.internalStructure.centerTorso = 0;

    const removed = [];
    engine.eventBus.on('unitRemoved', (data) => removed.push(data));

    engine.phaseManager.nextPhase(); // initiative -> movement

    expect(engine.stateManager.getState().getUnit('jenner-1')).toBeNull();
    expect(removed).toEqual([{ unitId: 'jenner-1', playerId: 1 }]);
  });

  // p44 Leg Destruction: "A 'Mech that loses both of its legs automatically
  // falls as well. It is not considered immobile (see p. 18), but it has 0 MP
  // available." Losing both legs is NOT a destruction, so the removal hook
  // must leave the 'Mech in state.units.
  it('keeps a both-legs-destroyed Mech on the board (p44: 0 MP, not destroyed)', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5]);
    engine.phaseManager.enterPhase('initiative');
    atlas.internalStructure.leftLeg = 0;
    atlas.internalStructure.rightLeg = 0;

    expect(atlas.isLocationDestroyed('leftLeg')).toBe(true);
    expect(atlas.isLocationDestroyed('rightLeg')).toBe(true);
    expect(atlas.isDestroyed()).toBe(false);
    expect(atlas.currentMP).toBe(0); // p44: "it has 0 MP available"

    const removed = [];
    engine.eventBus.on('unitRemoved', (data) => removed.push(data));

    engine.phaseManager.nextPhase(); // initiative -> movement (the removal hook)

    const state = engine.stateManager.getState();
    expect(state.getUnit('atlas-0')).toBe(atlas); // still on the board
    expect(removed).toEqual([]);                  // not removed as destroyed
    expect(engine.phaseManager.isDestroyedUnit(atlas)).toBe(false);
    expect(atlas.isDestroyed()).toBe(false);
    expect(atlas.currentMP).toBe(0);
    // p44: not considered immobile - it still gets a declaration slot.
    expect(engine.phaseManager.isImmobile(atlas)).toBe(false);
    expect(engine.phaseManager.getCurrentQueueEntry()).not.toBeNull();
  });

  it('skips a unit destroyed earlier in the same phase (no further slots)', () => {
    const { engine, jenner } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    expect(engine.phaseManager.getCurrentQueueEntry().unitId).toBe('jenner-1');

    jenner.internalStructure.centerTorso = 0;
    engine.phaseManager.advanceQueue();

    expect(engine.phaseManager.getCurrentQueueEntry().unitId).toBe('atlas-0');
  });

  it('rejects actions from a shut-down Mech but lets its slot be passed', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.advanceQueue(); // atlas-0 declares second

    atlas.shutdown = true;

    expect(engine.phaseManager.validateAction('move', 0, 'atlas-0')).toMatchObject({
      valid: false,
      reason: 'A shut-down Mech cannot act'
    });
    expect(engine.phaseManager.validateAction('pass', 0, 'atlas-0').valid).toBe(true);

    const move = engine.processAction(0, {
      type: 'move', unitId: 'atlas-0', path: ['5,7', '5,8'], movementType: 'walk'
    });
    expect(move.success).toBe(false);
    expect(engine.phaseManager.currentPhase).toBe('movement');

    const passed = engine.processAction(0, { type: 'pass', unitId: 'atlas-0' });
    expect(passed.success).toBe(true);
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
  });

  it('rejects actions from a Mech whose warrior is unconscious', () => {
    const { engine, atlas } = createTwoMechEngine();
    enterFirePhase(engine, 0);
    atlas.pilot.conscious = false;

    expect(engine.phaseManager.validateAction('fire', 0, 'atlas-0')).toMatchObject({
      valid: false,
      reason: 'A MechWarrior who is unconscious cannot act'
    });

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas-0', targetId: 'jenner-1', weapon: createWeaponDef('med_laser')
    });
    expect(result.success).toBe(false);
  });

  it('rejects actions from a destroyed Mech', () => {
    const { engine, jenner } = createTwoMechEngine();
    enterFirePhase(engine, 1);
    jenner.internalStructure.centerTorso = 0;

    expect(engine.phaseManager.validateAction('fire', 1, 'jenner-1')).toMatchObject({
      valid: false,
      reason: 'Unit has been destroyed'
    });
  });

  it('an immobile Mech keeps its declaration slot (p10)', () => {
    const { engine, atlas } = createTwoMechEngine();
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    atlas.pilot.conscious = false;

    const queue = engine.phaseManager.phaseUnitQueue;
    expect(queue.map(entry => entry.unitId)).toEqual(['jenner-1', 'atlas-0']);
  });

  it("marks an unconscious pilot's Mech immobile for the -4 target modifier (p18/p28)", () => {
    const { engine, atlas, jenner } = createTwoMechEngine();
    engine.phaseManager.enterPhase('weapon_attack');
    jenner.pilot.conscious = false;
    engine.phaseManager.enterPhase('weapon_attack'); // refresh derived state

    expect(jenner.immobile).toBe(true);

    const calc = engine.attackResolver.calculateTargetNumber(
      atlas, createWeaponDef('med_laser'), jenner, engine.stateManager.getState()
    );
    expect(calc.modifiers).toContain('Target immobile: -4');
  });

  it('a shut-down Mech gets a single -4 for being immobile, not -8', () => {
    const { engine, atlas, jenner } = createTwoMechEngine();
    engine.phaseManager.enterPhase('weapon_attack');
    jenner.shutdown = true;
    engine.phaseManager.enterPhase('weapon_attack');

    expect(jenner.immobile).toBe(false); // the shutdown flag carries the -4

    const calc = engine.attackResolver.calculateTargetNumber(
      atlas, createWeaponDef('med_laser'), jenner, engine.stateManager.getState()
    );
    expect(calc.modifiers).toContain('Target shutdown: -4');
    expect(calc.modifiers.filter(m => m.startsWith('Target immobile'))).toHaveLength(0);
  });
});

// =============================================================================
// Fall resolution (p56/p58)
// =============================================================================

describe('GameEngine: Fall resolution (p56/p58)', () => {
  it('a failed movement PSR falls the Mech and injures the warrior', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.gyro.hits = 1; // p142: running with a damaged gyro forces a PSR (+3)
    engine.diceRoller = makeDiceRoller(2); // fails the 8+ PSR
    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const falls = [];
    const rolls = [];
    engine.eventBus.on('unitFell', (data) => falls.push(data));
    engine.eventBus.on('consciousnessRoll', (data) => rolls.push(data));

    const armourBefore = JSON.stringify(atlas.armor);
    const result = engine.processAction(0, {
      type: 'move', unitId: 'atlas-0', path: ['5,7', '5,8'], movementType: 'run'
    });

    expect(result.success).toBe(true);
    expect(atlas.prone).toBe(true);

    // p58: the warrior's own fall PSR failed, so they take a point of damage
    // and must make a Consciousness Roll immediately.
    expect(atlas.pilot.hits).toBe(1);
    expect(atlas.pilot.conscious).toBe(false); // rolled 2 against the 3+
    expect(rolls).toHaveLength(1);

    // p57/p143: falling damage is ceil(tonnage / 10) x (levels fallen + 1).
    // This is a same-level fall on the Level 0 test map, so the 100-ton Atlas
    // takes 10 x (0 + 1) = 10 damage, applied in 5-point groupings.
    expect(falls).toHaveLength(1);
    expect(falls[0].fall).toMatchObject({
      pilotHit: true,
      levelsFallen: 0,
      damage: 10,
      damageGroupings: [5, 5]
    });
    expect(falls[0].fall.pilotPSR).toMatchObject({ passed: false, targetNumber: 8 });
    expect(JSON.stringify(atlas.armor)).not.toBe(armourBefore);
  });

  it('a 65-ton same-level fall takes 7 damage, not 14 (p57/p143)', () => {
    const thunderbolt = createTestUnit('thunderbolt-tdr5s', 0, 'thunderbolt-0');
    thunderbolt.position = { hexKey: '5,7', facing: 3 };
    const engine = createTestEngine({ units: { 'thunderbolt-0': thunderbolt } });
    thunderbolt.gyro.hits = 1; // run with a damaged gyro forces the PSR
    engine.diceRoller = makeDiceRoller(2); // fails the PSR
    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const falls = [];
    engine.eventBus.on('unitFell', (data) => falls.push(data));

    engine.processAction(0, {
      type: 'move', unitId: 'thunderbolt-0', path: ['5,7', '5,8'], movementType: 'run'
    });

    // ceil(65 / 10) x (0 + 1) = 7, i.e. one 5-point grouping and one 2-point.
    expect(falls).toHaveLength(1);
    expect(falls[0].fall).toMatchObject({
      levelsFallen: 0,
      damage: 7,
      damageGroupings: [5, 2]
    });
  });

  it('a fall while moving into a lower hex is still a 0-level fall (p56)', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.gyro.hits = 1; // run with a damaged gyro forces the PSR
    // Movement PSR 2 (fails), warrior PSR 2 (fails), Consciousness Roll 7
    // (passes), then hit-location rolls of 7 (centre torso).
    engine.diceRoller = makeFallRoller({ facingRoll: 1, twoD6: [2, 2, 7, 7] });
    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    // The move ends one level below where it started.
    const state = engine.stateManager.getState();
    state.map.hexes.get('5,8').level = -1;

    const result = engine.processAction(0, {
      type: 'move', unitId: 'atlas-0', path: ['5,7', '5,8'], movementType: 'run'
    });

    expect(result.success).toBe(true);
    expect(atlas.prone).toBe(true);
    expect(atlas.pilot.hits).toBe(1);
    // p56: "Mech falls are 0-level falls ... this includes Mechs that fall due
    // to jumping". A failed movement PSR is 0 levels even when the hex it lands
    // in is lower; only displacement of 2+ levels changes the count.
    // 100 tons, 0 levels: 10 x (0 + 1) = 10 damage in two 5-point groupings.
    expect(atlas.getArmor('centerTorso')).toBe(47 - 10);
    expect(atlas.getArmor('centerTorso', true)).toBe(14);
  });

  it('a Rear facing-after-fall result hits rear torso armour (p56/p57)', () => {
    const { engine, atlas } = createTwoMechEngine();
    // Facing-After-Fall 4 = "Opposite Direction" (Rear column). The warrior's
    // PSR fails (2 < 5), his Consciousness Roll passes (12), and both 5-point
    // groupings land on the centre torso (7 = centre torso/rear).
    engine.diceRoller = makeFallRoller({ facingRoll: 4, twoD6: [2, 12, 7, 7] });

    const frontBefore = atlas.getArmor('centerTorso');
    const rearBefore = atlas.getArmor('centerTorso', true);
    expect(rearBefore).toBe(14);

    const fall = engine.applyFall(atlas, { levelsFallen: 0 });

    expect(fall.hitLocationColumn).toBe('rear');
    expect(fall.facingAfterFall.label).toBe('Opposite Direction');
    expect(fall.damage).toBe(10);
    // p56/p57: rear-facing fall damage is marked against rear armour.
    expect(atlas.getArmor('centerTorso', true)).toBe(rearBefore - 10);
    expect(atlas.getArmor('centerTorso')).toBe(frontBefore);
  });

  it('a passed movement PSR does not fall the Mech', () => {
    const { engine, atlas } = createTwoMechEngine();
    atlas.gyro.hits = 1;
    engine.diceRoller = makeDiceRoller(12); // clears the 8+
    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const falls = [];
    engine.eventBus.on('unitFell', (data) => falls.push(data));

    const result = engine.processAction(0, {
      type: 'move', unitId: 'atlas-0', path: ['5,7', '5,8'], movementType: 'run'
    });

    expect(result.success).toBe(true);
    expect(atlas.prone).toBe(false);
    expect(atlas.pilot.hits).toBe(0);
    expect(falls).toHaveLength(0);
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
