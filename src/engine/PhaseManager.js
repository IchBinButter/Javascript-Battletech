/**
 * PhaseManager - Phase state machine for BattleTech turn flow.
 *
 * Phase sequence: initiative → movement → weapon_attack → physical_attack → heat → end
 *
 * Movement, weapon_attack, and physical_attack phases use per-unit alternation.
 * The phaseUnitQueue alternates units between players; phaseUnitIndex advances on each action.
 */

import { PHASES } from '../models/GameState.js';
import { createSeededDice } from '../utils/dice.js';

export class PhaseManager {
  constructor() {
    this.engine = null;
    this.currentPhase = 'initiative';
    this.phaseCallbacks = {};
    this.phaseUnitQueue = [];
    this.phaseUnitIndex = 0;
    this.initiativeWinnerGoesFirst = false;
  }

  setEngine(gameEngine) {
    this.engine = gameEngine;
  }

  /**
   * Initiative winner chooses whether to move first (affects movement/weapon phases).
   */
  chooseInitiative(goFirst) {
    this.initiativeWinnerGoesFirst = !!goFirst;
    this.engine.eventBus.emit('initiativeChoice', { goFirst: this.initiativeWinnerGoesFirst });
  }

  /**
   * Build alternating player/unit queue for per-unit action ordering.
   */
  buildUnitQueue(firstPlayer, secondPlayer) {
    const state = this.engine.stateManager.getState();
    const firstUnits = state.getPlayerUnits(firstPlayer.id);
    const secondUnits = state.getPlayerUnits(secondPlayer.id);

    const queue = [];
    const maxLen = Math.max(firstUnits.length, secondUnits.length);

    for (let i = 0; i < maxLen; i++) {
      if (i < firstUnits.length) {
        queue.push({ playerId: firstUnits[i].player, unitId: firstUnits[i].id });
      }
      if (i < secondUnits.length) {
        queue.push({ playerId: secondUnits[i].player, unitId: secondUnits[i].id });
      }
    }

    return queue;
  }

  /** Get the current queue entry, or null if empty/exhausted. */
  getCurrentQueueEntry() {
    if (this.phaseUnitQueue.length === 0 || this.phaseUnitIndex >= this.phaseUnitQueue.length) {
      return null;
    }
    return this.phaseUnitQueue[this.phaseUnitIndex];
  }

  /** Advance queue index. Returns true if no more entries remain. */
  advanceQueue() {
    if (this.phaseUnitQueue.length === 0) {
      return false;
    }
    this.phaseUnitIndex++;
    if (this.phaseUnitIndex >= this.phaseUnitQueue.length) {
      return true;
    }
    const entry = this.phaseUnitQueue[this.phaseUnitIndex];
    const state = this.engine.stateManager.getState();
    state.currentPlayer = entry.playerId;
    this.engine.eventBus.emit('queueAdvanced', entry);
    return false;
  }

  /** Advance queue; if exhausted, auto-call nextPhase. Returns true if phase advanced. */
  advanceQueueOrNextPhase() {
    if (this.advanceQueue()) {
      this.nextPhase();
      return true;
    }
    return false;
  }

  /** Clear the current unit queue. */
  clearQueue() {
    this.phaseUnitQueue = [];
    this.phaseUnitIndex = 0;
  }

  /**
   * Enter a new phase. Runs phase entry hooks.
   */
  enterPhase(phase) {
    this.currentPhase = phase;

    switch (phase) {
      case 'initiative':
        this._enterInitiative();
        break;
      case 'movement':
        this._enterMovement();
        break;
      case 'weapon_attack':
        this._enterWeaponAttack();
        break;
      case 'physical_attack':
        this._enterPhysicalAttack();
        break;
      case 'heat':
        this._enterHeatPhase();
        break;
      case 'end':
        this._enterEndPhase();
        break;
    }

    this.engine.eventBus.emit('phaseChanged', {
      phase,
      turn: this.engine.stateManager.getState().turn
    });

    if (this.phaseCallbacks[phase]) {
      this.phaseCallbacks[phase]();
    }
  }

  _enterInitiative() {
    const state = this.engine.stateManager.getState();
    state.phase = 'initiative';

    this.initiativeWinnerGoesFirst = false;

    const result = this.engine.initiativeManager.rollInitiative(
      state.players,
      this.engine.diceRoller
    );
    state.initiativeWinner = result.winner;

    this.engine.eventBus.emit('initiativeRolled', result);
  }

