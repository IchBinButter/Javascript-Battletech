import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  makeDiceRoller,
  makeSequencedDiceRoller,
  makeConsciousnessDiceRoller
} from '../helpers/testUtils.js';
import { PHASES } from '../../src/models/GameState.js';

function twoMechEngine(rolls = [8, 5]) {
  const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
  const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
  atlas.position = { hexKey: '5,7', facing: 0 };
  jenner.position = { hexKey: '10,7', facing: 3 };

  const engine = createTestEngine({
    units: { 'atlas-0': atlas, 'jenner-1': jenner }
  });
  engine.diceRoller = makeSequencedDiceRoller(rolls);
  return { engine, atlas, jenner };
}

// =============================================================================
// Phase sequence
// =============================================================================

describe('Phase sequence', () => {
  it('PHASES defines the correct order', () => {
    expect(PHASES).toEqual([
      'initiative',
      'movement',
      'weapon_attack',
      'physical_attack',
      'heat',
      'end'
    ]);
  });

  it('starts at initiative phase', () => {
    const { engine } = twoMechEngine();
    expect(engine.phaseManager.currentPhase).toBe('initiative');
  });

  it('nextPhase advances through all phases in order and wraps with turn increment', () => {
    const { engine } = twoMechEngine([8, 5, 8, 5, 8, 5, 8, 5]);
    engine.phaseManager.enterPhase('initiative');
    const state = engine.stateManager.getState();
    const visited = [];

    for (let i = 0; i < PHASES.length; i++) {
      visited.push(engine.phaseManager.currentPhase);
      engine.phaseManager.nextPhase();
    }

    expect(visited).toEqual(PHASES);
    expect(state.turn).toBe(2);

    engine.phaseManager.nextPhase();
    expect(engine.phaseManager.currentPhase).toBe('movement');
    expect(state.turn).toBe(2);
  });

  it('enterPhase sets currentPhase and state.phase', () => {
    const { engine } = twoMechEngine();

    engine.phaseManager.enterPhase('movement');
    expect(engine.phaseManager.currentPhase).toBe('movement');
    expect(engine.stateManager.getState().phase).toBe('movement');

    engine.phaseManager.enterPhase('weapon_attack');
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
    expect(engine.stateManager.getState().phase).toBe('weapon_attack');
  });

  it('enterPhase runs registered phase callback', () => {
    const { engine } = twoMechEngine();
    let ran = false;
    engine.phaseManager.onPhaseEnter('movement', () => { ran = true; });
    engine.phaseManager.enterPhase('movement');
    expect(ran).toBe(true);
  });
});

// =============================================================================
// Initiative
// =============================================================================

describe('Initiative', () => {
  it('rolls initiative and sets winner on enterPhase("initiative")', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(0);
  });

  it('handles ties with re-rolls', () => {
    const { engine } = twoMechEngine([5, 5, 8, 3]);
    engine.phaseManager.enterPhase('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(0);
  });

  it('initiative winner chooses to go first and it affects movement order', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    const state = engine.stateManager.getState();
    expect(state.initiativeWinner).toBe(0);

    engine.phaseManager.chooseInitiative(true);
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.phaseUnitQueue[0].playerId).toBe(0);
    expect(engine.phaseManager.phaseUnitQueue[1].playerId).toBe(1);
  });

  it('loser goes first in movement when initiativeWinnerGoesFirst is false (default)', () => {
    const { engine } = twoMechEngine([10, 4]);
    engine.phaseManager.enterPhase('initiative');
    expect(engine.stateManager.getState().initiativeWinner).toBe(0);

    engine.phaseManager.chooseInitiative(false);
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.phaseUnitQueue[0].playerId).toBe(1);
    expect(engine.phaseManager.phaseUnitQueue[1].playerId).toBe(0);
  });

  it('initiative choice affects weapon_attack phase ordering', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');

    engine.phaseManager.chooseInitiative(true);
    engine.phaseManager.enterPhase('weapon_attack');

    expect(engine.phaseManager.phaseUnitQueue[0].playerId).toBe(0);
    expect(engine.phaseManager.phaseUnitQueue[1].playerId).toBe(1);
  });

  it('physical_attack repeats the weapon attack order: loser declares first (p12)', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');

    engine.phaseManager.chooseInitiative(false);
    engine.phaseManager.enterPhase('physical_attack');

    expect(engine.phaseManager.phaseUnitQueue[0].playerId).toBe(1);
    expect(engine.phaseManager.phaseUnitQueue[1].playerId).toBe(0);
  });

  it('physical_attack honours the initiative choice like the weapon attack phase', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');

    engine.phaseManager.chooseInitiative(true);
    engine.phaseManager.enterPhase('physical_attack');

    expect(engine.phaseManager.phaseUnitQueue[0].playerId).toBe(0);
    expect(engine.phaseManager.phaseUnitQueue[1].playerId).toBe(1);
  });
});

