/**
 * UIController - DOM-based UI management.
 * Handles unit panel, action buttons, dice log, and phase display.
 */

import { describeHeatEffects } from '../rules/heat/HeatScale.js';
import { projectStateForPlayer } from '../engine/visibility.js';
import { weaponInstanceKey, weaponModelKey } from '../engine/GameEngine.js';
import { weaponMountAt, weaponMountFor } from '../rules/combat/WeaponMounts.js';
import { canWeaponFireAt } from '../rules/combat/ArcRules.js';
import { buildingCombat } from '../rules/urban/Buildings.js';
import { hexDistance } from '../hex/HexMath.js';
import { RecordCard, RecordSheet } from './record/index.js';
import {
  movementValues,
  currentMP as unitCurrentMP,
  heatSinkInfo
} from './record/unitValues.js';

export class UIController {
  constructor({ viewerId = 0 } = {}) {
    this.gameEngine = null;
    this.mapRenderer = null;
    this.selectedUnitId = null;
    // The player whose eyes the UI is looking through. Solo play watches the
    // game as player 0, so hidden enemy units stay off every list.
    this.viewerId = viewerId;

    // DOM elements
    this.phaseLabel = document.getElementById('phase-label');
    this.turnLabel = document.getElementById('turn-label');
    this.activePlayerLabel = document.getElementById('active-player');
    this.unitDetails = document.getElementById('unit-details');
    this.actionButtons = document.getElementById('action-buttons');
    this.weaponPanel = document.getElementById('weapon-panel');
    this.weaponList = document.getElementById('weapon-list');
    this.movementPanel = document.getElementById('movement-panel');
    this.physicalPanel = document.getElementById('physical-panel');
    this.diceLog = document.getElementById('dice-log');
    this.mpDisplay = document.getElementById('mp-display');

    // Record-sheet views. The chosen presentation lives in memory for the
    // session only (no localStorage): 'record' is the new card, 'classic' keeps
    // the old health-bar list available for comparison.
    this.unitView = 'record';
    this.recordOverlayOpen = false;
    this._selectedUnit = null;
    this._recordKeyHandler = null;
    this.unitViewControls = document.getElementById('unit-view-controls');
    this.btnViewRecord = document.getElementById('btn-view-record');
    this.btnViewClassic = document.getElementById('btn-view-classic');
    this.btnRecordSheet = document.getElementById('btn-record-sheet');
    this.recordOverlay = document.getElementById('record-overlay');
    this.recordSheetBody = document.getElementById('record-sheet-body');
    this.recordSheetTitle = document.getElementById('record-sheet-title');
    this.btnCloseRecord = document.getElementById('btn-close-record');

    // A controller is created per game. Never inherit an overlay (or the
    // checked rows it may contain) left in the page by a previous game.
    if (this.recordOverlay) this.recordOverlay.style.display = 'none';
    if (this.recordSheetBody) this.recordSheetBody.innerHTML = '';

    // Movement mode
    this.movementMode = 'walk';
    this.weaponFireMode = false;
    this.selectedWeapons = [];
    this._pendingTarget = null;

    // Movement preview
    this._pendingMove = null;
  }

  init(gameEngine, mapRenderer) {
    this.gameEngine = gameEngine;
    this.mapRenderer = mapRenderer;

    // Listen for game events
    gameEngine.eventBus.on('phaseChanged', (data) => this._onPhaseChanged(data));
    gameEngine.eventBus.on('unitMoved', (data) => this._onUnitMoved(data));
    gameEngine.eventBus.on('damageApplied', (data) => this._onDamageApplied(data));
    gameEngine.eventBus.on('unitAttacked', (data) => this._onUnitAttacked(data));
    gameEngine.eventBus.on('unitDestroyed', (data) => this._onUnitDestroyed(data));
    gameEngine.eventBus.on('physicalAttackResolved', (data) => this._onPhysicalAttackResolved(data));
    gameEngine.eventBus.on('actionProcessed', (data) => this._onActionProcessed(data));
    gameEngine.eventBus.on('queueAdvanced', (data) => this._onQueueAdvanced(data));

    // Setup UI listeners
    this._setupActionButtons();
  }

  /**
   * The state this controller is allowed to show the local viewer (R1).
   * Everything the UI lists, looks up or renders for a unit goes through this,
   * so a hidden enemy can never appear in a unit or target list.
   */
  viewState() {
    if (!this.gameEngine) return null;
    return projectStateForPlayer(this.gameEngine.stateManager.getState(), this.viewerId);
  }

  /** Every unit the local viewer can see; optionally only one player's. */
  getVisibleUnits(playerId = null) {
    const state = this.viewState();
    if (!state) return [];
    const units = Object.values(state.units);
    return playerId === null ? units : units.filter(unit => unit.player === playerId);
  }

  /** Enemy units of `unitId` that the local viewer can see, i.e. may target. */
  getTargetableUnits(unitId) {
    const state = this.viewState();
    if (!state) return [];
    const attacker = state.getUnit(unitId);
    if (!attacker) return [];
    return Object.values(state.units).filter(unit => unit.player !== attacker.player);
  }

  _hideAllPanels() {
    this.movementPanel.style.display = 'none';
    this.weaponPanel.style.display = 'none';
    this.physicalPanel.style.display = 'none';
    this.weaponFireMode = false;
    this._pendingTarget = null;
    // Phase change: the previous phase's destinations/hover are meaningless.
    this._clearMovementPreview();
  }

  _onPhaseChanged(data) {
    this.phaseLabel.textContent = `Phase: ${data.phase}`;
    this.turnLabel.textContent = `Turn: ${data.turn}`;
    this._pendingTarget = null;

    const state = this.viewState();
    this._updateActivePlayer(state);

    this._hideAllPanels();
    this._updateActionButtons(data.phase);
    // The record card's fire eligibility depends on the phase ("weapon phase"),
    // so a selected 'Mech's card is re-rendered when the phase turns over.
    this._refreshSelectedUnitPanel();
  }

  /**
   * Re-render the selected unit's panel from the current view, if the selection
   * is still visible. Used after phase changes and damage events so the card
   * and an open overlay never show stale pips or stale weapon eligibility.
   */
  _refreshSelectedUnitPanel() {
    this.refreshWeaponViews();
  }

