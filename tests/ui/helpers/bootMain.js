/**
 * Boot the real src/main.js against the real index.html markup in jsdom.
 *
 * Every test that drives the live-player path (start menu -> Force Builder ->
 * Start Game) needs the same scaffolding: real markup, a recording canvas,
 * fetch backed by the repo's data files, and a way to observe the state the
 * game actually handed to the map. This helper keeps that in one place.
 *
 * The MapRenderer patch is observation only: it records the state of every
 * render call without changing what production code does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { createRecordingCanvas } from '../../helpers/canvasStub.js';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

export function waitFor(predicate, timeoutMs = 3000) {
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

export function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * Replace the document with index.html's real markup and import src/main.js
 * (a fresh module graph each call, so tests that need a second boot can use it).
 *
 * @returns {Promise<{
 *   canvasStub: object,
 *   alertSpy: Function,
 *   renders: Array<{renderer: object, state: object}>,
 *   latest: () => {renderer: object, state: object} | null,
 *   renderer: object | null,
 *   state: object | null,
 *   restore: () => void
 * }>}
 */
export async function bootMain() {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = parsed.body.innerHTML;

  // jsdom has no canvas, so drawing goes to the recorder.
  const canvasStub = createRecordingCanvas(800, 600);
  HTMLCanvasElement.prototype.getContext = () => canvasStub.ctx;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 600; } });

  // main.js loads its JSON through fetch.
  global.fetch = async (url) => {
    const file = path.join(root, url);
    return { json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  const alertSpy = vi.fn();
  global.alert = alertSpy;

  const { MapRenderer } = await import('../../../src/renderer/MapRenderer.js');
  const originalRender = MapRenderer.prototype.render;
  const renders = [];
  MapRenderer.prototype.render = function render(state) {
    renders.push({ renderer: this, state });
    return originalRender.call(this, state);
  };

  await import('../../../src/main.js');
  await waitFor(() => document.querySelectorAll('.sm-menu-item').length >= 2);

  return {
    canvasStub,
    alertSpy,
    renders,
    latest: () => (renders.length > 0 ? renders[renders.length - 1] : null),
    get renderer() {
      const latest = renders[renders.length - 1];
      return latest ? latest.renderer : null;
    },
    get state() {
      const latest = renders[renders.length - 1];
      return latest ? latest.state : null;
    },
    restore() { MapRenderer.prototype.render = originalRender; }
  };
}

/** Click the start menu's New Game entry and return the Force Builder root. */
export function openNewGame() {
  const button = [...document.querySelectorAll('.sm-menu-item')]
    .find(el => el.textContent.trim() === 'New Game');
  if (!button) throw new Error('the start menu has no New Game entry');
  button.click();

  const container = document.getElementById('force-builder-container');
  if (!container) throw new Error('New Game did not open the Force Builder');
  return container;
}

/** All Force Builder roots currently in the document (there should be one). */
export function forceBuilderContainers() {
  return [...document.querySelectorAll('#force-builder-container')];
}

/** Add a roster 'Mech to `playerIndex` through the Force Builder's controls. */
export function addRosterUnit(container, playerIndex, mechId) {
  const select = container.querySelector(`#fb-mech-select-${playerIndex}`);
  const addButton = container.querySelectorAll('.fb-add-mech')[playerIndex];
  if (!select || !addButton) throw new Error(`Force Builder is missing player ${playerIndex}'s controls`);
  select.value = mechId;
  addButton.click();
}

/** Type a player name through the player-name input. */
export function setPlayerName(container, playerIndex, name) {
  const input = container.querySelectorAll('.fb-player-name')[playerIndex];
  input.value = name;
  input.dispatchEvent(new Event('input'));
}

/**
 * Click Start Game in `container` (defaults to the topmost Force Builder) and
 * wait until the game reports a real phase.
 */
export async function clickStartGame(container = null) {
  const root = container || forceBuilderContainers().pop() || document;
  const button = root.querySelector('#fb-start-game');
  if (!button) throw new Error('Start Game button not found');
  button.click();
  await waitFor(() => document.getElementById('phase-label').textContent !== 'Phase: --');
  await nextFrame();
}

/** The units the map was last handed, in deployment order. */
export function deployedUnits(state) {
  return Object.values(state.units).map(unit => ({
    name: unit.name,
    tonnage: unit.tonnage,
    player: unit.player,
    id: unit.id,
    hexKey: unit.position.hexKey
  }));
}

/** Is `hexKey` a real hex of the loaded map? */
export function isMapHex(state, hexKey) {
  return Boolean(state.map.hexes.get(hexKey));
}

/** Does every deployed unit stand on a real map hex? */
export function allDeployedOnMap(state) {
  return Object.values(state.units).every(unit => isMapHex(state, unit.position.hexKey));
}

/** The dice-log text, which is how the UI reports deployment facts. */
export function logText() {
  return document.getElementById('dice-log').textContent;
}
