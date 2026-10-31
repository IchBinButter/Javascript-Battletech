/**
 * @vitest-environment jsdom
 *
 * Opening the Force Builder a second time (New Game -> Cancel -> New Game) must
 * start from a clean force and a single builder. The start menu is rebuilt on
 * every visit, so this also protects the menu's teardown from leaving a stale
 * key handler or a second builder behind.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootMain,
  openNewGame,
  addRosterUnit,
  clickStartGame,
  forceBuilderContainers,
  deployedUnits,
  logText
} from './helpers/bootMain.js';

let app;

beforeAll(async () => {
  app = await bootMain();
});

afterAll(() => {
  if (app) app.restore();
});

describe('re-opening the Force Builder', () => {
  it('starts clean after Cancel and still deploys the new selection', async () => {
    const firstBuilder = openNewGame();
    addRosterUnit(firstBuilder, 0, 'locust-lct1v');

    firstBuilder.querySelector('.fb-cancel').click();

    // Back on the start menu with no builder left over.
    expect(forceBuilderContainers()).toHaveLength(0);
    expect(document.getElementById('start-menu-overlay').style.display).toBe('flex');
    expect(document.querySelectorAll('.sm-menu-item')).toHaveLength(4);

    const secondBuilder = openNewGame();
    expect(forceBuilderContainers()).toHaveLength(1);

    // The cancelled force did not leak into the new builder.
    expect(secondBuilder.querySelector('#fb-unit-list-0').textContent).toContain('No units added');
    expect(secondBuilder.querySelector('#fb-tonnage-0').textContent).toBe('Tonnage: 0 tons');

    addRosterUnit(secondBuilder, 1, 'awesome-aws8q');
    await clickStartGame(secondBuilder);

    expect(deployedUnits(app.state).map(u => ({ name: u.name, tonnage: u.tonnage, player: u.player }))).toEqual([
      { name: 'Awesome AWS-8Q', tonnage: 80, player: 1 }
    ]);
    expect(forceBuilderContainers()).toHaveLength(0);
    expect(logText()).toContain('1 BattleMechs deployed');
    expect(logText()).not.toMatch(/default/i);
  });
});
