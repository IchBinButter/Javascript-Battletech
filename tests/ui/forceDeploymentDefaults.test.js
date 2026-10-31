/**
 * @vitest-environment jsdom
 *
 * The zero-unit fallback is still supported: starting a game with an empty
 * Force Builder deploys the four default 'Mechs (Atlas + Jenner vs Wolverine +
 * Thunderbolt) so a new player can always get into a game. What it must not do
 * is stay silent about it - live play mistook the fallback for "my selection
 * was ignored", so the dice log has to say plainly that defaults were used.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };
import {
  bootMain,
  openNewGame,
  clickStartGame,
  deployedUnits,
  allDeployedOnMap,
  logText
} from './helpers/bootMain.js';

let app;

beforeAll(async () => {
  app = await bootMain();
});

afterAll(() => {
  if (app) app.restore();
});

describe('empty Force Builder', () => {
  it('deploys the four defaults and says so in the log', async () => {
    openNewGame(); // nothing added
    await clickStartGame();

    const defaults = mechsData.mechs.slice(0, 4);
    const units = deployedUnits(app.state);

    expect(units.map(u => ({ name: u.name, tonnage: u.tonnage, player: u.player }))).toEqual(
      defaults.map((def, index) => ({
        name: def.name,
        tonnage: def.tonnage,
        player: index < 2 ? 0 : 1
      }))
    );
    expect(allDeployedOnMap(app.state)).toBe(true);

    // The log must name the fallback rather than looking like a real deployment.
    expect(logText()).toContain('4 BattleMechs deployed');
    expect(logText()).toMatch(/default/i);
    expect(logText()).toContain('No BattleMechs were selected');
    expect(app.alertSpy).not.toHaveBeenCalled();
  });
});
