/**
 * PhaseManager - Phase state machine for BattleTech turn flow.
 *
 * Phase sequence: initiative → movement → weapon_attack → physical_attack → heat → end
 */

import { PHASES } from '../models/GameState.js';

export class PhaseManager {
  constructor() {
    this.engine = null;
    this.currentPhase = 'initiative';
    this.phaseCallbacks = {};
  }

  setEngine(gameEngine) {
    this.engine = gameEngine;
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

    // Emit phase change
    this.engine.eventBus.emit('phaseChanged', {
      phase,
      turn: this.engine.stateManager.getState().turn
    });

    // Call user-registered callback
    if (this.phaseCallbacks[phase]) {
      this.phaseCallbacks[phase]();
    }
  }

  _enterInitiative() {
    const state = this.engine.stateManager.getState();
    state.phase = 'initiative';

    // Roll initiative
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

    // Determine move order (loser moves first)
    const order = this.engine.initiativeManager.getInitiativeOrder(
      state.initiativeWinner,
      state.players,
      'movement'
    );
    state.currentPlayer = order[0];

    // Reset unit MP for all units
    for (const unit of Object.values(state.units)) {
      unit.currentMP = unit.movement.walk;
    }

    this.engine.eventBus.emit('movementPhase', { order });
  }

  _enterWeaponAttack() {
    const state = this.engine.stateManager.getState();
    state.phase = 'weapon_attack';

    const order = this.engine.initiativeManager.getInitiativeOrder(
      state.initiativeWinner,
      state.players,
      'weapon_attack'
    );
    state.currentPlayer = order[0];

    this.engine.eventBus.emit('weaponAttackPhase', { order });
  }

  _enterPhysicalAttack() {
    const state = this.engine.stateManager.getState();
    state.phase = 'physical_attack';

    // Winner moves first in physical attack
    const order = this.engine.initiativeManager.getInitiativeOrder(
      state.initiativeWinner,
      state.players,
      'physical_attack'
    );
    state.currentPlayer = order[0];

    this.engine.eventBus.emit('physicalAttackPhase', { order });
  }

  _enterHeatPhase() {
    const state = this.engine.stateManager.getState();
    state.phase = 'heat';

    // Heat is automatic - calculate for all units
    this.engine.eventBus.emit('heatPhase', {});
  }

  _enterEndPhase() {
    const state = this.engine.stateManager.getState();
    state.phase = 'end';

    // End phase cleanup
    for (const unit of Object.values(state.units)) {
      // Reset torso twists
      unit.torsoTwist = 0;
      unit.armsReversed = false;

      // Reset movement modifiers
      unit._movementModifier = 0;
      unit._targetMovementModifier = 0;
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
  validateAction(actionType, playerId) {
    const state = this.engine.stateManager.getState();

    // Must be current player's turn
    if (playerId !== state.currentPlayer) {
      return { valid: false, reason: 'Not your turn' };
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
      case 'endPhase':
        return { valid: true, reason: '' };
      case 'selectUnit':
        return { valid: true, reason: '' };
      default:
        return { valid: false, reason: `Unknown action: ${actionType}` };
    }
  }

  /**
   * Advance to the next phase.
   */
  nextPhase() {
    const idx = PHASES.indexOf(this.currentPhase);
    let next = null;

    if (idx < PHASES.length - 1) {
      next = PHASES[idx + 1];
    } else {
      // Start new turn
      const state = this.engine.stateManager.getState();
      state.turn++;
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
