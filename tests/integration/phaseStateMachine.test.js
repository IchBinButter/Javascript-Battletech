import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  makeDiceRoller,
  makeSequencedDiceRoller
} from '../helpers/testUtils.js';
import { PHASES } from '../../src/models/GameState.js';

describe('Integration: Phase State Machine Transitions', () => {
  function createEngineWithMechs() {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 0 };
    jenner.position = { hexKey: '10,7', facing: 3 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    return { engine, atlas, jenner };
  }

  it('PHASES array defines the correct sequence', () => {
    expect(PHASES).toEqual([
      'initiative',
      'movement',
      'weapon_attack',
      'physical_attack',
      'heat',
      'end'
    ]);
  });

  it('PhaseManager starts at initiative phase', () => {
    const { engine } = createEngineWithMechs();
    expect(engine.phaseManager.currentPhase).toBe('initiative');
  });

  it('nextPhase advances through all phases in order', () => {
    const { engine } = createEngineWithMechs();
    const transitions = [];

    for (let i = 0; i < PHASES.length; i++) {
      transitions.push(engine.phaseManager.currentPhase);
      engine.phaseManager.nextPhase();
    }

    expect(transitions).toEqual(PHASES);
  });

  it('nextPhase wraps from end back to initiative and increments turn', () => {
    const { engine } = createEngineWithMechs();
    // Use sequenced dice so initiative tie-breaking resolves (different rolls)
    engine.diceRoller = makeSequencedDiceRoller([8, 5, 8, 5, 8, 5]);
    const state = engine.stateManager.getState();
    expect(state.turn).toBe(1);

    // Advance to end phase (initiative is index 0, end is index 5)
    // Need 5 nextPhase calls: initiative→movement→weapon_attack→physical_attack→heat→end
    // First enter initiative to trigger dice roll
    engine.phaseManager.enterPhase('initiative');
    for (let i = 0; i < PHASES.length - 1; i++) {
      engine.phaseManager.nextPhase();
    }
    expect(engine.phaseManager.currentPhase).toBe('end');

    // Next phase should wrap to initiative and increment turn
    engine.phaseManager.nextPhase();
    expect(engine.phaseManager.currentPhase).toBe('initiative');
    expect(state.turn).toBe(2);
  });

  it('enterPhase sets both phaseManager.currentPhase and state.phase', () => {
    const { engine } = createEngineWithMechs();
    const state = engine.stateManager.getState();

    engine.phaseManager.enterPhase('movement');
    expect(engine.phaseManager.currentPhase).toBe('movement');
    expect(state.phase).toBe('movement');

    engine.phaseManager.enterPhase('weapon_attack');
    expect(engine.phaseManager.currentPhase).toBe('weapon_attack');
    expect(state.phase).toBe('weapon_attack');
  });

  it('enterPhase emits phaseChanged event', () => {
    const { engine } = createEngineWithMechs();
    const emitted = [];
    engine.eventBus.on('phaseChanged', (data) => emitted.push(data.phase));

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.enterPhase('weapon_attack');

    expect(emitted).toEqual(['movement', 'weapon_attack']);
  });

  it('enterPhase runs registered callback', () => {
    const { engine } = createEngineWithMechs();
    let callbackRan = false;
    engine.phaseManager.onPhaseEnter('movement', () => { callbackRan = true; });

    engine.phaseManager.enterPhase('movement');
    expect(callbackRan).toBe(true);
  });

  it('validateAction allows movement only in movement phase', () => {
    const { engine } = createEngineWithMechs();
    const state = engine.stateManager.getState();
    state.currentPlayer = 0;

    // validateAction checks state.phase, not phaseManager.currentPhase
    state.phase = 'movement';
    engine.phaseManager.currentPhase = 'movement';
    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(true);

    state.phase = 'weapon_attack';
    engine.phaseManager.currentPhase = 'weapon_attack';
    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(false);

    state.phase = 'initiative';
    engine.phaseManager.currentPhase = 'initiative';
    expect(engine.phaseManager.validateAction('move', 0).valid).toBe(false);
  });

  it('validateAction allows fire only in weapon_attack phase', () => {
    const { engine } = createEngineWithMechs();
    const state = engine.stateManager.getState();
    state.currentPlayer = 0;

    state.phase = 'weapon_attack';
    engine.phaseManager.currentPhase = 'weapon_attack';
    expect(engine.phaseManager.validateAction('fire', 0).valid).toBe(true);

    state.phase = 'movement';
    engine.phaseManager.currentPhase = 'movement';
    expect(engine.phaseManager.validateAction('fire', 0).valid).toBe(false);

    state.phase = 'physical_attack';
    engine.phaseManager.currentPhase = 'physical_attack';
    expect(engine.phaseManager.validateAction('fire', 0).valid).toBe(false);
  });

  it('validateAction allows physicalAttack only in physical_attack phase', () => {
    const { engine } = createEngineWithMechs();
    const state = engine.stateManager.getState();
    state.currentPlayer = 0;

    state.phase = 'physical_attack';
    engine.phaseManager.currentPhase = 'physical_attack';
    expect(engine.phaseManager.validateAction('physicalAttack', 0).valid).toBe(true);

    state.phase = 'movement';
    engine.phaseManager.currentPhase = 'movement';
    expect(engine.phaseManager.validateAction('physicalAttack', 0).valid).toBe(false);
  });

  it('validateAction always allows endPhase and selectUnit', () => {
    const { engine } = createEngineWithMechs();
    const state = engine.stateManager.getState();
    state.currentPlayer = 0;

    for (const phase of PHASES) {
      engine.phaseManager.currentPhase = phase;
      expect(engine.phaseManager.validateAction('endPhase', 0).valid).toBe(true);
      expect(engine.phaseManager.validateAction('selectUnit', 0).valid).toBe(true);
    }
  });

  it('validateAction rejects actions from wrong player', () => {
    const { engine } = createEngineWithMechs();
    const state = engine.stateManager.getState();
    state.currentPlayer = 0;
    engine.phaseManager.currentPhase = 'movement';

    // Player 1 tries to move, but it's player 0's turn
    const result = engine.phaseManager.validateAction('move', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Not your turn');
  });

  it('initiative phase rolls initiative and sets winner', () => {
    const { engine } = createEngineWithMechs();
    // Use sequenced dice: player 0 rolls 8, player 1 rolls 5 → player 0 wins
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    engine.phaseManager.enterPhase('initiative');
    const state = engine.stateManager.getState();

    expect(state.initiativeWinner).toBeDefined();
    expect(state.initiativeWinner).toBe(0);
  });

  it('movement phase sets current player based on initiative', () => {
    const { engine } = createEngineWithMechs();
    // Player 0 wins initiative (rolls 8 vs 5)
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    engine.phaseManager.enterPhase('initiative');
    const state = engine.stateManager.getState();
    const winner = state.initiativeWinner;

    engine.phaseManager.enterPhase('movement');

    // Movement: loser goes first (loser = player 1)
    expect(state.currentPlayer).toBe(1);
  });

  it('physical_attack phase has winner move first', () => {
    const { engine } = createEngineWithMechs();
    // Player 0 wins initiative
    engine.diceRoller = makeSequencedDiceRoller([8, 5]);

    engine.phaseManager.enterPhase('initiative');
    const state = engine.stateManager.getState();
    const winner = state.initiativeWinner;

    engine.phaseManager.enterPhase('physical_attack');

    // Physical attack: winner goes first
    expect(state.currentPlayer).toBe(winner);
  });

  it('end phase resets unit modifiers', () => {
    const { engine, atlas } = createEngineWithMechs();
    atlas.torsoTwist = 1;
    atlas.armsReversed = true;
    atlas._movementModifier = 2;
    atlas._targetMovementModifier = 3;

    engine.phaseManager.enterPhase('end');

    expect(atlas.torsoTwist).toBe(0);
    expect(atlas.armsReversed).toBe(false);
    expect(atlas._movementModifier).toBe(0);
    expect(atlas._targetMovementModifier).toBe(0);
  });

  it('multiple full turn cycles maintain consistent state', () => {
    const { engine, atlas, jenner } = createEngineWithMechs();
    // Need enough different rolls for initiative each cycle (2 players × 3 turns)
    // Each initiative needs at least 2 rolls, sometimes more if ties happen
    // Use alternating high/low to avoid ties
    const rolls = [];
    for (let i = 0; i < 20; i++) rolls.push(i % 2 === 0 ? 8 : 5);
    engine.diceRoller = makeSequencedDiceRoller(rolls);

    for (let turn = 0; turn < 3; turn++) {
      for (let phaseIdx = 0; phaseIdx < PHASES.length; phaseIdx++) {
        const expectedPhase = PHASES[phaseIdx];
        expect(engine.phaseManager.currentPhase).toBe(expectedPhase);
        engine.phaseManager.nextPhase();
      }
    }

    expect(engine.stateManager.getState().turn).toBe(4);
  });
});
