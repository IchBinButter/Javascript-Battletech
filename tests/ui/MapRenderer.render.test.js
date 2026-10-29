/**
 * @vitest-environment jsdom
 *
 * Render tests for MapRenderer. There is no canvas in jsdom, so the renderer
 * draws into a recording context and these tests assert what it actually drew:
 * terrain, grid, unit tokens, selection, previews and overlays.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MapRenderer } from '../../src/renderer/MapRenderer.js';
import { Hex } from '../../src/models/Hex.js';
import { hexToPixel, directionBetween } from '../../src/hex/HexMath.js';
import { MovementCalculator } from '../../src/rules/movement/MovementCalculator.js';
import { createRecordingCanvas } from '../helpers/canvasStub.js';

function stateWith(hexDefs, units = {}) {
  const hexes = new Map();
  for (const [key, data] of Object.entries(hexDefs)) {
    hexes.set(key, new Hex(key, data));
  }
  return { map: { hexes }, units };
}

function unit(overrides = {}) {
  return {
    id: 'u1',
    name: 'Atlas AS7-D',
    player: 0,
    heat: 0,
    prone: false,
    shutdown: false,
    position: { hexKey: '2,2', facing: 0 },
    ...overrides
  };
}

let canvas;
let renderer;

beforeEach(() => {
  canvas = createRecordingCanvas(800, 600);
  renderer = new MapRenderer(canvas, 30);
});

const draw = (state) => { renderer._doRender(state); return canvas.ctx; };

// The reachable-hex wash is the renderer's blue tint family.
const REACHABLE_FILL_PREFIX = 'fillStyle=rgba(59, 130, 246';

/** Alpha values of every reachable-hex tint the last pass drew. */
function reachableAlphas(ctx) {
  return ctx.styles()
    .filter(style => style.startsWith(REACHABLE_FILL_PREFIX))
    .map(style => Number(style.slice(style.lastIndexOf(',') + 1, -1)));
}

/** Does the context contain this exact call at (x, y)? */
function drewAt(ctx, method, x, y) {
  return ctx.calls.some(call => call.method === method &&
    Math.abs(call.args[0] - x) < 1e-9 &&
    Math.abs(call.args[1] - y) < 1e-9);
}

/** Pixel tip of the destination facing arrow the renderer draws for `facing`. */
function facingArrowTip(key, facing) {
  const dest = hexToPixel(key, 30);
  const length = 30 * 0.9 * 0.6; // arrow size 0.9 * hexSize, shaft length 0.6 * size
  const angle = -Math.PI / 2 + (facing * Math.PI / 3);
  return { x: dest.x + length * Math.cos(angle), y: dest.y + length * Math.sin(angle) };
}

/**
 * A real 11x11 map plus a 'Mech for MovementCalculator.getValidMoves. The unit
 * models no jump jets per location, so the calculator falls back to the design
 * Jumping MP rating; facing 3 matches the default deployment facing.
 */
function movementFixture() {
  const hexes = new Map();
  for (let col = 0; col <= 10; col++) {
    for (let row = 0; row <= 10; row++) {
      const key = `${col},${row}`;
      hexes.set(key, new Hex(key, { terrainType: 'clear' }));
    }
  }

  const mech = {
    id: 'u1',
    name: 'Spider SDR-5V',
    player: 0,
    heat: 0,
    prone: false,
    shutdown: false,
    movement: { walk: 8, run: 12, jump: 4 },
    position: { hexKey: '5,5', facing: 3 },
    criticalSlots: {},
    internalStructure: { leftLeg: 10, rightLeg: 10 },
    isLocationDestroyed() { return false; }
  };

  return { state: { map: { hexes }, units: { u1: mech } }, mech };
}

/** Every valid move the preview can draw a route to. */
function plottedDestinations(moves) {
  return [...moves].filter(([, move]) => Array.isArray(move.path) && move.path.length > 1);
}

