/**
 * @vitest-environment jsdom
 *
 * Panel transitions: every phase must show exactly the panel and buttons it
 * needs, and hide the rest. This is the "are buttons missing or stuck" test.
 *
 * The weapon picker is also checked here: it must only offer weapons that can
 * actually fire, and grey the rest out with a reason instead of letting the
 * engine reject the shot after the player pressed Fire.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIController } from '../../src/ui/UIController.js';
import { EventBus } from '../../src/engine/EventBus.js';
import { weaponInstanceKey } from '../../src/engine/GameEngine.js';
import { Weapon } from '../../src/models/Weapon.js';
import { createTestEngine, createTestUnit } from '../helpers/testUtils.js';
import weaponsData from '../../src/data/weapons.json' with { type: 'json' };

const weaponsLookup = Weapon.createLookup(weaponsData);

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
    processAction: () => ({ success: true }),
    // After initCombat/`_weaponsData` assignment, `_getWeaponData` resolves.
    attackResolver: {},
    _weaponsData: weaponsLookup
  };
}

const renderer = () => ({ selectedUnit: null, validMoves: null, render() {} });

function emitPhase(engine, phase) {
  engine.stateManager.getState().phase = phase;
  engine.eventBus.emit('phaseChanged', { phase, turn: 1 });
}

/** Register a unit on the fixture state and keep getUnit() in sync. */
function addUnit(state, unit) {
  state.units[unit.id] = unit;
  state.getUnit = (id) => state.units[id] || null;
  return unit;
}

/**
 * A minimal unit: the weapon entries the panel iterates, the ammo bins the
 * engine's declaration check reads, the critical slots p46 reads, and a
 * position for the target-dependent checks.
 */
function createUnit({ id = 'u1', player = 0, hexKey = '5,7', facing = 3, weapons, ammo = {}, criticalSlots = {} }) {
  return {
    id,
    name: 'Test Mech',
    player,
    position: { hexKey, facing },
    equipment: { weapons, ammo },
    criticalSlots,
    getAllWeapons() { return this.equipment.weapons; }
  };
}

/** Open the picker for `unitId`, optionally with a target already picked. */
function openWeaponPanel(ui, unitId, targetId = null) {
  ui.selectedUnitId = unitId;
  ui._pendingTarget = targetId;
  ui._showWeaponPanel();
}

/** All rendered weapon rows. */
function weaponRows() {
  return [...document.querySelectorAll('#weapon-list label')];
}

/** The row for one mounted weapon entry. */
function weaponRow(type, location = null) {
  return weaponRows().find(row => {
    const check = row.querySelector('.weapon-check');
    return check
      && check.dataset.type === type
      && (location === null || check.dataset.location === location);
  }) || null;
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
    expect(document.querySelectorAll('#weapon-list .weapon-check')).toHaveLength(1);
  });

  it('logs messages with a class so the dice log is styled', () => {
    ui.log('hello', 'hit');
    const entries = document.querySelectorAll('#dice-log .log-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].textContent).toContain('hello');
    expect(entries[0].className).toContain('hit');
  });
});

