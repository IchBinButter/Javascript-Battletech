/**
 * R1 - visibility seam. Hidden units must be absent from a player's view and
 * untargetable, without changing the shared engine state.
 */

import { describe, it, expect } from 'vitest';
import { createTestUnit, createTestEngine } from '../helpers/testUtils.js';
import { canSee, projectStateForPlayer } from '../../src/engine/visibility.js';

function hiddenEngine({ hidden = true } = {}) {
  const visible = createTestUnit('atlas-as7d', 0, 'atlas');
  const enemy = createTestUnit('locust-lct1v', 1, 'locust');
  visible.position = { hexKey: '5,5', facing: 0 };
  enemy.position = { hexKey: '5,8', facing: 3 };

  const engine = createTestEngine({ units: { atlas: visible, locust: enemy } });
  const state = engine.stateManager.getState();
  state.hiddenUnits = { locust: { hidden } };
  return { engine, state, visible, enemy };
}

describe('visibility', () => {
  it('lets a player always see their own units', () => {
    const { state } = hiddenEngine();
    expect(canSee(1, 'locust', state)).toBe(true);
  });

  it('hides a hidden enemy from the other player', () => {
    const { state } = hiddenEngine();
    expect(canSee(0, 'locust', state)).toBe(false);
  });

  it('reveals a unit once it is unhidden', () => {
    const { state } = hiddenEngine({ hidden: false });
    expect(canSee(0, 'locust', state)).toBe(true);
  });
});

describe('projectStateForPlayer', () => {
  it('drops hidden units from the projection', () => {
    const { state } = hiddenEngine();
    const view = projectStateForPlayer(state, 0);

    expect(Object.keys(view.units)).toEqual(['atlas']);
    expect(view.hiddenUnits).toEqual({});
    // The shared state is untouched.
    expect(state.units.locust).toBeDefined();
  });

  it('keeps the GameState helpers working on the projection', () => {
    const { state } = hiddenEngine();
    const view = projectStateForPlayer(state, 0);

    expect(view.getUnit('atlas')).toBeDefined();
    expect(view.getUnit('locust')).toBeNull();
    expect(view.getPlayerUnits(0)).toHaveLength(1);
  });

  it('shows both sides to a spectator who can see everything', () => {
    const { state } = hiddenEngine({ hidden: false });
    const view = projectStateForPlayer(state, 0);

    expect(Object.keys(view.units).sort()).toEqual(['atlas', 'locust']);
  });
});

describe('hidden units in combat', () => {
  it('refuses to fire at a hidden target', () => {
    const { engine } = hiddenEngine();
    engine.phaseManager.enterPhase('weapon_attack');
    const state = engine.stateManager.getState();
    const attacker = state.units.atlas;

    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust',
      weapon: attacker.getAllWeapons()[0], weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('hidden');
  });
});
