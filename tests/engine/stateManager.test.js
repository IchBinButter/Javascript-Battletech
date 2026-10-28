/**
 * StateManager: mutation, history/undo, subscribers and diffs.
 */

import { describe, it, expect, vi } from 'vitest';
import { StateManager } from '../../src/engine/StateManager.js';

const makeState = () => ({
  turn: 1,
  phase: 'initiative',
  currentPlayer: 0,
  units: { u1: { id: 'u1', heat: 0 } }
});

describe('StateManager', () => {
  it('returns the state it was given', () => {
    const state = makeState();
    expect(new StateManager(state).getState()).toBe(state);
  });

  it('applies a change in place', () => {
    const manager = new StateManager(makeState());
    manager.applyStateChange((state) => { state.turn = 2; });

    expect(manager.getState().turn).toBe(2);
  });

  it('notifies subscribers on change', () => {
    const manager = new StateManager(makeState());
    const spy = vi.fn();
    manager.subscribe(spy);

    manager.applyStateChange((state) => { state.phase = 'movement'; });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].phase).toBe('movement');
  });

  it('undoes the last change', () => {
    const manager = new StateManager(makeState());
    manager.applyStateChange((state) => { state.turn = 5; });
    expect(manager.getState().turn).toBe(5);

    manager.undo();
    expect(manager.getState().turn).toBe(1);
  });

  it('does nothing when there is nothing to undo', () => {
    const manager = new StateManager(makeState());
    expect(() => manager.undo()).not.toThrow();
    expect(manager.getState().turn).toBe(1);
  });

  it('diffs scalar fields and changed units', () => {
    const manager = new StateManager(makeState());
    const before = makeState();
    const after = makeState();
    after.turn = 3;
    after.phase = 'movement';
    after.currentPlayer = 1;
    after.units.u1.heat = 7;

    const diff = manager.getStateDiff(before, after);

    expect(diff.turn).toBe(3);
    expect(diff.phase).toBe('movement');
    expect(diff.currentPlayer).toBe(1);
    expect(diff.unitUpdates.u1.heat).toBe(7);
  });

  it('produces no unit updates when nothing changed', () => {
    const manager = new StateManager(makeState());
    const diff = manager.getStateDiff(makeState(), makeState());

    expect(diff.turn).toBeUndefined();
    expect(diff.unitUpdates).toEqual({});
  });

  it('applies a diff back onto a state', () => {
    const manager = new StateManager(makeState());
    const state = makeState();

    manager.applyStateDiff(state, {
      turn: 4,
      phase: 'heat',
      currentPlayer: 1,
      unitUpdates: { u1: { id: 'u1', heat: 12 } }
    });

    expect(state.turn).toBe(4);
    expect(state.phase).toBe('heat');
    expect(state.currentPlayer).toBe(1);
    expect(state.units.u1.heat).toBe(12);
  });

  it('leaves fields alone when the diff omits them', () => {
    const manager = new StateManager(makeState());
    const state = makeState();

    manager.applyStateDiff(state, {});

    expect(state).toEqual(makeState());
  });
});