describe('UIController weapon eligibility', () => {
  let ui;
  let engine;
  let state;

  beforeEach(() => {
    createDOMFixture();
    engine = createEngine();
    state = engine.stateManager.getState();
    ui = new UIController();
    ui.init(engine, renderer());
  });

  it('disables a weapon with no ammunition and shows the reason', () => {
    const unit = createUnit({
      weapons: [
        { type: 'srm6', location: 'leftTorso' },                        // no bin at all
        { type: 'ac20', location: 'rightTorso', ammoBin: 'ac20_ammo' }  // empty bin
      ],
      ammo: { ac20_ammo: { type: 'ac20', shots: 0, explosive: true } }
    });
    addUnit(state, unit);

    openWeaponPanel(ui, unit.id);

    for (const [type, location] of [['srm6', 'leftTorso'], ['ac20', 'rightTorso']]) {
      const row = weaponRow(type, location);
      expect(row.dataset.eligible).toBe('false');
      expect(row.querySelector('.weapon-check').disabled).toBe(true);
      expect(row.querySelector('.weapon-reason').textContent).toBe('no ammo');
    }
  });

  it('disables a weapon that already fired this turn', () => {
    const unit = createUnit({ weapons: [{ type: 'med_laser', location: 'rightArm' }] });
    // The engine's declaration key and turn reset, exactly as C-09 records them.
    unit.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    unit.firedWeaponsTurn = state.turn;
    addUnit(state, unit);

    openWeaponPanel(ui, unit.id);

    let row = weaponRow('med_laser', 'rightArm');
    expect(row.dataset.eligible).toBe('false');
    expect(row.querySelector('.weapon-check').disabled).toBe(true);
    expect(row.querySelector('.weapon-reason').textContent).toBe('already fired');

    // A new turn resets the engine's fired set; the panel must follow.
    unit.firedWeaponsTurn = state.turn - 1;
    openWeaponPanel(ui, unit.id);

    row = weaponRow('med_laser', 'rightArm');
    expect(row.dataset.eligible).toBe('true');
    expect(row.querySelector('.weapon-check').disabled).toBe(false);
  });

  it('disables only the fired instance of two identical weapons', () => {
    // p24 counts weapons, not weapon models: the Atlas has two medium lasers
    // in one arm and firing one must leave the other selectable.
    const weapons = [
      { type: 'med_laser', location: 'rightArm' },
      { type: 'med_laser', location: 'rightArm' }
    ];
    const unit = createUnit({ weapons });
    unit.firedWeaponsThisTurn = new Set(['med_laser@rightArm#0']);
    unit.firedWeaponsTurn = state.turn;
    addUnit(state, unit);

    openWeaponPanel(ui, unit.id);

    const rows = weaponRows();
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.querySelector('.weapon-check').disabled)).toEqual([true, false]);
    expect(rows[0].querySelector('.weapon-reason').textContent).toBe('already fired');
    expect(rows[1].querySelector('.weapon-reason')).toBeNull();

    // The old model-level record (a save from before per-instance identity)
    // still counts for every identical mount.
    unit.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    openWeaponPanel(ui, unit.id);
    expect(weaponRows().map(row => row.querySelector('.weapon-check').disabled))
      .toEqual([true, true]);
  });

  it('records each weapon instance index on its picker row', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 3 };
    addUnit(state, unit);

    openWeaponPanel(ui, unit.id);

    const indices = [...document.querySelectorAll('.weapon-check')]
      .map(check => Number(check.dataset.weaponIndex));
    expect(indices).toEqual(unit.getAllWeapons().map((weapon, weaponIndex) => weaponIndex));
  });

  it('disables a weapon whose own critical slot is destroyed', () => {
    const unit = createUnit({
      weapons: [{ type: 'med_laser', location: 'rightArm' }],
      criticalSlots: {
        rightArm: [
          { slot: 1, item: 'shoulder', status: 'ok' },
          { slot: 5, item: 'med_laser', status: 'destroyed' }
        ]
      }
    });
    addUnit(state, unit);

    openWeaponPanel(ui, unit.id);

    const row = weaponRow('med_laser', 'rightArm');
    expect(row.querySelector('.weapon-check').disabled).toBe(true);
    expect(row.querySelector('.weapon-reason').textContent).toBe('destroyed');

    // An intact record sheet (the mount is not damaged) offers the weapon.
    unit.criticalSlots.rightArm[1].status = 'ok';
    openWeaponPanel(ui, unit.id);
    expect(weaponRow('med_laser', 'rightArm').querySelector('.weapon-check').disabled).toBe(false);
  });

  it('disables only the identical mount whose slot is destroyed (Atlas)', () => {
    // The Atlas has two medium lasers in the right arm. Losing slot 6 kills the
    // second mount only, so one row stays selectable.
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    atlas.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    addUnit(state, atlas);

    openWeaponPanel(ui, atlas.id);

    const rows = weaponRows().filter(row => row.querySelector('.weapon-check').dataset.type === 'med_laser');
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.querySelector('.weapon-check').disabled)).toEqual([false, true]);
    expect(rows[0].querySelector('.weapon-reason')).toBeNull();
    expect(rows[1].querySelector('.weapon-reason').textContent).toBe('destroyed');
  });

  it('disables a multi-slot weapon when one of its slots is destroyed (Atlas AC/20)', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    // One of the AC/20's ten right-torso slots: the whole item is disabled (p46).
    atlas.criticalSlots.rightTorso
      .find(slot => slot.item === 'ac20' && slot.slot === 2).status = 'destroyed';
    addUnit(state, atlas);

    openWeaponPanel(ui, atlas.id);

    const ac20 = weaponRow('ac20', 'rightTorso');
    expect(ac20.querySelector('.weapon-check').disabled).toBe(true);
    expect(ac20.querySelector('.weapon-reason').textContent).toBe('destroyed');

    // The SRM-6 and LRM-20 in the left torso are separate components.
    expect(weaponRow('srm6', 'leftTorso').querySelector('.weapon-check').disabled).toBe(false);
    expect(weaponRow('lrm20', 'leftTorso').querySelector('.weapon-check').disabled).toBe(false);
  });

  it('disables a weapon whose multi-slot component is entirely gone', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    for (const slot of atlas.criticalSlots.leftTorso) {
      if (slot.item === 'lrm20') slot.status = 'destroyed';
    }
    addUnit(state, atlas);

    openWeaponPanel(ui, atlas.id);

    expect(weaponRow('lrm20', 'leftTorso').querySelector('.weapon-check').disabled).toBe(true);
    expect(weaponRow('lrm20', 'leftTorso').querySelector('.weapon-reason').textContent).toBe('destroyed');
    // The SRM-6 shares the location but not the component.
    expect(weaponRow('srm6', 'leftTorso').querySelector('.weapon-check').disabled).toBe(false);
  });

  it('leaves three arm lasers with two rows after one is destroyed (Thunderbolt)', () => {
    const thunderbolt = createTestUnit('thunderbolt-tdr5s', 0, 'thunderbolt-0');
    thunderbolt.position = { hexKey: '6,7', facing: 3 };
    thunderbolt.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    addUnit(state, thunderbolt);

    openWeaponPanel(ui, thunderbolt.id);

    const rows = weaponRows().filter(row => row.querySelector('.weapon-check').dataset.type === 'med_laser');
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.querySelector('.weapon-check').disabled)).toEqual([false, true, false]);
  });

  it('splits six PPC slots so one destroyed slot disables one row (Awesome)', () => {
    const awesome = createTestUnit('awesome-aws8q', 0, 'awesome-0');
    awesome.position = { hexKey: '7,7', facing: 3 };
    // Slot 7 is inside the second right-torso PPC's chunk (6-8).
    awesome.criticalSlots.rightTorso
      .find(slot => slot.item === 'ppc' && slot.slot === 7).status = 'destroyed';
    addUnit(state, awesome);

    openWeaponPanel(ui, awesome.id);

    const torsoPpcs = weaponRows()
      .filter(row => row.querySelector('.weapon-check').dataset.type === 'ppc')
      .filter(row => row.querySelector('.weapon-check').dataset.location === 'rightTorso');
    expect(torsoPpcs).toHaveLength(2);
    expect(torsoPpcs.map(row => row.querySelector('.weapon-check').disabled)).toEqual([false, true]);
    // The arm PPC is its own component.
    const armPpc = weaponRows()
      .filter(row => row.querySelector('.weapon-check').dataset.type === 'ppc')
      .filter(row => row.querySelector('.weapon-check').dataset.location === 'rightArm');
    expect(armPpc).toHaveLength(1);
    expect(armPpc[0].querySelector('.weapon-check').disabled).toBe(false);
  });

  it('disables a weapon that cannot bear on the pending target', () => {
    // Facing south (3); the enemy is north, i.e. in the rear arc.
    const unit = createUnit({
      hexKey: '5,7',
      facing: 3,
      weapons: [{ type: 'med_laser', location: 'rightArm' }]
    });
    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,6', weapons: [] });
    addUnit(state, unit);
    addUnit(state, target);

    openWeaponPanel(ui, unit.id, target.id);

    const row = weaponRow('med_laser', 'rightArm');
    expect(row.dataset.eligible).toBe('false');
    expect(row.querySelector('.weapon-check').disabled).toBe(true);
    expect(row.querySelector('.weapon-reason').textContent).toBe('out of arc');
  });

  it('disables a weapon that is out of range of the pending target', () => {
    const unit = createUnit({
      hexKey: '5,7',
      facing: 3,
      weapons: [
        { type: 'small_laser', location: 'rightArm' }, // 1/2/3, too short at distance 4
        { type: 'med_laser', location: 'leftArm' }     // 3/6/9, still in range
      ]
    });
    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,11', weapons: [] });
    addUnit(state, unit);
    addUnit(state, target);

    openWeaponPanel(ui, unit.id, target.id);

    const short = weaponRow('small_laser', 'rightArm');
    expect(short.querySelector('.weapon-check').disabled).toBe(true);
    expect(short.querySelector('.weapon-reason').textContent).toBe('out of range');

    const legal = weaponRow('med_laser', 'leftArm');
    expect(legal.dataset.eligible).toBe('true');
    expect(legal.querySelector('.weapon-check').disabled).toBe(false);
  });

  it('disables a weapon when the pending target has no line of sight', () => {
    const unit = createUnit({
      hexKey: '5,7',
      facing: 3,
      weapons: [{ type: 'med_laser', location: 'rightArm' }]
    });
    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,8', weapons: [] });
    addUnit(state, unit);
    addUnit(state, target);
    state.map = { hexes: new Map() };
    engine.los = { calculateLOS: () => ({ blocked: true, reason: 'blocked by test' }) };

    openWeaponPanel(ui, unit.id, target.id);

    const row = weaponRow('med_laser', 'rightArm');
    expect(row.querySelector('.weapon-check').disabled).toBe(true);
    expect(row.querySelector('.weapon-reason').textContent).toBe('no line of sight');
  });

  it('keeps a legal weapon enabled when a target is pending', () => {
    const unit = createUnit({
      hexKey: '5,7',
      facing: 3,
      weapons: [{ type: 'med_laser', location: 'rightArm' }]
    });
    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,8', weapons: [] });
    addUnit(state, unit);
    addUnit(state, target);
    state.map = { hexes: new Map() };
    engine.los = { calculateLOS: () => ({ blocked: false }) };

    openWeaponPanel(ui, unit.id, target.id);

    const row = weaponRow('med_laser', 'rightArm');
    expect(row.dataset.eligible).toBe('true');
    expect(row.classList.contains('weapon-option-disabled')).toBe(false);
    expect(row.querySelector('.weapon-check').disabled).toBe(false);
    expect(row.querySelector('.weapon-reason')).toBeNull();
    expect(row.textContent).toContain('Medium Laser (3/6/9)');
  });

  it('rebuilds the picker after a fire action so a spent weapon is disabled', () => {
    const unit = createUnit({ weapons: [{ type: 'med_laser', location: 'rightArm' }] });
    addUnit(state, unit);
    ui.weaponFireMode = true;
    openWeaponPanel(ui, unit.id);
    expect(weaponRow('med_laser', 'rightArm').querySelector('.weapon-check').disabled).toBe(false);

    // The engine resolves the shot and records the declaration for this turn.
    unit.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    unit.firedWeaponsTurn = state.turn;
    engine.eventBus.emit('actionProcessed', { action: { type: 'fire' } });

    const row = weaponRow('med_laser', 'rightArm');
    expect(row.querySelector('.weapon-check').disabled).toBe(true);
    expect(row.querySelector('.weapon-reason').textContent).toBe('already fired');
  });

  it('rebuilds the picker for the batched fireWeapons action type', () => {
    const unit = createUnit({ weapons: [{ type: 'med_laser', location: 'rightArm' }] });
    addUnit(state, unit);
    ui.weaponFireMode = true;
    openWeaponPanel(ui, unit.id);
    expect(weaponRow('med_laser', 'rightArm').querySelector('.weapon-check').disabled).toBe(false);

    // The UI sends 'fireWeapons'; the engine records the declaration per shot.
    unit.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    unit.firedWeaponsTurn = state.turn;
    engine.eventBus.emit('actionProcessed', { action: { type: 'fireWeapons' } });

    const row = weaponRow('med_laser', 'rightArm');
    expect(row.querySelector('.weapon-check').disabled).toBe(true);
    expect(row.querySelector('.weapon-reason').textContent).toBe('already fired');
  });

  it('only applies target-independent reasons when no target is pending', () => {
    const unit = createUnit({
      weapons: [
        { type: 'med_laser', location: 'rightArm' },      // legal
        { type: 'med_laser_rear', location: 'centerTorso' }, // rear-mounted, still legal
        { type: 'srm6', location: 'leftTorso' },          // no ammo
        { type: 'large_laser', location: 'rightTorso' }   // already fired
      ],
      ammo: {}
    });
    unit.firedWeaponsThisTurn = new Set(['large_laser@rightTorso']);
    unit.firedWeaponsTurn = state.turn;
    addUnit(state, unit);

    openWeaponPanel(ui, unit.id);

    const rows = weaponRows();
    expect(rows).toHaveLength(4);

    const enabled = rows.filter(row => row.dataset.eligible === 'true');
    expect(enabled).toHaveLength(2);
    expect(enabled.map(row => row.querySelector('.weapon-check').dataset.type).sort())
      .toEqual(['med_laser', 'med_laser_rear']);

    // Without a target the panel knows nothing about arcs, range or LOS, so
    // those reasons must not appear.
    for (const row of rows.filter(r => r.dataset.eligible === 'false')) {
      const reason = row.querySelector('.weapon-reason').textContent;
      expect(['destroyed', 'no ammo', 'already fired']).toContain(reason);
    }
    expect(rows.some(row => row.querySelector('.weapon-reason')?.textContent === 'out of arc'
      || row.querySelector('.weapon-reason')?.textContent === 'out of range'
      || row.querySelector('.weapon-reason')?.textContent === 'no line of sight')).toBe(false);
  });
});

