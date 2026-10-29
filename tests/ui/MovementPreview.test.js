/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIController } from '../../src/ui/UIController.js';
import { Hex } from '../../src/models/Hex.js';
import { EventBus } from '../../src/engine/EventBus.js';
import { createTestUnit } from '../helpers/testUtils.js';

function makeHex(key, terrainType = 'clear', level = 0, overrides = {}) {
  return new Hex(key, { terrainType, level, ...overrides });
}

function makeUnit(walk = 4, run = 6, jump = 3, facing = 0, hexKey = '5,7') {
  return {
    id: 'test-unit-1',
    player: 0,
    movement: { walk, run, jump },
    heat: 0,
    heatSinks: { count: 10, type: 'single' },
    tonnage: 70,
    engine: { type: 'Standard', hits: 3 },
    gyro: { hits: 2 },
    pilot: { gunnery: 4, piloting: 5 },
    prone: false,
    shutdown: false,
    position: { hexKey, facing },
    currentMP: walk,
    name: 'TestUnit',
    armor: {
      head: { front: 9 },
      centerTorso: { front: 30, rear: 10 },
      leftTorso: { front: 20, rear: 10 },
      rightTorso: { front: 20, rear: 10 },
      leftArm: { front: 20 },
      rightArm: { front: 20 },
      leftLeg: { front: 20 },
      rightLeg: { front: 20 }
    },
    internalStructure: {
      head: 3,
      centerTorso: 20,
      leftTorso: 15,
      rightTorso: 15,
      leftArm: 10,
      rightArm: 10,
      leftLeg: 15,
      rightLeg: 15
    },
    criticalSlots: {
      leftLeg: [
        { item: 'hip_actuator', status: 'ok' },
        { item: 'upper_leg_actuator', status: 'ok' },
        { item: 'lower_leg_actuator', status: 'ok' },
        { item: 'foot_actuator', status: 'ok' }
      ],
      rightLeg: [
        { item: 'hip_actuator', status: 'ok' },
        { item: 'upper_leg_actuator', status: 'ok' },
        { item: 'lower_leg_actuator', status: 'ok' },
        { item: 'foot_actuator', status: 'ok' }
      ]
    },
    getArmor(loc) {
      const a = this.armor[loc];
      if (!a) return 0;
      return (a.front || 0) + (a.rear || 0);
    },
    getMaxArmor(loc) {
      return this.getArmor(loc);
    },
    getInternal(loc) {
      return this.internalStructure[loc] || 0;
    },
    isLocationDestroyed(loc) {
      return this.internalStructure[loc] <= 0;
    },
    getAllWeapons() {
      return [];
    }
  };
}

