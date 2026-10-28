/**
 * M2 - replay equivalence.
 *
 * The multiplayer and save/replay story rests on this: an engine rebuilt with
 * the same game id and fed the same actions must end in the same state.
 */

import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/engine/GameEngine.js';
import { createTestGameState, createTestUnit, createWeaponDef } from '../helpers/testUtils.js';
import hitTables from '../../src/data/hitTables.json' with { type: 'json' };

function buildEngine(gameId) {
  const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
  const jenner = createTestUnit('jenner-jr7d', 1, 'jenner');
  atlas.position = { hexKey: '5,7', facing: 0 };
  jenner.position = { hexKey: '5,5', facing: 3 };

  const state = createTestGameState({ units: { atlas, jenner } });
  const engine = new GameEngine(state, { gameId });
  engine.initCombat(hitTables);
  return engine;
}

const STEPS = [
  { phase: 'movement', currentPlayer: 0 },
  { action: { type: 'move', unitId: 'atlas', path: ['5,7', '5,6'], movementType: 'walk' }, playerId: 0 },
  { phase: 'weapon_attack', currentPlayer: 0 },
  {
    action: {
      type: 'fire', attackerId: 'atlas', targetId: 'jenner',
      weapon: 'med_laser', weaponLocation: 'rightArm'
    },
    playerId: 0
  },
  { phase: 'physical_attack', currentPlayer: 0 },
  {
    action: { type: 'physicalAttack', attackerId: 'atlas', targetId: 'jenner', attackType: 'punch' },
    playerId: 0
  },
  { phase: 'heat' },
  { phase: 'end' }
];

function run(engine) {
  for (const step of STEPS) {
    if (step.phase) {
      engine.phaseManager.enterPhase(step.phase);
      engine.phaseManager.clearQueue();
    }
    if (step.currentPlayer !== undefined) {
      engine.stateManager.getState().currentPlayer = step.currentPlayer;
    }
    if (step.action) {
      const action = { ...step.action };
      if (action.weapon) action.weapon = createWeaponDef(action.weapon);
      engine.processAction(step.playerId, action);
    }
  }
}

describe('replay equivalence', () => {
  it('reaches the same state from the same game id and actions', () => {
    const first = buildEngine('replay-game-1');
    const second = buildEngine('replay-game-1');

    run(first);
    run(second);

    const a = first.stateManager.getState().toJSON();
    const b = second.stateManager.getState().toJSON();

    expect(a.turn).toBe(b.turn);
    expect(a.phase).toBe(b.phase);
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it('produces different dice streams for different game ids', () => {
    const first = buildEngine('replay-game-1');
    const second = buildEngine('replay-game-2');

    const rollsA = [first.diceRoller.roll2d6(), first.diceRoller.roll2d6()];
    const rollsB = [second.diceRoller.roll2d6(), second.diceRoller.roll2d6()];

    expect(rollsA).not.toEqual(rollsB);
  });
});
