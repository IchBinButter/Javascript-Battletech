/**
 * @vitest-environment jsdom
 *
 * Force Builder deployment sizes: two units a side must all reach the map, and
 * a large force must stay inside the loaded map. The old placement was
 * `col = 4 + i * 3` with no bound: on the 17-wide mapsheet the sixth 'Mech of a
 * side landed on `19,3`, a hex that does not exist, so it was in
 * `gameState.units` but could never be drawn or clicked.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  bootMain,
  openNewGame,
  addRosterUnit,
  clickStartGame,
  deployedUnits,
  allDeployedOnMap,
  isMapHex,
  logText
} from './helpers/bootMain.js';

let app = null;

afterAll(() => {
  if (app) app.restore();
});

describe('two units on each side', () => {
  beforeAll(async () => {
    app = await bootMain();
  });

  it('deploys both units per side, each on its own map hex', async () => {
    const builder = openNewGame();
    addRosterUnit(builder, 0, 'locust-lct1v');      // 20 t
    addRosterUnit(builder, 0, 'jenner-jr7d');       // 35 t
    addRosterUnit(builder, 1, 'awesome-aws8q');     // 80 t
    addRosterUnit(builder, 1, 'stalker-stk3f');     // 85 t

    await clickStartGame(builder);

    const units = deployedUnits(app.state);
    expect(units.map(u => ({ name: u.name, tonnage: u.tonnage, player: u.player }))).toEqual([
      { name: 'Locust LCT-1V', tonnage: 20, player: 0 },
      { name: 'Jenner JR7-D', tonnage: 35, player: 0 },
      { name: 'Awesome AWS-8Q', tonnage: 80, player: 1 },
      { name: 'Stalker STK-3F', tonnage: 85, player: 1 }
    ]);

    // Unique instance ids and distinct, real map hexes.
    expect(new Set(units.map(u => u.id)).size).toBe(4);
    expect(new Set(units.map(u => u.hexKey)).size).toBe(4);
    expect(allDeployedOnMap(app.state)).toBe(true);
    expect(units.slice(0, 2).every(u => u.hexKey.endsWith(',3'))).toBe(true);
    expect(units.slice(2).every(u => u.hexKey.endsWith(',11'))).toBe(true);

    expect(logText()).toContain('4 BattleMechs deployed');
    expect(logText()).not.toMatch(/default/i);
  });
});

describe('a force larger than one row', () => {
  beforeAll(async () => {
    vi.resetModules();
    if (app) app.restore();
    app = await bootMain();
  });

  it('wraps the formation onto further rows instead of placing units off-map', async () => {
    const builder = openNewGame();
    for (const mechId of [
      'atlas-as7d', 'jenner-jr7d', 'locust-lct1v',
      'shadowhawk-shd2h', 'griffin-grf1n', 'warhammer-whm6d'
    ]) {
      addRosterUnit(builder, 0, mechId);
    }

    await clickStartGame(builder);

    const units = deployedUnits(app.state);
    expect(units).toHaveLength(6);
    expect(units.every(u => u.player === 0)).toBe(true);
    expect(new Set(units.map(u => u.hexKey)).size).toBe(6);
    expect(allDeployedOnMap(app.state)).toBe(true);
    expect(units.every(u => isMapHex(app.state, u.hexKey))).toBe(true);
    // Every unit was placed on the player's own half of the map.
    for (const unit of units) {
      const row = Number(unit.hexKey.split(',')[1]);
      expect(row).toBeLessThan(Math.floor(app.state.map.height / 2));
    }
    expect(logText()).toContain('6 BattleMechs deployed');
    expect(logText()).not.toMatch(/default/i);
  });
});
