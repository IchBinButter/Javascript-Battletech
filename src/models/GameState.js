/**
 * GameState - top-level state container.
 * Manages turn, phase, players, units, map, and environmental conditions.
 */

import { deepClone, EventEmitter } from '../utils/helpers.js';
import { Unit } from './Unit.js';
import { Hex } from './Hex.js';

export const PHASES = [
  'initiative',
  'movement',
  'weapon_attack',
  'physical_attack',
  'heat',
  'end'
];

export class GameState {
  constructor(config = {}) {
    Object.assign(this, EventEmitter);

    this.turn = config.turn || 1;
    this.phase = config.phase || 'initiative';
    this.initiativeWinner = config.initiativeWinner || null;
    this.currentPlayer = config.currentPlayer || 0;

    this.players = config.players || [];
    this.units = config.units || {};  // Map of unitId -> Unit

    this.map = config.map || { width: 17, height: 15, hexes: {} };

    this.weather = config.weather || {
      type: 'clear',
      windDirection: 1,
      temperature: 20
    };

    this.battlefieldSupport = config.battlefieldSupport || {
      points: 12,
      selections: []
    };

    this.hiddenUnits = config.hiddenUnits || {};
    this.minefields = config.minefields || {};
    this.fireHexes = config.fireHexes || [];
    this.smokeHexes = config.smokeHexes || {};
    this.buildings = config.buildings || {};

    this.history = config.history || [];
  }

  /** Get all units for a player */
  getPlayerUnits(playerId) {
    return Object.values(this.units).filter(u => u.player === playerId);
  }

  /** Get a unit by ID */
  getUnit(unitId) {
    return this.units[unitId] || null;
  }

  /** Add a unit to the game state */
  addUnit(unit) {
    this.units[unit.id] = unit;
  }

  /** Get current player object */
  getCurrentPlayer() {
    return this.players[this.currentPlayer] || null;
  }

  /** Get opponent player index */
  getOpponentIndex() {
    return this.currentPlayer === 0 ? 1 : 0;
  }

  /** Advance to next player (for alternating moves) */
  nextPlayer() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    this.emit('playerChanged', { currentPlayer: this.currentPlayer });
  }

  /** Get a snapshot/clone of the current state */
  clone() {
    return new GameState(deepClone(this));
  }

  /** Push current state to history (for undo/replay) */
  pushHistory() {
    this.history.push({
      turn: this.turn,
      phase: this.phase,
      units: deepClone(this.units),
      fireHexes: [...this.fireHexes],
      smokeHexes: { ...this.smokeHexes }
    });
  }

  /** Check if a unit is hidden (double-blind rules) */
  isUnitHidden(unitId) {
    const entry = this.hiddenUnits[unitId];
    return entry && entry.hidden;
  }

  /** Reveal a hidden unit */
  revealUnit(unitId) {
    if (this.hiddenUnits[unitId]) {
      this.hiddenUnits[unitId].hidden = false;
    }
  }

  /** Plain data for saving and for sending over the wire. */
  toJSON() {
    const units = {};
    for (const [id, unit] of Object.entries(this.units)) {
      units[id] = typeof unit.toJSON === 'function' ? unit.toJSON() : unit;
    }

    const hexes = [];
    for (const [key, hex] of this.map.hexes) {
      hexes.push([key, typeof hex.toJSON === 'function' ? hex.toJSON() : hex]);
    }

    return {
      turn: this.turn,
      phase: this.phase,
      initiativeWinner: this.initiativeWinner,
      currentPlayer: this.currentPlayer,
      players: this.players,
      units,
      map: { width: this.map.width, height: this.map.height, hexes },
      weather: this.weather,
      battlefieldSupport: this.battlefieldSupport,
      hiddenUnits: this.hiddenUnits,
      minefields: this.minefields,
      fireHexes: this.fireHexes,
      smokeHexes: this.smokeHexes,
      buildings: this.buildings,
      history: this.history
    };
  }

  /** Rebuild a GameState (with Unit and Hex instances) from toJSON output. */
  static fromJSON(json) {
    const state = new GameState({
      turn: json.turn,
      phase: json.phase,
      initiativeWinner: json.initiativeWinner,
      currentPlayer: json.currentPlayer,
      players: json.players || [],
      weather: json.weather,
      battlefieldSupport: json.battlefieldSupport,
      hiddenUnits: json.hiddenUnits || {},
      minefields: json.minefields || {},
      fireHexes: json.fireHexes || [],
      smokeHexes: json.smokeHexes || {},
      buildings: json.buildings || {},
      history: json.history || []
    });

    state.units = {};
    for (const [id, unitJson] of Object.entries(json.units || {})) {
      state.units[id] = Unit.fromJSON(unitJson);
    }

    const hexes = new Map();
    for (const [key, hexJson] of (json.map && json.map.hexes) || []) {
      hexes.set(key, Hex.fromJSON(hexJson));
    }
    state.map = {
      width: (json.map && json.map.width) || 17,
      height: (json.map && json.map.height) || 15,
      hexes
    };

    return state;
  }
}