  _enterMovement() {
    const state = this.engine.stateManager.getState();
    state.phase = 'movement';

    const winner = state.initiativeWinner;
    const players = state.players;
    const loser = players.find(p => p.id !== winner) || players[0];
    const winnerPlayer = players.find(p => p.id === winner) || players[0];

    // Build alternating queue: loser first unless winner chose to go first
    const first = this.initiativeWinnerGoesFirst ? winnerPlayer : loser;
    const second = this.initiativeWinnerGoesFirst ? loser : winnerPlayer;

    this.phaseUnitQueue = this.buildUnitQueue(first, second);
    this.phaseUnitIndex = 0;

    // MP is derived (getMaxMP); only the mode it is based on needs resetting
    for (const unit of Object.values(state.units)) {
      unit.movementMode = 'walk';
      unit.firedThisTurn = new Set();
    }

    // Set current player from queue
    const entry = this.phaseUnitQueue[0];
    if (entry) {
      state.currentPlayer = entry.playerId;
    }

    this.engine.eventBus.emit('movementPhase', { queue: this.phaseUnitQueue });
  }

  _enterWeaponAttack() {
    const state = this.engine.stateManager.getState();
    state.phase = 'weapon_attack';

    // Spotting, attacking and secondary targets are per-phase (p27, p30).
    for (const unit of Object.values(state.units)) {
      unit.spottedThisPhase = null;
      unit.attackedThisPhase = false;
      unit.targetsAttackedThisPhase = new Set();
    }

    const winner = state.initiativeWinner;
    const players = state.players;
    const loser = players.find(p => p.id !== winner) || players[0];
    const winnerPlayer = players.find(p => p.id === winner) || players[0];

    const first = this.initiativeWinnerGoesFirst ? winnerPlayer : loser;
    const second = this.initiativeWinnerGoesFirst ? loser : winnerPlayer;

    this.phaseUnitQueue = this.buildUnitQueue(first, second);
    this.phaseUnitIndex = 0;

    const entry = this.phaseUnitQueue[0];
    if (entry) {
      state.currentPlayer = entry.playerId;
    }

    this.engine.eventBus.emit('weaponAttackPhase', { queue: this.phaseUnitQueue });
  }

  _enterPhysicalAttack() {
    const state = this.engine.stateManager.getState();
    state.phase = 'physical_attack';

    const winner = state.initiativeWinner;
    const players = state.players;
    const loser = players.find(p => p.id !== winner) || players[0];
    const winnerPlayer = players.find(p => p.id === winner) || players[0];

    // Physical attack: winner goes first (not affected by winner's choice)
    this.phaseUnitQueue = this.buildUnitQueue(winnerPlayer, loser);
    this.phaseUnitIndex = 0;

    const entry = this.phaseUnitQueue[0];
    if (entry) {
      state.currentPlayer = entry.playerId;
    }

    this.engine.eventBus.emit('physicalAttackPhase', { queue: this.phaseUnitQueue });
  }

  _enterHeatPhase() {
    const state = this.engine.stateManager.getState();
    state.phase = 'heat';

    // Remember who was running before the heat phase, to catch involuntary
    // shutdowns (p52: they force a PSR at +3).
    const wasShutdown = new Map();
    for (const unit of Object.values(state.units)) {
      wasShutdown.set(unit.id, Boolean(unit.shutdown));
    }

    // Auto-resolve heat for all units
    if (this.engine && this.engine.heatManager) {
      // Fire damage lands before heat dissipation (p63).
      if (typeof this.engine.resolveFireDamage === 'function') {
        this.engine.resolveFireDamage();
      }
      const heatResults = this.engine.heatManager.resolveHeatPhase(state, this.engine.diceRoller);
      this.engine.eventBus.emit('heatResolved', heatResults);
    }

    for (const unit of Object.values(state.units)) {
      if (unit.shutdown && !wasShutdown.get(unit.id)) {
        const psr = this.engine.psrCalc.makePSR(unit, this.engine.diceRoller, [
          { trigger: 'Involuntary shutdown', baseModifier: 3 }
        ]);
        if (!psr.passed) unit.prone = true;
        this.engine.eventBus.emit('involuntaryShutdown', { unitId: unit.id, psr });
      }
    }

    this.engine.eventBus.emit('heatPhase', {});
  }

