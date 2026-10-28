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
});
