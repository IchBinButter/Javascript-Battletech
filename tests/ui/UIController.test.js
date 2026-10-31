/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIController } from '../../src/ui/UIController.js';
import { Unit } from '../../src/models/Unit.js';
import { EventBus } from '../../src/engine/EventBus.js';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };

function createDOMFixture() {
  document.body.innerHTML = `
    <div id="phase-bar">
      <span id="phase-label">Phase: --</span>
      <span id="turn-label">Turn: 0</span>
      <span id="active-player">Active: --</span>
    </div>
    <div id="unit-details">Select a unit to view details</div>
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
  `;
}

function createMockGameEngine(stateOverrides = {}) {
  const stateMock = {
    turn: 1,
    phase: 'initiative',
    currentPlayer: 0,
    players: [
      { id: 0, name: 'Player 1' },
      { id: 1, name: 'Player 2' }
    ],
    units: {},
    getUnit(id) { return this.units[id] || null; },
    ...stateOverrides
  };

  return {
    eventBus: new EventBus(),
    stateManager: {
      getState() { return stateMock; },
      applyStateChange(fn) { fn(stateMock); },
      subscribe() {},
      undo() {}
    },
    phaseManager: {
      currentPhase: 'initiative',
      validateAction() { return { valid: true }; },
      getCurrentQueueEntry() { return null; },
      enterPhase() {}
    },
    movementCalc: {
      getValidMoves() { return new Map(); },
      validateMovement() { return { valid: true, totalCost: 1, errors: [], finalFacing: 0 }; }
    },
    processAction(playerId, action) {
      return { success: true };
    },
    _weaponsData: {},
    attackResolver: {},
    stateMock
  };
}

