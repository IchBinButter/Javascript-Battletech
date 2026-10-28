/**
 * StateManager - Manage game state with immutability and history.
 */

import { deepClone } from '../utils/helpers.js';

/** Normalise a map's hexes (Map, entry array from toJSON, or plain object). */
function hexSnapshot(map) {
  const hexes = (map && map.hexes) || {};
  const entries = hexes instanceof Map
    ? [...hexes.entries()]
    : Array.isArray(hexes) ? hexes : Object.entries(hexes);

  const normalised = new Map();
  for (const [key, hex] of entries) {
    normalised.set(key, typeof hex.toJSON === 'function' ? hex.toJSON() : hex);
  }
  return normalised;
}

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
   *
   * Accepts either live state (Unit/Hex instances, Map of hexes) or the plain
   * data from GameState.toJSON, because the server diffs live state against a
   * client's last snapshot.
   */
  getStateDiff(oldState, newState) {
    const diff = {};

    if (oldState.turn !== newState.turn) diff.turn = newState.turn;
    if (oldState.phase !== newState.phase) diff.phase = newState.phase;
    if (oldState.currentPlayer !== newState.currentPlayer) diff.currentPlayer = newState.currentPlayer;
    if (oldState.initiativeWinner !== newState.initiativeWinner) {
      diff.initiativeWinner = newState.initiativeWinner;
    }

    // Unit diffs
    diff.unitUpdates = {};
    for (const unitId of Object.keys(newState.units || {})) {
      const oldUnit = (oldState.units || {})[unitId];
      const newUnit = newState.units[unitId];
      if (!oldUnit || JSON.stringify(oldUnit) !== JSON.stringify(newUnit)) {
        diff.unitUpdates[unitId] = newUnit;
      }
    }

    // Fire and smoke (p63-64 state that lives outside the units).
    if (JSON.stringify(oldState.fireHexes) !== JSON.stringify(newState.fireHexes)) {
      diff.fireHexes = newState.fireHexes;
    }
    if (JSON.stringify(oldState.smokeHexes) !== JSON.stringify(newState.smokeHexes)) {
      diff.smokeHexes = newState.smokeHexes;
    }

    // Map hexes that changed: building CF, rubble from collapse, basements,
    // terrain set alight.
    const hexUpdates = {};
    const oldHexes = hexSnapshot(oldState.map);
    for (const [key, hex] of hexSnapshot(newState.map)) {
      const previous = oldHexes.get(key);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(hex)) {
        hexUpdates[key] = hex;
      }
    }
    if (Object.keys(hexUpdates).length > 0) diff.hexUpdates = hexUpdates;

    return diff;
  }

  /**
   * Apply a diff/patch to state.
   */
  applyStateDiff(state, diff) {
    if (diff.turn !== undefined) state.turn = diff.turn;
    if (diff.phase !== undefined) state.phase = diff.phase;
    if (diff.currentPlayer !== undefined) state.currentPlayer = diff.currentPlayer;
    if (diff.initiativeWinner !== undefined) state.initiativeWinner = diff.initiativeWinner;

    if (diff.unitUpdates) {
      for (const [id, data] of Object.entries(diff.unitUpdates)) {
        state.units[id] = data;
      }
    }

    if (diff.fireHexes) state.fireHexes = diff.fireHexes;
    if (diff.smokeHexes) state.smokeHexes = diff.smokeHexes;

    if (diff.hexUpdates) {
      const hexes = state.map.hexes;
      if (hexes instanceof Map) {
        for (const [key, data] of Object.entries(diff.hexUpdates)) {
          const existing = hexes.get(key);
          if (existing) Object.assign(existing, data);
          else hexes.set(key, data);
        }
      } else if (Array.isArray(hexes)) {
        for (const [key, data] of Object.entries(diff.hexUpdates)) {
          const entry = hexes.find(([k]) => k === key);
          if (entry) entry[1] = data;
          else hexes.push([key, data]);
        }
      } else if (hexes) {
        for (const [key, data] of Object.entries(diff.hexUpdates)) {
          hexes[key] = data;
        }
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
