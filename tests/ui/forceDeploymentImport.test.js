/**
 * @vitest-environment jsdom
 *
 * Import Force (.mul) must put the imported 'Mechs in the roster the map
 * deploys. The old `_importForceFromFile` called
 * `parseMULToUnits(text, this.mechsData)` - the roster belongs in the THIRD
 * argument - so the roster lookup was skipped and every imported unit became a
 * weaponless stub, then got wrapped in a second Unit on top. Nothing reached
 * the map with the stats the file described.
 *
 * This drives the real "Import Force" button and its FileReader path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  bootMain,
  openNewGame,
  clickStartGame,
  deployedUnits,
  allDeployedOnMap,
  waitFor,
  logText
} from './helpers/bootMain.js';

const TWO_MECH_MUL = `<?xml version="1.0" encoding="UTF-8"?>
<MUL>
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100">
    <Pilot gunnery="3" piloting="4" />
  </Unit>
  <Unit id="1" chassis="Jenner" model="JR7-D" tonnage="35">
    <Pilot gunnery="4" piloting="5" />
  </Unit>
</MUL>`;

let app;

beforeAll(async () => {
  app = await bootMain();
});

afterAll(() => {
  if (app) app.restore();
});

/**
 * Click the real Import Force button for `playerIndex` and hand the detached
 * file input the given file. The Force Builder creates that input itself and
 * clicks it; jsdom cannot open a picker, so the input is captured on creation
 * and a real `change` event is dispatched with a real File.
 */
function importForce(container, playerIndex, text) {
  const originalCreateElement = document.createElement.bind(document);
  let fileInput = null;
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = originalCreateElement(tag, options);
    if (String(tag).toLowerCase() === 'input') fileInput = element;
    return element;
  });

  const button = container.querySelectorAll('.fb-import-force')[playerIndex];
  expect(button, `player ${playerIndex} has an Import Force button`).toBeTruthy();
  button.click();
  spy.mockRestore();

  expect(fileInput, 'Import Force creates a file input').not.toBeNull();
  const file = new File([text], 'force.mul', { type: 'text/xml' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new Event('change'));
}

describe('Import Force', () => {
  it('deploys the imported roster units with their real stats and player', async () => {
    const builder = openNewGame();
    importForce(builder, 1, TWO_MECH_MUL);

    // FileReader + dynamic import: wait for the roster list to fill.
    await waitFor(() => builder.querySelectorAll('#fb-unit-list-1 .fb-unit-item').length === 2);
    expect(builder.querySelector('#fb-tonnage-1').textContent).toBe('Tonnage: 135 tons');

    await clickStartGame(builder);

    const units = deployedUnits(app.state);
    expect(units.map(u => ({ name: u.name, tonnage: u.tonnage, player: u.player }))).toEqual([
      { name: 'Atlas AS7-D', tonnage: 100, player: 1 },
      { name: 'Jenner JR7-D', tonnage: 35, player: 1 }
    ]);
    expect(allDeployedOnMap(app.state)).toBe(true);

    // Imported units must be the roster machines, not empty stubs: the Atlas
    // carries its weapons, armor and the pilot skills from the MUL.
    const [atlas, jenner] = Object.values(app.state.units);
    expect(atlas.equipment.weapons.length).toBeGreaterThan(0);
    expect(atlas.armor.head.front).toBe(9);
    expect(atlas.pilot).toMatchObject({ gunnery: 3, piloting: 4 });
    expect(jenner.equipment.weapons.length).toBeGreaterThan(0);
    expect(jenner.pilot).toMatchObject({ gunnery: 4, piloting: 5 });

    expect(logText()).toContain('2 BattleMechs deployed');
    expect(app.alertSpy).not.toHaveBeenCalled();
  });
});
