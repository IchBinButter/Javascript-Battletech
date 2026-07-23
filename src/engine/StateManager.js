/**
 * StateManager - Manage game state with immutability and history.
 */

import { deepClone } from '../utils/helpers.js';

export class StateManager {
  constructor(initialState) {
    this._state = initialState;
    this._history = [];
    this._historyIndex = -1;
    this.subscribers = [];
  }

  getState() {
    return this._state;
  }

  /**
   * Apply a state change. Pushes old state to history first.
   * @param {Function} changeFn - Receives state, modifies it in place
   */
  applyStateChange(changeFn) {
    // Push old state to history
    this._history.push(deepClone(this._state));
    this._historyIndex = this._history.length - 1;

    // Apply change
    changeFn(this._state);

    // Notify subscribers
    this.notifySubscribers();
  }

  /**
   * Undo last state change.
   */
  undo() {
    if (this._historyIndex >= 0) {
      this._state = deepClone(this._history[this._historyIndex]);
      this._historyIndex--;
      this.notifySubscribers();
    }
  }

  /**
   * Get JSON diff (patch) between two state snapshots.
   */
  getStateDiff(oldState, newState) {
    const diff = {};

    if (oldState.turn !== newState.turn) diff.turn = newState.turn;
    if (oldState.phase !== newState.phase) diff.phase = newState.phase;
    if (oldState.currentPlayer !== newState.currentPlayer) diff.currentPlayer = newState.currentPlayer;

    // Unit diffs
    diff.unitUpdates = {};
    for (const unitId of Object.keys(newState.units)) {
      const oldUnit = oldState.units[unitId];
      const newUnit = newState.units[unitId];
      if (!oldUnit || JSON.stringify(oldUnit) !== JSON.stringify(newUnit)) {
        diff.unitUpdates[unitId] = newUnit;
      }
    }

    return diff;
  }

  /**
   * Apply a diff/patch to state.
   */
  applyStateDiff(state, diff) {
    if (diff.turn !== undefined) state.turn = diff.turn;
    if (diff.phase !== undefined) state.phase = diff.phase;
    if (diff.currentPlayer !== undefined) state.currentPlayer = diff.currentPlayer;

    if (diff.unitUpdates) {
      for (const [id, data] of Object.entries(diff.unitUpdates)) {
        state.units[id] = data;
      }
    }
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  notifySubscribers() {
    for (const cb of this.subscribers) {
      cb(this._state);
    }
  }
}