  /** The selected unit from the current (projected) state, if still visible. */
  _lookupSelectedUnit() {
    if (!this.selectedUnitId) return null;
    const state = this.viewState();
    if (!state || typeof state.getUnit !== 'function') return null;
    return state.getUnit(this.selectedUnitId) || null;
  }

  _updateActivePlayer(state) {
    if (this.activePlayerLabel) {
      const player = state.players[state.currentPlayer];
      const name = player ? player.name : `Player ${state.currentPlayer}`;
      this.activePlayerLabel.textContent = `Active: ${name}`;
    }
  }

  _updateActionButtons(phase) {
    this.actionButtons.innerHTML = '';

    switch (phase) {
      case 'initiative':
        this._addButton('Roll Initiative', () => this._endPhase());
        break;
      case 'movement':
        this.movementPanel.style.display = 'block';
        this._addButton('End Movement Phase', () => this._endPhase());
        break;
      case 'weapon_attack':
        this._addButton('Declare Weapon Fire', () => this._startWeaponFire());
        this._addButton('End Weapon Phase', () => this._endPhase());
        break;
      case 'physical_attack':
        this.physicalPanel.style.display = 'block';
        this._addButton('End Physical Phase', () => this._endPhase());
        break;
      case 'heat':
        this._addButton('Resolve Heat', () => this._endPhase());
        break;
      case 'end':
        this._addButton('Next Turn', () => this._endPhase());
        break;
    }
  }

  _addButton(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    this.actionButtons.appendChild(btn);
  }

  _endPhase() {
    if (this.gameEngine) {
      const state = this.gameEngine.stateManager.getState();
      const result = this.gameEngine.processAction(state.currentPlayer, { type: 'endPhase' });
      this.log(result.error || `Advanced to ${result.nextPhase || 'next phase'}`);
    }
  }

  _startWeaponFire() {
    this.weaponFireMode = !this.weaponFireMode;
    if (this.weaponFireMode) {
      this.log('Weapon fire mode: Click a target to fire selected weapons', 'info');
      this._showWeaponPanel();
    } else {
      // Cancelling drops the target before the dependent render; otherwise the
      // record card would keep target-aware (disabled) rows after the picker is
      // hidden and the pending target is gone.
      this._pendingTarget = null;
      this.weaponPanel.style.display = 'none';
      this.refreshWeaponViews();
    }
  }

  /**
   * The checked weapon rows the player can act on right now.
   *
   * A declaration must only ever come from a visible surface. The closed
   * record-sheet overlay can retain checked inputs in its hidden DOM (the
   * overlay body is cleared on close as well, so this is defence in depth),
   * and the picker can be hidden while its old rows are still mounted. Scoping
   * the query to the open overlay - or, when it is closed, to the unit panel
   * and the visible picker - makes stale rows unable to fire.
   *
   * @returns {HTMLInputElement[]} checked weapon rows, visible surface only
   */
  _visibleWeaponChecks() {
    const roots = [];
    if (this.recordOverlayOpen && this.recordSheetBody) {
      // The modal covers everything else: only its rows are visible.
      roots.push(this.recordSheetBody);
    } else {
      if (this.unitDetails) roots.push(this.unitDetails);
      if (this.weaponPanel && this.weaponPanel.style.display !== 'none') {
        roots.push(this.weaponPanel);
      }
    }

    const checks = [];
    for (const root of roots) {
      checks.push(...root.querySelectorAll('.weapon-check:checked, .record-weapon-check:checked'));
    }
    return checks;
  }

  _handleFireSelected() {
    const state = this.viewState();
    const attacker = state.getUnit(this.selectedUnitId);
    if (!attacker) { this.log('Select a unit first', 'miss'); return; }

    if (!this._pendingTarget) {
      this.log('Click an enemy unit on the map to target', 'miss');
      return;
    }

    const target = state.getUnit(this._pendingTarget);
    if (!target) { this.log('Target no longer available', 'miss'); return; }

    // The record-sheet weapons table renders its own per-mount checkboxes. Both
    // sources are honoured, but ONLY from the surface the player can currently
    // see: a closed overlay may keep checked rows in its hidden DOM, and those
    // must never be declared for a newly selected 'Mech. A mount checked in
    // both visible places is still one shot (keyed by mounted instance).
    const checks = this._visibleWeaponChecks();
    if (checks.length === 0) { this.log('Select weapons to fire', 'miss'); return; }

    // One declaration carries every checked weapon. Calling the single-shot
    // 'fire' action once per weapon advanced the per-'Mech declaration queue
    // after the first shot, so every later shot was rejected with
    // "Not your turn" - a 'Mech could never fire two weapons at once.
    //
    // Each shot also names its mounted INSTANCE (index into
    // `unit.getAllWeapons()`, which is the order of `unit.equipment.weapons`).
    // A 'Mech can carry identical weapons in one location - the Atlas has two
    // medium lasers in its right arm - and "one attack per weapon per turn"
    // (p24) applies to each mount, not to the weapon model.
    const shots = [];
    const declared = new Set();
    for (const check of checks) {
      const mountIndex = check.dataset.weaponIndex;
      const shotKey = mountIndex !== undefined && mountIndex !== ''
        ? `mount:${mountIndex}`
        : `model:${check.dataset.type}@${check.dataset.location}`;
      if (declared.has(shotKey)) continue;
      declared.add(shotKey);

      const weaponDef = this._getWeaponData(check.dataset.type);
      if (!weaponDef) continue;
      const shot = {
        weapon: weaponDef,
        weaponLocation: check.dataset.location,
        ammoBin: check.dataset.ammo || null
      };
      if (mountIndex !== undefined && mountIndex !== '') {
        shot.weaponIndex = Number(mountIndex);
      }
      shots.push(shot);
    }
    if (shots.length === 0) { this.log('Select weapons to fire', 'miss'); return; }

    const result = this.gameEngine.processAction(state.currentPlayer, {
      type: 'fireWeapons',
      attackerId: attacker.id,
      targetId: target.id,
      shots
    });

    if (result && Array.isArray(result.shots)) {
      // Per-shot rejections (already fired, no ammo, out of arc, ...) are the
      // engine's decision; report them without hiding the shots that resolved.
      for (const shot of result.shots) {
        if (!shot.success && shot.error) this.log(`Fire error: ${shot.error}`, 'miss');
      }
    } else if (result && result.error) {
      // The declaration itself was refused (phase/queue), so nothing fired.
      this.log(`Fire error: ${result.error}`, 'miss');
    }

    this._pendingTarget = null;
    if (this.mapRenderer) {
      // Re-project once: a shot can reveal a hidden target, and the reveal must
      // be on screen immediately.
      this.mapRenderer.render(this.viewState());
    }
    // Target cleared before the dependent render: both the record card and the
    // picker are rebuilt from the same now-targetless eligibility verdict.
    this.refreshWeaponViews();
  }

