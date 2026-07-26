/**
 * BattleTech Tabletop Simulator - Main Entry Point
 * Integrates start menu, force builder, game engine, map renderer, and UI controller.
 */
import { HexGrid } from './hex/HexGrid.js';
import { pixelToHex } from './hex/HexMath.js';
import { Unit } from './models/Unit.js';
import { GameState } from './models/GameState.js';
import { Weapon } from './models/Weapon.js';
import { GameEngine } from './engine/GameEngine.js';
import { MapRenderer } from './renderer/MapRenderer.js';
import { UIController } from './ui/UIController.js';
import { StartMenu } from './ui/StartMenu.js';
import { ForceBuilder } from './ui/ForceBuilder.js';

// ---- Globals ----
const HEX_SIZE = 30;
let gameEngine;
let mapRenderer;
let ui;
let weaponsLookup;
let mechsData, weaponsData, hitTables, mapsData;

// Canvas setup
const canvas = document.getElementById('map-canvas');
const app = document.getElementById('app');
const startMenuOverlay = document.getElementById('start-menu-overlay');

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

// ---- Show/hide game UI ----
function showGame() {
  startMenuOverlay.style.display = 'none';
  app.style.display = 'grid';
}

function hideGame() {
  app.style.display = 'none';
}

// ---- Initialize Game with Selected Forces ----
function startGame(forceBuilder) {
  const players = forceBuilder.getPlayers();
  const selectedMapId = forceBuilder.selectedMapId;

  // Create hex grid from selected map or default
  let hexGrid;
  if (selectedMapId && mapsData) {
    const mapDef = mapsData.maps.find(m => m.id === selectedMapId);
    if (mapDef) {
      hexGrid = new HexGrid(mapDef.width, mapDef.height);
      for (const [key, data] of Object.entries(mapDef.hexes)) {
        hexGrid.setHex(key, new (Object.getPrototypeOf(hexGrid).constructor === Function ? Object : Object).constructor(key, data));
      }
      // Use Hex class for proper hex objects
      const { Hex } = await import('./models/Hex.js');
      hexGrid = new HexGrid(mapDef.width, mapDef.height);
      for (const [key, data] of Object.entries(mapDef.hexes)) {
        hexGrid.setHex(key, new Hex(key, { terrainType: data.terrain, level: data.level || 0 }));
      }
    }
  }
  if (!hexGrid) {
    hexGrid = HexGrid.createDefaultMap();
  }

  // Create game state
  const gameState = new GameState({
    players: [
      { id: 0, name: players[0].name || 'Player 1', homeEdge: 'north' },
      { id: 1, name: players[1].name || 'Player 2', homeEdge: 'south' }
    ]
  });
  gameState.map = { width: hexGrid.width, height: hexGrid.height, hexes: hexGrid.hexes };

  // Create units from force builder selections
  let unitIndex = 0;
  for (let playerIdx = 0; playerIdx < 2; playerIdx++) {
    const player = players[playerIdx];
    const homeRow = playerIdx === 0 ? 3 : hexGrid.height - 4;
    const units = player.units || [];

    for (let i = 0; i < units.length; i++) {
      const mechDef = units[i];
      const unitId = `unit-${unitIndex++}`;
      const unit = new Unit(mechDef, playerIdx, unitId);

      // Place units in a row at their home edge
      const col = 4 + (i * 3);
      unit.position.hexKey = `${col},${homeRow}`;
      unit.position.facing = playerIdx === 0 ? 3 : 0; // Face toward enemy

      gameState.addUnit(unit);
    }
  }

  // If no units selected, use defaults
  if (Object.keys(gameState.units).length === 0) {
    const defaults = [
      { def: mechsData.mechs[0], player: 0, col: 6, row: 3, facing: 3 },
      { def: mechsData.mechs[1], player: 0, col: 10, row: 3, facing: 3 },
      { def: mechsData.mechs[2], player: 1, col: 6, row: 12, facing: 0 },
      { def: mechsData.mechs[3], player: 1, col: 10, row: 12, facing: 0 }
    ];
    for (const d of defaults) {
      const unit = new Unit(d.def, d.player, `default-${d.player}-${d.col}`);
      unit.position.hexKey = `${d.col},${d.row}`;
      unit.position.facing = d.facing;
      gameState.addUnit(unit);
    }
  }

  // Initialize game engine
  gameEngine = new GameEngine(gameState);
  gameEngine.initCombat(hitTables);
  gameEngine._weaponsData = weaponsLookup;

  // Initialize renderer
  mapRenderer = new MapRenderer(canvas, HEX_SIZE);

  // Initialize UI
  ui = new UIController();
  ui.init(gameEngine, mapRenderer);

  // Trigger initial phase
  gameEngine.phaseManager.enterPhase('initiative');

  // Hook up render updates
  gameEngine.eventBus.on('phaseChanged', () => {
    mapRenderer.render(gameEngine.stateManager.getState());
    updateUI();
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

  // Show game UI
  showGame();

  // Initial render
  updateUI();
  mapRenderer.render(gameState);

  const unitCount = Object.keys(gameState.units).length;
  ui.log(`BattleTech Tabletop Simulator started!`);
  ui.log(`${gameState.players[0].name} vs ${gameState.players[1].name}`);
  ui.log(`${unitCount} BattleMechs deployed`);
  ui.log('Click a Mech to select it. Arrow keys to pan.');
}

// ---- Start Menu Setup ----
function showStartMenu() {
  hideGame();

  const startMenu = new StartMenu({
    onNewGame: () => {
      showForceBuilder();
    },
    onLoadGame: () => {
      // TODO: Implement load game
      alert('Load game not yet implemented');
    }
  });
  startMenu.attach(startMenuOverlay);
  startMenuOverlay.style.display = 'flex';
  startMenu.show();
}

function showForceBuilder() {
  startMenuOverlay.style.display = 'none';

  // Create a temporary container for force builder
  const builderContainer = document.createElement('div');
  builderContainer.id = 'force-builder-container';
  builderContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;background:#1a1a2e;overflow:auto;';
  document.body.appendChild(builderContainer);

  const forceBuilder = new ForceBuilder({
    mechsData: mechsData,
    mapsData: mapsData,
    container: builderContainer,
    onStartGame: (players, selectedMapId) => {
      forceBuilder.selectedMapId = selectedMapId;
      builderContainer.remove();
      startGame(forceBuilder);
    },
    onCancel: () => {
      builderContainer.remove();
      showStartMenu();
    }
  });
}

// ---- Main Initialization ----
async function init() {
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (gameEngine && mapRenderer) {
      mapRenderer.render(gameEngine.stateManager.getState());
    }
  });

  // Load all data
  try {
    [mechsData, weaponsData, hitTables, mapsData] = await Promise.all([
      loadJSON('src/data/mechs.json'),
      loadJSON('src/data/weapons.json'),
      loadJSON('src/data/hitTables.json'),
      loadJSON('src/data/maps/index.json').catch(() => ({ maps: [] }))
    ]);
  } catch (e) {
    console.error('Failed to load data:', e);
    document.getElementById('dice-log').innerHTML = '<div class="log-entry miss">ERROR: Failed to load game data files</div>';
    return;
  }

  // Build weapon lookup
  weaponsLookup = Weapon.createLookup(weaponsData);

  // Show start menu
  showStartMenu();
}

