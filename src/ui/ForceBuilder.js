/**
 * ForceBuilder - Pre-game force construction UI.
 * Two-column layout: Player 1 (left), Player 2 (right).
 * Import Mech/Force buttons, browse roster, remove units,
 * tonnage counter, map selection dropdown, player name inputs,
 * Start Game button.
 */

import { Unit } from '../models/Unit.js';
import { parseMTF } from '../import/mtfParser.js';
import { parseAndConvert } from '../import/unitConverter.js';

export class ForceBuilder {
  constructor(config = {}) {
    this.mechsData = config.mechsData || { mechs: [] };
    this.mapsData = config.mapsData || { maps: [] };
    this.onStartGame = config.onStartGame || null;
    this.onCancel = config.onCancel || null;

    this.players = [
      { name: 'Player 1', units: [] },
      { name: 'Player 2', units: [] }
    ];
    this.selectedMapId = this.mapsData.maps.length > 0 ? this.mapsData.maps[0].id : null;

    this._unitCounter = 0;

    if (config.container) {
      this.container = config.container;
      this._buildUI();
    }
  }

  attach(container) {
    this.container = container;
    this._buildUI();
  }

  _nextUnitId(prefix = 'unit') {
    this._unitCounter++;
    return `${prefix}-${this._unitCounter}`;
  }

  _buildUI() {
    this.container.innerHTML = '';
    this.container.classList.add('force-builder');

    this._buildHeader();
    this._buildColumns();
    this._buildFooter();
    this._setupFileButtons();
  }

  _buildHeader() {
    const h2 = document.createElement('h2');
    h2.textContent = 'Force Builder';
    this.container.appendChild(h2);
  }

  _buildColumns() {
    const wrapper = document.createElement('div');
    wrapper.className = 'fb-columns';

    for (let p = 0; p < 2; p++) {
      const col = this._buildPlayerColumn(p);
      wrapper.appendChild(col);
    }

    this.container.appendChild(wrapper);
    this._renderUnitList(0);
    this._renderUnitList(1);
  }

  _buildPlayerColumn(playerIndex) {
    const col = document.createElement('div');
    col.className = 'fb-column';
    col.dataset.player = playerIndex;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'fb-player-name';
    nameInput.value = this.players[playerIndex].name;
    nameInput.placeholder = `Player ${playerIndex + 1} Name`;
    nameInput.addEventListener('input', (e) => {
      this.players[playerIndex].name = e.target.value || `Player ${playerIndex + 1}`;
      this._updateTonnage(playerIndex);
    });
    col.appendChild(nameInput);

    const tonnageDisplay = document.createElement('div');
    tonnageDisplay.className = 'fb-tonnage';
    tonnageDisplay.id = `fb-tonnage-${playerIndex}`;
    tonnageDisplay.textContent = 'Tonnage: 0 tons';
    col.appendChild(tonnageDisplay);

    const btnRow = document.createElement('div');
    btnRow.className = 'fb-btn-row';

    const importMechBtn = document.createElement('button');
    importMechBtn.textContent = 'Import Mech';
    importMechBtn.className = 'fb-import-mech';
    importMechBtn.dataset.player = playerIndex;
    btnRow.appendChild(importMechBtn);

    const importForceBtn = document.createElement('button');
    importForceBtn.textContent = 'Import Force';
    importForceBtn.className = 'fb-import-force';
    importForceBtn.dataset.player = playerIndex;
    btnRow.appendChild(importForceBtn);

    col.appendChild(btnRow);

    const browseRow = document.createElement('div');
    browseRow.className = 'fb-browse-row';

    const mechSelect = document.createElement('select');
    mechSelect.className = 'fb-mech-select';
    mechSelect.id = `fb-mech-select-${playerIndex}`;
    mechSelect.innerHTML = '<option value="">-- Add from roster --</option>';
    for (const mech of this.mechsData.mechs) {
      const opt = document.createElement('option');
      opt.value = mech.id;
      opt.textContent = `${mech.name} (${mech.tonnage}t)`;
      mechSelect.appendChild(opt);
    }
    browseRow.appendChild(mechSelect);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.className = 'fb-add-mech';
    addBtn.addEventListener('click', () => {
      const mechId = mechSelect.value;
      if (!mechId) return;
      this._addMechToPlayer(playerIndex, mechId);
      mechSelect.value = '';
    });
    browseRow.appendChild(addBtn);

    col.appendChild(browseRow);

    const unitList = document.createElement('div');
    unitList.className = 'fb-unit-list';
    unitList.id = `fb-unit-list-${playerIndex}`;
    col.appendChild(unitList);

    return col;
  }

