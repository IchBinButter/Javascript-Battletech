/**
 * @vitest-environment jsdom
 *
 * Boot test for src/main.js: load index.html's markup, stub the canvas and
 * fetch, then drive the real entry point from the start menu into a running
 * game. This is the test that would have caught "a button is missing" and
 * "the map never renders".
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRecordingCanvas } from '../helpers/canvasStub.js';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let canvasStub;
let booted = false;

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

beforeAll(async () => {
  // Real markup, minus the script tag (the module is imported directly).
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = parsed.body.innerHTML;

  // jsdom has no canvas, so every canvas drawing goes to the recorder.
  canvasStub = createRecordingCanvas(800, 600);
  HTMLCanvasElement.prototype.getContext = () => canvasStub.ctx;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 600; } });

  // main.js loads its data with fetch.
  global.fetch = async (url) => {
    const file = path.join(root, url);
    return { json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };

  global.alert = () => {};
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await import('../../src/main.js');
  await waitFor(() => document.querySelectorAll('.sm-menu-item').length >= 2);
  booted = true;
});

describe('main.js boot', () => {
  it('renders the start menu with its menu items', () => {
    expect(booted).toBe(true);
    const labels = [...document.querySelectorAll('.sm-menu-item')].map(el => el.textContent.trim());
    expect(labels).toEqual(['New Game', 'Load Game', 'Settings', 'Quit']);
    expect(document.getElementById('start-menu-overlay').style.display).toBe('flex');
  });

  it('hides the game shell until a game starts', () => {
    expect(document.getElementById('app').style.display).toBe('none');
  });

  it('opens the force builder with the full roster and every control', () => {
    const newGame = [...document.querySelectorAll('.sm-menu-item')]
      .find(el => el.textContent.trim() === 'New Game');
    newGame.click();

    const container = document.getElementById('force-builder-container');
    expect(container).not.toBeNull();

    // Two player columns, each with a name field, roster select and add button.
    expect(container.querySelectorAll('.fb-column').length).toBe(2);
    expect(container.querySelectorAll('.fb-player-name').length).toBe(2);
    expect(container.querySelectorAll('.fb-add-mech').length).toBe(2);

    const roster = container.querySelector('#fb-mech-select-0');
    expect(roster.querySelectorAll('option').length).toBe(15); // 14 Mechs + placeholder
    expect(container.querySelector('#fb-map-select')).not.toBeNull();
    expect(container.querySelector('#fb-start-game').textContent.trim()).toBe('Start Game');
    expect(container.querySelector('#fb-start-game')).not.toBeNull();
  });

  it('starts a game, renders the map and fills the HUD', async () => {
    document.getElementById('fb-start-game').click();

    // 'Phase: --' is the pre-game placeholder.
    await waitFor(() => document.getElementById('phase-label').textContent !== 'Phase: --');
    // Rendering is coalesced onto requestAnimationFrame, so let a frame run.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));

    // HUD
    expect(document.getElementById('phase-label').textContent).toBe('Phase: initiative');
    expect(document.getElementById('turn-label').textContent).toBe('Turn: 1');
    expect(document.getElementById('active-player').textContent).toContain('Active');

    // The canvas was resized to the container and actually drawn into.
    const canvas = document.getElementById('map-canvas');
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvasStub.ctx.methods()).toContain('clearRect');
    expect(canvasStub.ctx.methods()).toContain('fill');
    // Unit tokens drew their abbreviations.
    expect(canvasStub.ctx.texts().length).toBeGreaterThan(0);

    // The dice log reported the deployment.
    const logText = document.getElementById('dice-log').textContent;
    expect(logText).toContain('started');
    expect(logText).toContain('BattleMechs deployed');
  });

  it('renders the phase action buttons', () => {
    const buttons = [...document.querySelectorAll('#action-buttons button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.map(b => b.textContent.toLowerCase()).join(' ')).toContain('initiative');
  });

  it('selects a unit when its hex is clicked, and clears on Escape', async () => {
    const { hexToPixel } = await import('../../src/hex/HexMath.js');
    const canvas = document.getElementById('map-canvas');
    const pos = hexToPixel('6,3', 30);

    canvas.dispatchEvent(new MouseEvent('click', {
      clientX: pos.x,
      clientY: pos.y,
      bubbles: true
    }));

    expect(document.getElementById('unit-details').textContent).toContain('Atlas');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('unit-details').textContent).toContain('Select a unit');
  });

  it('re-renders the map on keyboard input', async () => {
    const before = canvasStub.ctx.calls.length;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    await new Promise(resolve => requestAnimationFrame(() => resolve()));

    // The grid toggle schedules a fresh frame, which clears and redraws.
    expect(canvasStub.ctx.calls.length).toBeGreaterThan(before);
  });

  it('exposes the structured debug log with this game in its export', async () => {
    expect(window.BT_LOG).toBeTruthy();
    expect(typeof window.BT_LOG.dump).toBe('function');
    expect(typeof window.BT_LOG.download).toBe('function');
    expect(typeof window.BT_LOG.clear).toBe('function');

    // This test's fetch stub has no /api/log endpoint, so the stream probe has
    // to fall back to the in-memory log without throwing or retrying.
    await waitFor(() => window.BT_LOG.dump().includes('log streaming unavailable'));

    const text = window.BT_LOG.dump();

    // The header names the game the entries belong to.
    expect(text).toContain('game: game-');
    expect(text).toContain('turn: 1');
    expect(text).toContain('phase: initiative');

    // Engine events and the dice log were both mirrored into the buffer.
    expect(text).toContain('engine');
    expect(text).toContain('phaseChanged');
    expect(text).toContain('game started');
    expect(text).toContain('ui');
    expect(text).toContain('BattleTech Tabletop Simulator started!');

    // Logging keeps no browser storage state: the only persistence is the
    // optional dev-server file stream (or the Ctrl+Shift+L download).
    expect(localStorage.length).toBe(0);
  });

  it('downloads a timestamped .txt of the debug log (Ctrl+Shift+L)', () => {
    // jsdom has no object URLs; stub them and record the anchor download.
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, writable: true, value: () => 'blob:debug-log'
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, writable: true, value: () => {}
    });

    const downloads = [];
    const clickSpy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function click() {
      if (this.tagName === 'A') downloads.push({ href: this.href, download: this.download });
    });

    try {
      const result = window.BT_LOG.download();
      expect(result.filename)
        .toMatch(/^battletech-log-game-\d+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.txt$/);
      expect(result.text).toContain('BattleTech Tabletop Simulator debug log');
      expect(downloads).toHaveLength(1);
      expect(downloads[0].download).toBe(result.filename);
      expect(downloads[0].href).toBe('blob:debug-log');

      // The keyboard shortcut is the same export path.
      const notCancelled = document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'L', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
      }));
      expect(notCancelled).toBe(false); // preventDefault() ran: the browser does not also type an 'l'
      expect(downloads).toHaveLength(2);
      expect(downloads[1].download).toMatch(/^battletech-log-game-.*\.txt$/);
    } finally {
      clickSpy.mockRestore();
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
      else delete URL.createObjectURL;
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
      else delete URL.revokeObjectURL;
    }
  });
});
