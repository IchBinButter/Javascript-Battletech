/**
 * UIController - DOM-based UI management.
 * Handles unit panel, action buttons, dice log, and phase display.
 */

import { describeHeatEffects } from '../rules/heat/HeatScale.js';
import { projectStateForPlayer } from '../engine/visibility.js';

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
    gameEngine.eventBus.on('actionProcessed', (data) => this._onActionProcessed(data));

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
    this._pendingMove = null;

    if (this.mapRenderer) {
      this.mapRenderer.validMoves = null;
    }
  }

  _onPhaseChanged(data) {
    this.phaseLabel.textContent = `Phase: ${data.phase}`;
    this.turnLabel.textContent = `Turn: ${data.turn}`;
    this._pendingTarget = null;

    const state = this.viewState();
    this._updateActivePlayer(state);

    this._hideAllPanels();
    this._updateActionButtons(data.phase);
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
      this.weaponPanel.style.display = 'none';
    }
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

    const checks = document.querySelectorAll('.weapon-check:checked');
    if (checks.length === 0) { this.log('Select weapons to fire', 'miss'); return; }

    for (const check of checks) {
      const weaponType = check.dataset.type;
      const weaponDef = this._getWeaponData(weaponType);
      if (!weaponDef) continue;

      const result = this.gameEngine.processAction(state.currentPlayer, {
        type: 'fire',
        attackerId: attacker.id,
        targetId: target.id,
        weapon: weaponDef,
        weaponLocation: check.dataset.location,
        ammoBin: check.dataset.ammo || null
      });

      if (result.error) {
        this.log(`Fire error: ${result.error}`, 'miss');
      }
    }

    this._pendingTarget = null;
    if (this.mapRenderer) {
      // Re-project: a shot can reveal a hidden target, and the reveal must be
      // on screen immediately.
      this.mapRenderer.render(this.viewState());
    }
    this.updateUnitPanel(attacker);
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

    for (const w of unit.getAllWeapons()) {
      const weaponData = this._getWeaponData(w.type);
      if (!weaponData) continue;

      const rangeText = `${weaponData.shortRange}/${weaponData.mediumRange}/${weaponData.longRange}`;
      const label = document.createElement('label');
      label.innerHTML = `
        <input type="checkbox" class="weapon-check" data-type="${w.type}" data-location="${w.location}"
          data-ammo="${w.ammoBin || ''}">
        ${weaponData.name} (${rangeText}) | ${weaponData.heat}♥ | ${weaponData.damage}dmg
      `;
      this.weaponList.appendChild(label);
    }
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

  updateUnitPanel(unit) {
    if (!unit) {
      this.unitDetails.innerHTML = '<p>Select a unit to view details</p>';
      this.selectedUnitId = null;
      return;
    }

    this.selectedUnitId = unit.id;

    let armorHTML = '<div class="armor-diagram">';
    const locations = ['head', 'centerTorso', 'leftTorso', 'rightTorso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
    for (const loc of locations) {
      const armor = unit.getArmor(loc);
      const maxArmor = unit.getMaxArmor(loc);
      const pct = maxArmor > 0 ? Math.min(100, Math.max(0, (armor / maxArmor) * 100)) : 0;
      const internal = unit.getInternal(loc);
      const destroyed = unit.isLocationDestroyed(loc) ? ' DESTROYED' : '';
      armorHTML += `
        <div class="location">
          <span>${loc}${destroyed}</span>
          <span class="bar-bg"><span class="armor-bar" style="width:${pct}%"></span></span>
          <span>A:${armor}/I:${internal}</span>
        </div>`;
    }
    armorHTML += '</div>';

    const weapons = unit.getAllWeapons().map(w => {
      const wd = this._getWeaponData(w.type);
      return wd ? `<li>${wd.name} (${w.location})</li>` : `<li>${w.type} (${w.location})</li>`;
    }).join('');

    const playerColor = unit.player === 0 ? '#3b82f6' : '#ef4444';
    const playerName = this.gameEngine
      ? (this.gameEngine.stateManager.getState().players[unit.player]?.name || `Player ${unit.player + 1}`)
      : `Player ${unit.player + 1}`;
    const isActive = this.gameEngine
      && this.gameEngine.stateManager.getState().currentPlayer === unit.player;

    this.unitDetails.innerHTML = `
      <p>
        <strong>${unit.name}</strong> (${unit.tonnage}t)
        <span style="color:${playerColor}"> - ${playerName}</span>
        ${isActive ? ' <span style="color:#4cc9f0">[ACTIVE]</span>' : ''}
      </p>
      <p>Heat: ${unit.heat} / ${unit.heatSinks.count * (unit.heatSinks.type === 'double' ? 2 : 1)} dissipation${this._getHeatEffects(unit)}</p>
      ${this._renderHeatBar(unit)}
      <p>MP: ${unit.currentMP}/${unit.movement.walk}(${unit.movement.run})</p>
      <p>Pilot: G${unit.pilot.gunnery}/P${unit.pilot.piloting} | Facing: ${unit.position.facing}</p>
      ${unit.prone ? '<p style="color:#ff4444">PRONE</p>' : ''}
      ${unit.shutdown ? '<p style="color:#ff4444">SHUTDOWN</p>' : ''}
      <p>Heat Sinks: ${unit.heatSinks.count} (${unit.heatSinks.type})</p>
      ${armorHTML}
      <p>Weapons:</p><ul>${weapons || '<li>None</li>'}</ul>
      <p>Engine: ${unit.engine.type} (${unit.engine.hits}hits) | Gyro: ${unit.gyro.hits}hits</p>
    `;

    this._updateMPDisplay(unit);
  }

  _updateMPDisplay(unit) {
    this.mpDisplay.textContent = `MP: ${unit.currentMP} / ${unit.movement.walk} (Run: ${unit.movement.run}, Jump: ${unit.movement.jump})`;
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
  }

  _onActionProcessed(data) {
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
    }
  }

  _refreshMovementPreview() {
    // The movement calculator needs the full state (it validates against the
    // engine's rules); only what is drawn is projected back down to the view.
    const state = this.gameEngine.stateManager.getState();
    if (state.phase !== 'movement') return;
    const unit = state.getUnit(this.selectedUnitId);
    if (!unit || unit.player !== state.currentPlayer) return;

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
  }
}
