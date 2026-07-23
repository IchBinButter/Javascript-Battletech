/**
 * UIController - DOM-based UI management.
 * Handles unit panel, action buttons, dice log, and phase display.
 */

export class UIController {
  constructor() {
    this.gameEngine = null;
    this.mapRenderer = null;
    this.selectedUnitId = null;

    // DOM elements
    this.phaseLabel = document.getElementById('phase-label');
    this.turnLabel = document.getElementById('turn-label');
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

  _onPhaseChanged(data) {
    this.phaseLabel.textContent = `Phase: ${data.phase}`;
    this.turnLabel.textContent = `Turn: ${data.turn}`;
    this._pendingTarget = null;
    this._updateActionButtons(data.phase);
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
    const state = this.gameEngine.stateManager.getState();
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
      this.mapRenderer.render(state);
    }
    this.updateUnitPanel(attacker);
  }

  _handlePhysicalAttack() {
    const state = this.gameEngine.stateManager.getState();
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
      this.mapRenderer.render(state);
    }
    this.updateUnitPanel(attacker);
  }

  _showWeaponPanel() {
    if (!this.selectedUnitId) {
      this.log('Select a unit first', 'miss');
      return;
    }

    const state = this.gameEngine.stateManager.getState();
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
    // This is populated from the weapon lookup table
    if (this.gameEngine.attackResolver && this.gameEngine._weaponsData) {
      return this.gameEngine._weaponsData[weaponType] || null;
    }
    return null;
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
      const maxArmor = unit.tonnage > 60 ? 45 : unit.tonnage > 35 ? 30 : 20;
      const pct = Math.min(100, Math.max(0, (armor / maxArmor) * 100));
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

    this.unitDetails.innerHTML = `
      <p><strong>${unit.name}</strong> (${unit.tonnage}t) - Player ${unit.player + 1}</p>
      <p>Heat: ${unit.heat} | MP: ${unit.currentMP}/${unit.movement.walk}(${unit.movement.run})</p>
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
    const state = this.gameEngine.stateManager.getState();
    const unit = state.getUnit(data.unitId);
    this.log(`Unit ${data.unitId} moved to ${data.hexKey}, facing ${data.facing}`);
    if (unit && unit.id === this.selectedUnitId) {
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
    // Generic action logging
  }

  _setupActionButtons() {
    // Movement mode radio buttons
    document.querySelectorAll('input[name="moveMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.movementMode = e.target.value;
      });
    });

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