// ---- Game Interaction (only active when game is running) ----
canvas.addEventListener('click', (event) => {
  if (!gameEngine) return;
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

    // Show movement preview for own units in movement phase
    if (state.phase === 'movement' && unitOnHex.player === state.currentPlayer) {
      const validMoves = gameEngine.movementCalc.getValidMoves(unitOnHex, state, ui.movementMode);
      mapRenderer.validMoves = validMoves;
      ui._pendingMove = null;
    } else {
      mapRenderer.validMoves = null;
    }

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
    const unit = state.getUnit(mapRenderer.selectedUnit);
    if (unit && unit.player === state.currentPlayer) {
      const validMoves = mapRenderer.validMoves;
      if (validMoves && validMoves.has(hexKey)) {
        const moveData = validMoves.get(hexKey);
        ui._pendingMove = {
          path: moveData.path,
          movementType: ui.movementMode
        };
        mapRenderer.hoveredHex = hexKey;
        ui.log(`Move pending to ${hexKey} (${moveData.cost} MP). Click Confirm Move.`);
      } else {
        ui.log('Cannot reach that hex', 'miss');
      }
      mapRenderer.render(state);
    }
    return;
  }

  // Deselect
  if (state.phase !== 'movement') {
    mapRenderer.selectedUnit = null;
    ui.updateUnitPanel(null);
    mapRenderer.validMoves = null;
    mapRenderer.render(state);
  }
});

// Mouse wheel pan
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (!mapRenderer) return;
  mapRenderer.offsetX -= event.deltaX;
  mapRenderer.offsetY -= event.deltaY;
  if (gameEngine) {
    mapRenderer.render(gameEngine.stateManager.getState());
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
  if (!gameEngine) return;
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
    default: return;
  }
  mapRenderer.render(state);
});

function updateUI() {
  if (!gameEngine) return;
  const state = gameEngine.stateManager.getState();
  document.getElementById('turn-label').textContent = `Turn: ${state.turn}`;
  document.getElementById('phase-label').textContent = `Phase: ${state.phase}`;
}

// Start
init();