// =============================================================================
// Per-unit alternation through all phases
// =============================================================================

describe('Per-unit alternation', () => {
  it('buildUnitQueue alternates entries between two players', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');

    const players = engine.stateManager.getState().players;
    const queue = engine.phaseManager.buildUnitQueue(players[1], players[0]);

    expect(queue).toHaveLength(2);
    expect(queue[0]).toEqual({ playerId: 1, unitId: 'jenner-1' });
    expect(queue[1]).toEqual({ playerId: 0, unitId: 'atlas-0' });
  });

  it('_enterMovement populates alternating queue with correct currentPlayer', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.phaseUnitQueue).toHaveLength(2);
    expect(engine.phaseManager.phaseUnitQueue[0].unitId).toBe('jenner-1');
    expect(engine.stateManager.getState().currentPlayer).toBe(1);
  });

  it('_enterWeaponAttack populates alternating queue', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('weapon_attack');

    expect(engine.phaseManager.phaseUnitQueue).toHaveLength(2);
    expect(engine.phaseManager.phaseUnitQueue[0].unitId).toBe('jenner-1');
  });

  it('_enterPhysicalAttack builds queue with the initiative loser first', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('physical_attack');

    expect(engine.phaseManager.phaseUnitQueue).toHaveLength(2);
    expect(engine.phaseManager.phaseUnitQueue[0].unitId).toBe('jenner-1');
  });

  it('advanceQueue increments index and emits queueAdvanced', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    const emitted = [];
    engine.eventBus.on('queueAdvanced', e => emitted.push(e));

    expect(engine.phaseManager.phaseUnitIndex).toBe(0);
    expect(engine.phaseManager.phaseUnitQueue).toHaveLength(2);

    const exhausted = engine.phaseManager.advanceQueue();
    expect(engine.phaseManager.phaseUnitIndex).toBe(1);
    expect(exhausted).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({ playerId: 0, unitId: 'atlas-0' });
    expect(engine.stateManager.getState().currentPlayer).toBe(0);
  });

  it('advanceQueueOrNextPhase auto-transitions to next phase when queue exhausted', () => {
    const { engine } = twoMechEngine([8, 5, 8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    engine.phaseManager.advanceQueue();
    expect(engine.phaseManager.currentPhase).toBe('movement');

    engine.phaseManager.advanceQueueOrNextPhase();
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
  });

  it('movement phase resets unit MP for all units', () => {
    const { engine, atlas, jenner } = twoMechEngine([8, 5]);
    atlas.movementMode = 'jump';
    jenner.movementMode = 'run';
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(atlas.currentMP).toBe(atlas.movement.walk);
    expect(jenner.currentMP).toBe(jenner.movement.walk);
  });

  it('clearQueue empties the queue and resets index', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    engine.phaseManager.clearQueue();
    expect(engine.phaseManager.phaseUnitQueue).toEqual([]);
    expect(engine.phaseManager.phaseUnitIndex).toBe(0);
  });
});

// =============================================================================
// Action validation
// =============================================================================

