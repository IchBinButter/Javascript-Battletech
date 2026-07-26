/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForceBuilder } from '../../src/ui/ForceBuilder.js';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };
import mapsData from '../../src/data/maps/index.json' with { type: 'json' };

function createDOMFixture() {
  document.body.innerHTML = '<div id="force-builder-container"></div>';
  return document.getElementById('force-builder-container');
}

describe('ForceBuilder', () => {
  let builder, container;

  beforeEach(() => {
    container = createDOMFixture();
    builder = new ForceBuilder({
      mechsData,
      mapsData,
      container,
      onStartGame: vi.fn(),
      onCancel: vi.fn()
    });
  });

  describe('layout rendering', () => {
    it('renders two player columns', () => {
      const columns = container.querySelectorAll('.fb-column');
      expect(columns.length).toBe(2);
    });

    it('renders player name inputs with default values', () => {
      const inputs = container.querySelectorAll('.fb-player-name');
      expect(inputs.length).toBe(2);
      expect(inputs[0].value).toBe('Player 1');
      expect(inputs[1].value).toBe('Player 2');
    });

    it('renders tonnage displays for both players', () => {
      expect(container.querySelector('#fb-tonnage-0')).not.toBeNull();
      expect(container.querySelector('#fb-tonnage-1')).not.toBeNull();
      expect(container.querySelector('#fb-tonnage-0').textContent).toBe('Tonnage: 0 tons');
    });

    it('renders import mech buttons for both players', () => {
      const btns = container.querySelectorAll('.fb-import-mech');
      expect(btns.length).toBe(2);
      expect(btns[0].dataset.player).toBe('0');
      expect(btns[1].dataset.player).toBe('1');
    });

    it('renders import force buttons for both players', () => {
      const btns = container.querySelectorAll('.fb-import-force');
      expect(btns.length).toBe(2);
    });

    it('renders mech select dropdowns with roster entries', () => {
      const selects = container.querySelectorAll('.fb-mech-select');
      expect(selects.length).toBe(2);

      const expectedCount = mechsData.mechs.length + 1; // +1 for placeholder
      expect(selects[0].options.length).toBe(expectedCount);
    });

    it('renders add buttons for both players', () => {
      const btns = container.querySelectorAll('.fb-add-mech');
      expect(btns.length).toBe(2);
    });

    it('renders map selection dropdown with all maps', () => {
      const mapSelect = container.querySelector('.fb-map-select');
      expect(mapSelect).not.toBeNull();
      expect(mapSelect.options.length).toBe(mapsData.maps.length);
    });

    it('renders start game button', () => {
      const btn = container.querySelector('.fb-start-game');
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('Start Game');
    });

    it('renders cancel button when onCancel provided', () => {
      const btn = container.querySelector('.fb-cancel');
      expect(btn).not.toBeNull();
    });

    it('renders empty unit lists initially', () => {
      expect(container.querySelector('#fb-unit-list-0').innerHTML).toContain('No units added');
      expect(container.querySelector('#fb-unit-list-1').innerHTML).toContain('No units added');
    });
  });

  describe('player name input', () => {
    it('updates player name on input', () => {
      const input = container.querySelectorAll('.fb-player-name')[0];
      input.value = 'Commander Shepard';
      input.dispatchEvent(new Event('input'));

      expect(builder.players[0].name).toBe('Commander Shepard');
    });

    it('falls back to default name when input cleared', () => {
      const input = container.querySelectorAll('.fb-player-name')[1];
      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(builder.players[1].name).toBe('Player 2');
    });
  });

  describe('adding mechs from roster', () => {
    it('adds a mech to player 1 when add button is clicked', () => {
      const select = container.querySelector('#fb-mech-select-0');
      select.value = 'atlas-as7d';

      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      addBtn.click();

      expect(builder.players[0].units.length).toBe(1);
      expect(builder.players[0].units[0].name).toBe('Atlas AS7-D');
      expect(builder.players[0].units[0].tonnage).toBe(100);
    });

    it('adds a mech to player 2 when their add button is clicked', () => {
      const select = container.querySelector('#fb-mech-select-1');
      select.value = 'locust-lct1v';

      const addBtn = container.querySelectorAll('.fb-add-mech')[1];
      addBtn.click();

      expect(builder.players[1].units.length).toBe(1);
      expect(builder.players[1].units[0].name).toBe('Locust LCT-1V');
      expect(builder.players[1].units[0].tonnage).toBe(20);
    });

    it('does nothing when no mech selected', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      addBtn.click();

      expect(builder.players[0].units.length).toBe(0);
    });

    it('clears the select after adding a mech', () => {
      const select = container.querySelector('#fb-mech-select-0');
      select.value = 'warhammer-whm6d';

      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      addBtn.click();

      expect(select.value).toBe('');
    });
  });

  describe('tonnage counter', () => {
    it('updates tonnage counter when mechs are added', () => {
      const select = container.querySelector('#fb-mech-select-0');
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];

      select.value = 'atlas-as7d'; // 100t
      addBtn.click();
      select.value = 'jenner-jr7d'; // 35t
      addBtn.click();

      expect(container.querySelector('#fb-tonnage-0').textContent).toBe('Tonnage: 135 tons');
    });

    it('starts at zero', () => {
      expect(builder.getTotalTonnage(0)).toBe(0);
      expect(builder.getTotalTonnage(1)).toBe(0);
    });

    it('getTotalTonnage returns correct sum', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[1];
      const select = container.querySelector('#fb-mech-select-1');

      select.value = 'wolverine-wvr6r'; // 55t
      addBtn.click();
      select.value = 'thunderbolt-tdr5s'; // 65t
      addBtn.click();

      expect(builder.getTotalTonnage(1)).toBe(120);
    });
  });

  describe('removing units', () => {
    it('removes a unit when remove button is clicked', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');

      select.value = 'atlas-as7d';
      addBtn.click();
      select.value = 'jenner-jr7d';
      addBtn.click();

      expect(builder.players[0].units.length).toBe(2);

      const removeBtn = container.querySelector('#fb-unit-list-0').querySelector('.fb-remove-unit');
      removeBtn.click();

      expect(builder.players[0].units.length).toBe(1);
    });

    it('updates tonnage after removal', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');

      select.value = 'atlas-as7d'; // 100t
      addBtn.click();
      select.value = 'jenner-jr7d'; // 35t
      addBtn.click();

      const firstRemove = container.querySelector('#fb-unit-list-0').querySelector('.fb-remove-unit');
      firstRemove.click();

      expect(container.querySelector('#fb-tonnage-0').textContent).toBe('Tonnage: 35 tons');
    });

    it('shows empty state after all units removed', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');

      select.value = 'atlas-as7d';
      addBtn.click();

      const removeBtn = container.querySelector('#fb-unit-list-0').querySelector('.fb-remove-unit');
      removeBtn.click();

      expect(container.querySelector('#fb-unit-list-0').innerHTML).toContain('No units added');
    });
  });

  describe('map selection', () => {
    it('selects first map by default', () => {
      expect(builder.selectedMapId).toBe(mapsData.maps[0].id);
    });

    it('updates selected map on dropdown change', () => {
      const mapSelect = container.querySelector('.fb-map-select');
      const forestMap = mapsData.maps.find(m => m.id === 'forest');
      mapSelect.value = 'forest';
      mapSelect.dispatchEvent(new Event('change'));

      expect(builder.selectedMapId).toBe('forest');
    });

    it('getSelectedMapId returns current selection', () => {
      expect(builder.getSelectedMapId()).toBe(mapsData.maps[0].id);
    });
  });

  describe('start game', () => {
    it('calls onStartGame callback with player data and map', () => {
      const onStartGame = builder.onStartGame;

      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');
      select.value = 'atlas-as7d';
      addBtn.click();

      const startBtn = container.querySelector('.fb-start-game');
      startBtn.click();

      expect(onStartGame).toHaveBeenCalledTimes(1);
      const callData = onStartGame.mock.calls[0][0];
      expect(callData.players.length).toBe(2);
      expect(callData.players[0].units.length).toBe(1);
      expect(callData.players[0].name).toBe('Player 1');
      expect(callData.selectedMapId).toBe(mapsData.maps[0].id);
    });

    it('includes player names in start data', () => {
      const onStartGame = builder.onStartGame;

      const nameInput = container.querySelectorAll('.fb-player-name')[0];
      nameInput.value = 'Alpha Lance';
      nameInput.dispatchEvent(new Event('input'));

      const startBtn = container.querySelector('.fb-start-game');
      startBtn.click();

      expect(onStartGame.mock.calls[0][0].players[0].name).toBe('Alpha Lance');
    });
  });

  describe('cancel', () => {
    it('calls onCancel when cancel button clicked', () => {
      const onCancel = builder.onCancel;
      const cancelBtn = container.querySelector('.fb-cancel');
      cancelBtn.click();

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPlayerUnits', () => {
    it('returns a copy of player units', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');

      select.value = 'atlas-as7d';
      addBtn.click();

      const units = builder.getPlayerUnits(0);
      expect(units.length).toBe(1);
      expect(units[0].name).toBe('Atlas AS7-D');
    });

    it('returns empty array for player with no units', () => {
      expect(builder.getPlayerUnits(1)).toEqual([]);
    });
  });

  describe('getPlayers', () => {
    it('returns player names and units copies', () => {
      const players = builder.getPlayers();
      expect(players.length).toBe(2);
      expect(players[0].name).toBe('Player 1');
      expect(players[0].units).toEqual([]);
    });
  });

  describe('reset', () => {
    it('clears all units and resets to defaults', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');
      select.value = 'atlas-as7d';
      addBtn.click();

      expect(builder.players[0].units.length).toBe(1);

      builder.reset();

      expect(builder.players[0].units.length).toBe(0);
      expect(builder.players[0].name).toBe('Player 1');
      expect(builder.players[1].name).toBe('Player 2');
      expect(builder.selectedMapId).toBe(mapsData.maps[0].id);
    });

    it('rebuilds UI on reset', () => {
      builder.reset();

      expect(container.querySelectorAll('.fb-column').length).toBe(2);
      expect(container.querySelector('.fb-start-game')).not.toBeNull();
    });
  });

  describe('unit IDs', () => {
    it('generates unique IDs for each unit', () => {
      const addBtn = container.querySelectorAll('.fb-add-mech')[0];
      const select = container.querySelector('#fb-mech-select-0');

      select.value = 'atlas-as7d';
      addBtn.click();
      select.value = 'jenner-jr7d';
      addBtn.click();

      expect(builder.players[0].units[0].id).not.toBe(builder.players[0].units[1].id);
    });

    it('assigns correct player ID to units', () => {
      const addBtn0 = container.querySelectorAll('.fb-add-mech')[0];
      const addBtn1 = container.querySelectorAll('.fb-add-mech')[1];
      const select0 = container.querySelector('#fb-mech-select-0');
      const select1 = container.querySelector('#fb-mech-select-1');

      select0.value = 'atlas-as7d';
      addBtn0.click();
      select1.value = 'wolverine-wvr6r';
      addBtn1.click();

      expect(builder.players[0].units[0].player).toBe(0);
      expect(builder.players[1].units[0].player).toBe(1);
    });
  });
});