  _buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'fb-footer';

    const mapRow = document.createElement('div');
    mapRow.className = 'fb-map-row';

    const mapLabel = document.createElement('label');
    mapLabel.textContent = 'Map: ';
    mapRow.appendChild(mapLabel);

    const mapSelect = document.createElement('select');
    mapSelect.className = 'fb-map-select';
    mapSelect.id = 'fb-map-select';
    for (const map of this.mapsData.maps) {
      const opt = document.createElement('option');
      opt.value = map.id;
      opt.textContent = `${map.name} - ${map.description}`;
      if (map.id === this.selectedMapId) opt.selected = true;
      mapSelect.appendChild(opt);
    }
    mapSelect.addEventListener('change', (e) => {
      this.selectedMapId = e.target.value;
    });
    mapRow.appendChild(mapSelect);

    footer.appendChild(mapRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'fb-footer-buttons';

    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start Game';
    startBtn.className = 'fb-start-game';
    startBtn.id = 'fb-start-game';
    startBtn.addEventListener('click', () => this._handleStartGame());
    btnRow.appendChild(startBtn);

    if (this.onCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'fb-cancel';
      cancelBtn.addEventListener('click', () => this.onCancel());
      btnRow.appendChild(cancelBtn);
    }

    footer.appendChild(btnRow);
    this.container.appendChild(footer);
  }

  _setupFileButtons() {
    const importMechBtns = this.container.querySelectorAll('.fb-import-mech');
    const importForceBtns = this.container.querySelectorAll('.fb-import-force');

    for (const btn of importMechBtns) {
      btn.addEventListener('click', () => {
        const playerIndex = parseInt(btn.dataset.player);
        this._promptImportMech(playerIndex);
      });
    }

    for (const btn of importForceBtns) {
      btn.addEventListener('click', () => {
        const playerIndex = parseInt(btn.dataset.player);
        this._promptImportForce(playerIndex);
      });
    }
  }