describe('MapRenderer rendering', () => {
  it('clears the canvas before every pass', () => {
    const ctx = draw(stateWith({}));
    expect(ctx.calls[0].method).toBe('clearRect');
  });

  it('draws one filled hex per visible terrain hex', () => {
    const ctx = draw(stateWith({ '0,0': { terrainType: 'clear' }, '1,0': { terrainType: 'light_woods' }, '2,0': { terrainType: 'water_depth1' } }));

    const fills = ctx.calls.filter(c => c.method === 'fill');
    expect(fills.length).toBeGreaterThanOrEqual(3);
    // Terrain colours come from the renderer's palette.
    expect(ctx.styles().some(s => s.includes('#90EE90'))).toBe(true);
    expect(ctx.styles().some(s => s.includes('#228B22'))).toBe(true);
    expect(ctx.styles().some(s => s.includes('#4169E1'))).toBe(true);
  });

  it('draws trees, water ripples and rocks for the matching terrain', () => {
    const ctx = draw(stateWith({
      '0,0': { terrainType: 'heavy_woods' },
      '1,0': { terrainType: 'water_depth1' },
      '2,0': { terrainType: 'rough' }
    }));
    // Three wooded arcs, one ripple arc, one rock arc on top of the hex fills.
    const arcs = ctx.calls.filter(c => c.method === 'arc');
    expect(arcs.length).toBeGreaterThanOrEqual(5);
  });

  it('draws the elevation number on hills', () => {
    const ctx = draw(stateWith({ '0,0': { terrainType: 'clear', level: 3 } }));
    expect(ctx.texts()).toContain('3');
  });

  it('draws buildings with their level and remaining CF', () => {
    const ctx = draw(stateWith({ '0,0': { terrainType: 'clear', building: { type: 'medium', levels: 2, cf: 40, currentCF: 38 } } }));
    expect(ctx.methods()).toContain('strokeRect');
    expect(ctx.texts()).toContain('L2·38');
  });

  it('draws a wrecked building as rubble', () => {
    const ctx = draw(stateWith({ '0,0': { terrainType: 'clear', building: { type: 'medium', levels: 2, cf: 40, currentCF: 0 } } }));
    expect(ctx.texts()).toContain('RUBBLE');
  });

  it('uses a distinct terrain colour for building hexes', () => {
    const ctx = draw(stateWith({
      '0,0': { terrainType: 'light_building' },
      '1,0': { terrainType: 'medium_building' },
      '2,0': { terrainType: 'heavy_building' }
    }));

    // Buildings must not fall back to the clear green.
    expect(ctx.styles()).not.toContain('fillStyle=#90EE90');
    expect(ctx.styles()).toContain('fillStyle=#C9B79C');
    expect(ctx.styles()).toContain('fillStyle=#A89B8C');
    expect(ctx.styles()).toContain('fillStyle=#8A8078');
  });

  it('draws the hex grid only when enabled', () => {
    const state = stateWith({ '0,0': {}, '1,0': {} });

    renderer.showGrid = true;
    const withGrid = draw(state).calls.filter(c => c.method === 'stroke').length;

    canvas.ctx.reset();
    renderer.showGrid = false;
    const withoutGrid = draw(state).calls.filter(c => c.method === 'stroke').length;

    expect(withGrid).toBeGreaterThan(withoutGrid);
  });

  it('draws a unit token with its abbreviation, heat and facing arrow', () => {
    const ctx = draw(stateWith({ '2,2': {} }, { u1: unit({ heat: 12 }) }));

    expect(ctx.texts()).toContain('ATL');
    expect(ctx.texts()).toContain('H:12');
    expect(ctx.methods()).toContain('arc');       // token circle
    expect(ctx.methods()).toContain('lineTo');    // facing arrow
  });

  it('highlights the selected unit in yellow', () => {
    renderer.selectedUnit = 'u1';
    const ctx = draw(stateWith({ '2,2': {} }, { u1: unit() }));

    expect(ctx.styles()).toContain('strokeStyle=#ffff00');
    expect(ctx.styles()).toContain('lineWidth=3');
  });

  it('marks shut down and prone units', () => {
    const ctx = draw(stateWith({ '2,2': {} }, {
      u1: unit({ shutdown: true }),
      u2: unit({ id: 'u2', name: 'Jenner JR7-D', prone: true, position: { hexKey: '3,2', facing: 0 } })
    }));

    expect(ctx.styles()).toContain('fillStyle=#444444'); // shutdown token
    expect(ctx.texts()).toContain('DOWN');
    expect(ctx.texts()).toContain('PRONE');
  });

  it('draws the movement preview overlay', () => {
    renderer.validMoves = new Map([
      ['1,1', { cost: 1, remainingMP: 4, path: ['2,2', '1,1'] }],
      ['1,2', { cost: 2, remainingMP: 2, path: ['2,2', '1,2'] }]
    ]);
    const ctx = draw(stateWith({ '2,2': {}, '1,1': {}, '1,2': {} }));

    const overlays = ctx.styles().filter(s => s.includes('rgba(59, 130, 246'));
    expect(overlays.length).toBeGreaterThanOrEqual(2);
  });

  it('draws a dashed LOS preview, red when blocked', () => {
    renderer.losPreview = {
      fromKey: '0,0',
      toKey: '3,0',
      losResult: { blocked: true, interveningHexes: ['1,0'] }
    };
    const ctx = draw(stateWith({ '0,0': {}, '3,0': {}, '1,0': {} }));

    expect(ctx.methods()).toContain('setLineDash');
    expect(ctx.styles()).toContain('strokeStyle=#ff0000');
  });

  it('draws the LOS preview in green when the line is clear', () => {
    renderer.losPreview = {
      fromKey: '0,0',
      toKey: '2,0',
      losResult: { blocked: false, interveningHexes: ['1,0'] }
    };
    const ctx = draw(stateWith({ '0,0': {}, '1,0': {}, '2,0': {} }));

    expect(ctx.styles()).toContain('strokeStyle=#00ff00');
  });

  it('falls back to a default alpha when a preview move has no remaining MP', () => {
    renderer.validMoves = new Map([['1,1', { cost: 1, path: ['2,2', '1,1'] }]]);
    const ctx = draw(stateWith({ '2,2': {}, '1,1': {} }));

    expect(ctx.styles().some(s => s.includes('rgba(59, 130, 246'))).toBe(true);
  });

  it('draws fire and smoke overlays', () => {
    const state = stateWith({ '1,1': {} });
    state.fireHexes = ['1,1'];
    state.smokeHexes = { '1,1': 2 };
    const ctx = draw(state);

    expect(ctx.styles().some(s => s.includes('rgba(255, 69, 0'))).toBe(true);
    expect(ctx.styles().some(s => s.includes('rgba(128, 128, 128'))).toBe(true);
  });

  it('culls terrain outside the canvas', () => {
    canvas.width = 0;
    canvas.height = 0;
    const ctx = draw(stateWith({ '5,5': { terrainType: 'clear' } }));

    // No terrain fill, no grid: nothing of the map fits in a 0x0 viewport.
    expect(ctx.styles()).not.toContain('fillStyle=#90EE90');
    expect(ctx.styles().some(s => s.includes('#555555'))).toBe(false);
  });

  it('coalesces renders onto one animation frame', async () => {
    const state = stateWith({ '0,0': {} });
    renderer.render(state);
    renderer.render(state);
    renderer.render(state);
    expect(renderer._pendingRender).not.toBeNull();

    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    expect(renderer._pendingRender).toBeNull();
    expect(canvas.ctx.calls.some(c => c.method === 'clearRect')).toBe(true);
  });

  it('does nothing beyond clearing when there is no map', () => {
    const ctx = draw({ units: {} });
    expect(ctx.calls.filter(c => c.method === 'fill').length).toBe(0);
  });
});