describe('UIController batched weapon fire', () => {
  let ui;
  let engine;
  let state;

  beforeEach(() => {
    createDOMFixture();
    engine = createEngine();
    state = engine.stateManager.getState();
    ui = new UIController();
    ui.init(engine, renderer());
  });

  /**
   * Open the picker for a real Atlas (so updateUnitPanel can render it) with an
   * enemy target 6 hexes due south: in arc, in range and with clear "LOS" in the
   * mock engine (no los helper means clear).
   */
  function armTwoWeaponDeclaration() {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 3 };
    addUnit(state, unit);

    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,13', weapons: [] });
    addUnit(state, target);

    ui.weaponFireMode = true;
    ui.selectedUnitId = unit.id;
    ui._pendingTarget = target.id;
    ui._showWeaponPanel();
    return { unit, target };
  }

  function check(type, location) {
    const box = weaponRow(type, location).querySelector('.weapon-check');
    expect(box.disabled, `${type} at ${location} should be eligible`).toBe(false);
    box.checked = true;
  }

  it('sends every checked weapon as one batched declaration, not one call each', () => {
    const { unit, target } = armTwoWeaponDeclaration();
    check('ac20', 'rightTorso');
    check('lrm20', 'leftTorso');

    const processAction = vi.fn(() => ({
      success: true,
      fired: 2,
      rejected: 0,
      shots: [{ success: true }, { success: true }]
    }));
    engine.processAction = processAction;

    document.getElementById('btn-fire').click();

    // One declaration for the whole 'Mech: the queue advances once.
    expect(processAction).toHaveBeenCalledTimes(1);
    const [playerId, action] = processAction.mock.calls[0];
    expect(playerId).toBe(0);
    expect(action.type).toBe('fireWeapons');
    expect(action.attackerId).toBe(unit.id);
    expect(action.targetId).toBe(target.id);
    expect(action.shots.map(shot => [shot.weapon.id, shot.weaponLocation])).toEqual([
      ['ac20', 'rightTorso'],
      ['lrm20', 'leftTorso']
    ]);
    expect(action.shots[0].ammoBin).toBe('ac20_ammo');
  });

  it('sends the mounted instance index for every checked weapon', () => {
    const { unit } = armTwoWeaponDeclaration();

    // The Atlas has two medium lasers in the right arm. Both rows must be
    // selectable and each shot must name its own mount (p24 keys the fired
    // record by instance, not by weapon model).
    const laserChecks = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'med_laser');
    expect(laserChecks).toHaveLength(2);
    expect(laserChecks.map(check => check.dataset.location)).toEqual(['rightArm', 'rightArm']);
    expect(laserChecks.map(check => check.disabled)).toEqual([false, false]);
    laserChecks.forEach(check => { check.checked = true; });

    const processAction = vi.fn(() => ({
      success: true,
      fired: 2,
      rejected: 0,
      shots: [{ success: true, weaponIndex: 1 }, { success: true, weaponIndex: 2 }]
    }));
    engine.processAction = processAction;

    document.getElementById('btn-fire').click();

    expect(processAction).toHaveBeenCalledTimes(1);
    const [, action] = processAction.mock.calls[0];
    expect(action.type).toBe('fireWeapons');
    expect(action.shots).toHaveLength(2);
    expect(action.shots.map(shot => shot.weapon.id)).toEqual(['med_laser', 'med_laser']);
    expect(action.shots.map(shot => shot.weaponIndex)).toEqual([1, 2]);
  });

  /**
   * A real engine and UI for an Atlas-vs-Atlas duel 6 hexes due south, mid
   * Weapon Attack Phase with the Atlas holding the declaration slot. Returns
   * the live unit, which is what the engine mutates.
   */
  function realAtlasFireSetup() {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    const target = createTestUnit('atlas-as7d', 1, 'target-1');
    target.position = { hexKey: '5,13', facing: 0 };

    const realEngine = createTestEngine({
      units: { 'atlas-0': atlas, 'target-1': target },
      enforceWeaponDeclarations: true
    });
    realEngine._weaponsData = weaponsLookup;
    // Player 1 wins initiative, so player 0's Atlas declares first (p10).
    realEngine.stateManager.getState().initiativeWinner = 1;
    realEngine.phaseManager.enterPhase('weapon_attack');

    const realUi = new UIController();
    realUi.init(realEngine, renderer());
    realUi.weaponFireMode = true;
    realUi.selectedUnitId = atlas.id;
    realUi._pendingTarget = target.id;
    realUi._showWeaponPanel();
    return { atlas, target, realEngine, realUi };
  }

  /**
   * The live-play bug this fixes: an Atlas with two medium lasers in its right
   * arm fired one, and the second was refused with "Weapon med_laser has
   * already fired this turn". Run the whole click path against a real engine
   * and declaration queue.
   */
  it('fires two identical weapons from one Fire Selected click', () => {
    const { atlas } = realAtlasFireSetup();

    const laserChecks = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'med_laser');
    expect(laserChecks).toHaveLength(2);
    expect(laserChecks.every(check => !check.disabled)).toBe(true);
    laserChecks.forEach(check => { check.checked = true; });

    document.getElementById('btn-fire').click();

    // Both mounts fired: two heat additions, two recorded instances, no
    // "already fired" rejection on screen.
    expect(atlas.heat).toBe(6);
    expect([...atlas.firedWeaponsThisTurn].sort())
      .toEqual(['med_laser@rightArm#1', 'med_laser@rightArm#2']);
    expect(document.getElementById('dice-log').textContent).not.toContain('already fired');
  });

  /**
   * T5-1 live path: one critical hit destroys one of the two right-arm lasers.
   * The picker must disable exactly that row and Fire must resolve one shot,
   * not two (the pre-fix engine fired both).
   */
  it('fires only the intact mount from one Fire Selected click after a crit', () => {
    const { atlas, realUi } = realAtlasFireSetup();
    // Record-sheet slot 6 is the second right-arm laser.
    atlas.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    realUi._showWeaponPanel();

    const laserChecks = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'med_laser');
    expect(laserChecks).toHaveLength(2);
    expect(laserChecks.map(check => check.disabled)).toEqual([false, true]);
    expect(laserChecks[1].closest('label').querySelector('.weapon-reason').textContent)
      .toBe('destroyed');

    // Only the surviving mount is selectable.
    laserChecks[0].checked = true;
    document.getElementById('btn-fire').click();

    expect(atlas.heat).toBe(3);
    expect([...atlas.firedWeaponsThisTurn]).toEqual(['med_laser@rightArm#1']);
    expect(document.getElementById('dice-log').textContent).not.toContain('already fired');
  });

  it('logs a per-shot rejection without hiding the shots that resolved', () => {
    armTwoWeaponDeclaration();
    check('ac20', 'rightTorso');
    check('lrm20', 'leftTorso');

    engine.processAction = vi.fn(() => ({
      success: true,
      fired: 1,
      rejected: 1,
      shots: [
        { success: true },
        { success: false, error: 'already fired' }
      ]
    }));

    document.getElementById('btn-fire').click();

    const fireErrors = [...document.querySelectorAll('#dice-log .log-entry')]
      .map(entry => entry.textContent)
      .filter(text => text.includes('Fire error'));
    expect(fireErrors).toEqual(['Fire error: already fired']);
    // The pending target is consumed by the declaration either way.
    expect(ui._pendingTarget).toBeNull();
  });

  it('reports a refused declaration that produced no per-shot results', () => {
    armTwoWeaponDeclaration();
    check('med_laser', 'rightArm');

    engine.processAction = vi.fn(() => ({ success: false, error: 'Not your turn' }));

    document.getElementById('btn-fire').click();

    expect(document.getElementById('dice-log').textContent).toContain('Fire error: Not your turn');
    expect(ui._pendingTarget).toBeNull();
  });
});

