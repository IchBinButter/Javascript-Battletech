/**
 * @vitest-environment jsdom
 *
 * Regression: the game must stay playable on turn 2, and weapon fire must be a
 * two-step flow (pick the target, then fire the checked weapons).
 *
 * Live play: "I am unable to select my mech or move on the second turn, so I'm
 * stuck." This test boots src/main.js against the real index.html markup,
 * starts a game, plays a whole turn through the phase buttons, and then, on
 * turn 2's Movement Phase, clicks one of the player's own 'Mechs on the canvas.
 * The click must select the 'Mech and populate mapRenderer.validMoves, and the
 * pending move must be confirmable - through the real DOM event path only.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRecordingCanvas } from '../helpers/canvasStub.js';
import { MapRenderer } from '../../src/renderer/MapRenderer.js';
import { hexToPixel } from '../../src/hex/HexMath.js';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let canvasStub;
let renderer = null;
let lastRenderedState = null;
const originalRender = MapRenderer.prototype.render;

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

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function phaseText() {
  return document.getElementById('phase-label').textContent;
}

function turnText() {
  return document.getElementById('turn-label').textContent;
}

function logText() {
  return document.getElementById('dice-log').textContent;
}

function actionButtons() {
  return [...document.querySelectorAll('#action-buttons button')];
}

/** Click the button that advances the current phase (the last one offered). */
function clickAdvanceButton() {
  const buttons = actionButtons();
  if (buttons.length === 0) throw new Error(`no action button in ${phaseText()}`);
  buttons[buttons.length - 1].click();
}

function actionButton(labelPart) {
  return actionButtons().find(button => button.textContent.toLowerCase().includes(labelPart));
}

function ownUnits() {
  return Object.values(lastRenderedState.units).filter(unit => unit.player === 0);
}

function enemyUnits() {
  return Object.values(lastRenderedState.units).filter(unit => unit.player !== 0);
}

function canvasPoint(hexKey) {
  const pos = hexToPixel(hexKey, renderer.hexSize);
  return { clientX: pos.x + renderer.offsetX, clientY: pos.y + renderer.offsetY };
}

function clickHex(hexKey) {
  const point = canvasPoint(hexKey);
  document.getElementById('map-canvas').dispatchEvent(new MouseEvent('click', {
    ...point,
    bubbles: true
  }));
}

function hoverHex(hexKey) {
  const point = canvasPoint(hexKey);
  document.getElementById('map-canvas').dispatchEvent(new MouseEvent('mousemove', {
    ...point,
    bubbles: true
  }));
}

beforeAll(async () => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = parsed.body.innerHTML;

  canvasStub = createRecordingCanvas(800, 600);
  HTMLCanvasElement.prototype.getContext = () => canvasStub.ctx;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 600; } });

  global.fetch = async (url) => {
    const file = path.join(root, url);
    return { json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  global.alert = () => {};
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // main.js keeps its MapRenderer private; capture the live instance (and the
  // state it was handed) through the class the module itself uses. This is
  // observation only - no test injects renderer state.
  MapRenderer.prototype.render = function render(state) {
    renderer = this;
    lastRenderedState = state;
    return originalRender.call(this, state);
  };

  await import('../../src/main.js');
  await waitFor(() => document.querySelectorAll('.sm-menu-item').length >= 2);
});

afterAll(() => {
  MapRenderer.prototype.render = originalRender;
});