describe('Action validation', () => {
  it('move valid only in movement phase', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    expect(engine.phaseManager.validateAction('move', 1).valid).toBe(true);

    engine.phaseManager.enterPhase('weapon_attack');
    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(false);
  });

  it('fire valid only in weapon_attack phase', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('weapon_attack');

    expect(engine.phaseManager.validateAction('fire', 1).valid).toBe(true);

    engine.phaseManager.enterPhase('movement');
    expect(engine.phaseManager.validateAction('fire', 0).valid).toBe(false);
  });

  it('physicalAttack valid only in physical_attack phase (and for the declaring side)', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('physical_attack');

    // p12: the initiative loser declares first.
    expect(engine.phaseManager.validateAction('physicalAttack', 1).valid).toBe(true);
    expect(engine.phaseManager.validateAction('physicalAttack', 0).valid).toBe(false);

    engine.phaseManager.enterPhase('movement');
    expect(engine.phaseManager.validateAction('physicalAttack', 1).valid).toBe(false);
  });

  it('endPhase and selectUnit are always valid regardless of phase', () => {
    const { engine } = twoMechEngine([8, 5]);

    for (const phase of PHASES) {
      engine.phaseManager.currentPhase = phase;
      expect(engine.phaseManager.validateAction('endPhase', 0).valid).toBe(true);
      expect(engine.phaseManager.validateAction('selectUnit', 0).valid).toBe(true);
    }
  });

  it('rejects when wrong player acts during queue-based phase', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    const result = engine.phaseManager.validateAction('move', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Not your turn');
  });

  it('rejects when wrong unit acts during queue-based phase', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    const result = engine.phaseManager.validateAction('move', 1, 'atlas-0');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Not the current acting unit');
  });

  it('falls back to currentPlayer when no queue exists', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.clearQueue();
    engine.phaseManager.currentPhase = 'movement';
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.phaseManager.validateAction('move', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Not your turn');
  });

  it('unknown action type returns invalid', () => {
    const { engine } = twoMechEngine([8, 5]);
    const result = engine.phaseManager.validateAction('unknown', 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Unknown action: unknown');
  });
});

// =============================================================================
// Heat phase (auto-heat)
// =============================================================================

describe('Heat phase', () => {
  it('_enterHeatPhase resolves heat via HeatManager', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    atlas.heat = 5;
    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(0);
    expect(engine.phaseManager.currentPhase).toBe('heat');
    expect(engine.stateManager.getState().phase).toBe('heat');
  });

  it('heat dissipation reduces unit heat', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const totalSinks = atlas.heatSinks.type === 'double'
      ? atlas.heatSinks.count * 2
      : atlas.heatSinks.count;

    atlas.heat = totalSinks + 2;
    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(2);
  });

  it('heat at 14 after dissipation still applies heat effects', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const totalSinks = atlas.heatSinks.type === 'double'
      ? atlas.heatSinks.count * 2
      : atlas.heatSinks.count;

    atlas.heat = totalSinks + 14;
    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(14);
    expect(atlas._movementModifier).toBe(0);
  });

  it('shutdown check triggers at heat 20+', () => {
    const { engine, atlas } = twoMechEngine([2, 2]);
    const totalSinks = atlas.heatSinks.type === 'double'
      ? atlas.heatSinks.count * 2
      : atlas.heatSinks.count;

    atlas.heat = totalSinks + 20;
    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(true);
  });

  it('heat at 30 causes auto shutdown', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const totalSinks = atlas.heatSinks.type === 'double'
      ? atlas.heatSinks.count * 2
      : atlas.heatSinks.count;

    atlas.heat = totalSinks + 30;
    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(true);
  });

  it('rolls Consciousness before the shutdown PSR and only once per damage point (p58)', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const totalSinks = atlas.getHeatDissipation();
    atlas.heat = totalSinks + 23; // 23 heat: shutdown on 8+, ammo explosion on 6+
    engine.diceRoller = makeDiceRoller(2); // fails every avoid roll

    const rolls = [];
    const shutdowns = [];
    engine.eventBus.on('consciousnessRoll', d => rolls.push(d));
    engine.eventBus.on('involuntaryShutdown', d => shutdowns.push(d));

    engine.phaseManager.enterPhase('heat');

    // The ammunition explosion adds 2 points of MechWarrior damage; the first
    // roll (2 vs 3+) knocks the warrior out, so no further rolls are made.
    expect(atlas.pilot.hits).toBe(3); // 2 from the ammo explosion + 1 from the fall
    expect(atlas.pilot.conscious).toBe(false);
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({ hits: 1, roll: 2, target: 3 });

    // p58: an unconscious warrior's PSRs fail automatically, so the shut-down
    // Mech falls and the warrior takes the p54 footnote-2 point of damage.
    expect(atlas.shutdown).toBe(true);
    expect(atlas.prone).toBe(true);
    expect(shutdowns).toHaveLength(1);
    expect(shutdowns[0].psr.passed).toBe(false);
    expect(shutdowns[0].fall).not.toBeNull();
  });

  it('a failed involuntary-shutdown PSR falls the Mech and injures the warrior (p52/p54/p58)', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const totalSinks = atlas.getHeatDissipation();
    atlas.heat = totalSinks + 18; // 18 heat: avoid shutdown on 6+
    engine.diceRoller = makeDiceRoller(2); // fails the shutdown check and the +3 PSR

    const falls = [];
    const shutdowns = [];
    engine.eventBus.on('unitFell', d => falls.push(d));
    engine.eventBus.on('involuntaryShutdown', d => shutdowns.push(d));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(true);
    expect(atlas.prone).toBe(true);
    expect(shutdowns).toHaveLength(1);

    // p56/p74: a standing fall of a 100-ton Mech is ceil(100/10) = 10 damage,
    // applied in 5-point groupings.
    expect(shutdowns[0].fall).toMatchObject({
      pilotHit: true,
      levelsFallen: 0,
      damage: 10,
      damageGroupings: [5, 5],
      hitLocationColumn: 'front'
    });

    // p54 footnote 2 / p58: the shutdown 'Mech is immobile, so the warrior
    // takes the point of damage automatically; the injury then forces an
    // immediate Consciousness Roll.
    expect(shutdowns[0].fall.pilotPSR).toMatchObject({ autoDamage: true, passed: false });
    expect(atlas.pilot.hits).toBe(1);
    expect(atlas.pilot.conscious).toBe(false);
    expect(falls).toHaveLength(1);
  });

  it('emits heatResolved and heatPhase events', () => {
    const { engine } = twoMechEngine([8, 5]);
    const events = [];
    engine.eventBus.on('heatResolved', d => events.push({ type: 'heatResolved', data: d }));
    engine.eventBus.on('heatPhase', d => events.push({ type: 'heatPhase', data: d }));

    engine.phaseManager.enterPhase('heat');

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('heatResolved');
    expect(Array.isArray(events[0].data)).toBe(true);
    expect(events[1].type).toBe('heatPhase');
  });
});