/**
 * F3: the picker needs a unit-level gate. The engine refuses the whole
 * declaration with "Not the current acting unit" (PhaseManager.validateAction)
 * or with _handleFire's destroyed / shutdown / unconscious-warrior guards, so
 * every weapon row must be disabled, with the reason shown for the 'Mech rather
 * than repeated per row.
 */
describe('UIController weapon picker unit gate', () => {
  let ui;
  let engine;
  let state;

  beforeEach(() => {
    createDOMFixture();
    engine = createEngine();
    state = engine.stateManager.getState();
    ui = new UIController();
    ui.init(engine, renderer());
  });

  function acting(unitId, playerId = 0) {
    engine.phaseManager = { getCurrentQueueEntry: () => ({ unitId, playerId }) };
  }

  it('disables the whole picker for a Mech that is not the acting unit', () => {
    // The reviewer's live case: five legal weapons on a non-acting own 'Mech,
    // shown enabled, then Fire fails with "Not the current acting unit".
    const actingUnit = createUnit({ id: 'acting-0', weapons: [{ type: 'med_laser', location: 'leftArm' }] });
    const selectedUnit = createUnit({
      id: 'other-0',
      hexKey: '5,7',
      facing: 3,
      weapons: [
        { type: 'med_laser', location: 'rightArm' },
        { type: 'large_laser', location: 'rightTorso' },
        { type: 'ac20', location: 'rightTorso', ammoBin: 'ac20_ammo' },
        { type: 'srm6', location: 'leftTorso' },
        { type: 'lrm20', location: 'leftTorso' }
      ],
      ammo: {
        ac20_ammo: { type: 'ac20', shots: 5 },
        srm6_ammo: { type: 'srm6', shots: 15 },
        lrm20_ammo: { type: 'lrm20', shots: 6 }
      }
    });
    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,13', weapons: [] });
    addUnit(state, actingUnit);
    addUnit(state, selectedUnit);
    addUnit(state, target);

    state.phase = 'weapon_attack';
    state.currentPlayer = 0;
    acting(actingUnit.id);
    ui.weaponFireMode = true;

    openWeaponPanel(ui, selectedUnit.id, target.id);

    // Every weapon is individually legal against this target (distance 6, in
    // front, clear LOS in the fixture), yet none is offered because the acting
    // unit is another 'Mech.
    const checks = [...document.querySelectorAll('.weapon-check')];
    expect(checks).toHaveLength(5);
    expect(checks.every(check => check.disabled)).toBe(true);
    expect(document.querySelectorAll('.weapon-check:not(:disabled)')).toHaveLength(0);

    const notice = document.querySelector('.weapon-panel-notice');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('not the acting unit');
    expect(document.getElementById('btn-fire').disabled).toBe(true);
  });

  it('disables the picker for a shut-down Mech', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 3 };
    unit.shutdown = true;
    addUnit(state, unit);
    state.phase = 'weapon_attack';

    openWeaponPanel(ui, unit.id);

    expect(document.querySelector('.weapon-panel-notice').textContent).toContain('shut down');
    expect([...document.querySelectorAll('.weapon-check')].every(check => check.disabled)).toBe(true);
    expect(document.getElementById('btn-fire').disabled).toBe(true);
  });

  it('disables the picker for a Mech whose warrior is unconscious', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 3 };
    unit.pilot.conscious = false;
    addUnit(state, unit);
    state.phase = 'weapon_attack';

    openWeaponPanel(ui, unit.id);

    expect(document.querySelector('.weapon-panel-notice').textContent).toContain('warrior unconscious');
    expect([...document.querySelectorAll('.weapon-check')].every(check => check.disabled)).toBe(true);
    expect(document.getElementById('btn-fire').disabled).toBe(true);
  });

  it('disables the picker for a destroyed Mech', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 3 };
    unit.internalStructure.centerTorso = 0; // p44: centre torso gone = destroyed
    addUnit(state, unit);
    state.phase = 'weapon_attack';

    openWeaponPanel(ui, unit.id);

    expect(document.querySelector('.weapon-panel-notice').textContent).toContain('destroyed');
    expect([...document.querySelectorAll('.weapon-check')].every(check => check.disabled)).toBe(true);
    expect(document.getElementById('btn-fire').disabled).toBe(true);
  });

  it('keeps the picker enabled for the acting unit', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 3 };
    addUnit(state, unit);
    const target = createUnit({ id: 'enemy-1', player: 1, hexKey: '5,13', weapons: [] });
    addUnit(state, target);
    state.phase = 'weapon_attack';
    state.currentPlayer = 0;
    acting(unit.id);
    ui.weaponFireMode = true;

    openWeaponPanel(ui, unit.id, target.id);

    expect(document.querySelector('.weapon-panel-notice')).toBeNull();
    expect(document.getElementById('btn-fire').disabled).toBe(false);
    expect(document.querySelectorAll('.weapon-check:not(:disabled)').length).toBeGreaterThan(0);
  });

  it('uses the real declaration queue, not the player, to find the acting Mech', () => {
    // Two own 'Mechs in a real engine queue: the first slot is the acting one,
    // the other own 'Mech is the reviewer's "non-acting own 'Mech" case.
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    const warhammer = createTestUnit('warhammer-whm6d', 0, 'warhammer-0');
    warhammer.position = { hexKey: '8,7', facing: 3 };
    const realEngine = createTestEngine({
      units: { 'atlas-0': atlas, 'warhammer-0': warhammer },
      enforceWeaponDeclarations: true
    });
    realEngine._weaponsData = weaponsLookup;
    // Player 1 wins initiative, so player 0's 'Mechs declare first (p10).
    realEngine.stateManager.getState().initiativeWinner = 1;
    realEngine.phaseManager.enterPhase('weapon_attack');

    const realState = realEngine.stateManager.getState();
    const entry = realEngine.phaseManager.getCurrentQueueEntry();
    expect(entry).toBeTruthy();
    const nonActing = Object.values(realState.units).find(mounted => mounted.id !== entry.unitId);
    expect(nonActing).toBeTruthy();

    const realUi = new UIController();
    realUi.init(realEngine, renderer());
    realUi.weaponFireMode = true;
    realUi.selectedUnitId = nonActing.id;
    realUi._showWeaponPanel();

    expect(document.querySelector('.weapon-panel-notice').textContent).toContain('not the acting unit');
    expect([...document.querySelectorAll('.weapon-check')].every(check => check.disabled)).toBe(true);
    expect(document.getElementById('btn-fire').disabled).toBe(true);
  });
});