describe('turn 2 movement flow (live-player path)', () => {
  it('starts a game from the start menu', async () => {
    const newGame = [...document.querySelectorAll('.sm-menu-item')]
      .find(el => el.textContent.trim() === 'New Game');
    newGame.click();
    document.getElementById('fb-start-game').click();

    await waitFor(() => phaseText() !== 'Phase: --');
    await nextFrame();
    expect(turnText()).toBe('Turn: 1');
    expect(phaseText()).toBe('Phase: initiative');
  });

  it('reaches the weapon attack phase of turn 1 through the phase buttons', async () => {
    clickAdvanceButton(); // Roll Initiative -> Movement
    await nextFrame();
    expect(phaseText()).toBe('Phase: movement');

    clickAdvanceButton(); // End Movement Phase -> Weapon Attack
    await nextFrame();
    expect(phaseText()).toBe('Phase: weapon_attack');
    expect(renderer).not.toBeNull();
    expect(ownUnits()).toHaveLength(2);
    expect(enemyUnits()).toHaveLength(2);
  });

  it('targets an enemy without firing, then fires the checked weapons from the panel', async () => {
    const attacker = ownUnits()[0];
    const target = enemyUnits()[0];

    clickHex(attacker.position.hexKey);
    await nextFrame();
    expect(document.getElementById('unit-details').textContent).toContain(attacker.name);

    const declareButton = actionButton('declare weapon fire');
    expect(declareButton, 'the weapon phase offers "Declare Weapon Fire"').toBeTruthy();
    declareButton.click();
    expect(document.getElementById('weapon-panel').style.display).toBe('block');

    // Record the pre-target eligibility, then arm a weapon: in the old
    // one-step flow the target click would fire it immediately.
    const eligibilityBeforeTarget = [...document.querySelectorAll('.weapon-check')]
      .map(checkbox => checkbox.disabled);
    const armed = [...document.querySelectorAll('.weapon-check:not(:disabled)')][0];
    expect(armed).toBeTruthy();
    armed.checked = true;

    // Step 1: clicking the enemy only records the target and refreshes the
    // weapon panel with target-dependent eligibility. It must not fire.
    const beforeTarget = logText();
    clickHex(target.position.hexKey);
    await nextFrame();
    const targetLog = logText().slice(beforeTarget.length);
    expect(targetLog).toContain(`Target selected: ${target.name}`);
    expect(targetLog).not.toMatch(/HIT!|MISS!|Fire error/);
    expect(document.getElementById('weapon-panel').style.display).toBe('block');

    // The panel was rebuilt for the target: the armed box is gone and weapons
    // that cannot fire at this target are now disabled.
    expect(document.querySelectorAll('.weapon-check:checked')).toHaveLength(0);
    const eligibilityAfterTarget = [...document.querySelectorAll('.weapon-check')]
      .map(checkbox => checkbox.disabled);
    expect(eligibilityAfterTarget).toHaveLength(eligibilityBeforeTarget.length);
    expect(eligibilityAfterTarget).not.toEqual(eligibilityBeforeTarget);

    // The target-aware panel now disables weapons that cannot fire at it, so
    // at least two eligible weapons must remain for the multi-shot declaration.
    const eligible = [...document.querySelectorAll('.weapon-check:not(:disabled)')];
    expect(eligible.length, 'legal shots are offered at the selected target').toBeGreaterThanOrEqual(2);

    // Step 2: Fire Selected resolves every checked weapon in ONE declaration.
    // Both shots must resolve: firing them as separate actions used to advance
    // the per-'Mech queue after the first and reject the rest.
    eligible[0].checked = true;
    eligible[1].checked = true;
    const beforeFire = logText();
    document.getElementById('btn-fire').click();
    await nextFrame();
    const fireLog = logText().slice(beforeFire.length);
    expect(fireLog.match(/HIT!|MISS!/g) || []).toHaveLength(2);
    expect(fireLog).not.toMatch(/Fire error/);
  });

  it('plays turn 1 through the phase buttons and reaches turn 2 movement', async () => {
    const visited = [];
    for (let guard = 0; guard < 20; guard++) {
      await nextFrame();
      visited.push(`${turnText()} ${phaseText()}`);
      if (turnText() === 'Turn: 2' && phaseText() === 'Phase: movement') break;
      clickAdvanceButton();
      await nextFrame();
    }
    expect(visited[visited.length - 1]).toBe('Turn: 2 Phase: movement');
  });

  it('selects a player-owned Mech on turn 2 and previews its legal moves', async () => {
    // The turn-2 initiative puts player 1's declaration first, which is the
    // slot nobody controls in solo play; the viewer's own 'Mech must still
    // become the acting unit.
    expect(renderer).not.toBeNull();
    const playerUnits = ownUnits();
    expect(playerUnits).toHaveLength(2);
    const ownUnit = playerUnits[0];

    expect(lastRenderedState.currentPlayer).toBe(0);
    expect(document.getElementById('active-player').textContent)
      .toContain(lastRenderedState.players[0].name);

    clickHex(ownUnit.position.hexKey);
    await nextFrame();

    // Selection happened: the unit panel shows the Mech.
    expect(document.getElementById('unit-details').textContent).toContain(ownUnit.name);
    expect(renderer.selectedUnit).toBe(ownUnit.id);

    // And the movement preview was built for it.
    expect(renderer.validMoves).toBeInstanceOf(Map);
    expect(renderer.validMoves.size).toBeGreaterThan(1);
  });

  it('does not preview movement for a Mech whose declaration is not current', async () => {
    const [actingUnit, otherUnit] = ownUnits();

    clickHex(otherUnit.position.hexKey);
    await nextFrame();

    // Selection still works (the panel is an inspection tool)...
    expect(renderer.selectedUnit).toBe(otherUnit.id);
    expect(document.getElementById('unit-details').textContent).toContain(otherUnit.name);
    // ...but the preview follows the declaration queue, and the player is told.
    expect(renderer.validMoves).toBeNull();
    expect(logText()).toContain('declaring movement now');

    clickHex(actingUnit.position.hexKey);
    await nextFrame();
    expect(renderer.validMoves).toBeInstanceOf(Map);
  });

  it('tracks hovered hexes and exposes the legal path/cost, clearing on mouseleave', async () => {
    const ownUnit = ownUnits()[0];
    const startHex = ownUnit.position.hexKey;
    const destination = [...renderer.validMoves.keys()].find(key => key !== startHex);
    expect(destination).toBeTruthy();

    hoverHex(destination);
    await nextFrame();
    expect(renderer.hoveredHex).toBe(destination);
    expect(renderer.hoveredMove).toMatchObject({ hexKey: destination });
    expect(Array.isArray(renderer.hoveredMove.path)).toBe(true);
    expect(renderer.hoveredMove.path[renderer.hoveredMove.path.length - 1]).toBe(destination);
    expect(typeof renderer.hoveredMove.cost).toBe('number');

    document.getElementById('map-canvas').dispatchEvent(new MouseEvent('mouseleave'));
    expect(renderer.hoveredHex).toBeNull();
    expect(renderer.hoveredMove).toBeNull();
  });

  it('moves the Mech through the real click + Confirm Move path and keeps the flow going', async () => {
    const ownUnit = ownUnits()[0];
    const startHex = ownUnit.position.hexKey;
    const destination = [...renderer.validMoves.keys()].find(key => key !== startHex);

    clickHex(destination);
    await nextFrame();
    expect(logText()).toContain(`Move pending to ${destination}`);

    document.getElementById('btn-confirm-move').click();
    await nextFrame();
    expect(logText()).toContain(`moved to ${destination}`);

    // Hover state is cleared after the move.
    expect(renderer.hoveredHex).toBeNull();
    expect(renderer.hoveredMove).toBeNull();

    // The viewer's second Mech becomes the acting unit: the opponent's
    // declaration slot in between was passed, not a dead end.
    expect(lastRenderedState.currentPlayer).toBe(0);
    const nextUnit = ownUnits().find(unit => unit.id !== ownUnit.id);
    expect(nextUnit).toBeTruthy();
    clickHex(nextUnit.position.hexKey);
    await nextFrame();
    expect(renderer.selectedUnit).toBe(nextUnit.id);
    expect(renderer.validMoves).toBeInstanceOf(Map);
    expect(renderer.validMoves.size).toBeGreaterThan(1);
  });

  it('does not draw a movement preview when the movement-mode radio changes for a non-acting Mech', async () => {
    // Find the declaration-queue owner by observation: only the acting 'Mech
    // gets a reachable-hex preview through the real click path.
    const own = ownUnits();
    expect(own).toHaveLength(2);
    let actingUnit = null;
    let nonActingUnit = null;
    for (const unit of own) {
      clickHex(unit.position.hexKey);
      await nextFrame();
      if (renderer.validMoves instanceof Map) actingUnit = unit;
      else nonActingUnit = unit;
    }
    expect(actingUnit, 'one own Mech holds the movement declaration').toBeTruthy();
    expect(nonActingUnit, 'the other own Mech is not the acting unit').toBeTruthy();

    // Draw the acting Mech's preview, then move the selection: the previously
    // drawn preview must not survive the selection change.
    clickHex(actingUnit.position.hexKey);
    await nextFrame();
    expect(renderer.validMoves).toBeInstanceOf(Map);
    expect(renderer.validMoves.size).toBeGreaterThan(1);

    clickHex(nonActingUnit.position.hexKey);
    await nextFrame();
    expect(renderer.selectedUnit).toBe(nonActingUnit.id);
    expect(renderer.validMoves).toBeNull();

    // The reported bug: changing Walk/Run/Jump called the movement calculator
    // for whatever 'Mech was selected, drawing ~85 destinations on a non-acting
    // Mech that the engine then refuses to move. It must draw nothing now.
    for (const mode of ['run', 'jump']) {
      const radio = document.querySelector(`input[name="moveMode"][value="${mode}"]`);
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      await nextFrame();
      expect(renderer.validMoves, `no preview for a non-acting Mech in ${mode}`).toBeNull();
    }

    // Leave the panel on its default mode for any later test.
    const walkRadio = document.querySelector('input[name="moveMode"][value="walk"]');
    walkRadio.checked = true;
    walkRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  });
});