// =============================================================================
// Consciousness: damage-time rolls and End-Phase recovery (p12/p58)
// =============================================================================

describe('Consciousness', () => {
  it('a conscious pilot does not roll in the End Phase', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    engine.diceRoller = makeDiceRoller(2);
    atlas.pilot.hits = 3;
    atlas.pilot.conscious = true;

    const rolls = [];
    engine.eventBus.on('consciousnessRoll', d => rolls.push(d));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
    expect(rolls).toHaveLength(0);
  });

  it('an unconscious pilot recovers in the End Phase of a later turn', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    engine.diceRoller = makeDiceRoller(7);
    atlas.pilot.hits = 3;
    atlas.pilot.conscious = false;
    atlas.pilot.unconsciousTurn = 0;

    const events = [];
    engine.eventBus.on('pilotRegainedConsciousness', d => events.push(d));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ unitId: 'atlas-0', roll: 7, target: 7 });
  });

  it.each([[1, 3], [2, 5], [3, 7], [4, 10], [5, 11]])(
    'a warrior with %i hits needs %i+ to regain consciousness',
    (hits, target) => {
      const { engine, atlas } = twoMechEngine([8, 5]);
      engine.diceRoller = makeDiceRoller(target - 1);
      atlas.pilot.hits = hits;
      atlas.pilot.conscious = false;
      atlas.pilot.unconsciousTurn = 0;

      const stillOut = [];
      engine.eventBus.on('pilotStillUnconscious', d => stillOut.push(d));

      engine.phaseManager.enterPhase('end');

      expect(atlas.pilot.conscious).toBe(false);
      expect(stillOut).toHaveLength(1);
      expect(stillOut[0].target).toBe(target);
    }
  );

  it('does not roll for a pilot knocked out during this turn', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    engine.diceRoller = makeDiceRoller(12);
    atlas.pilot.hits = 1;
    atlas.pilot.conscious = false;
    atlas.pilot.unconsciousTurn = engine.stateManager.getState().turn;

    const events = [];
    engine.eventBus.on('pilotRegainedConsciousness', d => events.push(d));

    engine.phaseManager.enterPhase('end');

    expect(atlas.pilot.conscious).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('the sixth point of damage kills the warrior', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const killed = [];
    engine.eventBus.on('pilotKilled', d => killed.push(d));

    engine.phaseManager.rollConsciousness(atlas, { hits: 6 });

    expect(atlas.pilot.dead).toBe(true);
    expect(atlas.pilot.conscious).toBe(false);
    expect(killed).toHaveLength(1);
  });

  it('an unconscious pilot is immobile and cannot act', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.enterPhase('movement');

    atlas.pilot.conscious = false;
    engine.phaseManager.advanceQueue(); // atlas-0 declares second in movement

    expect(engine.phaseManager.validateAction('move', 0, 'atlas-0').valid).toBe(false);
    expect(engine.phaseManager.validateAction('pass', 0, 'atlas-0').valid).toBe(true);
  });
});

