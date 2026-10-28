/**
 * @vitest-environment jsdom
 *
 * 6.4 hidden units - the read path.
 *
 * The engine is shared, so the only thing standing between a hidden enemy and
 * the screen is projectStateForPlayer. These tests drive the real renderer and
 * UIController with both raw and projected state: the projection is what keeps
 * a hidden unit off the map, out of the unit list and off the target list.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MapRenderer } from '../../src/renderer/MapRenderer.js';
import { UIController } from '../../src/ui/UIController.js';
import { Hex } from '../../src/models/Hex.js';
import { projectStateForPlayer, revealOnMove } from '../../src/engine/visibility.js';
import { createRecordingCanvas } from '../helpers/canvasStub.js';

const ABBREVIATIONS = { atlas: 'ATL', ghost: 'LOC', scout: 'JEN' };

function makeUnit(overrides = {}) {
  return {
    id: 'unit',
    name: 'Atlas AS7-D',
    player: 0,
    heat: 0,
    prone: false,
    shutdown: false,
    position: { hexKey: '5,5', facing: 0 },
    ...overrides
  };
}

/**
 * One visible friendly 'Mech, one hidden enemy ('ghost') and one visible enemy
 * ('scout'). Player 0 is the local viewer.
 */
function makeState() {
  const hexes = new Map();
  for (const key of ['5,5', '5,6', '6,5', '5,8', '6,8']) {
    hexes.set(key, new Hex(key, { terrainType: 'clear', level: 0 }));
  }

  const atlas = makeUnit({ id: 'atlas', name: 'Atlas AS7-D' });
  const ghost = makeUnit({
    id: 'ghost', name: 'Locust LCT-1V', player: 1, position: { hexKey: '5,8', facing: 3 }
  });
  const scout = makeUnit({
    id: 'scout', name: 'Jenner JR7-D', player: 1, position: { hexKey: '6,8', facing: 3 }
  });

  const state = {
    turn: 1,
    phase: 'movement',
    currentPlayer: 0,
    players: [{ id: 0, name: 'Player 1' }, { id: 1, name: 'Player 2' }],
    map: { width: 17, height: 15, hexes },
    units: { atlas, ghost, scout },
    hiddenUnits: { ghost: { hidden: true }, scout: { hidden: false } },
    fireHexes: [],
    smokeHexes: {},
    // GameState's prototype helpers are what projection preserves; mirror the
    // two the UI needs.
    getUnit(id) { return this.units[id] || null; },
    getPlayerUnits(playerId) { return Object.values(this.units).filter(u => u.player === playerId); }
  };

  return { state, atlas, ghost, scout };
}

let canvas;
let renderer;

beforeEach(() => {
  canvas = createRecordingCanvas(800, 600);
  renderer = new MapRenderer(canvas, 30);
  // Minimal HUD for the controller tests: the dice log and unit panel.
  document.body.innerHTML = '<div id="unit-details"></div><div id="dice-log"></div>';
});

const draw = (state) => {
  renderer._doRender(state);
  return canvas.ctx;
};

describe('MapRenderer and the per-player projection', () => {
  it('draws no token for a hidden enemy', () => {
    const { state } = makeState();
    const view = projectStateForPlayer(state, 0);

    const drawUnit = vi.spyOn(renderer, 'drawUnit');
    const ctx = draw(view);

    // Only the two units player 0 can see got a token.
    expect(Object.keys(view.units).sort()).toEqual(['atlas', 'scout']);
    const drawnIds = drawUnit.mock.calls.map(call => call[3]);
    expect(drawnIds).toEqual(['atlas', 'scout']);

    expect(ctx.texts()).toContain(ABBREVIATIONS.atlas);
    expect(ctx.texts()).not.toContain(ABBREVIATIONS.ghost);
  });

  it('draws a visible enemy normally', () => {
    const { state } = makeState();
    const ctx = draw(projectStateForPlayer(state, 0));

    expect(ctx.texts()).toContain(ABBREVIATIONS.scout);
  });

  it('would draw the hidden unit from raw state (control: the projection is doing the work)', () => {
    const { state } = makeState();

    // A renderer handed the raw state has no way to know ghost is hidden - this
    // control proves the previous test is not passing for an unrelated reason.
    const ctx = draw(state);
    expect(ctx.texts()).toContain(ABBREVIATIONS.ghost);
  });

  it('is per player: player 1 sees their own hidden unit', () => {
    const { state } = makeState();
    const view = projectStateForPlayer(state, 1);

    expect(Object.keys(view.units).sort()).toEqual(['atlas', 'ghost', 'scout']);
    expect(draw(view).texts()).toContain(ABBREVIATIONS.ghost);
  });

  it('draws nothing for a unit absent from the state it receives', () => {
    const { state } = makeState();
    const ctx = draw({ map: state.map, units: {} });

    expect(ctx.texts().filter(t => Object.values(ABBREVIATIONS).includes(t))).toEqual([]);
  });
});