  _promptImportMech(playerIndex) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mtf';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this._importMechFromFile(playerIndex, file);
    });
    input.click();
  }

  _promptImportForce(playerIndex) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mul';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this._importForceFromFile(playerIndex, file);
    });
    input.click();
  }

  _importMechFromFile(playerIndex, file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const mechDef = parseMTF(e.target.result);
        this._addMechDefToPlayer(playerIndex, mechDef);
      } catch (err) {
        this._emitError(`Failed to import MTF file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  _importForceFromFile(playerIndex, file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const { parseMULToUnits } = await import('../import/mulParser.js');
        // parseMULToUnits(mulText, playerId, mechsData, mtfFiles): the roster is
        // the THIRD argument. Passing mechsData as the player id skipped the
        // roster lookup, so every imported 'Mech became a weaponless stub.
        const units = parseMULToUnits(e.target.result, playerIndex, this.mechsData);
        this._addUnitsToPlayer(playerIndex, units);
      } catch (err) {
        this._emitError(`Failed to import MUL file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  _addMechToPlayer(playerIndex, mechId) {
    const mechDef = this.mechsData.mechs.find(m => m.id === mechId);
    if (!mechDef) {
      this._emitError(`Mech not found: ${mechId}`);
      return;
    }
    this._addMechDefToPlayer(playerIndex, mechDef);
  }

  _addMechDefToPlayer(playerIndex, mechDef) {
    const unitId = this._nextUnitId(mechDef.id || 'custom');
    const unitFromDef = this._createUnitFromDef(mechDef, playerIndex, unitId);
    this.players[playerIndex].units.push(unitFromDef);
    this._renderUnitList(playerIndex);
    this._updateTonnage(playerIndex);
  }

  /**
   * Add already-built Unit instances (a parsed MUL force) to a player.
   *
   * The units arrive fully built: `parseMULToUnits` resolved the roster
   * definition and stamped the player id. Push them as they are - wrapping them
   * in `new Unit(unit)` again would rebuild them from their current state, and
   * writing player/id fields here would bypass the model's constructor (the UI
   * must not mutate units directly).
   *
   * @param {number} playerIndex
   * @param {Array<import('../models/Unit.js').Unit>} units
   */
  _addUnitsToPlayer(playerIndex, units) {
    if (!Array.isArray(units) || units.length === 0) return;
    this.players[playerIndex].units.push(...units);
    this._renderUnitList(playerIndex);
    this._updateTonnage(playerIndex);
  }

  _createUnitFromDef(mechDef, playerIndex, unitId) {
    if (mechDef.id) {
      return new Unit(mechDef, playerIndex, unitId);
    }
    try {
      const converted = parseAndConvert(mechDef);
      if (converted && converted.id) {
        return new Unit(converted, playerIndex, unitId);
      }
    } catch (e) {
      // Fallback: try to use the def directly
    }
    return new Unit(mechDef, playerIndex, unitId);
  }

  _removeUnit(playerIndex, index) {
    this.players[playerIndex].units.splice(index, 1);
    this._renderUnitList(playerIndex);
    this._updateTonnage(playerIndex);
  }

  _renderUnitList(playerIndex) {
    // Scope every lookup to this builder: `document.getElementById` would find
    // another Force Builder's list first if two were ever open at once, and the
    // visible builder would then look empty while its units lived on.
    const scope = this.container || document;
    const list = scope.querySelector(`#fb-unit-list-${playerIndex}`);
    if (!list) return;

    list.innerHTML = '';

    if (this.players[playerIndex].units.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fb-unit-empty';
      empty.textContent = 'No units added';
      list.appendChild(empty);
      return;
    }

    for (let i = 0; i < this.players[playerIndex].units.length; i++) {
      const unit = this.players[playerIndex].units[i];
      const item = document.createElement('div');
      item.className = 'fb-unit-item';

      const info = document.createElement('span');
      info.className = 'fb-unit-info';
      info.textContent = `${unit.name} (${unit.tonnage}t)`;
      item.appendChild(info);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.className = 'fb-remove-unit';
      removeBtn.addEventListener('click', () => this._removeUnit(playerIndex, i));
      item.appendChild(removeBtn);

      list.appendChild(item);
    }
  }

  _updateTonnage(playerIndex) {
    const scope = this.container || document;
    const display = scope.querySelector(`#fb-tonnage-${playerIndex}`);
    if (!display) return;

    const total = this.players[playerIndex].units.reduce((sum, u) => sum + u.tonnage, 0);
    display.textContent = `Tonnage: ${total} tons`;
  }

  _handleStartGame() {
    if (this.onStartGame) {
      this.onStartGame({
        players: this.players,
        selectedMapId: this.selectedMapId
      });
    }
  }

  _emitError(msg) {
    if (this.onStartGame) {
      this.onStartGame({ error: msg });
    }
  }

  getPlayerUnits(playerIndex) {
    return [...this.players[playerIndex].units];
  }

  getSelectedMapId() {
    return this.selectedMapId;
  }

  getPlayers() {
    return this.players.map(p => ({ name: p.name, units: [...p.units] }));
  }

  getTotalTonnage(playerIndex) {
    return this.players[playerIndex].units.reduce((sum, u) => sum + u.tonnage, 0);
  }

  reset() {
    this.players = [
      { name: 'Player 1', units: [] },
      { name: 'Player 2', units: [] }
    ];
    this.selectedMapId = this.mapsData.maps.length > 0 ? this.mapsData.maps[0].id : null;
    this._unitCounter = 0;
    this._buildUI();
  }
}
