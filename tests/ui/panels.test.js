/**
 * @vitest-environment jsdom
 *
 * Panel transitions: every phase must show exactly the panel and buttons it
 * needs, and hide the rest. This is the "are buttons missing or stuck" test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIController } from '../../src/ui/UIController.js';
import { EventBus } from '../../src/engine/EventBus.js';

function createDOMFixture() {
  document.body.innerHTML = `
    <span id="phase-label">Phase: --</span>
    <span id="turn-label">Turn: 0</span>
    <span id="active-player">Active: --</span>
    <div id="unit-details">Select a unit</div>
    <div id="action-buttons"></div>
    <div id="weapon-panel" style="display:none"><div id="weapon-list"></div><button id="btn-fire">Fire Selected</button></div>
    <div id="physical-panel" style="display:none"><select id="physical-type"><option value="punch">Punch</option></select><button id="btn-physical">Execute</button></div>
    <div id="movement-panel" style="display:none">
      <input type="radio" name="moveMode" value="walk" checked>
      <input type="radio" name="moveMode" value="run">
      <input type="radio" name="moveMode" value="jump">
      <p id="mp-display">MP: 0 / 0</p>
      <button id="btn-confirm-move">Confirm Move</button>
      <button id="btn-cancel-move">Cancel</button>
    </div>
    <div id="dice-log"></div>
  `;
}

function createEngine() {
  const state = {
    turn: 1,
    phase: 'initiative',
    currentPlayer: 0,
    players: [{ id: 0, name: 'Player 1' }, { id: 1, name: 'Player 2' }],
    units: {},
    getUnit: () => null,
    getPlayerUnits: () => []
  };

  return {
    eventBus: new EventBus(),
    stateManager: { getState: () => state },
    processAction: () => ({ success: true })
  };
}

const renderer = () => ({ selectedUnit: null, validMoves: null, render() {} });

function emitPhase(engine, phase) {
  engine.stateManager.getState().phase = phase;
  engine.eventBus.emit('phaseChanged', { phase, turn: 1 });
}

describe('UIController panel transitions', () => {
  let ui;
  let engine;

  beforeEach(() => {
    createDOMFixture();
    engine = createEngine();
    ui = new UIController();
    ui.init(engine, renderer());
  });

  it('starts with every contextual panel hidden', () => {
    expect(document.getElementById('movement-panel').style.display).toBe('none');
    expect(document.getElementById('weapon-panel').style.display).toBe('none');
    expect(document.getElementById('physical-panel').style.display).toBe('none');
  });

  it('shows the movement panel and its buttons in the movement phase', () => {
    emitPhase(engine, 'movement');

    expect(document.getElementById('movement-panel').style.display).toBe('block');
    expect(document.getElementById('phase-label').textContent).toBe('Phase: movement');
    const buttons = [...document.querySelectorAll('#action-buttons button')].map(b => b.textContent);
    expect(buttons).toEqual(['End Movement Phase']);
  });

  it('shows the weapon and physical buttons in the weapon attack phase', () => {
    emitPhase(engine, 'weapon_attack');

    const buttons = [...document.querySelectorAll('#action-buttons button')].map(b => b.textContent);
    expect(buttons).toEqual(['Declare Weapon Fire', 'End Weapon Phase']);
    expect(document.getElementById('movement-panel').style.display).toBe('none');
  });

  it('shows the physical panel in the physical attack phase', () => {
    emitPhase(engine, 'physical_attack');

    expect(document.getElementById('physical-panel').style.display).toBe('block');
    const buttons = [...document.querySelectorAll('#action-buttons button')].map(b => b.textContent);
    expect(buttons).toEqual(['End Physical Phase']);
  });

  it('swaps the action button as phases change', () => {
    emitPhase(engine, 'heat');
    expect([...document.querySelectorAll('#action-buttons button')].map(b => b.textContent))
      .toEqual(['Resolve Heat']);

    emitPhase(engine, 'end');
    expect([...document.querySelectorAll('#action-buttons button')].map(b => b.textContent))
      .toEqual(['Next Turn']);

    emitPhase(engine, 'initiative');
    expect([...document.querySelectorAll('#action-buttons button')].map(b => b.textContent))
      .toEqual(['Roll Initiative']);
  });

  it('hides the movement panel again when the phase ends', () => {
    emitPhase(engine, 'movement');
    expect(document.getElementById('movement-panel').style.display).toBe('block');

    emitPhase(engine, 'weapon_attack');
    expect(document.getElementById('movement-panel').style.display).toBe('none');
    expect(document.getElementById('physical-panel').style.display).toBe('none');
  });

  it('updates the active player line from the state', () => {
    emitPhase(engine, 'movement');
    expect(document.getElementById('active-player').textContent).toBe('Active: Player 1');
  });

  it('opening weapon fire mode shows the weapon panel and lists weapons', () => {
    // A unit with a weapon so the panel builds a checkbox per weapon.
    const unit = {
      id: 'u1',
      name: 'Atlas AS7-D',
      player: 0,
      equipment: { weapons: [{ type: 'med_laser', location: 'rightArm' }], ammo: {} },
      getAllWeapons() { return this.equipment.weapons; }
    };
    engine.stateManager.getState().units = { u1: unit };
    engine.stateManager.getState().getUnit = () => unit;
    engine.stateManager.getState().getPlayerUnits = () => [unit];

    ui.selectedUnitId = 'u1';
    emitPhase(engine, 'weapon_attack');

    const declare = [...document.querySelectorAll('#action-buttons button')]
      .find(b => b.textContent === 'Declare Weapon Fire');
    declare.click();

    expect(document.getElementById('weapon-panel').style.display).toBe('block');
  });

  it('logs messages with a class so the dice log is styled', () => {
    ui.log('hello', 'hit');
    const entries = document.querySelectorAll('#dice-log .log-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].textContent).toContain('hello');
    expect(entries[0].className).toContain('hit');
  });
});