describe('UIController unit and target lists', () => {
  function makeUI(state, viewerId = 0) {
    const ui = new UIController({ viewerId });
    ui.gameEngine = { stateManager: { getState: () => state } };
    return ui;
  }
  it('lists only units the local viewer can see', () => {
    const { state } = makeState();
    const ui = makeUI(state);

    expect(ui.getVisibleUnits().map(unit => unit.id)).toEqual(['atlas', 'scout']);
    expect(ui.getVisibleUnits(1).map(unit => unit.id)).toEqual(['scout']);
  });

  it('does not offer a hidden enemy as a target', () => {
    const { state } = makeState();
    const ui = makeUI(state);

    expect(ui.getTargetableUnits('atlas').map(unit => unit.id)).toEqual(['scout']);
  });

  it('offers the enemy once it is revealed', () => {
    const { state } = makeState();
    state.hiddenUnits.ghost.hidden = false;
    const ui = makeUI(state);

    expect(ui.getTargetableUnits('atlas').map(unit => unit.id).sort())
      .toEqual(['ghost', 'scout']);
    expect(ui.getVisibleUnits(1).map(unit => unit.id).sort())
      .toEqual(['ghost', 'scout']);
  });

  it('honours its viewer: player 1 sees their own hidden unit', () => {
    const { state } = makeState();
    const ui = makeUI(state, 1);

    expect(ui.getVisibleUnits().map(unit => unit.id).sort())
      .toEqual(['atlas', 'ghost', 'scout']);
  });

  it('returns empty lists before a game engine is attached', () => {
    const ui = new UIController();
    expect(ui.getVisibleUnits()).toEqual([]);
    expect(ui.getTargetableUnits('atlas')).toEqual([]);
  });
});

describe('UIController dice log', () => {
  it('logs a move after the engine reveals the mover at the start of its move (p82)', () => {
    const { state } = makeState();
    const ui = new UIController({ viewerId: 0 });
    ui.gameEngine = { stateManager: { getState: () => state } };

    // The engine calls this before the move is applied, so by the time the
    // unitMoved event reaches the UI the mover is no longer hidden.
    revealOnMove(state, 'ghost');
    ui._onUnitMoved({ unitId: 'ghost', hexKey: '5,8', facing: 3 });

    expect(ui.diceLog.textContent).toContain('ghost');
    expect(ui.diceLog.textContent).toContain('5,8');
  });

  it('still refuses to log a move for a unit the viewer cannot see (defence in depth)', () => {
    const { state } = makeState();
    const ui = new UIController({ viewerId: 0 });
    ui.gameEngine = { stateManager: { getState: () => state } };

    // p82 says a hidden mover is revealed at the start of its move, so this
    // state should not reach the UI; if it does, the log must not leak it.
    ui._onUnitMoved({ unitId: 'ghost', hexKey: '5,8', facing: 3 });
    expect(ui.diceLog.textContent).not.toContain('ghost');
    expect(ui.diceLog.textContent).not.toContain('5,8');

    // A visible unit's move is still reported.
    ui._onUnitMoved({ unitId: 'scout', hexKey: '6,8', facing: 3 });
    expect(ui.diceLog.textContent).toContain('scout');
    expect(ui.diceLog.textContent).toContain('6,8');
  });
});