  _handlePhysicalAttack() {
    const state = this.viewState();
    const attacker = state.getUnit(this.selectedUnitId);
    if (!attacker) { this.log('Select a unit first', 'miss'); return; }

    if (!this._pendingTarget) {
      this.log('Click an enemy unit on the map to target', 'miss');
      return;
    }

    const target = state.getUnit(this._pendingTarget);
    if (!target) { this.log('Target no longer available', 'miss'); return; }

    const attackType = document.getElementById('physical-type')?.value || 'punch';

    const result = this.gameEngine.processAction(state.currentPlayer, {
      type: 'physicalAttack',
      attackerId: attacker.id,
      targetId: target.id,
      attackType: attackType
    });

    if (result.error) {
      this.log(`Physical attack error: ${result.error}`, 'miss');
    } else {
      this.log(`Executed ${attackType} on ${target.name}!`, 'hit');
    }

    this._pendingTarget = null;
    if (this.mapRenderer) {
      this.mapRenderer.render(this.viewState());
    }
    this.updateUnitPanel(attacker);
  }

  /**
   * Build the weapon picker.
   *
   * The engine's fire validation (PhaseManager.validateAction + C-09 +
   * GameEngine._handleFire) is the only authority on whether a shot is legal.
   * This panel is an affordance that asks the same rules ahead of time:
   *
   * 1. unit level - is this the acting unit, and can it act at all (destroyed,
   *    shut down, unconscious warrior)? If not, the whole picker is disabled
   *    with one reason and the Fire button is turned off;
   * 2. weapon level - mounted and not destroyed, ammunition, once per turn, and
   *    (with a target pending) firing arc, range and line of sight.
   *
   * Ineligible rows stay visible: greyed out, disabled, with a short reason.
   */
  _showWeaponPanel() {
    if (!this.selectedUnitId) {
      this.log('Select a unit first', 'miss');
      return;
    }

    const state = this.viewState();
    const unit = state.getUnit(this.selectedUnitId);
    if (!unit) return;

    this.weaponPanel.style.display = 'block';
    this.weaponList.innerHTML = '';

    const unitEligibility = this._getUnitFireEligibility(unit, state);

    const fireButton = document.getElementById('btn-fire');
    if (fireButton) fireButton.disabled = !unitEligibility.eligible;

    if (!unitEligibility.eligible) {
      const notice = document.createElement('p');
      notice.className = 'weapon-panel-notice';
      notice.style.color = '#ff8fa3';
      notice.style.fontSize = '12px';
      notice.textContent = `This Mech cannot fire: ${unitEligibility.reason}`;
      this.weaponList.appendChild(notice);
    }

    // The mounted instance index is what the engine keys "already fired" by,
    // so each row carries its position in `unit.getAllWeapons()`.
    const weapons = unit.getAllWeapons();
    for (const [weaponIndex, w] of weapons.entries()) {
      const weaponData = this._getWeaponData(w.type);
      if (!weaponData) continue;

      const eligibility = unitEligibility.eligible
        ? this._getWeaponEligibility(unit, w, weaponData, state, weaponIndex)
        : { eligible: false, reason: null }; // the unit-level notice carries the reason
      this.weaponList.appendChild(
        this._renderWeaponOption(w, weaponData, eligibility.eligible, eligibility.reason, weaponIndex)
      );
    }
  }

  /**
   * The 'Mech whose declaration slot is current, or null when no queue is
   * installed (initiative/heat) or the fixture has no phase manager.
   */
  _currentQueueEntry() {
    const phaseManager = this.gameEngine && this.gameEngine.phaseManager;
    if (!phaseManager || typeof phaseManager.getCurrentQueueEntry !== 'function') return null;
    return phaseManager.getCurrentQueueEntry();
  }

  /**
   * Can `unit` fire at all right now? Returns `{ eligible, reason }` with the
   * 'Mech-level reason, or `{ eligible: true, reason: null }`.
   *
   * These are the guards the engine applies before any weapon row matters:
   * PhaseManager.validateAction refuses a unit that is not the current
   * declaration slot ('Not the current acting unit' / 'Not your turn'), and
   * GameEngine._handleFire refuses a destroyed 'Mech and a shut-down or
   * unconscious-warrior 'Mech (p44/p52/p58).
   *
   * @param {Unit|object} unit - selected 'Mech
   * @param {object} state - projected game state
   * @returns {{eligible: boolean, reason: string|null}}
   */
  _getUnitFireEligibility(unit, state) {
    const phaseManager = this.gameEngine && this.gameEngine.phaseManager;
    const entry = this._currentQueueEntry();

    if (entry) {
      if (entry.unitId !== unit.id) {
        return {
          eligible: false,
          reason: entry.playerId === unit.player ? 'not the acting unit' : 'not your turn'
        };
      }
    } else if (!state || unit.player !== state.currentPlayer) {
      return { eligible: false, reason: 'not your turn' };
    }

    const destroyed = phaseManager && typeof phaseManager.isDestroyedUnit === 'function'
      ? phaseManager.isDestroyedUnit(unit)
      : (typeof unit.isDestroyed === 'function' ? unit.isDestroyed() : Boolean(unit.pilot && unit.pilot.dead));
    if (destroyed) return { eligible: false, reason: 'destroyed' };

    const immobile = phaseManager && typeof phaseManager.isImmobile === 'function'
      ? phaseManager.isImmobile(unit)
      : Boolean(unit.shutdown || (unit.pilot && (unit.pilot.conscious === false || unit.pilot.dead)));
    if (immobile) {
      return { eligible: false, reason: unit.shutdown ? 'shut down' : 'warrior unconscious' };
    }

    return { eligible: true, reason: null };
  }

