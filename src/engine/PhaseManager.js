/**
 * PhaseManager - Phase state machine for BattleTech turn flow.
 *
 * Phase sequence: initiative → movement → weapon_attack → physical_attack → heat → end
 *
 * Movement, weapon_attack, and physical_attack phases declare in per-unit
 * alternation: the initiative loser declares first (p10) and the queue repeats
 * those steps for the Physical Attack Phase (p12). When the forces are unequal,
 * p12's Unequal Numbers of 'Mechs ratio is evaluated before each pair of
 * declarations (2:1 -> the larger side declares two, 3:1 -> three, and so on),
 * and it is re-evaluated against the 'Mechs still left to declare for, so a
 * 'Mech destroyed mid-phase changes the block sizes of the remaining pairs.
 * The phaseUnitQueue holds one entry per 'Mech; phaseUnitIndex advances on each
 * action.
 *
 * Timing rules owned here (BMM p10, p12, p52, p58):
 * - Consciousness Rolls happen when damage is taken (GameEngine calls
 *   `rollConsciousness`); the End Phase only offers *recovery* rolls to
 *   warriors who were already unconscious before this turn.
 * - Restart attempts happen in the Heat Phase, after the Heat Scale has been
 *   adjusted; below 14 heat the plant restarts automatically and at 30+ heat no
 *   restart is possible.
 * - Destroyed 'Mechs take no further declaration slots and are removed from
 *   the map at the end of the phase in which they died; a shut-down 'Mech or
 *   one with an unconscious warrior is immobile and may not act.
 * - The Physical Attack Phase repeats the Weapon Attack Phase, so the
 *   initiative loser declares first there as well.
 * - A building hex's CF damage is banked during the Weapon Attack Phase and
 *   applied at its end, so every hit in the phase uses the same CF.
 */

import { PHASES } from '../models/GameState.js';
import { createSeededDice } from '../utils/dice.js';
import { getHeatEffects } from '../rules/heat/HeatScale.js';

/** p58 Consciousness Table: consciousness number by total damage points. */
export const CONSCIOUSNESS_TARGETS = Object.freeze({ 1: 3, 2: 5, 3: 7, 4: 10, 5: 11 });

/** p58: "A warrior that takes 6 points of damage is dead." */
export const FATAL_PILOT_DAMAGE = 6;

/**
 * Consciousness number for a pilot's current total damage (p58).
 * @param {number} hits - total damage points the MechWarrior has taken
 * @returns {number|null} target number, or null when the warrior is dead
 */
export function consciousnessNumber(hits) {
  const damage = Math.max(0, Math.floor(Number.isFinite(hits) ? hits : 0));
  if (damage >= FATAL_PILOT_DAMAGE) return null;
  return damage === 0 ? 0 : CONSCIOUSNESS_TARGETS[damage];
}

/**
 * p12 "Unequal Numbers of 'Mechs": how many 'Mechs each side declares for in
 * the next pair, given how many each side still has left to declare for.
 *
 * "If, prior to any pair of movement or attack declarations, one team has at
 * least twice as many 'Mechs left to declare for as the other team, the team
 * with twice as many 'Mechs declares for two 'Mechs each time, rather than one.
 * If one team has at least three times as many 'Mechs, it declares for three
 * each time, and so on."
 *
 * The printed examples confirm the larger side declares
 * `floor(larger / smaller)` 'Mechs: 10 vs 18 stays 1:1 until 8 vs 16 (then the
 * 18-side declares 2), while 5 vs 14 starts at 2 because 14 / 5 = 2.8 -> two
 * (not three; three would need a 3:1 ratio). The smaller side always declares
 * one, and a side with nothing left to declare for hands the rest of the pair
 * to the other side.
 *
 * @param {number} firstLeft - 'Mechs the first-declaring side still has to declare
 * @param {number} secondLeft - 'Mechs the second-declaring side still has to declare
 * @returns {{first: number, second: number}} 'Mechs each side declares this pair
 */