// =============================================================================
// Shutdown restart (p12/p52)
// =============================================================================

describe('Shutdown restart', () => {
  it('restarts automatically below 14 heat in the Heat Phase', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    engine.diceRoller = makeDiceRoller(12);
    atlas.shutdown = true;
    atlas.heat = 10;

    const events = [];
    engine.eventBus.on('unitRestarted', d => events.push(d));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ unitId: 'atlas-0', auto: true });
  });

  it('rolls against the current avoid target in the Heat Phase', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 14; // 14 heat -> avoid on 4+
    atlas.shutdown = true;
    // Shutdown-avoid roll first (12), then the restart roll (3 < 4).
    engine.diceRoller = makeSequencedDiceRoller([12, 3]);

    const events = [];
    engine.eventBus.on('unitRestartFailed', d => events.push(d));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.heat).toBe(14);
    expect(atlas.shutdown).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ roll: 3, target: 4 });
  });

  it('no restart is possible at 30 or more heat', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    const sinks = atlas.getHeatDissipation();
    atlas.heat = sinks + 30;
    atlas.shutdown = true;
    engine.diceRoller = makeDiceRoller(12);

    const blocked = [];
    engine.eventBus.on('unitRestartBlocked', d => blocked.push(d));

    engine.phaseManager.enterPhase('heat');

    expect(atlas.shutdown).toBe(true);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toBe('overflow heat');
  });

  it('non-shutdown unit is not checked for restart', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    engine.diceRoller = makeDiceRoller(2);
    atlas.shutdown = false;

    const events = [];
    engine.eventBus.on('unitRestarted', d => events.push(d));
    engine.eventBus.on('unitRestartFailed', d => events.push(d));
    engine.eventBus.on('unitRestartBlocked', d => events.push(d));

    engine.phaseManager.enterPhase('heat');
    expect(events).toHaveLength(0);
  });
});

// =============================================================================
// End phase cleanup
// =============================================================================

describe('End phase cleanup', () => {
  it('resets torsoTwist, armsReversed, movement modifiers, hexesMoved, movementMode', () => {
    const { engine, atlas } = twoMechEngine([8, 5]);
    atlas.torsoTwist = 1;
    atlas.armsReversed = true;
    atlas._movementModifier = 2;
    atlas._targetMovementModifier = 3;
    atlas.hexesMoved = 10;
    atlas.movementMode = 'run';

    engine.phaseManager.enterPhase('end');

    expect(atlas.torsoTwist).toBe(0);
    expect(atlas.armsReversed).toBe(false);
    expect(atlas._movementModifier).toBe(0);
    expect(atlas._targetMovementModifier).toBe(0);
    expect(atlas.hexesMoved).toBe(0);
    expect(atlas.movementMode).toBe('walk');
  });

  it('advances smoke timers, removing expired smoke', () => {
    const { engine } = twoMechEngine([8, 5]);
    const state = engine.stateManager.getState();
    state.smokeHexes['3,3'] = { turnsRemaining: 2, level: 1 };
    state.smokeHexes['4,4'] = { turnsRemaining: 1, level: 1 };

    engine.phaseManager.enterPhase('end');

    expect(state.smokeHexes['3,3'].turnsRemaining).toBe(1);
    expect(state.smokeHexes['4,4']).toBeUndefined();
  });
});

// =============================================================================
// Events
// =============================================================================