  /**
   * Can this weapon fire right now? Returns `{ eligible, reason }`, where
   * `reason` is the short UI label when it cannot: 'destroyed', 'no ammo',
   * 'already fired', 'out of arc', 'out of range', 'no line of sight'.
   *
   * The checks reuse the helpers the engine uses instead of restating the
   * rules: `WeaponMounts` (which physical critical-slot component each mount
   * occupies, p46), `_validateWeaponDeclaration`'s key scheme (once per
   * instance per turn), `_hasAmmoForWeapon`/ammo bins (p31),
   * `canWeaponFireAt` (arcs), `Weapon.getRangeModifier` (range) and the LOS
   * gate of `_handleFire` (`buildingCombat` + `LineOfSight.calculateLOS`).
   *
   * @param {Unit|object} unit - attacker
   * @param {{type: string, location: string, ammoBin?: string}} weapon - mounted entry
   * @param {Weapon|object} weaponData - weapon definition for `weapon.type`
   * @param {object} state - projected game state
   * @param {number|null} [weaponIndex] - mounted instance index when the caller
   *   has it; otherwise it is derived from `unit.equipment.weapons`
   * @returns {{eligible: boolean, reason: string|null}}
   */
  _getWeaponEligibility(unit, weapon, weaponData, state, weaponIndex = null) {
    const index = weaponIndex === null ? this._weaponListIndex(unit, weapon) : weaponIndex;

    // p46: a mount whose own critical-slot component is destroyed cannot fire.
    // The mapping (multi-slot weapons are one component, identical single-slot
    // mounts are separate components) comes from WeaponMounts.js - the same
    // helper the engine's declaration check uses - so one destroyed arm laser
    // greys out exactly one row.
    const mount = index >= 0 ? weaponMountAt(unit, index) : weaponMountFor(unit, weapon);
    if (mount && mount.destroyed) {
      return { eligible: false, reason: 'destroyed' };
    }

    // p31: ammunition comes from a real bin that feeds this weapon and has
    // enough shots, picked exactly the way `_validateWeaponDeclaration` does.
    const usesAmmo = typeof weaponData.usesAmmo === 'function'
      ? weaponData.usesAmmo()
      : Boolean(weaponData.ammoPerShot);
    if (usesAmmo && !this._hasAmmoForWeapon(unit, weapon, weaponData)) {
      return { eligible: false, reason: 'no ammo' };
    }

    // p24: one attack per weapon INSTANCE per turn. Same key scheme as
    // `_validateWeaponDeclaration`: the mounted index identifies the weapon, so
    // one of two identical lasers firing does not disable the other.
    if (this._weaponFiredThisTurn(unit, weapon, weaponData, state, index)) {
      return { eligible: false, reason: 'already fired' };
    }

    // Target-dependent checks only apply while a target is actually picked;
    // otherwise the panel must not invent an arc/range/LOS verdict.
    const target = this._pendingTarget ? state.getUnit(this._pendingTarget) : null;
    if (target && target.id !== unit.id) {
      const arc = canWeaponFireAt(unit, weaponData, target.position.hexKey, {
        weaponLocation: weapon.location,
        mount: weaponData.mount
      });
      if (!arc.legal) return { eligible: false, reason: 'out of arc' };

      const distance = hexDistance(unit.position.hexKey, target.position.hexKey);
      if (typeof weaponData.getRangeModifier === 'function'
        && weaponData.getRangeModifier(distance) === null) {
        return { eligible: false, reason: 'out of range' };
      }

      if (this._isLineOfSightBlocked(unit, target, state)) {
        return { eligible: false, reason: 'no line of sight' };
      }
    }

    return { eligible: true, reason: null };
  }

  /** Does a bin feed `weapon` with enough shots? Mirrors the engine's pick. */
  _hasAmmoForWeapon(unit, weapon, weaponData) {
    const ammo = (unit.equipment && unit.equipment.ammo) || {};
    const needed = weaponData.ammoPerShot || 1;

    const explicitBin = weapon.ammoBin || null;
    if (explicitBin) {
      const bin = ammo[explicitBin];
      if (!bin) return false;
      if (bin.type && bin.type !== weaponData.id) return false;
      return (bin.shots || 0) >= needed;
    }

    return Object.keys(ammo).some(name => {
      const bin = ammo[name];
      if (!bin) return false;
      const feeds = !bin.type || bin.type === weaponData.id;
      return feeds && (bin.shots || 0) >= needed;
    });
  }

  /**
   * Index of a mounted weapon entry in its 'Mech's equipment list, i.e. the
   * position the engine's per-instance fired record is keyed by. Returns -1
   * when the caller handed in an entry that is not part of the unit.
   */
  _weaponListIndex(unit, weapon) {
    const mounted = (unit && unit.equipment && unit.equipment.weapons) || [];
    return mounted.indexOf(weapon);
  }

  /**
   * Has this mounted INSTANCE already fired this turn? Mirrors
   * `_validateWeaponDeclaration` exactly: only a Set recorded on the current
   * turn counts, and both the per-instance key and the pre-instance
   * `<id>@<location>` key (a caller or fixture that still uses it) are
   * honoured. The engine treats anything else (an array after a JSON
   * round-trip, or a Set from an earlier turn) as a fresh empty set, so the UI
   * must not report a stale shot either.
   */
  _weaponFiredThisTurn(unit, weapon, weaponData, state, weaponIndex) {
    const fired = unit.firedWeaponsThisTurn;
    if (!(fired instanceof Set)) return false;
    if (unit.firedWeaponsTurn !== state.turn) return false;

    if (weaponIndex >= 0
      && fired.has(weaponInstanceKey(weaponData.id, weapon.location, weaponIndex))) {
      return true;
    }
    return fired.has(weaponModelKey(weaponData.id, weapon.location));
  }