export function declarationBlockSizes(firstLeft, secondLeft) {
  const first = Math.max(0, Math.floor(Number.isFinite(firstLeft) ? firstLeft : 0));
  const second = Math.max(0, Math.floor(Number.isFinite(secondLeft) ? secondLeft : 0));

  if (first === 0 || second === 0) return { first, second };
  if (first >= second * 2) return { first: Math.floor(first / second), second: 1 };
  if (second >= first * 2) return { first: 1, second: Math.floor(second / first) };
  return { first: 1, second: 1 };
}

export class PhaseManager {
  constructor() {
    this.engine = null;
    this.currentPhase = 'initiative';
    this.phaseCallbacks = {};
    this.phaseUnitQueue = [];
    this.phaseUnitIndex = 0;
    // p12 declaration bookkeeping: the two sides, where each pair of
    // declarations begins in phaseUnitQueue, and which pair starts have had
    // their block sizes settled already (see _maybeReevaluateDeclarationPair).
    this._declarationSides = null;
    this._pairStarts = [];
    this._evaluatedPairStarts = new Set();
  }

  setEngine(gameEngine) {
    this.engine = gameEngine;
  }

  /**
   * Is this 'Mech out of the game? p131: destroyed 'Mechs are removed from the
   * map; p58: a warrior who takes 6 points of damage is dead and their 'Mech is
   * removed at the end of the phase.
   */
  isDestroyedUnit(unit) {
    if (!unit) return false;
    if (typeof unit.isDestroyed === 'function' && unit.isDestroyed()) return true;
    return Boolean(unit.pilot && unit.pilot.dead);
  }

  /**
   * Is this 'Mech immobile? p52: a shutdown 'Mech "becomes immobile ... and it
   * cannot attack or take any other action". p58: a 'Mech with an unconscious
   * warrior "cannot move, fire, or take any other action". The flag is derived
   * here rather than written onto the unit, so it can never drift.
   */
  isImmobile(unit) {
    if (!unit) return false;
    if (unit.shutdown) return true;
    return Boolean(unit.pilot && (unit.pilot.conscious === false || unit.pilot.dead));
  }

  /**
   * Plan declaration entries for two sides from the 'Mechs each still has to
   * declare for.
   *
   * p10: "The side that lost Initiative must act first", then the winner, and
   * the declarations alternate. p12 "Unequal Numbers of 'Mechs" changes the
   * sizes of those alternating pairs: before each pair, a side with at least
   * twice as many 'Mechs left to declare for declares two, three at 3:1, and
   * so on (see `declarationBlockSizes`).
   *
   * `unavailableUnitIds` holds the 'Mechs that have already declared earlier in
   * the phase; the queue for the remaining pairs is rebuilt from this when the
   * ratio has to be re-evaluated mid-phase.
   *
   * @param {object} firstPlayer - side that declares first (the initiative loser)
   * @param {object} secondPlayer - side that declares second
   * @param {Set<string>|null} [unavailableUnitIds] - already-declared 'Mech ids
   * @returns {{entries: Array<{playerId:number, unitId:string}>, pairStarts: number[]}}
   *   entries in declaration order, plus the index in `entries` where each p12
   *   pair of declarations begins
   */
  _planDeclarationEntries(firstPlayer, secondPlayer, unavailableUnitIds = null) {
    const state = this.engine.stateManager.getState();
    const isAvailable = unit => !this.isDestroyedUnit(unit)
      && !(unavailableUnitIds && unavailableUnitIds.has(unit.id));

    const firstUnits = state.getPlayerUnits(firstPlayer.id).filter(isAvailable);
    const secondUnits = state.getPlayerUnits(secondPlayer.id).filter(isAvailable);

    const entries = [];
    const pairStarts = [];
    let firstIndex = 0;
    let secondIndex = 0;

    // p12 re-checks the ratio "prior to any pair of ... declarations", so a
    // pair is planned from the counts left when that pair starts.
    while (firstIndex < firstUnits.length || secondIndex < secondUnits.length) {
      pairStarts.push(entries.length);
      const blocks = declarationBlockSizes(
        firstUnits.length - firstIndex,
        secondUnits.length - secondIndex
      );

      for (let n = 0; n < blocks.first && firstIndex < firstUnits.length; n++) {
        const unit = firstUnits[firstIndex++];
        entries.push({ playerId: unit.player, unitId: unit.id });
      }
      for (let n = 0; n < blocks.second && secondIndex < secondUnits.length; n++) {
        const unit = secondUnits[secondIndex++];
        entries.push({ playerId: unit.player, unitId: unit.id });
      }
    }

    return { entries, pairStarts };
  }

