/**
 * @vitest-environment jsdom
 *
 * Shared fixture for the record-sheet UI tests. The DOM mirrors the real
 * index.html shells the controller drives (unit panel controls + overlay), and
 * the engine mock exposes only what UIController reads: state, queue, weapon
 * data and the event bus.
 */

import { EventBus } from '../../../src/engine/EventBus.js';
import { Unit } from '../../../src/models/Unit.js';
import { Weapon } from '../../../src/models/Weapon.js';
import mechsData from '../../../src/data/mechs.json' with { type: 'json' };
import weaponsData from '../../../src/data/weapons.json' with { type: 'json' };

export const weaponsLookup = Weapon.createLookup(weaponsData);

export const RECORD_DOM = `
  <div id="phase-bar">
    <span id="phase-label">Phase: --</span>
    <span id="turn-label">Turn: 0</span>
    <span id="active-player">Active: --</span>
  </div>
  <div id="unit-panel">
    <h3>Unit Info</h3>
    <div id="unit-view-controls" data-view="record">
      <button type="button" id="btn-view-record" class="active" aria-pressed="true">Record card</button>
      <button type="button" id="btn-view-classic" aria-pressed="false">Classic bars</button>
      <button type="button" id="btn-record-sheet" disabled>Record Sheet</button>
    </div>
    <div id="unit-details"><p>Select a unit to view details</p></div>
  </div>
  <div id="action-buttons"></div>
  <div id="weapon-panel" style="display:none"><div id="weapon-list"></div><button id="btn-fire">Fire Selected</button></div>
  <div id="physical-panel" style="display:none"><select id="physical-type"><option value="punch">Punch</option></select><button id="btn-physical">Execute</button></div>
  <div id="movement-panel" style="display:none">
    <label><input type="radio" name="moveMode" value="walk" checked> Walk</label>
    <label><input type="radio" name="moveMode" value="run"> Run</label>
    <label><input type="radio" name="moveMode" value="jump"> Jump</label>
    <p id="mp-display">MP: 0 / 0</p>
    <button id="btn-confirm-move">Confirm Move</button>
    <button id="btn-cancel-move">Cancel</button>
  </div>
  <div id="dice-log"></div>
  <div id="record-overlay" style="display:none" role="dialog">
    <div id="record-sheet">
      <div class="record-sheet-header">
        <h2 id="record-sheet-title">Record Sheet</h2>
        <button type="button" id="btn-close-record">Close</button>
      </div>
      <div id="record-sheet-body"></div>
    </div>
  </div>
`;

export function resetDOM() {
  document.body.innerHTML = RECORD_DOM;
}

export function createRecordUnit(mechId, playerId = 0, unitId = null) {
  const definition = mechsData.mechs.find(mech => mech.id === mechId);
  if (!definition) throw new Error(`Mech not found: ${mechId}`);
  return new Unit(definition, playerId, unitId || `${mechId}-${playerId}`);
}

export function createRecordEngine(units = {}) {
  const state = {
    turn: 1,
    phase: 'initiative',
    currentPlayer: 0,
    players: [
      { id: 0, name: 'Player 1' },
      { id: 1, name: 'Player 2' }
    ],
    units,
    getUnit(id) { return this.units[id] || null; }
  };

  const engine = {
    eventBus: new EventBus(),
    stateManager: {
      getState() { return state; },
      applyStateChange(fn) { fn(state); },
      subscribe() {},
      undo() {}
    },
    phaseManager: {
      currentPhase: 'initiative',
      validateAction() { return { valid: true }; },
      getCurrentQueueEntry() { return null; },
      enterPhase() {},
      isDestroyedUnit(unit) {
        return unit.internalStructure.head <= 0 || unit.internalStructure.centerTorso <= 0;
      },
      isImmobile(unit) {
        return Boolean(unit.shutdown || (unit.pilot && unit.pilot.conscious === false));
      }
    },
    movementCalc: {
      getValidMoves() { return new Map(); },
      validateMovement() { return { valid: true, totalCost: 1, errors: [], finalFacing: 0 }; }
    },
    los: null,
    processAction() { return { success: true }; },
    attackResolver: {},
    _weaponsData: weaponsLookup,
    state
  };

  state.getUnit = (id) => state.units[id] || null;
  return engine;
}

export function createRecordRenderer() {
  return {
    validMoves: null,
    hoveredHex: null,
    selectedUnit: null,
    render() {},
    offsetX: 0,
    offsetY: 0,
    hexSize: 30
  };
}

export function addUnit(engine, unit) {
  engine.state.units[unit.id] = unit;
  return unit;
}