  _enterEndPhase() {
    const state = this.engine.stateManager.getState();
    state.phase = 'end';

    // A hex that started on fire fills the hexes downwind with smoke, fires
    // spread, and burning buildings lose CF (p64).
    if (typeof this.engine.resolveEndPhaseFire === 'function') {
      this.engine.resolveEndPhaseFire();
    }

    // Scheduled battlefield support strikes resolve in the End Phase of the
    // turn they were called for, then expire (p.75-79).
    if (typeof this.engine.resolveScheduledSupport === 'function') {
      this.engine.resolveScheduledSupport();
    }

    // Consciousness checks
    for (const unit of Object.values(state.units)) {
      if (unit.pilot.hits > 0 && unit.pilot.conscious) {
        // p58: 3+, 5+, 7+, 10+, 11+, then dead on the sixth point.
        const consciousnessTargets = [0, 3, 5, 7, 10, 11, null];
        const hits = Math.min(unit.pilot.hits, 6);
        const target = consciousnessTargets[hits];

        if (target === null) {
          // 5+ hits: auto unconscious
          unit.pilot.conscious = false;
          this.engine.eventBus.emit('pilotUnconscious', {
            unitId: unit.id,
            roll: 0,
            target: 0,
            hits: unit.pilot.hits,
            auto: true
          });
        } else {
          const roll = this.engine.diceRoller.roll2d6();
          if (roll < target) {
            unit.pilot.conscious = false;
            this.engine.eventBus.emit('pilotUnconscious', {
              unitId: unit.id,
              roll,
              target,
              hits: unit.pilot.hits,
              auto: false
            });
          }
        }
      }
    }

    // Shutdown restart checks
    for (const unit of Object.values(state.units)) {
      if (unit.shutdown) {
        const roll = this.engine.diceRoller.roll2d6();
        if (roll >= 8) {
          unit.shutdown = false;
          this.engine.eventBus.emit('unitRestarted', { unitId: unit.id, roll });
        } else {
          this.engine.eventBus.emit('unitRestartFailed', { unitId: unit.id, roll });
        }
      }
    }

    // End phase cleanup
    for (const unit of Object.values(state.units)) {
      unit.torsoTwist = 0;
      unit.armsReversed = false;
      unit._movementModifier = 0;
      unit._targetMovementModifier = 0;
      unit.hexesMoved = 0;
      unit.movementMode = 'walk';
    }

    // Advance smoke timers
    for (const key of Object.keys(state.smokeHexes)) {
      state.smokeHexes[key].turnsRemaining--;
      if (state.smokeHexes[key].turnsRemaining <= 0) {
        delete state.smokeHexes[key];
      }
    }

    this.engine.eventBus.emit('endPhase', {});
  }

  /**
   * Validate if an action is allowed in the current phase.
   */
  validateAction(actionType, playerId, unitId = null) {
    const state = this.engine.stateManager.getState();

    // endPhase and selectUnit bypass queue/player checks
    if (actionType === 'endPhase' || actionType === 'selectUnit') {
      return { valid: true, reason: '' };
    }

    // Queue-based validation
    const entry = this.getCurrentQueueEntry();
    if (entry) {
      if (playerId !== entry.playerId) {
        return { valid: false, reason: 'Not your turn' };
      }
      if (unitId && unitId !== entry.unitId) {
        return { valid: false, reason: 'Not the current acting unit' };
      }
    } else {
      if (playerId !== state.currentPlayer) {
        return { valid: false, reason: 'Not your turn' };
      }
    }

    switch (actionType) {
      case 'move':
        return { valid: state.phase === 'movement', reason: 'Only in movement phase' };
      case 'fire':
        return { valid: state.phase === 'weapon_attack', reason: 'Only in weapon attack phase' };
      case 'physicalAttack':
        return { valid: state.phase === 'physical_attack', reason: 'Only in physical attack phase' };
      case 'confirmFacing':
        return { valid: state.phase === 'movement', reason: 'Only in movement phase' };
      case 'twistTorso':
      case 'flipArms':
        return { valid: state.phase === 'weapon_attack', reason: 'Only in weapon attack phase' };
      default:
        return { valid: false, reason: `Unknown action: ${actionType}` };
    }
  }

  /**
   * Advance to the next phase.
   */
  nextPhase() {
    this.clearQueue();

    const idx = PHASES.indexOf(this.currentPhase);
    let next = null;

    if (idx < PHASES.length - 1) {
      next = PHASES[idx + 1];
    } else {
      // Start new turn
      const state = this.engine.stateManager.getState();
      state.turn++;
      // Re-seed dice roller for the new turn
      this.engine.diceRoller = createSeededDice(this.engine.gameId, state.turn);
      next = PHASES[0];
    }

    this.enterPhase(next);
    return next;
  }

  /**
   * Register a callback for when a specific phase is entered.
   */
  onPhaseEnter(phase, callback) {
    this.phaseCallbacks[phase] = callback;
  }
}
