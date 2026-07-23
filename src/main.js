/**
 * BattleTech Tabletop Simulator - Main Entry Point
 * Integrates game engine, map renderer, and UI controller.
 */
import { HexGrid } from './hex/HexGrid.js';
import { pixelToHex } from './hex/HexMath.js';
import { Unit } from './models/Unit.js';
import { GameState } from './models/GameState.js';
import { Weapon } from './models/Weapon.js';
import { GameEngine } from './engine/GameEngine.js';
import { MapRenderer } from './renderer/MapRenderer.js';
import { UIController } from './ui/UIController.js';

// ---- Globals ----
const HEX_SIZE = 30;
let gameEngine;
let mapRenderer;
let ui;
let weaponsLookup;

// Canvas setup
const canvas = document.getElementById('map-canvas');

function resizeCanvas() {
  const container = document.getElementById('map-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  if (mapRenderer) {
    mapRenderer.canvas = canvas;
    mapRenderer.ctx = canvas.getContext('2d');
  }
}

// ---- Data loading ----
async function loadJSON(path) {
  const resp = await fetch(path);
  return resp.json();
}

// ---- Initialize ----
async function init() {
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (gameEngine && mapRenderer) {
      mapRenderer.render(gameEngine.stateManager.getState());
    }
  });

  // Load all data
  let mechsData, weaponsData, hitTables;
  try {
    [mechsData, weaponsData, hitTables] = await Promise.all([
      loadJSON('src/data/mechs.json'),
      loadJSON('src/data/weapons.json'),
      loadJSON('src/data/hitTables.json')
    ]);
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('dice-log').innerHTML = '<div class="log-entry miss">ERROR: Failed to load game data files</div>';
    return;
  }

  // Build weapon lookup
  weaponsLookup = Weapon.createLookup(weaponsData);

  // Create map
  const hexGrid = HexGrid.createDefaultMap();

  // Create game state
  const gameState = new GameState({
    players: [
      { id: 0, name: 'Player 1', homeEdge: 'north' },
      { id: 1, name: 'Player 2', homeEdge: 'south' }
    ]
  });
  gameState.map = { width: 17, height: 15, hexes: hexGrid.hexes };

  // Create units
  const atlas = new Unit(mechsData.mechs[0], 0, 'atlas-0');
  atlas.position.hexKey = '6,3';
  atlas.position.facing = 3;

  const jenner = new Unit(mechsData.mechs[1], 0, 'jenner-0');
  jenner.position.hexKey = '10,3';
  jenner.position.facing = 3;

  const wolverine = new Unit(mechsData.mechs[2], 1, 'wolverine-1');
  wolverine.position.hexKey = '6,12';
  wolverine.position.facing = 0;

  const thunderbolt = new Unit(mechsData.mechs[3], 1, 'thunderbolt-1');
  thunderbolt.position.hexKey = '10,12';
  thunderbolt.position.facing = 0;

  gameState.addUnit(atlas);
  gameState.addUnit(jenner);
  gameState.addUnit(wolverine);
  gameState.addUnit(thunderbolt);

  // Initialize game engine
  gameEngine = new GameEngine(gameState);
  gameEngine.initCombat(hitTables);
  gameEngine._weaponsData = weaponsLookup;

  // Initialize renderer
  mapRenderer = new MapRenderer(canvas, HEX_SIZE);

  // Initialize UI
  ui = new UIController();
  ui.init(gameEngine, mapRenderer);

  // Trigger initial phase to set up phase buttons
  gameEngine.phaseManager.enterPhase('initiative');

  // Hook up render updates
  gameEngine.eventBus.on('phaseChanged', () => {
    mapRenderer.render(gameEngine.stateManager.getState());
  });
  gameEngine.eventBus.on('unitMoved', () => {
    mapRenderer.render(gameEngine.stateManager.getState());
  });
  gameEngine.eventBus.on('damageApplied', () => {
    mapRenderer.render(gameEngine.stateManager.getState());
  });
  gameEngine.eventBus.on('unitDestroyed', () => {
    mapRenderer.render(gameEngine.stateManager.getState());
  });

  // Initial render
  updateUI();
  mapRenderer.render(gameState);

  ui.log('BattleTech Tabletop Simulator initialized!');
  ui.log('Map: 17×15 hex grid with 4 BattleMechs');
  ui.log('Atlas AS7-D + Jenner JR7-D vs Wolverine WVR-6R + Thunderbolt TDR-5S');
  ui.log('Click a Mech to select it. Arrow keys to pan.');
  ui.log('Click "Roll Initiative" to start the turn sequence.');
}