function createMockMapRenderer() {
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

describe('UIController', () => {
  let ui, engine, renderer, atlas;

  beforeEach(() => {
    createDOMFixture();

    const atlasDef = mechsData.mechs.find(m => m.id === 'atlas-as7d');
    atlas = new Unit(atlasDef, 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };

    engine = createMockGameEngine({ units: { 'atlas-0': atlas } });
    renderer = createMockMapRenderer();

    ui = new UIController();
    ui.init(engine, renderer);
  });

  describe('panel visibility', () => {
    it('hides all panels on phase change', () => {
      ui.movementPanel.style.display = 'block';
      ui.weaponPanel.style.display = 'block';
      ui.physicalPanel.style.display = 'block';
      ui.weaponFireMode = true;

      engine.eventBus.emit('phaseChanged', { phase: 'movement', turn: 1 });

      expect(ui.movementPanel.style.display).toBe('block');
      expect(ui.weaponPanel.style.display).toBe('none');
      expect(ui.physicalPanel.style.display).toBe('none');
      expect(ui.weaponFireMode).toBe(false);
    });

    it('shows movement panel only in movement phase', () => {
      engine.eventBus.emit('phaseChanged', { phase: 'initiative', turn: 1 });
      expect(ui.movementPanel.style.display).toBe('none');

      engine.eventBus.emit('phaseChanged', { phase: 'movement', turn: 1 });
      expect(ui.movementPanel.style.display).toBe('block');

      engine.eventBus.emit('phaseChanged', { phase: 'weapon_attack', turn: 1 });
      expect(ui.movementPanel.style.display).toBe('none');
    });

    it('shows physical panel only in physical attack phase', () => {
      engine.eventBus.emit('phaseChanged', { phase: 'physical_attack', turn: 1 });
      expect(ui.physicalPanel.style.display).toBe('block');

      engine.eventBus.emit('phaseChanged', { phase: 'heat', turn: 1 });
      expect(ui.physicalPanel.style.display).toBe('none');
    });

    it('clears weapon fire mode on phase change', () => {
      ui.weaponFireMode = true;
      ui.weaponPanel.style.display = 'block';

      engine.eventBus.emit('phaseChanged', { phase: 'heat', turn: 1 });

      expect(ui.weaponFireMode).toBe(false);
      expect(ui.weaponPanel.style.display).toBe('none');
    });

    it('clears pending target on phase change', () => {
      ui._pendingTarget = 'enemy-1';

      engine.eventBus.emit('phaseChanged', { phase: 'movement', turn: 2 });

      expect(ui._pendingTarget).toBeNull();
    });

    it('clears valid moves on renderer on phase change', () => {
      renderer.validMoves = new Map([['6,7', { cost: 1 }]]);

      engine.eventBus.emit('phaseChanged', { phase: 'weapon_attack', turn: 1 });

      expect(renderer.validMoves).toBeNull();
    });
  });

  describe('confirm/cancel move buttons', () => {
    it('confirm move button processes pending move', () => {
      engine.stateManager.getState().phase = 'movement';
      engine.stateManager.getState().currentPlayer = 0;
      ui.selectedUnitId = 'atlas-0';
      ui._pendingMove = { path: ['5,7', '6,7'], movementType: 'walk' };

      const processActionSpy = vi.spyOn(engine, 'processAction');

      const btnConfirm = document.getElementById('btn-confirm-move');
      btnConfirm.click();

      expect(processActionSpy).toHaveBeenCalledWith(0, {
        type: 'move',
        unitId: 'atlas-0',
        path: ['5,7', '6,7'],
        movementType: 'walk'
      });
    });

    it('confirm move clears pending move and preview', () => {
      engine.stateManager.getState().phase = 'movement';
      engine.stateManager.getState().currentPlayer = 0;
      ui.selectedUnitId = 'atlas-0';
      ui._pendingMove = { path: ['5,7', '6,7'], movementType: 'walk' };
      renderer.validMoves = new Map([['6,7', { cost: 1 }]]);

      document.getElementById('btn-confirm-move').click();

      expect(ui._pendingMove).toBeNull();
      expect(renderer.validMoves).toBeNull();
    });

    it('cancel move clears pending move and preview', () => {
      ui._pendingMove = { path: ['5,7', '6,7'], movementType: 'walk' };
      renderer.validMoves = new Map([['6,7', { cost: 1 }]]);

      document.getElementById('btn-cancel-move').click();

      expect(ui._pendingMove).toBeNull();
      expect(renderer.validMoves).toBeNull();
    });

    it('confirm move without pending move shows log message', () => {
      engine.stateManager.getState().phase = 'movement';
      engine.stateManager.getState().currentPlayer = 0;
      ui.selectedUnitId = 'atlas-0';
      ui._pendingMove = null;

      document.getElementById('btn-confirm-move').click();

      const lastLog = ui.diceLog.lastChild;
      expect(lastLog).toBeNull();
    });

    it('confirm with no unit selected does nothing', () => {
      engine.stateManager.getState().phase = 'movement';
      ui.selectedUnitId = null;

      const processActionSpy = vi.spyOn(engine, 'processAction');
      document.getElementById('btn-confirm-move').click();

      expect(processActionSpy).not.toHaveBeenCalled();
    });
  });

  describe('active player indicator', () => {
    it('updates on phase change', () => {
      engine.eventBus.emit('phaseChanged', { phase: 'movement', turn: 1 });

      expect(document.getElementById('active-player').textContent).toBe('Active: Player 1');
    });

    it('shows player 2 when they are active', () => {
      engine.stateManager.getState().currentPlayer = 1;

      engine.eventBus.emit('phaseChanged', { phase: 'weapon_attack', turn: 1 });

      expect(document.getElementById('active-player').textContent).toBe('Active: Player 2');
    });
  });

  describe('heat bar rendering (classic view)', () => {
    beforeEach(() => {
      // The legacy health-bar list is still available behind the view control.
      ui.setUnitView('classic');
    });

    it('renders heat bar with inactive segments at zero heat', () => {
      atlas.heat = 0;
      ui.updateUnitPanel(atlas);

      const heatBar = ui.unitDetails.querySelector('.heat-bar');
      expect(heatBar).not.toBeNull();
      const segments = heatBar.querySelectorAll('.heat-segment');
      expect(segments.length).toBe(15);

      const inactiveSegments = heatBar.querySelectorAll('.heat-segment.inactive');
      expect(inactiveSegments.length).toBe(15);
    });

    it('shows safe segments for low heat', () => {
      atlas.heat = 3;
      ui.updateUnitPanel(atlas);

      const safeSegs = ui.unitDetails.querySelectorAll('.heat-segment.safe');
      expect(safeSegs.length).toBeGreaterThan(0);
    });

    it('shows warn segments for moderate heat', () => {
      atlas.heat = 8;
      ui.updateUnitPanel(atlas);

      const warnSegs = ui.unitDetails.querySelectorAll('.heat-segment.warn');
      expect(warnSegs.length).toBeGreaterThan(0);
    });

    it('shows danger segments for high heat', () => {
      atlas.heat = 13;
      ui.updateUnitPanel(atlas);

      const dangerSegs = ui.unitDetails.querySelectorAll('.heat-segment.danger');
      expect(dangerSegs.length).toBeGreaterThan(0);
    });

    it('shows critical segments for very high heat', () => {
      atlas.heat = 20;
      ui.updateUnitPanel(atlas);

      const critSegs = ui.unitDetails.querySelectorAll('.heat-segment.critical');
      expect(critSegs.length).toBeGreaterThan(0);
    });

    it('shows heat effects text', () => {
      atlas.heat = 12;
      ui.updateUnitPanel(atlas);

      expect(ui.unitDetails.innerHTML).toContain('-2 Walk MP');
    });

    it('shows shutdown warning at high heat', () => {
      atlas.heat = 26;
      ui.updateUnitPanel(atlas);

      expect(ui.unitDetails.innerHTML).toContain('Shutdown check: avoid on 10+');
    });
  });

  describe('armor bar rendering (classic view)', () => {
    beforeEach(() => {
      ui.setUnitView('classic');
    });

    it('uses getMaxArmor from the unit for each location', () => {
      const maxArmorSpy = vi.spyOn(atlas, 'getMaxArmor');
      ui.updateUnitPanel(atlas);
      expect(maxArmorSpy).toHaveBeenCalled();
    });

    it('renders armor bars with percentage widths', () => {
      atlas.armor.head.front = 5;
      ui.updateUnitPanel(atlas);

      const armorBars = ui.unitDetails.querySelectorAll('.armor-bar');
      expect(armorBars.length).toBe(8);

      // head armor: 5 / 9 = 55.55% → width:55.56%
      const headBar = armorBars[0];
      const width = parseFloat(headBar.style.width);
      expect(width).toBeGreaterThan(50);
      expect(width).toBeLessThan(60);
    });

    it('marks destroyed locations', () => {
      atlas.internalStructure.head = 0;
      ui.updateUnitPanel(atlas);

      expect(ui.unitDetails.innerHTML).toContain('DESTROYED');
    });

    it('shows zero width for zero max armor', () => {
      // Simulate missing location
      const original = atlas.getMaxArmor;
      atlas.getMaxArmor = (loc) => loc === 'head' ? 0 : original.call(atlas, loc);
      ui.updateUnitPanel(atlas);

      const armorBars = ui.unitDetails.querySelectorAll('.armor-bar');
      expect(parseFloat(armorBars[0].style.width)).toBe(0);

      atlas.getMaxArmor = original;
    });
  });

  describe('unit panel rendering', () => {
    it('shows active indicator for current player unit', () => {
      ui.updateUnitPanel(atlas);

      expect(ui.unitDetails.innerHTML).toContain('[ACTIVE]');
    });

    it('does not show active for opponent unit', () => {
      engine.stateManager.getState().currentPlayer = 1; // Player 2 is active
      ui.updateUnitPanel(atlas); // atlas belongs to player 0

      expect(ui.unitDetails.innerHTML).not.toContain('[ACTIVE]');
    });

    it('shows placeholder text when unit is null', () => {
      ui.updateUnitPanel(null);

      expect(ui.unitDetails.innerHTML).toContain('Select a unit to view details');
      expect(ui.selectedUnitId).toBeNull();
    });

    it('sets selectedUnitId when unit is provided', () => {
      ui.updateUnitPanel(atlas);

      expect(ui.selectedUnitId).toBe('atlas-0');
    });
  });

  describe('record-sheet card (default view)', () => {
    const LOCATIONS = [
      'head', 'centerTorso', 'leftTorso', 'rightTorso',
      'leftArm', 'rightArm', 'leftLeg', 'rightLeg'
    ];

    it('renders the record card instead of the health bars by default', () => {
      ui.updateUnitPanel(atlas);

      expect(ui.unitView).toBe('record');
      expect(ui.unitDetails.querySelector('.record-card')).not.toBeNull();
      expect(ui.unitDetails.querySelector('.record-armor')).not.toBeNull();
      expect(ui.unitDetails.querySelector('.record-internal')).not.toBeNull();
      expect(ui.unitDetails.querySelector('.heat-bar')).toBeNull();
      expect(ui.unitDetails.querySelector('.armor-bar')).toBeNull();
    });

    it('draws one armour and internal pip per point from the unit maxima', () => {
      ui.updateUnitPanel(atlas);

      for (const loc of LOCATIONS) {
        const front = ui.unitDetails.querySelector(
          `.record-armor [data-location="${loc}"] [data-face="front"]`
        );
        expect(front.querySelectorAll('.pip').length, `${loc} armour`).toBe(atlas.getMaxArmor(loc));

        const internal = ui.unitDetails.querySelector(
          `.record-internal [data-location="${loc}"]`
        );
        expect(internal.querySelectorAll('.pip').length, `${loc} internal`)
          .toBe(atlas.getMaxInternal(loc));
      }
    });

    it('shows the A/I text, movement, engine and pilot info', () => {
      ui.updateUnitPanel(atlas);

      const text = ui.unitDetails.textContent;
      expect(text).toContain('A:9/9 I:3/3'); // head
      expect(text).toContain('MP: 3/3(5)');
      expect(text).toContain('Pilot: G4/P5');
      expect(text).toContain('Engine: standard');
      expect(text).toContain('Heat Sinks: 20');
    });

    it('always shows the rear torso armour strip', () => {
      ui.updateUnitPanel(atlas);

      const strip = ui.unitDetails.querySelector('.record-rear-strip');
      expect(strip).not.toBeNull();
      expect(strip.hidden).toBe(false);
      expect(ui.unitDetails.querySelector('.record-rear-toggle')).toBeNull();

      const rearCenter = strip.querySelector('[data-location="centerTorso"]');
      expect(rearCenter.querySelectorAll('.pip').length)
        .toBe(atlas.getMaxArmor('centerTorso', true));
    });

    it('keeps the classic bars available and remembers the choice', () => {
      ui.updateUnitPanel(atlas);
      expect(ui.unitDetails.querySelector('.armor-bar')).toBeNull();

      ui.setUnitView('classic');
      expect(ui.unitDetails.querySelectorAll('.armor-bar')).toHaveLength(8);
      expect(ui.unitDetails.querySelector('.heat-bar')).not.toBeNull();
      expect(ui.unitDetails.querySelector('.record-card')).toBeNull();

      // The choice survives a re-render and a selection change for the session.
      ui.updateUnitPanel(atlas);
      expect(ui.unitView).toBe('classic');
      expect(ui.unitDetails.querySelectorAll('.armor-bar')).toHaveLength(8);

      ui.setUnitView('record');
      expect(ui.unitDetails.querySelector('.record-card')).not.toBeNull();
    });

    it('marks a destroyed location in the record card', () => {
      atlas.internalStructure.head = 0;
      ui.updateUnitPanel(atlas);

      expect(ui.unitDetails.innerHTML).toContain('DESTROYED');
    });
  });

  describe('logging', () => {
    it('adds log entries with correct CSS class', () => {
      ui.log('test message', 'hit');

      const entry = ui.diceLog.lastChild;
      expect(entry.textContent).toBe('test message');
      expect(entry.className).toContain('hit');
    });

    it('defaults to info class', () => {
      ui.log('info message');

      expect(ui.diceLog.lastChild.className).toContain('info');
    });
  });

  describe('unit moved event', () => {
    it('updates unit panel if selected unit moved', () => {
      ui.updateUnitPanel(atlas);
      atlas.heat = 10; // Atlas walk 3, -2 MP at this heat

      engine.eventBus.emit('unitMoved', { unitId: 'atlas-0', hexKey: '6,7', facing: 3 });

      expect(ui.unitDetails.innerHTML).toContain('MP: 1/3');
      atlas.heat = 0;
    });
  });

  describe('damage event', () => {
    it('logs damage with hit class', () => {
      engine.eventBus.emit('damageApplied', {
        targetId: 'atlas-0',
        damage: 5,
        location: 'centerTorso',
        result: { criticalHits: [] }
      });

      const lastLog = ui.diceLog.lastChild;
      expect(lastLog.className).toContain('hit');
      expect(lastLog.textContent).toContain('Damage');
    });
  });

  describe('physical attack', () => {
    it('shows select prompt on physical panel', () => {
      engine.eventBus.emit('phaseChanged', { phase: 'physical_attack', turn: 1 });

      expect(ui.physicalPanel.style.display).toBe('block');
    });
  });
});

/**
 * F1: the movement preview (and the Walk/Run/Jump radio that re-builds it) must
 * follow the engine's declaration queue, not just the selected 'Mech's side.
 * Previewing moves for a non-acting own 'Mech drew destinations the engine
 * refuses ("... is declaring movement now; finish its move first") and left a
 * stale highlight behind.
 */
describe('UIController movement preview gating', () => {
  let ui, engine, renderer, atlas;

  beforeEach(() => {
    createDOMFixture();

    const atlasDef = mechsData.mechs.find(m => m.id === 'atlas-as7d');
    atlas = new Unit(atlasDef, 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };

    engine = createMockGameEngine({ units: { 'atlas-0': atlas } });
    renderer = createMockMapRenderer();

    ui = new UIController();
    ui.init(engine, renderer);
    engine.stateManager.getState().phase = 'movement';
    ui.selectedUnitId = 'atlas-0';
  });

  function setQueueEntry(unitId, playerId = 0) {
    engine.phaseManager.getCurrentQueueEntry = () => ({ unitId, playerId });
  }

  function changeMode(mode) {
    const radio = document.querySelector(`input[name="moveMode"][value="${mode}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('clears a drawn preview when the selected Mech is not the acting unit', () => {
    ui._pendingMove = { path: ['5,7', '6,7'], movementType: 'walk' };
    renderer.validMoves = new Map([['6,7', { cost: 1 }]]);
    renderer.hoveredHex = '6,7';
    setQueueEntry('other-mech');

    const getValidMoves = vi.spyOn(engine.movementCalc, 'getValidMoves');
    changeMode('run');

    expect(ui.movementMode).toBe('run');
    expect(renderer.validMoves).toBeNull();
    expect(renderer.hoveredHex).toBeNull();
    expect(ui._pendingMove).toBeNull();
    // The non-acting Mech is never handed to the movement calculator.
    expect(getValidMoves).not.toHaveBeenCalled();
  });

  it('still previews the acting unit when the movement mode changes', () => {
    engine.movementCalc.getValidMoves = vi.fn(() => new Map([['6,7', { cost: 1 }]]));
    setQueueEntry('atlas-0');

    changeMode('run');

    expect(engine.movementCalc.getValidMoves)
      .toHaveBeenCalledWith(atlas, engine.stateManager.getState(), 'run');
    expect(renderer.validMoves).toBeInstanceOf(Map);
    expect(renderer.validMoves.has('6,7')).toBe(true);
  });

  it('clears the preview when the declaration queue moves on', () => {
    renderer.validMoves = new Map([['6,7', { cost: 1 }]]);
    renderer.hoveredHex = '6,7';
    ui._pendingMove = { path: ['5,7', '6,7'], movementType: 'walk' };

    engine.eventBus.emit('queueAdvanced', { unitId: 'atlas-0', playerId: 0 });

    expect(renderer.validMoves).toBeNull();
    expect(renderer.hoveredHex).toBeNull();
    expect(ui._pendingMove).toBeNull();
  });

  it('clears the preview when the selection changes', () => {
    renderer.validMoves = new Map([['6,7', { cost: 1 }]]);
    renderer.hoveredHex = '6,7';

    ui.updateUnitPanel(null);

    expect(ui.selectedUnitId).toBeNull();
    expect(renderer.validMoves).toBeNull();
    expect(renderer.hoveredHex).toBeNull();
  });
});