  /**
   * Build the declaration queue for an acting phase, one entry per 'Mech.
   *
   * p10/p131: destroyed 'Mechs are out of the game and get no declaration slot.
   * An immobile 'Mech (shutdown or unconscious pilot) still receives a slot -
   * p10 lets a player assign a movement selection to it - but validation below
   * refuses any action that would make it move or fight.
   */
  buildUnitQueue(firstPlayer, secondPlayer) {
    return this._planDeclarationEntries(firstPlayer, secondPlayer).entries;
  }

  /**
   * Install the declaration plan for an acting phase and remember the sides so
   * that a pair can be re-evaluated after a mid-phase destruction.
   *
   * The plan installed here is only the phase-entry estimate; every pair,
   * including the first, is (re)planned when the queue reaches it, because p12
   * evaluates the ratio "prior to any pair of movement or attack declarations".
   */
  _enterDeclarationPhase(firstPlayer, secondPlayer) {
    const { entries, pairStarts } = this._planDeclarationEntries(firstPlayer, secondPlayer);

    this.phaseUnitQueue = entries;
    this.phaseUnitIndex = 0;
    this._declarationSides = { firstId: firstPlayer.id, secondId: secondPlayer.id };
    this._pairStarts = pairStarts;
    this._evaluatedPairStarts = new Set();
  }

  /**
   * Re-plan the pair that is about to start from the 'Mechs still left to
   * declare for.
   *
   * p12 evaluates the block sizes "prior to any pair of movement or attack
   * declarations", so a 'Mech destroyed after the phase began must change the
   * sizes from the next pair on. The pair that is already under way is never
   * changed - only a pair the queue has just reached. (A 4-vs-8 force that
   * loses two 'Mechs on the larger side, for example, re-plans its remaining
   * 1:2 pairs as 1:3 pairs once 2 vs 6 Mechs are left to declare.)
   *
   * @returns {boolean} whether a pair was re-planned
   */
  _maybeReevaluateDeclarationPair() {
    const index = this.phaseUnitIndex;
    if (!this._declarationSides) return false;
    if (!this._pairStarts.includes(index)) return false;
    if (this._evaluatedPairStarts.has(index)) return false;

    this._evaluatedPairStarts.add(index);

    const declaredUnitIds = new Set(
      this.phaseUnitQueue.slice(0, index).map(entry => entry.unitId)
    );
    const players = this.engine.stateManager.getState().players || [];
    const firstPlayer = players.find(p => p.id === this._declarationSides.firstId) || players[0];
    const secondPlayer = players.find(p => p.id === this._declarationSides.secondId) || firstPlayer;

    const { entries, pairStarts } = this._planDeclarationEntries(
      firstPlayer,
      secondPlayer,
      declaredUnitIds
    );

    this.phaseUnitQueue = this.phaseUnitQueue.slice(0, index).concat(entries);
    this._pairStarts = this._pairStarts
      .filter(start => start < index)
      .concat(pairStarts.map(start => start + index));

    return true;
  }

