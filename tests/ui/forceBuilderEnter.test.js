/**
 * @vitest-environment jsdom
 *
 * Regression for the live-play report "whatever is chosen in the Force Builder,
 * the map always deploys the four defaults".
 *
 * Root cause: leaving the start menu never told the StartMenu it was hidden
 * (`showForceBuilder` only flipped the overlay's CSS). Its document-level key
 * handler still thought the menu was visible, so pressing Enter while filling in
 * the Force Builder - the natural way to confirm a player name or a roster
 * choice - silently ran "New Game" again and stacked a second, EMPTY Force
 * Builder on top of the first. Starting that one had no units, so startGame's
 * zero-unit fallback deployed the four defaults.
 *
 * This test types the player names, adds the units, presses Enter, and then
 * starts the game exactly as the visible Force Builder would. The deployed
 * force must be the picks, and only one Force Builder may ever be open.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootMain,
  openNewGame,
  addRosterUnit,
  setPlayerName,
  clickStartGame,
  forceBuilderContainers,
  deployedUnits,
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

describe('Enter in the Force Builder', () => {
  it('keeps the picks (and the single builder) instead of deploying the defaults', async () => {
    const builder = openNewGame();
    setPlayerName(builder, 0, 'Alpha Lance');
    setPlayerName(builder, 1, 'Beta Lance');
    addRosterUnit(builder, 0, 'locust-lct1v');   // 20 t
    addRosterUnit(builder, 1, 'awesome-aws8q');  // 80 t

    // A user confirming a text field or dropdown with Enter. The start menu is
    // hidden, so this must not run its New Game action again.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextFrame();

    // The user-visible symptom: the force they picked is still what starts.
    expect(forceBuilderContainers()).toHaveLength(1);
    expect(builder.querySelector('#fb-unit-list-0').textContent).toContain('Locust LCT-1V');
    expect(builder.querySelector('#fb-tonnage-0').textContent).toContain('20 tons');

    await clickStartGame();

    // Start Game hands over to the map: no builder survives over the game.
    expect(forceBuilderContainers()).toHaveLength(0);
    expect(document.getElementById('app').style.display).toBe('grid');
    expect(deployedUnits(app.state)).toEqual([
      { name: 'Locust LCT-1V', tonnage: 20, player: 0, id: 'unit-0', hexKey: '4,3' },
      { name: 'Awesome AWS-8Q', tonnage: 80, player: 1, id: 'unit-1', hexKey: '4,11' }
    ]);
    expect(app.state.players.map(p => p.name)).toEqual(['Alpha Lance', 'Beta Lance']);
    expect(logText()).toContain('2 BattleMechs deployed');
    expect(logText()).not.toMatch(/default/i);
    expect(app.alertSpy).not.toHaveBeenCalled();
  });
});