describe('movement affordances', () => {
  const clearHexes = (...keys) => Object.fromEntries(keys.map(key => [key, {}]));

  it('tints and outlines every reachable hex with a clearly visible wash', () => {
    renderer.validMoves = new Map([
      ['2,2', { cost: 0, path: ['2,2'], remainingMP: 5 }],
      ['1,1', { cost: 1, path: ['2,2', '1,1'], remainingMP: 4 }],
      ['1,2', { cost: 2, path: ['2,2', '1,1', '1,2'], remainingMP: 3 }]
    ]);
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '1,2')));

    const alphas = reachableAlphas(ctx);
    expect(alphas.length).toBe(3); // exactly one tint per reachable hex
    // Clearly stronger than the old 0.15-0.25 wash that vanished into terrain.
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.3);
    // Each tinted hex is traced as well, so the range reads on busy terrain.
    expect(ctx.styles().filter(s => s === 'strokeStyle=#93c5fd').length).toBe(3);
  });

  it('stamps the MP cost on each reachable hex at a readable zoom', () => {
    renderer.validMoves = new Map([
      ['1,1', { cost: 3, path: ['2,2', '1,1'], remainingMP: 4 }],
      ['1,2', { cost: 5, path: ['2,2', '1,1', '1,2'], remainingMP: 2 }]
    ]);
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '1,2')));

    expect(ctx.texts()).toContain('3');
    expect(ctx.texts()).toContain('5');

    const centre = hexToPixel('1,1', 30);
    const label = ctx.calls.find(c => c.method === 'fillText' && c.args[0] === '3');
    expect(label.args[1]).toBeCloseTo(centre.x, 6);
    expect(label.args[2]).toBeCloseTo(centre.y + 30 * 0.45, 6);
  });

  it('does not stamp costs when zoomed out, but still tints the range', () => {
    renderer.hexSize = 12;
    renderer.validMoves = new Map([['1,1', { cost: 3, path: ['2,2', '1,1'], remainingMP: 4 }]]);
    const ctx = draw(stateWith(clearHexes('2,2', '1,1')));

    expect(ctx.texts()).toEqual([]);
    expect(reachableAlphas(ctx).length).toBe(1);
  });

  it('plots the hovered route through every intermediate hex', () => {
    renderer.validMoves = new Map([
      ['1,2', { cost: 2, path: ['2,2', '1,1', '1,2'], remainingMP: 3 }]
    ]);
    renderer.hoveredHex = '1,2';
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '1,2')));

    expect(ctx.styles()).toContain('strokeStyle=#facc15');
    for (const key of ['1,1', '1,2']) {
      const p = hexToPixel(key, 30);
      expect(drewAt(ctx, 'lineTo', p.x, p.y), `no path line at ${key}`).toBe(true);
    }

    // A hop marker sits on the intermediate hex, not on the endpoints.
    const hop = hexToPixel('1,1', 30);
    expect(ctx.calls.some(c => c.method === 'arc' &&
      Math.abs(c.args[0] - hop.x) < 1e-9 &&
      Math.abs(c.args[1] - hop.y) < 1e-9 &&
      c.args[2] === 3)).toBe(true);

    // The move's total cost is shown next to the destination.
    expect(ctx.texts()).toContain('2 MP');
  });

  it('falls back to the last hop when the move has no arrival facing', () => {
    renderer.validMoves = new Map([
      ['1,2', { cost: 2, path: ['2,2', '1,1', '1,2'], remainingMP: 3 }]
    ]);
    renderer.hoveredHex = '1,2';
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '1,2')));

    // '1,1' -> '1,2' is one hexside south (facing 3), so the arrow points
    // straight down the screen: -PI/2 + 3 * PI/3 = PI/2.
    const tip = facingArrowTip('1,2', 3);
    expect(drewAt(ctx, 'lineTo', tip.x, tip.y)).toBe(true);
    expect(ctx.styles()).toContain('strokeStyle=#facc15'); // path-coloured arrow
    expect(ctx.styles()).toContain('lineWidth=3');
  });

  it('uses the move’s arrival facing even when it differs from the last hop', () => {
    renderer.validMoves = new Map([
      ['1,2', { cost: 2, path: ['2,2', '1,1', '1,2'], remainingMP: 3, facing: 1 }]
    ]);
    renderer.hoveredHex = '1,2';
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '1,2')));

    // `facing` is the arrival facing MovementCalculator stores: a jump lands on
    // its take-off/landing facing, which need not match the direction of
    // flight. The last hop points south (3), so only honouring `facing` draws 1.
    const arrival = facingArrowTip('1,2', 1);
    expect(drewAt(ctx, 'lineTo', arrival.x, arrival.y)).toBe(true);
    const lastHop = facingArrowTip('1,2', 3);
    expect(drewAt(ctx, 'lineTo', lastHop.x, lastHop.y)).toBe(false);
  });

  it('draws no route when the hovered hex is not a legal move', () => {
    renderer.validMoves = new Map([['1,1', { cost: 1, path: ['2,2', '1,1'], remainingMP: 4 }]]);
    renderer.hoveredHex = '3,3'; // off the reachable set
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '3,3')));

    expect(ctx.styles()).not.toContain('strokeStyle=#facc15');
    expect(ctx.texts().some(text => String(text).endsWith(' MP'))).toBe(false);
  });

  it('draws no route for the no-move entry in the unit’s own hex', () => {
    renderer.validMoves = new Map([['2,2', { cost: 0, path: ['2,2'], remainingMP: 5 }]]);
    renderer.hoveredHex = '2,2';
    const ctx = draw(stateWith(clearHexes('2,2')));

    expect(ctx.styles()).not.toContain('strokeStyle=#facc15');
    expect(reachableAlphas(ctx).length).toBe(1);
  });

  it('keeps the selected unit’s own facing arrow while a route is previewed', () => {
    renderer.selectedUnit = 'u1';
    renderer.validMoves = new Map([
      ['1,2', { cost: 2, path: ['2,2', '1,1', '1,2'], remainingMP: 3 }]
    ]);
    renderer.hoveredHex = '1,2';
    const ctx = draw(stateWith(clearHexes('2,2', '1,1', '1,2'), { u1: unit() }));

    // The selected token ring and its enlarged facing arrow are both yellow.
    expect(ctx.styles().filter(s => s === 'strokeStyle=#ffff00').length).toBeGreaterThanOrEqual(2);

    const start = hexToPixel('2,2', 30);
    const arrowTipY = start.y - 30 * 0.8 * 0.6; // facing 0 (north), selected size
    expect(drewAt(ctx, 'lineTo', start.x, arrowTipY)).toBe(true);
  });

  it('draws the preview below the unit tokens', () => {
    renderer.selectedUnit = 'u1';
    renderer.validMoves = new Map([['1,1', { cost: 1, path: ['2,2', '1,1'], remainingMP: 4 }]]);
    const ctx = draw(stateWith(clearHexes('2,2', '1,1'), { u1: unit() }));

    const tintIndex = ctx.calls.findIndex(c =>
      c.set === 'fillStyle' && String(c.value).startsWith('rgba(59, 130, 246'));
    const tokenIndex = ctx.calls.findIndex(c => c.method === 'arc' && c.args[2] === 15);
    expect(tintIndex).toBeGreaterThanOrEqual(0);
    expect(tokenIndex).toBeGreaterThan(tintIndex);
  });

  // ------------------------------------------------------------------
  // Real-calculator cases: the reviewed bug was that the renderer invented
  // its own arrival facing (the last hop) instead of reading the one the
  // engine's calculator stores in `facing`. These drive the real
  // getValidMoves output, never a hand-built move map.
  // ------------------------------------------------------------------
  it('matches the engine arrival facing for every real jump destination', () => {
    const { state, mech } = movementFixture();
    const moves = new MovementCalculator().getValidMoves(mech, state, 'jump');
    renderer.validMoves = moves;
    renderer.selectedUnit = 'u1';

    const destinations = plottedDestinations(moves);
    expect(destinations.length).toBeGreaterThan(10);

    // A jump keeps the facing it took off with (facing 3) instead of turning
    // into the direction of flight, so most destinations differ from the hop.
    // These are exactly the cases the old last-hop rendering got wrong.
    const differsFromLastHop = destinations.filter(([, move]) =>
      directionBetween(move.path[move.path.length - 2], move.path[move.path.length - 1]) !== move.facing);
    expect(differsFromLastHop.length).toBeGreaterThan(10);

    for (const [key, move] of differsFromLastHop) {
      renderer.hoveredHex = key;
      canvas.ctx.reset();
      renderer._doRender(state);

      const arrival = facingArrowTip(key, move.facing);
      expect(drewAt(canvas.ctx, 'lineTo', arrival.x, arrival.y),
        `engine arrival facing ${move.facing} not drawn at ${key}`).toBe(true);

      const lastHop = directionBetween(move.path[move.path.length - 2], move.path[move.path.length - 1]);
      const lastHopTip = facingArrowTip(key, lastHop);
      expect(drewAt(canvas.ctx, 'lineTo', lastHopTip.x, lastHopTip.y),
        `last-hop facing ${lastHop} drawn instead of engine facing ${move.facing} at ${key}`).toBe(false);
    }
  });

  it('matches the engine arrival facing for every real ground destination', () => {
    const { state, mech } = movementFixture();
    const moves = new MovementCalculator().getValidMoves(mech, state, 'walk');
    renderer.validMoves = moves;
    renderer.selectedUnit = 'u1';

    const destinations = plottedDestinations(moves);
    expect(destinations.length).toBeGreaterThan(10);

    for (const [key, move] of destinations) {
      // Ground movement turns to face the hex it entered last.
      expect(move.facing).toBe(
        directionBetween(move.path[move.path.length - 2], move.path[move.path.length - 1])
      );

      renderer.hoveredHex = key;
      canvas.ctx.reset();
      renderer._doRender(state);

      const arrival = facingArrowTip(key, move.facing);
      expect(drewAt(canvas.ctx, 'lineTo', arrival.x, arrival.y),
        `engine arrival facing ${move.facing} not drawn at ${key}`).toBe(true);
    }
  });
});
