/**
 * GameState - top-level state container.
 * Manages turn, phase, players, units, map, and environmental conditions.
 */

import { deepClone, EventEmitter } from '../utils/helpers.js';

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
}