  /**
   * Step over queue entries whose 'Mech was destroyed earlier in the same
   * phase (p131: no further slots). Keeps `currentPlayer` in step.
   *
   * Also the point where p12's "prior to any pair" re-evaluation happens: when
   * the queue reaches a pair that has not been planned against the current
   * counts yet, the remaining pairs are rebuilt first (see
   * `_maybeReevaluateDeclarationPair`).
   */
  _skipDestroyedEntries() {
    if (!this.engine) return;
    const state = this.engine.stateManager.getState();

    let skipped = false;
    while (this.phaseUnitIndex < this.phaseUnitQueue.length) {
      this._maybeReevaluateDeclarationPair();

      const entry = this.phaseUnitQueue[this.phaseUnitIndex];
      const unit = state.getUnit(entry.unitId);
      if (unit && !this.isDestroyedUnit(unit)) break;
      this.phaseUnitIndex++;
      skipped = true;
    }

    if (skipped && this.phaseUnitIndex < this.phaseUnitQueue.length) {
      state.currentPlayer = this.phaseUnitQueue[this.phaseUnitIndex].playerId;
    }
  }

  /** Get the current queue entry, or null if empty/exhausted. */
  getCurrentQueueEntry() {
    this._skipDestroyedEntries();
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
    this._skipDestroyedEntries();
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

  /** Clear the current unit queue, including the p12 pair bookkeeping. */
  clearQueue() {
    this.phaseUnitQueue = [];
    this.phaseUnitIndex = 0;
    this._declarationSides = null;
    this._pairStarts = [];
    this._evaluatedPairStarts = new Set();
  }

  /**
   * Remove destroyed 'Mechs from play (p10/p131) at the end of the phase in
   * which they died - i.e. on the transition into the next phase. A dead
   * MechWarrior's 'Mech leaves the map the same way (p58).
   * @returns {Array<{unitId: string, playerId: number}>} removed units
   */
  _removeDestroyedUnits() {
    if (!this.engine) return [];
    const state = this.engine.stateManager.getState();
    const removed = [];

    for (const unit of Object.values(state.units)) {
      if (!this.isDestroyedUnit(unit)) continue;

      delete state.units[unit.id];
      if (state.hiddenUnits) delete state.hiddenUnits[unit.id];
      removed.push({ unitId: unit.id, playerId: unit.player });
    }

    for (const record of removed) {
      this.engine.eventBus.emit('unitRemoved', record);
    }

    return removed;
  }

  /**
   * Keep the derived `immobile` flag the attack resolver reads in step with
   * the 'Mech's state (p18/p28: an immobile target is attacked at -4).
   *
   * A shut-down 'Mech is immobile too (p52), but its own `shutdown` flag
   * already grants the same -4 modifier (AttackResolver), so it is left off
   * here to avoid applying -8.
   */
  refreshImmobileFlag(unit) {
    if (!unit) return false;
    const warriorOut = Boolean(unit.pilot && (unit.pilot.conscious === false || unit.pilot.dead));
    unit.immobile = warriorOut && !unit.shutdown;
    return unit.immobile;
  }

  /** Refresh the derived immobile flag for every unit on the map. */
  _refreshImmobileFlags() {
    if (!this.engine || !this.engine.stateManager) return;
    const state = this.engine.stateManager.getState();
    for (const unit of Object.values(state.units)) {
      this.refreshImmobileFlag(unit);
    }
  }

  /**
   * Consciousness Roll (p58). "Every time a warrior takes a point of damage,
   * its controller must immediately make a Consciousness Roll. Roll 2D6 ...
   * If the roll result is equal to or greater than the MechWarrior's
   * consciousness number, the warrior remains conscious."
   *
   * Called from the damage paths (GameEngine rolls whenever pilot damage lands)
   * and from the Heat Phase for heat-induced pilot damage. The sixth point of
   * damage kills the warrior instead of rolling.
   *
   * @param {object} unit
   * @param {{hits?: number, source?: string}} [options] hits = total damage to
   *   test against (defaults to the pilot's current total)
   * @returns {{rolled: boolean, roll?: number, target?: number|null,
   *   passed?: boolean, dead?: boolean, skipped?: boolean, reason?: string}}
   */
  rollConsciousness(unit, { hits = null, source = 'damage' } = {}) {
    const pilot = unit && unit.pilot;
    if (!pilot) return { rolled: false, skipped: true, reason: 'no pilot' };

    const total = Math.max(0, hits === null ? (pilot.hits || 0) : hits);

    // p58: "A warrior that takes 6 points of damage is dead." No roll is made -
    // the warrior's 'Mech is removed from play at the end of the phase.
    if (total >= FATAL_PILOT_DAMAGE) {
      return this._killPilot(unit, { hits: total, source });
    }

    // p58: "if a MechWarrior is knocked unconscious, no further Consciousness
    // Rolls need be made that turn."
    if (pilot.conscious === false) {
      return { rolled: false, skipped: true, reason: 'already unconscious' };
    }

    const target = consciousnessNumber(total);
    const roll = this.engine.diceRoller.roll2d6();
    const passed = roll >= target;

    this.engine.eventBus.emit('consciousnessRoll', {
      unitId: unit.id, roll, target, hits: total, passed, source
    });

    if (!passed) {
      pilot.conscious = false;
      pilot.unconsciousTurn = this.engine.stateManager.getState().turn;
      this.refreshImmobileFlag(unit);
      this.engine.eventBus.emit('pilotUnconscious', {
        unitId: unit.id, roll, target, hits: total, auto: false, source
      });
    }

    return { rolled: true, roll, target, passed };
  }

  /** p58: the sixth point of MechWarrior damage kills the warrior. */
  _killPilot(unit, { hits = FATAL_PILOT_DAMAGE, source = 'damage' } = {}) {
    const pilot = unit.pilot;
    // Unit.applyPilotDamage sets `dead` on the sixth hit; report the death once
    // even though the flag may already be set when the roll is reached.
    const firstReport = !pilot.deathReported;

    pilot.dead = true;
    pilot.conscious = false;
    pilot.deathReported = true;
    this.refreshImmobileFlag(unit);

    if (firstReport) {
      this.engine.eventBus.emit('pilotKilled', { unitId: unit.id, hits, source });
    }

    return { rolled: false, dead: true, hits };
  }

  /**
   * End-Phase recovery rolls for warriors who were already unconscious before
   * this turn (p12, p58). A pilot knocked out this turn does not roll yet, and
   * a conscious pilot never rolls in the End Phase.
   */
  _resolveConsciousnessRecovery(state) {
    const recovered = [];
    const stillOut = [];

    for (const unit of Object.values(state.units)) {
      const pilot = unit.pilot;
      if (!pilot || pilot.dead) continue;
      if (pilot.conscious !== false) continue;
      if ((pilot.hits || 0) <= 0) continue;

      // p58: recovery starts "the turn after the turn in which the MechWarrior
      // lost consciousness"; p12 phrases the same rule as "unconscious during
      // the Initiative Phase of this turn".
      if (pilot.unconsciousTurn === state.turn) continue;

      const target = consciousnessNumber(pilot.hits);
      if (target === null) continue;

      const roll = this.engine.diceRoller.roll2d6();
      if (roll >= target) {
        pilot.conscious = true;
        pilot.unconsciousTurn = undefined;
        this.refreshImmobileFlag(unit);
        recovered.push({ unitId: unit.id, roll, target, hits: pilot.hits });
      } else {
        stillOut.push({ unitId: unit.id, roll, target, hits: pilot.hits });
      }
    }

    for (const record of recovered) this.engine.eventBus.emit('pilotRegainedConsciousness', record);
    for (const record of stillOut) this.engine.eventBus.emit('pilotStillUnconscious', record);

    return { recovered, stillOut };
  }

  /**
   * Enter a new phase. Runs phase entry hooks.
   */
  enterPhase(phase) {
    // p58/p131: 'Mechs destroyed (or whose warrior was killed) in the phase that
    // just ended leave the map now, before the new phase builds its queue.
    this._removeDestroyedUnits();

    // Keep the derived immobile flag (p18/p28) in step with shutdown and
    // consciousness, which the Heat Phase and attacks change mid-turn.
    this._refreshImmobileFlags();

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

    const result = this.engine.initiativeManager.rollInitiative(
      state.players,
      this.engine.diceRoller
    );
    state.initiativeWinner = result.winner;

    this.engine.eventBus.emit('initiativeRolled', result);
  }

  /**
   * The two sides in declaration order for an acting phase (p10/p12).
   *
   * p10 Movement Phase: "The side that lost Initiative must act first." The
   * Weapon Attack Phase repeats that, and p12's Physical Attack Phase repeats
   * the Weapon Attack Phase, so the loser declares first in all three. The
   * winner's only choice on p10 is which side of the playing area to deploy
   * on, which is not a phase-order choice; the engine's old
   * winner-goes-first flag was a house rule (H-11) and has been removed.
   *
   * @returns {[object, object]} [first side, second side]
   */
  _getDeclarationSides() {
    const state = this.engine.stateManager.getState();
    const players = state.players || [];
    const [firstId, secondId] = this.engine.initiativeManager.getInitiativeOrder(
      state.initiativeWinner,
      players
    );

    const first = players.find(p => p.id === firstId) || players[0];
    const second = players.find(p => p.id === secondId) || first;
    return [first, second];
  }

  _enterMovement() {
    const state = this.engine.stateManager.getState();
    state.phase = 'movement';

    // p10: "The side that lost Initiative must act first."
    const [first, second] = this._getDeclarationSides();

    this._enterDeclarationPhase(first, second);

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

    // p72: a building's protection is fixed by the CF it had at the start of
    // the phase, and the CF damage it takes is only charged at the end of the
    // phase. Snapshot here so every hit in the phase reads the same value.
    if (state.map && state.map.hexes) {
      for (const [, hex] of state.map.hexes) {
        if (!hex.building) continue;
        hex._cfAtPhaseStart = hex.building.currentCF ?? hex.building.cf;
        hex._pendingCFDamage = 0;
      }
    }

    // p10 Weapon Attack Phase: "The side that lost Initiative must act first."
    const [first, second] = this._getDeclarationSides();

    this._enterDeclarationPhase(first, second);

    const entry = this.phaseUnitQueue[0];
    if (entry) {
      state.currentPlayer = entry.playerId;
    }

    this.engine.eventBus.emit('weaponAttackPhase', { queue: this.phaseUnitQueue });
  }

  _enterPhysicalAttack() {
    const state = this.engine.stateManager.getState();
    state.phase = 'physical_attack';

    // p72: the Weapon Attack Phase's building CF damage is settled at its end.
    // nextPhase() already does this on the normal transition; this also covers
    // a caller that enters the Physical Attack Phase directly (saves, tests).
    if (this.engine && typeof this.engine.applyPendingBuildingDamage === 'function') {
      this.engine.applyPendingBuildingDamage();
      this._clearBuildingSnapshots();
    }

    // p12: "Players repeat the steps given for the Weapon Attack Phase, except
    // for torso twisting" - so the initiative loser declares physical attacks
    // first, exactly as in the Weapon Attack Phase (p10).
    const [first, second] = this._getDeclarationSides();

    this._enterDeclarationPhase(first, second);

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
    // MechWarrior damage from heat (ammo explosions, life support) forces
    // Consciousness Rolls; remember each pilot's damage so the new points can
    // be rolled once the Heat Scale has been adjusted (p12/p52/p58).
    const pilotHitsBefore = new Map();
    for (const unit of Object.values(state.units)) {
      wasShutdown.set(unit.id, Boolean(unit.shutdown));
      pilotHitsBefore.set(unit.id, unit.pilot ? (unit.pilot.hits || 0) : 0);
    }

    // Auto-resolve heat for all units. Fire is outside heat (p50: +5 in a
    // burning hex, +2 per burning hex moved through), so HeatManager records it
    // in the same step as dissipation; it is not damage.
    if (this.engine && this.engine.heatManager) {
      const heatResults = this.engine.heatManager.resolveHeatPhase(state, this.engine.diceRoller);
      this.engine.eventBus.emit('heatResolved', heatResults);
    }

    // Pilot damage inflicted by the heat phase itself (ammo explosion, life
    // support) forces Consciousness Rolls. p58: "If a MechWarrior is forced to
    // make both a Consciousness Roll and a PSR at the same time, the
    // Consciousness Roll always comes first", so these are rolled before the
    // shutdown PSR below. The snapshot excludes the shutdown fall's own damage.
    const heatHitsAfter = new Map();
    for (const unit of Object.values(state.units)) {
      heatHitsAfter.set(unit.id, unit.pilot ? (unit.pilot.hits || 0) : 0);
    }

    for (const unit of Object.values(state.units)) {
      const before = pilotHitsBefore.get(unit.id);
      const after = heatHitsAfter.get(unit.id);
      if (before === undefined || !Number.isFinite(after) || after <= before) continue;
      this.engine.rollConsciousnessForNewPilotHits(unit, before, after);
    }

    for (const unit of Object.values(state.units)) {
      if (unit.shutdown && !wasShutdown.get(unit.id)) {
        const triggers = [{ trigger: 'Involuntary shutdown', baseModifier: 3 }];
        // p58: "All PSRs required of an unconscious MechWarrior automatically
        // fail." (The shutdown PSR itself is the one roll a shutdown 'Mech is
        // allowed to make, p52.)
        const psr = unit.pilot && unit.pilot.conscious === false
          ? { passed: false, roll: 0, targetNumber: 999, details: 'Auto-fail (unconscious MechWarrior)' }
          : this.engine.psrCalc.makePSR(unit, this.engine.diceRoller, triggers);
        let fall = null;
        if (!psr.passed) {
          // p52: a failed shutdown PSR means the 'Mech falls; p54 footnote 2 /
          // p58: a falling warrior automatically takes 1 point of damage (an
          // immobile 'Mech cannot make the warrior's PSR), and the fall damages
          // the 'Mech. This goes through the same path as any other fall.
          fall = this.engine.applyFall(unit, { levelsFallen: 0, causeTriggers: triggers });
        }
        this.engine.eventBus.emit('involuntaryShutdown', { unitId: unit.id, psr, fall });
      }
    }

    // p12: "'Mechs shutdown due to heat make their restart attempts in this
    // phase." The Heat Scale has now been adjusted, so the attempt uses the
    // current heat level (p52). Only 'Mechs that were already shut down when
    // this phase began make the attempt - p52 allows it in "any subsequent
    // Heat Phase", so a shutdown that happened just now waits for the next one.
    this._resolveRestartAttempts(state, wasShutdown);

    this.engine.eventBus.emit('heatPhase', {});
  }

  /**
   * Restart attempts for shut-down 'Mechs (p52), made in the Heat Phase once
   * the Heat Scale has been recorded:
   * - below 14 heat the power plant restarts automatically, even if the pilot
   *   is out of action;
   * - a conscious warrior may roll 2D6 against the highest current Avoid
   *   Target Number at 14-29 heat;
   * - "A 'Mech's Heat Scale must be below 30 before a restart can occur."
   *
   * A 'Mech that shut down during *this* Heat Phase is not eligible yet: p52
   * says the warrior may attempt a restart "during in any subsequent Heat
   * Phase", so it waits for the next turn's Heat Phase.
   *
   * @param {object} state
   * @param {Map<string, boolean>|null} wasShutdown - shutdown state at the
   *   start of this Heat Phase
   */
  _resolveRestartAttempts(state, wasShutdown = null) {
    const restarted = [];
    const blocked = [];
    const failed = [];

    for (const unit of Object.values(state.units)) {
      if (!unit.shutdown) continue;

      // p52: restart attempts are for a later Heat Phase than the shutdown.
      if (wasShutdown && !wasShutdown.get(unit.id)) continue;

      const heat = Math.max(0, unit.heat || 0);
      const pilot = unit.pilot || {};

      // A dead warrior's 'Mech is on its way off the map (p58).
      if (pilot.dead) continue;

      if (heat >= 30) {
        blocked.push({ unitId: unit.id, heat, reason: 'overflow heat' });
        continue;
      }

      if (heat < 14) {
        unit.shutdown = false;
        restarted.push({ unitId: unit.id, heat, auto: true, roll: 0, target: 0 });
        continue;
      }

      if (pilot.conscious === false) {
        blocked.push({ unitId: unit.id, heat, reason: 'unconscious pilot' });
        continue;
      }

      const target = getHeatEffects(heat).shutdownAvoid;
      if (target === null) {
        blocked.push({ unitId: unit.id, heat, reason: 'no shutdown threshold' });
        continue;
      }

      const roll = this.engine.diceRoller.roll2d6();
      if (roll >= target) {
        unit.shutdown = false;
        restarted.push({ unitId: unit.id, heat, roll, target, auto: false });
      } else {
        failed.push({ unitId: unit.id, heat, roll, target });
      }
    }

    for (const record of restarted) this.engine.eventBus.emit('unitRestarted', record);
    for (const record of failed) this.engine.eventBus.emit('unitRestartFailed', record);
    for (const record of blocked) this.engine.eventBus.emit('unitRestartBlocked', record);

    return { restarted, failed, blocked };
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

    // p12 End Phase (mandatory): "Any MechWarrior who was unconscious during
    // the Initiative Phase of this turn rolls 2D6 to see if they regain
    // consciousness"; p58: recover "during the End Phase of each turn after the
    // turn in which the MechWarrior lost consciousness". A conscious pilot does
    // not roll here - consciousness rolls belong to the damage that caused them.
    this._resolveConsciousnessRecovery(state);

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

    // p10/p131: a destroyed 'Mech has no actions left; p52/p58: a shut-down
    // 'Mech and one with an unconscious warrior are immobile and "cannot move,
    // fire, or take any other action". `pass` is the exception - it is how the
    // declaration slot of such a 'Mech is spent without acting.
    const actingUnitId = unitId || (entry ? entry.unitId : null);
    const actingUnit = actingUnitId ? state.getUnit(actingUnitId) : null;
    if (actingUnit) {
      if (this.isDestroyedUnit(actingUnit)) {
        return { valid: false, reason: 'Unit has been destroyed' };
      }
      if (actionType !== 'pass' && this.isImmobile(actingUnit)) {
        return {
          valid: false,
          reason: actingUnit.shutdown
            ? 'A shut-down Mech cannot act'
            : 'A MechWarrior who is unconscious cannot act'
        };
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
      case 'pass':
        return {
          valid: ['movement', 'weapon_attack', 'physical_attack'].includes(state.phase),
          reason: 'Only during movement, weapon attack or physical attack phase'
        };
      default:
        return { valid: false, reason: `Unknown action: ${actionType}` };
    }
  }

  /**
   * Advance to the next phase.
   */
  nextPhase() {
    this.clearQueue();

    // End-of-phase resolution for the phase being left. p72: the CF damage a
    // building absorbed is applied "at the end of the Weapon Attack Phase",
    // after every attack that phase has been resolved.
    if (this.currentPhase === 'weapon_attack'
      && this.engine
      && typeof this.engine.applyPendingBuildingDamage === 'function') {
      this.engine.applyPendingBuildingDamage();
    }

    // Building CF snapshots are per phase (p72); a new phase takes its own.
    this._clearBuildingSnapshots();

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

  /** Drop the per-phase building CF snapshots and any unapplied bank. */
  _clearBuildingSnapshots() {
    if (!this.engine || !this.engine.stateManager) return;
    const state = this.engine.stateManager.getState();
    if (!state.map || !state.map.hexes) return;

    for (const [, hex] of state.map.hexes) {
      if (hex.building) delete hex._cfAtPhaseStart;
      delete hex._pendingCFDamage;
    }
  }

  /**
   * Register a callback for when a specific phase is entered.
   */
  onPhaseEnter(phase, callback) {
    this.phaseCallbacks[phase] = callback;
  }
}