describe('Events', () => {
  it('emit phaseChanged with phase and turn on every phase entry', () => {
    const { engine } = twoMechEngine([8, 5, 8, 5, 8, 5]);
    const events = [];
    engine.eventBus.on('phaseChanged', d => events.push(d));

    engine.phaseManager.enterPhase('initiative');
    engine.phaseManager.nextPhase();
    engine.phaseManager.nextPhase();

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ phase: 'initiative', turn: 1 });
    expect(events[1]).toMatchObject({ phase: 'movement', turn: 1 });
    expect(events[2]).toMatchObject({ phase: 'weapon_attack', turn: 1 });
  });

  it('emit initiativeRolled on initiative phase entry', () => {
    const { engine } = twoMechEngine([8, 5]);
    const events = [];
    engine.eventBus.on('initiativeRolled', d => events.push(d));

    engine.phaseManager.enterPhase('initiative');

    expect(events).toHaveLength(1);
    expect(events[0].winner).toBeDefined();
    expect(events[0].rolls).toHaveLength(2);
  });

  it('emit initiativeChoice when chooseInitiative is called', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    const events = [];
    engine.eventBus.on('initiativeChoice', d => events.push(d));

    engine.phaseManager.chooseInitiative(true);
    expect(events).toHaveLength(1);
    expect(events[0].goFirst).toBe(true);
  });

  it('emit movementPhase with queue on movement entry', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    const events = [];
    engine.eventBus.on('movementPhase', d => events.push(d));

    engine.phaseManager.enterPhase('movement');

    expect(events).toHaveLength(1);
    expect(events[0].queue).toHaveLength(2);
  });

  it('emit weaponAttackPhase with queue on weapon attack entry', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    const events = [];
    engine.eventBus.on('weaponAttackPhase', d => events.push(d));

    engine.phaseManager.enterPhase('weapon_attack');

    expect(events).toHaveLength(1);
    expect(events[0].queue).toHaveLength(2);
  });

  it('emit physicalAttackPhase with queue on physical attack entry', () => {
    const { engine } = twoMechEngine([8, 5]);
    engine.phaseManager.enterPhase('initiative');
    const events = [];
    engine.eventBus.on('physicalAttackPhase', d => events.push(d));

    engine.phaseManager.enterPhase('physical_attack');

    expect(events).toHaveLength(1);
    expect(events[0].queue).toHaveLength(2);
  });

  it('emit endPhase event', () => {
    const { engine } = twoMechEngine([8, 5]);
    const events = [];
    engine.eventBus.on('endPhase', d => events.push(d));

    engine.phaseManager.enterPhase('end');

    expect(events).toHaveLength(1);
  });

  it('multiple events fire in correct order during a full phase traversal', () => {
    const { engine } = twoMechEngine([8, 5, 8, 5, 8, 5]);
    const emitted = [];
    const eventNames = [
      'initiativeRolled', 'phaseChanged', 'movementPhase',
      'weaponAttackPhase', 'physicalAttackPhase',
      'heatResolved', 'heatPhase', 'endPhase'
    ];
    for (const name of eventNames) {
      engine.eventBus.on(name, d => emitted.push(name));
    }

    engine.phaseManager.enterPhase('initiative');
    for (let i = 1; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    expect(emitted).toContain('initiativeRolled');
    expect(emitted).toContain('movementPhase');
    expect(emitted).toContain('weaponAttackPhase');
    expect(emitted).toContain('physicalAttackPhase');
    expect(emitted).toContain('heatResolved');
    expect(emitted).toContain('heatPhase');
    expect(emitted).toContain('endPhase');
  });
});

// =============================================================================
// Multiple turn cycles
// =============================================================================

describe('Multiple turn cycles', () => {
  it('complete three full turn cycles maintain correct phase sequence', () => {
    const rolls = [];
    for (let i = 0; i < 30; i++) {
      rolls.push(i % 2 === 0 ? 8 : 5);
    }
    const { engine } = twoMechEngine(rolls);

    for (let turn = 0; turn < 3; turn++) {
      for (let phaseIdx = 0; phaseIdx < PHASES.length; phaseIdx++) {
        expect(engine.phaseManager.currentPhase).toBe(PHASES[phaseIdx]);
        engine.phaseManager.nextPhase();
      }
    }

    expect(engine.stateManager.getState().turn).toBe(4);
  });

  it('initiative is re-rolled each turn via initiativeRolled event', () => {
    const { engine } = twoMechEngine([8, 5, 8, 5, 8, 5, 8, 5]);
    const events = [];
    engine.eventBus.on('initiativeRolled', d => events.push(d));

    engine.phaseManager.enterPhase('initiative');
    expect(events).toHaveLength(1);

    for (let i = 0; i < PHASES.length; i++) {
      engine.phaseManager.nextPhase();
    }

    expect(engine.stateManager.getState().turn).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[1].winner).toBeDefined();
  });

  it('state is consistent after multiple turn cycles', () => {
    const { engine, atlas, jenner } = twoMechEngine([8, 5, 8, 5, 8, 5, 8, 5, 8, 5, 8, 5, 8, 5]);

    engine.phaseManager.enterPhase('initiative');

    for (let i = 0; i < PHASES.length * 2; i++) {
      engine.phaseManager.nextPhase();
    }

    expect(engine.stateManager.getState().turn).toBe(3);
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(atlas.torsoTwist).toBe(0);
    expect(atlas.armsReversed).toBe(false);
    expect(jenner.torsoTwist).toBe(0);
    expect(jenner.armsReversed).toBe(false);
  });
});