  /**
   * The line-of-sight gate of `GameEngine._handleFire`, read-only: a same-building
   * pair only checks the p72 building count, an outside shot into a building is
   * blocked by intervening building hexes, everything else uses the generic LOS.
   * A missing LOS engine (minimal test fixtures) is treated as clear - the
   * engine still rejects a blocked shot.
   */
  _isLineOfSightBlocked(attacker, target, state) {
    const los = this.gameEngine && this.gameEngine.los;
    if (!los || typeof los.calculateLOS !== 'function') return false;
    if (!state || !state.map || !state.map.hexes) return false;
    if (typeof state.map.hexes.get !== 'function') return false;

    const urban = buildingCombat(attacker, target, state);
    if (urban.sameBuilding) return Boolean(urban.losBlocked);
    if (urban.targetInside && urban.interveningHexes > 0) return true;

    return Boolean(los.calculateLOS(
      attacker.position.hexKey,
      target.position.hexKey,
      state,
      { attacker, target }
    ).blocked);
  }

  /** One row of the weapon picker; disabled and greyed out when ineligible. */
  _renderWeaponOption(weapon, weaponData, eligible, reason, weaponIndex) {
    const rangeText = `${weaponData.shortRange}/${weaponData.mediumRange}/${weaponData.longRange}`;

    const label = document.createElement('label');
    label.className = 'weapon-option';
    label.dataset.eligible = String(eligible);
    if (!eligible) {
      label.classList.add('weapon-option-disabled');
      label.setAttribute('aria-disabled', 'true');
      label.style.opacity = '0.45';
      label.style.cursor = 'not-allowed';
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'weapon-check';
    checkbox.dataset.type = weapon.type;
    checkbox.dataset.location = weapon.location;
    checkbox.dataset.ammo = weapon.ammoBin || '';
    // The shot names its mounted instance, not just its weapon type.
    if (weaponIndex !== undefined) checkbox.dataset.weaponIndex = String(weaponIndex);
    checkbox.disabled = !eligible;
    label.appendChild(checkbox);

    const description = document.createElement('span');
    description.className = 'weapon-description';
    description.textContent = `${weaponData.name} (${rangeText}) | ${weaponData.heat}♥ | ${weaponData.damage}dmg`;
    label.appendChild(description);

    if (!eligible && reason) {
      const reasonLabel = document.createElement('span');
      reasonLabel.className = 'weapon-reason';
      reasonLabel.textContent = reason;
      reasonLabel.style.color = '#ff8fa3';
      reasonLabel.style.fontSize = '11px';
      label.appendChild(reasonLabel);
    }

    return label;
  }

  _getWeaponData(weaponType) {
    if (this.gameEngine.attackResolver && this.gameEngine._weaponsData) {
      return this.gameEngine._weaponsData[weaponType] || null;
    }
    return null;
  }

  _renderHeatBar(unit) {
    const scale = 30;
    const segments = 15;
    const heatPerSegment = scale / segments;

    let html = '<div class="heat-bar">';
    for (let i = 0; i < segments; i++) {
      const segStart = i * heatPerSegment;
      let cls = 'inactive';
      if (unit.heat > segStart) {
        if (segStart < 5) cls = 'safe';
        else if (segStart < 10) cls = 'warn';
        else if (segStart < 15) cls = 'danger';
        else cls = 'critical';
      }
      html += `<div class="heat-segment ${cls}" title="Heat ${Math.round(segStart)}-${Math.round(segStart + heatPerSegment)}"></div>`;
    }
    html += '</div>';
    return html;
  }

  _getHeatEffects(unit) {
    const effects = describeHeatEffects(unit.heat);
    return effects.length ? ` (${effects.join(', ')})` : '';
  }

  /**
   * Render the unit panel.
   *
   * Two presentations share the same header (name, player, heat, MP, pilot,
   * engine/gyro) and differ below it:
   *
   *  - 'record' (default): the record-sheet card - humanoid armour and
   *    internal-structure diagrams, compact weapons inventory, heat scale,
   *    MechWarrior block, and the old A/I text;
   *  - 'classic': the previous health-bar list, kept for comparison.
   *
   * The choice is memory-only and survives selection changes for the session.
   */
  updateUnitPanel(unit) {
    if (!unit) {
      // Drop the pending target before anything target-aware is re-rendered.
      this._pendingTarget = null;
      if (this.unitDetails) {
        this.unitDetails.innerHTML = '<p>Select a unit to view details</p>';
      }
      this.selectedUnitId = null;
      this._selectedUnit = null;
      this.closeRecordSheet();
      this._syncUnitViewControls();
      // Deselecting drops the previous selection's destinations.
      this._clearMovementPreview();
      return;
    }

    // A different 'Mech is now selected: the previous reachable-hex preview
    // belonged to the old selection, and a pending target belonged to the
    // previous attacker. Both are cleared BEFORE the panel renders so the new
    // selection never inherits stale target-dependent eligibility.
    if (this.selectedUnitId !== unit.id) {
      this._clearMovementPreview();
      this._pendingTarget = null;
      // A stale overlay belongs to the previous selection; drop its inputs
      // before the new unit's sheet (card and overlay) is rendered.
      this._clearRecordOverlayBody();
    }
    this.selectedUnitId = unit.id;
    this._selectedUnit = unit;

    if (this.unitDetails) {
      this.unitDetails.innerHTML = this._renderUnitHeader(unit);
      if (this.unitView === 'classic') {
        this.unitDetails.insertAdjacentHTML('beforeend', this._renderClassicBody(unit));
      } else {
        this.unitDetails.appendChild(RecordCard(unit, this._recordOptions(unit)));
      }
    }

    this._updateMPDisplay(unit);
    this._syncUnitViewControls();
    if (this.recordOverlayOpen) this._renderRecordOverlay(unit);
  }

  /**
   * Refresh every weapon view that depends on the pending target.
   *
   * Setting or clearing `_pendingTarget` changes what `_getWeaponEligibility`
   * answers (arc, range, line of sight) without a phase or selection change.
   * Both the record-card inventory and the classic picker are rebuilt from
   * that one verdict here, so they cannot drift; callers must assign
   * `_pendingTarget` BEFORE calling this.
   *
   * @param {object|null} [unit] - unit to refresh (defaults to the current
   *   selection, so a selection change can be routed through the same entry)
   */
  refreshWeaponViews(unit = null) {
    const selected = unit || this._selectedUnit || this._lookupSelectedUnit();
    if (!selected) return;
    this.updateUnitPanel(selected);
    if (this.weaponFireMode) this._showWeaponPanel();
  }

  /** Header lines shared by both presentations (movement, engine, pilot...). */
  _renderUnitHeader(unit) {
    const movement = movementValues(unit);
    const currentMP = unitCurrentMP(unit);
    const sinks = heatSinkInfo(unit);
    const pilot = unit.pilot || {};
    const engine = unit.engine || {};
    const gyro = unit.gyro || {};
    const facing = unit.position && unit.position.facing !== undefined
      ? unit.position.facing
      : '—';
    const heat = Number(unit.heat) || 0;

    const playerColor = unit.player === 0 ? '#3b82f6' : '#ef4444';
    const playerName = this.gameEngine
      ? (this.gameEngine.stateManager.getState().players[unit.player]?.name || `Player ${unit.player + 1}`)
      : `Player ${unit.player + 1}`;
    const isActive = this.gameEngine
      && this.gameEngine.stateManager.getState().currentPlayer === unit.player;

    return `
      <p>
        <strong>${unit.name}</strong> (${unit.tonnage}t)
        <span style="color:${playerColor}"> - ${playerName}</span>
        ${isActive ? ' <span style="color:#4cc9f0">[ACTIVE]</span>' : ''}
      </p>
      <div class="record-meta">
        <span class="record-meta-item" title="not modelled yet">BV: —</span>
        <span class="record-meta-item" title="not modelled yet">Role: —</span>
        <span class="record-meta-item" title="not modelled yet">Tech Base: —</span>
        <span class="record-meta-item" title="not modelled yet">Rules Level: —</span>
      </div>
      <p>Heat: ${heat} / ${sinks.dissipation} dissipation${this._getHeatEffects(unit)}</p>
      ${this.unitView === 'classic' ? this._renderHeatBar(unit) : ''}
      <p>MP: ${currentMP}/${movement.walk}(${movement.run})</p>
      <p>Pilot: G${pilot.gunnery ?? '—'}/P${pilot.piloting ?? '—'} | Facing: ${facing}</p>
      ${unit.prone ? '<p style="color:#ff4444">PRONE</p>' : ''}
      ${unit.shutdown ? '<p style="color:#ff4444">SHUTDOWN</p>' : ''}
      <p>Heat Sinks: ${sinks.count} (${sinks.type})</p>
      <p>Engine: ${engine.type || '—'} (${engine.hits ?? 0}hits) | Gyro: ${gyro.hits ?? 0}hits</p>
    `;
  }

  /** The old health-bar armour list plus the simple weapons list. */
  _renderClassicBody(unit) {
    let armorHTML = '<div class="armor-diagram">';
    const locations = ['head', 'centerTorso', 'leftTorso', 'rightTorso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
    for (const loc of locations) {
      const armor = typeof unit.getArmor === 'function' ? unit.getArmor(loc) : 0;
      const maxArmor = typeof unit.getMaxArmor === 'function' ? unit.getMaxArmor(loc) : 0;
      const pct = maxArmor > 0 ? Math.min(100, Math.max(0, (armor / maxArmor) * 100)) : 0;
      const internal = typeof unit.getInternal === 'function' ? unit.getInternal(loc) : 0;
      const destroyed = typeof unit.isLocationDestroyed === 'function'
        && unit.isLocationDestroyed(loc) ? ' DESTROYED' : '';
      armorHTML += `
        <div class="location">
          <span>${loc}${destroyed}</span>
          <span class="bar-bg"><span class="armor-bar" style="width:${pct}%"></span></span>
          <span>A:${armor}/I:${internal}</span>
        </div>`;
    }
    armorHTML += '</div>';

    const mounted = typeof unit.getAllWeapons === 'function' ? unit.getAllWeapons() : [];
    const weapons = mounted.map(w => {
      const wd = this._getWeaponData(w.type);
      return wd ? `<li>${wd.name} (${w.location})</li>` : `<li>${w.type} (${w.location})</li>`;
    }).join('');

    return `
      ${armorHTML}
      <p>Weapons:</p><ul>${weapons || '<li>None</li>'}</ul>
    `;
  }

  /**
   * Switch the unit panel between the record card and the classic bars.
   * The choice is kept in memory for the session (no localStorage).
   * @param {'record'|'classic'} mode
   */
  setUnitView(mode) {
    if (mode !== 'record' && mode !== 'classic') return;
    this.unitView = mode;
    const unit = this._selectedUnit || this._lookupSelectedUnit();
    if (unit) {
      this.updateUnitPanel(unit);
    } else {
      this._syncUnitViewControls();
    }
  }

  /** Reflect the current view/selection on the view-control buttons. */
  _syncUnitViewControls() {
    const isRecord = this.unitView !== 'classic';
    if (this.unitViewControls) this.unitViewControls.dataset.view = this.unitView;
    if (this.btnViewRecord) {
      this.btnViewRecord.classList.toggle('active', isRecord);
      this.btnViewRecord.setAttribute('aria-pressed', String(isRecord));
    }
    if (this.btnViewClassic) {
      this.btnViewClassic.classList.toggle('active', !isRecord);
      this.btnViewClassic.setAttribute('aria-pressed', String(!isRecord));
    }
    if (this.btnRecordSheet) this.btnRecordSheet.disabled = !this.selectedUnitId;
  }

  /**
   * Options forwarded to the record components. Weapon eligibility is NOT
   * re-implemented in the UI kit: the table receives the same
   * `_getWeaponEligibility` verdict the picker uses, and only in the weapon
   * phase - a record sheet is also an inspection panel the rest of the turn.
   */
  _recordOptions(unit) {
    const state = this.viewState();
    const inWeaponPhase = Boolean(state && state.phase === 'weapon_attack');
    let unitEligibility = { eligible: false, reason: inWeaponPhase ? null : 'weapon phase' };
    if (inWeaponPhase) unitEligibility = this._getUnitFireEligibility(unit, state);

    return {
      getWeaponData: (type) => this._getWeaponData(type),
      unitEligibility,
      getEligibility: (weapon, weaponData, weaponIndex) => {
        if (!inWeaponPhase || !unitEligibility.eligible) {
          return { eligible: false, reason: null };
        }
        return this._getWeaponEligibility(unit, weapon, weaponData, state, weaponIndex);
      }
    };
  }

  /** Open the full record-sheet overlay for the selected unit. */
  openRecordSheet() {
    if (!this.recordOverlay || !this.recordSheetBody) return;
    const unit = this._selectedUnit || this._lookupSelectedUnit();
    if (!unit) {
      this.log('Select a unit first', 'miss');
      return;
    }

    this.recordOverlayOpen = true;
    this.recordOverlay.style.display = 'flex';
    this._renderRecordOverlay(unit);

    if (!this._recordKeyHandler) {
      this._recordKeyHandler = (event) => {
        if (event && event.key === 'Escape') this.closeRecordSheet();
      };
      document.addEventListener('keydown', this._recordKeyHandler);
    }
    if (this.btnRecordSheet) this.btnRecordSheet.classList.add('active');
  }

  /** Remove the overlay's rendered rows so stale checked inputs cannot survive. */
  _clearRecordOverlayBody() {
    if (this.recordSheetBody) this.recordSheetBody.innerHTML = '';
  }

  /** Close the overlay (Close button or Escape). */
  closeRecordSheet() {
    this.recordOverlayOpen = false;
    if (this.recordOverlay) this.recordOverlay.style.display = 'none';
    if (this.btnRecordSheet) this.btnRecordSheet.classList.remove('active');
    if (this._recordKeyHandler) {
      document.removeEventListener('keydown', this._recordKeyHandler);
      this._recordKeyHandler = null;
    }
    // The hidden DOM must not keep checked rows around for a later Fire click.
    this._clearRecordOverlayBody();
    if (this.recordSheetTitle) this.recordSheetTitle.textContent = 'Record Sheet';
  }

  /** Fill the overlay body for `unit` (used on open and on every refresh). */
  _renderRecordOverlay(unit) {
    if (!this.recordOverlayOpen || !this.recordSheetBody) return;
    this.recordSheetBody.innerHTML = '';
    this.recordSheetBody.appendChild(RecordSheet(unit, this._recordOptions(unit)));
    if (this.recordSheetTitle) {
      this.recordSheetTitle.textContent = `Record Sheet — ${unit.name}`;
    }
  }

  /**
   * Jumping MP the unit has available where it is standing (p19). The movement
   * preview caps destinations with the same value, so the MP label and the
   * highlighted hexes agree: Depth 1 water loses the submerged leg jets and
   * Depth 2+ water reports 0 (no jump).
   *
   * @param {Unit|object} unit
   * @returns {number}
   */
  _availableJumpMP(unit) {
    if (!unit) return 0;
    if (typeof unit.getJumpMP !== 'function') {
      return (unit.movement && unit.movement.jump) || 0;
    }

    const state = this.gameEngine ? this.gameEngine.stateManager.getState() : null;
    const hexes = state && state.map && state.map.hexes;
    const hexKey = unit.position && unit.position.hexKey;
    const hex = hexes && hexKey
      ? (typeof hexes.get === 'function' ? hexes.get(hexKey) : hexes[hexKey])
      : null;
    const movementCalc = this.gameEngine && this.gameEngine.movementCalc;
    const waterDepth = hex && movementCalc && typeof movementCalc.waterDepthOf === 'function'
      ? movementCalc.waterDepthOf(hex)
      : 0;

    return unit.getJumpMP(waterDepth);
  }

  _updateMPDisplay(unit) {
    if (!this.mpDisplay) return;
    const jumpMP = this._availableJumpMP(unit);
    const movement = movementValues(unit);
    // p19: with Jump selected, the current MP is the water-adjusted jump MP.
    const currentMP = this.movementMode === 'jump' ? jumpMP : unitCurrentMP(unit);
    this.mpDisplay.textContent = `MP: ${currentMP} / ${movement.walk} (Run: ${movement.run}, Jump: ${jumpMP})`;
  }

  log(msg, className = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.textContent = msg;
    this.diceLog.appendChild(entry);
    this.diceLog.scrollTop = this.diceLog.scrollHeight;
  }

  _onUnitMoved(data) {
    const state = this.viewState();
    const unit = state && state.getUnit(data.unitId);
    // A unit this viewer cannot see must not have its destination printed in
    // the dice log - a hidden enemy moving would otherwise broadcast its hex.
    if (!unit) return;
    this.log(`Unit ${data.unitId} moved to ${data.hexKey}, facing ${data.facing}`);
    if (unit.id === this.selectedUnitId) {
      this.updateUnitPanel(unit);
    }
  }

  _onDamageApplied(data) {
    this.log(`Damage to ${data.targetId}: ${data.damage} at ${data.location}`, 'hit');
    if (data.result && data.result.criticalHits && data.result.criticalHits.length > 0) {
      for (const crit of data.result.criticalHits) {
        this.log(`  CRITICAL: ${crit.effect}`, 'crit');
      }
    }
    // Keep the pips honest while the sheet is on screen (the selected 'Mech
    // may be the one that was just hit).
    if (data.targetId && data.targetId === this.selectedUnitId) {
      this._refreshSelectedUnitPanel();
    }
  }

  /**
   * A punch/kick/charge/DFA resolves: damage and its consequences (DFA leg
   * damage, prone, PSRs) are applied inside the engine without a unitMoved
   * event for every affected location. Refresh the sheet on screen so armour
   * pips, heat and crit tables are current immediately.
   */
  _onPhysicalAttackResolved() {
    this._refreshSelectedUnitPanel();
  }

  _onUnitAttacked(data) {
    const result = data.result;
    if (result.hit) {
      this.log(`HIT! Rolled ${result.roll} (TN: ${result.targetNumber}) - ${result.details}`, 'hit');
    } else {
      this.log(`MISS! Rolled ${result.roll} (TN: ${result.targetNumber})`, 'miss');
    }
  }

  _onUnitDestroyed(data) {
    this.log(`UNIT DESTROYED: ${data.unitId}!`, 'crit');
    if (data.unitId && data.unitId === this.selectedUnitId) {
      // Drop any rows rendered for the destroyed 'Mech before refreshing; if it
      // is already gone from the state, the overlay must not keep stale inputs.
      this._clearRecordOverlayBody();
      this._refreshSelectedUnitPanel();
    }
  }

  _onActionProcessed(data) {
    // A resolved fire spends ammo and marks the weapon as fired this turn. If
    // the weapon views are open, rebuild both (record card and classic picker)
    // against the current target so a spent weapon is greyed out immediately
    // instead of staying clickable in only one of them. The UI declares all
    // checked weapons in one batched 'fireWeapons' action; a single-shot 'fire'
    // is still handled for direct callers.
    const actionType = data && data.action ? data.action.type : null;
    if (this.weaponFireMode && this.selectedUnitId
      && (actionType === 'fire' || actionType === 'fireWeapons')) {
      this.refreshWeaponViews();
    }
  }

  /**
   * The declaration slot moved to another 'Mech: any reachable-hex preview (and
   * pending destination) was computed for the previous acting unit, so it does
   * not describe what the engine will accept now. Drop it before the next
   * click; the user picks the next acting 'Mech to see its moves.
   */
  _onQueueAdvanced() {
    this._clearMovementPreview();
    this._renderView();
  }

  _handleConfirmMove() {
    const state = this.viewState();
    const unit = state.getUnit(this.selectedUnitId);
    if (!unit) { this.log('No unit selected', 'miss'); return; }

    if (this._pendingMove) {
      const result = this.gameEngine.processAction(state.currentPlayer, {
        type: 'move',
        unitId: unit.id,
        path: this._pendingMove.path,
        movementType: this._pendingMove.movementType
      });

      if (result.error) {
        this.log(`Movement error: ${result.error}`, 'miss');
      }

      this._clearMovementPreview();
      // Re-project: ending a move next to an enemy can reveal this unit.
      const view = this.viewState();
      if (this.mapRenderer) {
        this.mapRenderer.render(view);
      }
      this.updateUnitPanel(view.getUnit(unit.id));
    }
  }

  _handleCancelMove() {
    this._clearMovementPreview();
    if (this.mapRenderer) {
      this.mapRenderer.render(this.viewState());
    }
  }

  _clearMovementPreview() {
    this._pendingMove = null;
    if (this.mapRenderer) {
      this.mapRenderer.validMoves = null;
      this.mapRenderer.hoveredHex = null;
      this.mapRenderer.hoveredMove = null;
    }
  }

  /** Render the viewer's projection (guarding fixtures with no units map). */
  _renderView() {
    if (!this.mapRenderer || !this.gameEngine) return;
    const state = this.gameEngine.stateManager.getState();
    if (!state || !state.units) return;
    this.mapRenderer.render(this.viewState());
  }

  /**
   * Is `unit` the 'Mech whose declaration slot is current?
   *
   * Mirrors PhaseManager.validateAction's queue check ("Not the current acting
   * unit") and the click-path gate in main.js. With no queue installed
   * (initiative/heat, or a bare fixture) a unit of the active player may act,
   * exactly as the engine's player-only check does.
   */
  _isActingUnit(unit, state) {
    const entry = this._currentQueueEntry();
    if (entry) return entry.unitId === unit.id;
    return Boolean(state) && unit.player === state.currentPlayer;
  }

  /**
   * Rebuild - or clear - the reachable-hex preview for the selected 'Mech when
   * the movement mode (Walk/Run/Jump) changes.
   *
   * The preview follows the engine's declaration queue, not just the selected
   * unit's side: PhaseManager.validateAction only accepts a move from the
   * current queue slot ("Not the current acting unit"), so highlighting
   * destinations for any other own 'Mech promises a move the engine refuses.
   * When the selected 'Mech cannot declare, the preview and any hover/pending
   * destination are cleared and redrawn as empty.
   */
  _refreshMovementPreview() {
    // The movement calculator needs the full state (it validates against the
    // engine's rules); only what is drawn is projected back down to the view.
    const state = this.gameEngine.stateManager.getState();

    // Nothing selected: leave the renderer as the caller left it (inspection
    // mode); a real deselection clears it through updateUnitPanel(null).
    if (!this.selectedUnitId) return;

    if (state.phase !== 'movement') {
      this._clearMovementPreview();
      return;
    }

    const unit = state.getUnit(this.selectedUnitId);
    if (!unit || unit.player !== this.viewerId || !this._isActingUnit(unit, state)) {
      this._clearMovementPreview();
      this._renderView();
      return;
    }

    const validMoves = this.gameEngine.movementCalc.getValidMoves(unit, state, this.movementMode);
    if (this.mapRenderer) {
      this.mapRenderer.validMoves = validMoves;
      this.mapRenderer.render(this.viewState());
    }
    this._pendingMove = null;
  }

  _setupActionButtons() {
    // Movement mode radio buttons
    document.querySelectorAll('input[name="moveMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.movementMode = e.target.value;
        this._refreshMovementPreview();
      });
    });

    // Confirm move button
    const btnConfirm = document.getElementById('btn-confirm-move');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => this._handleConfirmMove());
    }

    // Cancel move button
    const btnCancel = document.getElementById('btn-cancel-move');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => this._handleCancelMove());
    }

    // Fire Selected button
    const btnFire = document.getElementById('btn-fire');
    if (btnFire) {
      btnFire.addEventListener('click', () => this._handleFireSelected());
    }

    // Execute Attack button
    const btnPhysical = document.getElementById('btn-physical');
    if (btnPhysical) {
      btnPhysical.addEventListener('click', () => this._handlePhysicalAttack());
    }

    // Record-sheet presentation controls (unit panel, not the overlay).
    if (this.btnViewRecord) {
      this.btnViewRecord.addEventListener('click', () => this.setUnitView('record'));
    }
    if (this.btnViewClassic) {
      this.btnViewClassic.addEventListener('click', () => this.setUnitView('classic'));
    }
    if (this.btnRecordSheet) {
      this.btnRecordSheet.addEventListener('click', () => this.openRecordSheet());
    }
    if (this.btnCloseRecord) {
      this.btnCloseRecord.addEventListener('click', () => this.closeRecordSheet());
    }
  }
}
