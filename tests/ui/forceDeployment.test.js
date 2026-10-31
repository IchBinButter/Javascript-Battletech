/**
 * @vitest-environment jsdom
 *
 * Regression: the 'Mechs chosen in the Force Builder must be the 'Mechs the map
 * deploys. This boots the real src/main.js against the real index.html markup,
 * opens New Game, builds a 1v1 force through the Force Builder's DOM controls,
 * and asserts what the map was actually handed: count, names, tonnage, player,
 * map-legal deployment hexes, and that the tokens were drawn and are clickable.
 *
 * The old zero-unit fallback (src/main.js "If no units selected") silently
 * deployed Atlas + Jenner vs Wolverine + Thunderbolt; live play reported that
 * as "whatever I pick, I always get the four defaults". The fallback is still
 * there for an empty force, but it must never replace a real selection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hexToPixel } from '../../src/hex/HexMath.js';
import {
  bootMain,
  openNewGame,
  addRosterUnit,
  setPlayerName,
  clickStartGame,
  forceBuilderContainers,
  deployedUnits,
  allDeployedOnMap,
  isMapHex,
  logText,
  nextFrame
} from './helpers/bootMain.js';

let app;

beforeAll(async () => {
  app = await bootMain();
});

afterAll(() => {
  if (app) app.restore();
});

describe('Force Builder selections reach the map', () => {
  it('deploys exactly the units chosen for each side, with names/tonnage/player', async () => {
    const builder = openNewGame();
    setPlayerName(builder, 0, 'Alpha Lance');
    setPlayerName(builder, 1, 'Beta Lance');

    // Deliberately not any of the four defaults, so a fallback cannot alias.
    addRosterUnit(builder, 0, 'locust-lct1v');   // 20 t
    addRosterUnit(builder, 1, 'awesome-aws8q');  // 80 t

    await clickStartGame(builder);

    // Starting must hand over to the game: the builder is gone, the map is up.
    expect(forceBuilderContainers()).toHaveLength(0);
    expect(document.getElementById('app').style.display).toBe('grid');

    expect(app.state).not.toBeNull();
    expect(deployedUnits(app.state)).toEqual([
      { name: 'Locust LCT-1V', tonnage: 20, player: 0, id: 'unit-0', hexKey: '4,3' },
      { name: 'Awesome AWS-8Q', tonnage: 80, player: 1, id: 'unit-1', hexKey: '4,11' }
    ]);

    // The typed player names travelled with the force.
    expect(app.state.players.map(p => p.name)).toEqual(['Alpha Lance', 'Beta Lance']);

    // Every 'Mech stands on its own side's starting edge, on a hex that exists.
    expect(allDeployedOnMap(app.state)).toBe(true);
    const [own, enemy] = Object.values(app.state.units);
    expect(own.position.hexKey.endsWith(',3')).toBe(true);
    expect(enemy.position.hexKey.endsWith(',11')).toBe(true);
    expect(isMapHex(app.state, own.position.hexKey)).toBe(true);
    expect(isMapHex(app.state, enemy.position.hexKey)).toBe(true);
    expect(own.position.hexKey).not.toBe(enemy.position.hexKey);

    // The fallback log must not claim defaults were used for a real selection.
    expect(logText()).toContain('2 BattleMechs deployed');
    expect(logText()).not.toMatch(/default/i);

    // The renderer drew both tokens (abbreviation of the unit name).
    await nextFrame();
    const drawnText = app.canvasStub.ctx.texts().join(' ');
    expect(drawnText).toContain('LOC');
    expect(drawnText).toContain('AWE');

    // And the deployed 'Mechs are clickable on the canvas: the hex the map took
    // from the state is the hex the player sees.
    const canvas = document.getElementById('map-canvas');
    const pos = hexToPixel(own.position.hexKey, app.renderer.hexSize);
    canvas.dispatchEvent(new MouseEvent('click', {
      clientX: pos.x + app.renderer.offsetX,
      clientY: pos.y + app.renderer.offsetY,
      bubbles: true
    }));
    await nextFrame();
    expect(document.getElementById('unit-details').textContent).toContain('Locust LCT-1V');
    expect(app.alertSpy).not.toHaveBeenCalled();
  });
});