/**
 * F5: keep the picker's target-independent predicates (destroyed weapon, ammo,
 * already fired) in lockstep with the engine's own declaration validation.
 *
 * Arc, range and line of sight are deliberately out of scope for this parity
 * check: the UI greys an out-of-range weapon out before the shot, while the
 * engine resolves range inside AttackResolver (a shot at a target beyond long
 * range is still a legal declaration that resolves as a miss). The picker's
 * "out of range" reason is covered by its own test above. With no
 * `_pendingTarget`, `_getWeaponEligibility` makes exactly the target-independent
 * decision compared here.
 */
describe('UIController / engine weapon-declaration parity', () => {
  let ui;
  let engine;
  let state;

  beforeEach(() => {
    createDOMFixture();

    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    const locust = createTestUnit('locust-lct1v', 0, 'locust-0');
    locust.position = { hexKey: '6,7', facing: 3 };
    // Non-Atlas chassis with duplicate and multi-slot mounts in one location.
    const thunderbolt = createTestUnit('thunderbolt-tdr5s', 0, 'thunderbolt-0');
    thunderbolt.position = { hexKey: '7,7', facing: 3 };
    const jenner = createTestUnit('jenner-jr7d', 0, 'jenner-0');
    jenner.position = { hexKey: '8,7', facing: 3 };
    const awesome = createTestUnit('awesome-aws8q', 0, 'awesome-0');
    awesome.position = { hexKey: '9,7', facing: 3 };

    engine = createTestEngine({
      units: {
        'atlas-0': atlas,
        'locust-0': locust,
        'thunderbolt-0': thunderbolt,
        'jenner-0': jenner,
        'awesome-0': awesome
      },
      enforceWeaponDeclarations: true
    });
    engine._weaponsData = weaponsLookup;
    state = engine.stateManager.getState();
    state.currentPlayer = 0;
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();

    ui = new UIController();
    ui.init(engine, renderer());
  });

  /** Assert the picker and the engine agree for every mounted weapon. */
  function expectDeclarationParity(units) {
    for (const unit of units) {
      const mountedWeapons = (unit.equipment && unit.equipment.weapons) || [];
      for (const mounted of unit.getAllWeapons()) {
        const weaponDef = weaponsLookup[mounted.type];
        // Ask the engine about the SAME mounted instance: without the index the
        // engine allocates the first unfired instance of that model, which is
        // not what an individual picker row is about.
        const weaponIndex = mountedWeapons.indexOf(mounted);
        const picker = ui._getWeaponEligibility(unit, mounted, weaponDef, state, weaponIndex);
        const engineDecision = engine._validateWeaponDeclaration(unit, {
          weapon: weaponDef,
          weaponLocation: mounted.location,
          ...(weaponIndex >= 0 ? { weaponIndex } : {}),
          ammoBin: mounted.ammoBin || null
        }, state);

        expect(
          picker.eligible,
          `${unit.id} ${mounted.type}@${mounted.location}#${weaponIndex}: picker=${picker.reason || 'eligible'} engine=${engineDecision.error || 'eligible'}`
        ).toBe(engineDecision.ok);
      }
    }
  }

  it('matches the engine for every weapon of several undamaged Mechs', () => {
    expectDeclarationParity([state.getUnit('atlas-0'), state.getUnit('locust-0')]);
  });

  it('matches the engine after damage, empty bins and fired weapons', () => {
    const atlas = state.getUnit('atlas-0');
    const locust = state.getUnit('locust-0');

    // Empty AC/20 and machine-gun bins, a spent medium laser, one destroyed laser.
    atlas.equipment.ammo.ac20_ammo.shots = 0;
    locust.equipment.ammo.machinegun_ammo.shots = 0;
    atlas.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    atlas.firedWeaponsTurn = state.turn;
    for (const slot of atlas.criticalSlots.rightArm) {
      if (slot.item === 'med_laser') slot.status = 'destroyed';
    }

    expectDeclarationParity([atlas, locust]);

    // A fired set from an earlier turn must count for neither side.
    atlas.firedWeaponsTurn = state.turn - 1;
    expectDeclarationParity([atlas]);
  });

  it('matches the engine for a fired-weapon record that is not a Set', () => {
    const atlas = state.getUnit('atlas-0');
    // JSON save/load round-trips the Set to an array. The engine treats that as
    // an empty fired set for this turn, and so must the picker.
    atlas.firedWeaponsThisTurn = ['med_laser@rightArm'];
    atlas.firedWeaponsTurn = state.turn;

    expectDeclarationParity([atlas]);
  });

  it('matches the engine per mounted instance, not per weapon model', () => {
    const atlas = state.getUnit('atlas-0');
    const lasers = atlas.equipment.weapons
      .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
      .filter(entry => entry.weapon.type === 'med_laser');
    expect(lasers.map(entry => entry.weaponIndex)).toEqual([1, 2]);

    // Only the first right-arm medium laser has fired (p24 is per WEAPON).
    atlas.firedWeaponsThisTurn = new Set([
      weaponInstanceKey('med_laser', 'rightArm', lasers[0].weaponIndex)
    ]);
    atlas.firedWeaponsTurn = state.turn;

    expectDeclarationParity([atlas]);

    // The picker really did split the pair: exactly the unfired one is offered.
    ui.selectedUnitId = atlas.id;
    ui._pendingTarget = null;
    ui._showWeaponPanel();
    const laserChecks = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'med_laser');
    expect(laserChecks.map(check => check.disabled)).toEqual([true, false]);
  });

  it('matches the engine when a pre-instance model key is recorded', () => {
    const atlas = state.getUnit('atlas-0');
    // A record written before per-instance identity: the conservative reading
    // is that the model in that location has fired, for every instance of it.
    atlas.firedWeaponsThisTurn = new Set(['med_laser@rightArm']);
    atlas.firedWeaponsTurn = state.turn;

    expectDeclarationParity([atlas]);
  });

  it('matches the engine when a mounted weapon names a bin that does not feed it', () => {
    const atlas = state.getUnit('atlas-0');
    const ac20 = atlas.equipment.weapons.find(weapon => weapon.type === 'ac20');
    ac20.ammoBin = 'srm6_ammo'; // a real bin, but for the SRM racks

    expectDeclarationParity([atlas]);
  });

  it('matches the engine when one of two identical mounts is destroyed', () => {
    const atlas = state.getUnit('atlas-0');
    // Slot 6 is the second right-arm medium laser: only that mount dies.
    atlas.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';

    expectDeclarationParity([atlas]);

    // The picker offers exactly the surviving mount of the pair.
    ui.selectedUnitId = atlas.id;
    ui._pendingTarget = null;
    ui._showWeaponPanel();
    const laserChecks = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'med_laser');
    expect(laserChecks.map(check => check.disabled)).toEqual([false, true]);
    expect(laserChecks[1].closest('label').querySelector('.weapon-reason').textContent)
      .toBe('destroyed');
  });

  it('matches the engine when one slot of a multi-slot weapon is destroyed', () => {
    const atlas = state.getUnit('atlas-0');
    atlas.criticalSlots.rightTorso
      .find(slot => slot.item === 'ac20' && slot.slot === 5).status = 'destroyed';
    atlas.criticalSlots.leftTorso
      .find(slot => slot.item === 'lrm20' && slot.slot === 2).status = 'destroyed';

    expectDeclarationParity([atlas]);
  });

  it('matches the engine for destroyed components on Atlas and Locust together', () => {
    const atlas = state.getUnit('atlas-0');
    const locust = state.getUnit('locust-0');

    // Atlas: one of two arm lasers, one AC/20 slot, one LRM-20 slot.
    atlas.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    atlas.criticalSlots.rightTorso
      .find(slot => slot.item === 'ac20' && slot.slot === 5).status = 'destroyed';
    atlas.criticalSlots.leftTorso
      .find(slot => slot.item === 'lrm20' && slot.slot === 3).status = 'destroyed';
    // Locust: its single medium laser and one of its two machine guns.
    locust.criticalSlots.centerTorso
      .find(slot => slot.item === 'med_laser').status = 'destroyed';
    locust.criticalSlots.leftArm
      .find(slot => slot.item === 'machinegun').status = 'destroyed';

    expectDeclarationParity([atlas, locust]);
  });

  it('matches the engine per mount on non-Atlas chassis', () => {
    const thunderbolt = state.getUnit('thunderbolt-0');
    const jenner = state.getUnit('jenner-0');
    const awesome = state.getUnit('awesome-0');

    // Three medium lasers in one arm: the middle one's slot dies.
    thunderbolt.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 6).status = 'destroyed';
    // Two lasers per arm: one right-arm mount dies.
    jenner.criticalSlots.rightArm
      .find(slot => slot.item === 'med_laser' && slot.slot === 5).status = 'destroyed';
    // Six PPC slots split three each: one slot in the second chunk dies.
    awesome.criticalSlots.rightTorso
      .find(slot => slot.item === 'ppc' && slot.slot === 7).status = 'destroyed';

    expectDeclarationParity([thunderbolt, jenner, awesome]);

    // Thunderbolt: two of three arm lasers stay offered.
    ui.selectedUnitId = thunderbolt.id;
    ui._pendingTarget = null;
    ui._showWeaponPanel();
    const thunderboltLasers = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'med_laser');
    expect(thunderboltLasers.map(check => check.disabled)).toEqual([false, true, false]);

    // Awesome: the second right-torso PPC row is the destroyed one.
    ui.selectedUnitId = awesome.id;
    ui._showWeaponPanel();
    const torsoPpcs = [...document.querySelectorAll('.weapon-check')]
      .filter(check => check.dataset.type === 'ppc' && check.dataset.location === 'rightTorso');
    expect(torsoPpcs.map(check => check.disabled)).toEqual([false, true]);
  });
});