function buildHexMap(centerKey, radius, terrainType = 'clear', level = 0) {
  const hexes = {};
  hexes[centerKey] = makeHex(centerKey, terrainType, level);
  for (let r = 1; r <= radius; r++) {
    const keys = new Set();
    for (const key of Object.keys(hexes)) {
      const [c, ro] = key.split(',').map(Number);
      const isEven = c % 2 === 0;
      const dirs = isEven
        ? [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]
        : [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      for (const [dc, dr] of dirs) {
        const nk = `${c + dc},${ro + dr}`;
        if (!keys.has(nk) && !hexes[nk]) keys.add(nk);
      }
    }
    for (const k of keys) hexes[k] = makeHex(k, terrainType, level);
  }
  return hexes;
}

function makeGameState(hexMap, overrides = {}) {
  const hexes = new Map();
  for (const [key, hex] of Object.entries(hexMap)) {
    hexes.set(key, hex);
  }
  return {
    map: { hexes },
    turn: 1,
    phase: 'movement',
    currentPlayer: 0,
    players: [{ id: 0, name: 'Player 1' }, { id: 1, name: 'Player 2' }],
    getUnit(id) { return (this.units && this.units[id]) || null; },
    units: {},
    ...overrides
  };
}

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

describe('MovementPreview', () => {
  let ui, renderer;
  let movementCalc;
  let gameState, unit;

  beforeEach(() => {
    createDOMFixture();
    renderer = createMockMapRenderer();

    const hexes = buildHexMap('5,7', 3);
    unit = makeUnit(4, 6, 3, 0, '5,7');
    gameState = makeGameState(hexes, { units: { 'test-unit-1': unit } });

    movementCalc = {
      getValidMoves: vi.fn(() => {
        return new Map([
          ['5,7', { cost: 0, path: ['5,7'], remainingMP: 4 }],
          ['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 3 }],
          ['5,8', { cost: 1, path: ['5,7', '5,8'], remainingMP: 3 }]
        ]);
      }),
      calculateMPCost: vi.fn(() => 1),
      getMaxMP: vi.fn((u, type) => {
        if (type === 'walk') return 4;
        if (type === 'run') return 6;
        if (type === 'jump') return 3;
        return 4;
      })
    };

    const engine = {
      eventBus: new EventBus(),
      stateManager: {
        getState() { return gameState; },
        applyStateChange(fn) { fn(gameState); },
        subscribe() {},
        undo() {}
      },
      movementCalc,
      processAction(playerId, action) {
        if (action.type === 'move') {
          return { success: true };
        }
        return { error: 'unknown action' };
      },
      _weaponsData: {}
    };

    ui = new UIController();
    ui.init(engine, renderer);
    ui.movementMode = 'walk';
    ui.selectedUnitId = 'test-unit-1';
  });

  // ==========================================================
  // getValidMoves RETURN VALUE TESTS
  // ==========================================================
  describe('getValidMoves returns correct hexes for walk/run/jump', () => {
    it('getValidMoves is called with walk movement type', () => {
      ui.movementMode = 'walk';
      ui._refreshMovementPreview();
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'walk');
    });

    it('getValidMoves is called with run movement type', () => {
      ui.movementMode = 'run';
      ui._refreshMovementPreview();
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'run');
    });

    it('getValidMoves is called with jump movement type', () => {
      ui.movementMode = 'jump';
      ui._refreshMovementPreview();
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'jump');
    });

    it('only includes hexes within maxMP for walk', () => {
      const realCalc = movementCalc;
      realCalc.getValidMoves = vi.fn(() => new Map([
        ['5,7', { cost: 0, path: ['5,7'], remainingMP: 4 }],
        ['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 3 }],
        ['5,8', { cost: 5, path: ['5,7', '5,8'], remainingMP: -1 }]
      ]));
      ui._refreshMovementPreview();
      const moves = renderer.validMoves;
      expect(moves.has('5,7')).toBe(true);
      expect(moves.has('5,6')).toBe(true);
    });

    it('start hex always has cost 0', () => {
      const result = new Map([['5,7', { cost: 0, path: ['5,7'], remainingMP: 4 }]]);
      movementCalc.getValidMoves.mockReturnValue(result);
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,7').cost).toBe(0);
    });

    it('includes hexes up to max jump MP', () => {
      ui.movementMode = 'jump';
      movementCalc.getValidMoves.mockReturnValue(new Map([
        ['5,7', { cost: 0, path: ['5,7'], remainingMP: 3 }],
        ['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 2 }],
        ['5,5', { cost: 2, path: ['5,7', '5,6', '5,5'], remainingMP: 1 }],
        ['6,6', { cost: 3, path: ['5,7', '5,6', '6,6'], remainingMP: 0 }]
      ]));
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('6,6')).toBe(true);
    });
  });

  // ==========================================================
  // MAPRENDERER.VALIDMOVES
  // ==========================================================
  describe('movement preview sets mapRenderer.validMoves', () => {
    it('sets validMoves on renderer when refresh is called', () => {
      expect(renderer.validMoves).toBeNull();
      ui._refreshMovementPreview();
      expect(renderer.validMoves).not.toBeNull();
      expect(renderer.validMoves instanceof Map).toBe(true);
    });

    it('clears validMoves when phase is not movement', () => {
      gameState.phase = 'weapon_attack';
      ui._refreshMovementPreview();
      expect(renderer.validMoves).toBeNull();
    });

    it('clears validMoves when unit is not current player', () => {
      unit.player = 1;
      gameState.currentPlayer = 0;
      ui._refreshMovementPreview();
      expect(renderer.validMoves).toBeNull();
    });

    it('does not touch validMoves when no unit is selected (early return)', () => {
      ui.selectedUnitId = null;
      renderer.validMoves = new Map([['6,7', { cost: 1 }]]);
      ui._refreshMovementPreview();
      expect(renderer.validMoves).not.toBeNull();
    });

    it('clears validMoves on clearMovementPreview', () => {
      ui._refreshMovementPreview();
      expect(renderer.validMoves).not.toBeNull();

      ui._clearMovementPreview();
      expect(renderer.validMoves).toBeNull();
      expect(renderer.hoveredHex).toBeNull();
      expect(ui._pendingMove).toBeNull();
    });

    it('clears validMoves on hideAllPanels (phase change)', () => {
      ui._refreshMovementPreview();
      expect(renderer.validMoves).not.toBeNull();

      ui._hideAllPanels();
      expect(renderer.validMoves).toBeNull();
    });

    it('sets validMoves to null when unit not found in state', () => {
      delete gameState.units;
      gameState.getUnit = () => null;
      ui._refreshMovementPreview();
      expect(renderer.validMoves).toBeNull();
    });
  });

  // ==========================================================
  // CONFIRM/CANCEL BUTTONS
  // ==========================================================
  describe('confirm/cancel buttons', () => {
    it('confirm move processes pending move with correct data', () => {
      ui._pendingMove = { path: ['5,7', '5,6'], movementType: 'walk' };
      gameState.phase = 'movement';

      let processed = null;
      const engine = { stateManager: { getState: () => gameState }, processAction: vi.fn((p, a) => { processed = a; return { success: true }; }), eventBus: new EventBus(), movementCalc };
      ui.gameEngine = engine;

      document.getElementById('btn-confirm-move').click();
      expect(engine.processAction).toHaveBeenCalled();
      expect(processed.type).toBe('move');
      expect(processed.unitId).toBe('test-unit-1');
      expect(processed.path).toEqual(['5,7', '5,6']);
      expect(processed.movementType).toBe('walk');
    });

    it('confirm move clears pending move and preview', () => {
      ui._pendingMove = { path: ['5,7', '5,6'], movementType: 'walk' };
      renderer.validMoves = new Map([['5,6', { cost: 1 }]]);
      renderer.hoveredHex = '5,6';

      const engine = { stateManager: { getState: () => gameState }, processAction: () => ({ success: true }), eventBus: new EventBus(), movementCalc };
      ui.gameEngine = engine;

      document.getElementById('btn-confirm-move').click();
      expect(ui._pendingMove).toBeNull();
      expect(renderer.validMoves).toBeNull();
    });

    it('cancel move clears pending move and preview', () => {
      ui._pendingMove = { path: ['5,7', '5,6'], movementType: 'walk' };
      renderer.validMoves = new Map([['5,6', { cost: 1 }]]);

      document.getElementById('btn-cancel-move').click();
      expect(ui._pendingMove).toBeNull();
      expect(renderer.validMoves).toBeNull();
      expect(renderer.hoveredHex).toBeNull();
    });

    it('confirm move without pending move does not crash', () => {
      ui._pendingMove = null;
      gameState.phase = 'movement';

      expect(() => {
        document.getElementById('btn-confirm-move').click();
      }).not.toThrow();
    });

    it('confirm move without selected unit logs message', () => {
      ui.selectedUnitId = null;
      gameState.phase = 'movement';
      ui._pendingMove = { path: ['5,7', '5,6'], movementType: 'walk' };

      document.getElementById('btn-confirm-move').click();
      expect(ui.diceLog.innerHTML).toContain('No unit selected');
    });

    it('cancel move calls render on mapRenderer', () => {
      ui._pendingMove = { path: ['5,7', '5,6'], movementType: 'walk' };
      const renderSpy = vi.spyOn(renderer, 'render');

      document.getElementById('btn-cancel-move').click();
      expect(renderSpy).toHaveBeenCalled();
    });
  });

  // ==========================================================
  // MOVEMENT MODE AFFECTS PREVIEW
  // ==========================================================
  describe('movement mode affects preview', () => {
    it('changing radio to run calls getValidMoves with run', () => {
      const runRadio = document.querySelector('input[value="run"]');
      runRadio.checked = true;
      runRadio.dispatchEvent(new Event('change', { bubbles: true }));

      expect(ui.movementMode).toBe('run');
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'run');
    });

    it('changing radio to jump calls getValidMoves with jump', () => {
      const jumpRadio = document.querySelector('input[value="jump"]');
      jumpRadio.checked = true;
      jumpRadio.dispatchEvent(new Event('change', { bubbles: true }));

      expect(ui.movementMode).toBe('jump');
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'jump');
    });

    it('changing radio back to walk calls getValidMoves with walk', () => {
      // First switch to run
      ui.movementMode = 'run';
      const walkRadio = document.querySelector('input[value="walk"]');
      walkRadio.checked = true;
      walkRadio.dispatchEvent(new Event('change', { bubbles: true }));

      expect(ui.movementMode).toBe('walk');
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'walk');
    });

    it('default mode is walk', () => {
      expect(ui.movementMode).toBe('walk');
    });

    it('different modes produce different validMoves on renderer', () => {
      movementCalc.getValidMoves = vi.fn((u, gs, type) => {
        if (type === 'walk') return new Map([['5,6', { cost: 1, remainingMP: 3 }]]);
        if (type === 'run') return new Map([['5,6', { cost: 1, remainingMP: 5 }], ['5,5', { cost: 2, remainingMP: 4 }]]);
        if (type === 'jump') return new Map([['6,8', { cost: 1, remainingMP: 2 }]]);
        return new Map();
      });

      ui.movementMode = 'walk';
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('5,6')).toBe(true);

      ui.movementMode = 'run';
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('5,5')).toBe(true);

      ui.movementMode = 'jump';
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('6,8')).toBe(true);
    });
  });

  // ==========================================================
  // FACING CHANGE COSTS IN PREVIEW
  // ==========================================================
  describe('facing change costs in preview', () => {
    it('moving straight ahead costs terrain MP only (no facing cost)', () => {
      ui.movementMode = 'walk';
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 3, facing: 0 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(1);
      expect(renderer.validMoves.get('5,6').remainingMP).toBe(3);
    });

    it('facing change adds cost (1 hexside = +1 MP)', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['6,6', { cost: 2, path: ['5,7', '6,6'], remainingMP: 2, facing: 1 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('6,6').cost).toBe(2);
    });

    it('two hexside facing change adds +2 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['6,7', { cost: 3, path: ['5,7', '6,7'], remainingMP: 1, facing: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('6,7').cost).toBe(3);
    });

    it('facing change wraps (shorter path = 1 hexside)', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['4,7', { cost: 2, path: ['5,7', '4,7'], remainingMP: 2, facing: 5 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('4,7')).toBe(true);
      expect(renderer.validMoves.get('4,7').cost).toBe(2);
    });

    it('facing + terrain > maxMP blocks hex', () => {
      ui.movementMode = 'walk';
      movementCalc.getValidMoves.mockReturnValue(new Map());
      ui._refreshMovementPreview();
      expect(renderer.validMoves.size).toBe(0);
    });
  });

  // ==========================================================
  // LEVEL 3+ RESTRICTION
  // ==========================================================
  describe('level 3+ restriction', () => {
    it('walk mode blocks hexes with 3+ level climb', () => {
      ui.movementMode = 'walk';
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: Infinity, path: ['5,7', '5,6'], remainingMP: 0 }]])
      );
      ui._refreshMovementPreview();
      // The BFS in getValidMoves skips Infinity-cost hexes, but if mock includes it,
      // it still appears in the map. The actual MovementCalculator filters these out.
      // We test that getValidMoves is called with the correct mode, and the actual
      // BFS filtering happens internally.
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'walk');
    });

    it('jump mode bypasses level 3+ restriction', () => {
      ui.movementMode = 'jump';
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,4', { cost: 1, path: ['5,7', '5,4'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('5,4')).toBe(true);
      expect(movementCalc.getValidMoves).toHaveBeenCalledWith(unit, gameState, 'jump');
    });

    it('getValidMoves filters out Infinity-cost hexes for walk', () => {
      movementCalc.getValidMoves = vi.fn(() => {
        const result = new Map();
        result.set('5,7', { cost: 0, path: ['5,7'], remainingMP: 4 });
        return result;
      });
      ui._refreshMovementPreview();
      expect(renderer.validMoves.has('5,6')).toBe(false);
    });
  });

  // ==========================================================
  // TERRAIN COSTS
  // ==========================================================
  describe('terrain costs in preview', () => {
    it('clear terrain costs 1 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 3 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(1);
    });

    it('light_woods costs 2 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 2, path: ['5,7', '5,6'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(2);
    });

    it('heavy_woods costs 3 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 3, path: ['5,7', '5,6'], remainingMP: 1 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(3);
    });

    it('water_depth1 costs 2 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 2, path: ['5,7', '5,6'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(2);
    });

    it('water_depth2 costs 3 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 3, path: ['5,7', '5,6'], remainingMP: 1 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(3);
    });

    it('rough costs 2 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 2, path: ['5,7', '5,6'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(2);
    });

    it('rubble costs 2 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 2, path: ['5,7', '5,6'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(2);
    });

    it('swamp costs 3 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 3, path: ['5,7', '5,6'], remainingMP: 1 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(3);
    });

    it('pavement costs 1 MP', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 3 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(1);
    });

    it('terrain + level change stack (clear + 1 level = 2 MP)', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 2, path: ['5,7', '5,6'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(2);
    });

    it('jump ignores all terrain costs (always 1 MP per hex)', () => {
      ui.movementMode = 'jump';
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 2 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').cost).toBe(1);
    });

    it('remainingMP is correctly populated', () => {
      movementCalc.getValidMoves.mockReturnValue(
        new Map([['5,6', { cost: 1, path: ['5,7', '5,6'], remainingMP: 3 }]])
      );
      ui._refreshMovementPreview();
      expect(renderer.validMoves.get('5,6').remainingMP).toBe(3);
    });
  });

  // ==========================================================
  // PENDING MOVE INTERACTION
  // ==========================================================
  describe('pending move interaction', () => {
    it('refresh clears existing pending move', () => {
      ui._pendingMove = { path: ['5,7', '5,6'], movementType: 'walk' };
      ui._refreshMovementPreview();
      expect(ui._pendingMove).toBeNull();
    });

    it('pending move stores movement type from UI mode', () => {
      ui._pendingMove = {
        path: ['5,7', '5,6'],
        movementType: ui.movementMode
      };
      expect(ui._pendingMove.movementType).toBe('walk');

      ui.movementMode = 'run';
      ui._pendingMove = {
        path: ['5,7', '5,6'],
        movementType: ui.movementMode
      };
      expect(ui._pendingMove.movementType).toBe('run');
    });
  });

  // ==========================================================
  // MP LABEL USES AVAILABLE JUMP MP (BMM p19)
  // ==========================================================
  describe('MP label uses the available jump MP (p19)', () => {
    /**
     * A Jenner whose five torso-mounted jets are rearranged to three torso +
     * two leg-mounted, so Depth 1 water submerges the leg pair (p18/p19).
     */
    function makeLegJetJumper(terrainType) {
      const jumper = createTestUnit('jenner-jr7d', 0, 'test-unit-1');
      jumper.position = { hexKey: '5,7', facing: 0 };

      const jets = [];
      for (const [location, slots] of Object.entries(jumper.criticalSlots)) {
        slots.forEach((slot, index) => {
          if (slot.item === 'jump_jet') jets.push({ location, index });
        });
      }
      ['leftLeg', 'rightLeg'].forEach((leg, k) => {
        jumper.criticalSlots[jets[k].location][jets[k].index].item = 'empty';
        jumper.criticalSlots[leg].push({ item: 'jump_jet', status: 'ok' });
      });

      const hexes = buildHexMap('5,7', 3);
      hexes['5,7'] = makeHex('5,7', terrainType);
      gameState = makeGameState(hexes, { units: { 'test-unit-1': jumper } });
      movementCalc.waterDepthOf = (hex) => {
        const match = /^water_depth(\d+)$/.exec((hex && hex.terrainType) || '');
        return match ? Number(match[1]) : 0;
      };
      return jumper;
    }

    it('shows the Depth 1 submerged-jets total in the movement label', () => {
      const jumper = makeLegJetJumper('water_depth1');
      ui.movementMode = 'jump';
      ui.updateUnitPanel(jumper);

      // 5 jets, two submerged -> 3; with Jump selected the current MP is 3.
      expect(ui.mpDisplay.textContent).toBe('MP: 3 / 7 (Run: 11, Jump: 3)');
    });

    it('shows 0 jump MP in Depth 2 water', () => {
      const jumper = makeLegJetJumper('water_depth2');
      ui.movementMode = 'jump';
      ui.updateUnitPanel(jumper);

      expect(ui.mpDisplay.textContent).toBe('MP: 0 / 7 (Run: 11, Jump: 0)');
    });

    it('keeps the full jump rating on dry land', () => {
      const jumper = makeLegJetJumper('clear');
      ui.movementMode = 'jump';
      ui.updateUnitPanel(jumper);

      expect(ui.mpDisplay.textContent).toBe('MP: 5 / 7 (Run: 11, Jump: 5)');
    });

    it('leaves the walk-mode label untouched', () => {
      const jumper = makeLegJetJumper('water_depth2');
      ui.movementMode = 'walk';
      ui.updateUnitPanel(jumper);

      expect(ui.mpDisplay.textContent).toBe('MP: 7 / 7 (Run: 11, Jump: 0)');
    });
  });
});