// ---- Interaction ----
canvas.addEventListener('click', (event) => {
  const state = gameEngine.stateManager.getState();
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left - mapRenderer.offsetX;
  const py = event.clientY - rect.top - mapRenderer.offsetY;
  const hexKey = pixelToHex(px, py, mapRenderer.hexSize);

  const hex = state.map.hexes.get(hexKey);
  if (!hex) return;

  // Check if clicking on a unit
  const unitOnHex = Object.values(state.units).find(u => u.position.hexKey === hexKey);

  if (unitOnHex) {
    // If a friendly unit is selected and clicking an enemy, treat as target
    if (ui.selectedUnitId && ui.selectedUnitId !== unitOnHex.id) {
      const selectedUnit = state.getUnit(ui.selectedUnitId);
      const clickedUnit = unitOnHex;
      if (selectedUnit && clickedUnit.player !== selectedUnit.player) {
        ui._pendingTarget = unitOnHex.id;
        ui.log(`Target selected: ${clickedUnit.name}`);
        mapRenderer.selectedUnit = ui.selectedUnitId;
        mapRenderer.render(state);

        if (ui.weaponFireMode) {
          const checks = document.querySelectorAll('.weapon-check:checked');
          for (const check of checks) {
            const weaponType = check.dataset.type;
            const weaponDef = weaponsLookup[weaponType];
            if (!weaponDef) continue;

            const result = gameEngine.processAction(state.currentPlayer, {
              type: 'fire',
              attackerId: selectedUnit.id,
              targetId: clickedUnit.id,
              weapon: weaponDef,
              weaponLocation: check.dataset.location,
              ammoBin: check.dataset.ammo || null
            });

            if (result.error) {
              ui.log(`Fire error: ${result.error}`, 'miss');
            }
          }
          mapRenderer.render(gameEngine.stateManager.getState());
          ui.updateUnitPanel(selectedUnit);
        }
        return;
      }
    }

    // Normal selection
    mapRenderer.selectedUnit = unitOnHex.id;
    ui.updateUnitPanel(unitOnHex);
    mapRenderer.render(state);
    return;
  }

  // Clicked empty hex - handle movement
  if (ui.weaponFireMode) {
    ui.weaponFireMode = false;
    ui.weaponPanel.style.display = 'none';
    ui.log('Weapon fire cancelled', 'info');
    return;
  }

  if (state.phase === 'movement' && mapRenderer.selectedUnit) {
    // Clicked empty hex during movement phase
    // Move selected unit
    const unit = state.getUnit(mapRenderer.selectedUnit);
    if (unit && unit.player === state.currentPlayer) {
      const result = gameEngine.processAction(state.currentPlayer, {
        type: 'move',
        unitId: unit.id,
        path: [unit.position.hexKey, hexKey],
        movementType: ui.movementMode
      });

      if (result.error) {
        ui.log(`Movement error: ${result.error}`, 'miss');
      } else {
        ui.log(`Moved ${unit.name} to ${hexKey}`);
      }

      mapRenderer.render(gameEngine.stateManager.getState());
      ui.updateUnitPanel(unit);
    }
  }

  // Deselect if clicking empty hex during non-movement
  if (state.phase !== 'movement') {
    mapRenderer.selectedUnit = null;
    ui.updateUnitPanel(null);
    mapRenderer.render(state);
  }
});

// Mouse wheel pan
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  mapRenderer.offsetX -= event.deltaX;
  mapRenderer.offsetY -= event.deltaY;
  mapRenderer.render(gameEngine.stateManager.getState());
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
  const state = gameEngine.stateManager.getState();

  switch (event.key) {
    case 'ArrowUp': mapRenderer.offsetY += 20; break;
    case 'ArrowDown': mapRenderer.offsetY -= 20; break;
    case 'ArrowLeft': mapRenderer.offsetX += 20; break;
    case 'ArrowRight': mapRenderer.offsetX -= 20; break;
    case 'Escape':
      mapRenderer.selectedUnit = null;
      ui.updateUnitPanel(null);
      ui.weaponFireMode = false;
      ui.weaponPanel.style.display = 'none';
      break;
    case 'n':
      if (mapRenderer.selectedUnit) {
        const units = state.getPlayerUnits(state.currentPlayer);
        const idx = units.findIndex(u => u.id === mapRenderer.selectedUnit);
        if (idx >= 0 && idx < units.length - 1) {
          mapRenderer.selectedUnit = units[idx + 1].id;
          ui.updateUnitPanel(state.getUnit(units[idx + 1].id));
        }
      }
      break;
    case 'g':
      mapRenderer.showGrid = !mapRenderer.showGrid;
      break;
    default: return; // Only render if key was handled
  }
  mapRenderer.render(state);
});

function updateUI() {
  const state = gameEngine.stateManager.getState();
  document.getElementById('turn-label').textContent = `Turn: ${state.turn}`;
  document.getElementById('phase-label').textContent = `Phase: ${state.phase}`;
}

// Start
init();
