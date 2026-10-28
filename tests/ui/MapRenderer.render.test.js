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

  it('draws buildings with their level label', () => {
    const ctx = draw(stateWith({ '0,0': { terrainType: 'clear', building: { type: 'medium', levels: 2, cf: 40 } } }));
    expect(ctx.methods()).toContain('strokeRect');
    expect(ctx.texts()).toContain('L2');
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
