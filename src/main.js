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
import { projectStateForPlayer } from './engine/visibility.js';
import { MapRenderer } from './renderer/MapRenderer.js';
import { UIController } from './ui/UIController.js';
import { StartMenu } from './ui/StartMenu.js';
import { ForceBuilder } from './ui/ForceBuilder.js';

// ---- Globals ----
const HEX_SIZE = 30;
// Solo play looks at the game through player 0's eyes. The projection removes
// hidden enemy units, so they never reach the renderer, the UI or a click test.
const VIEWER_ID = 0;
let gameEngine;
let mapRenderer;
let ui;
let weaponsLookup;
let mechsData, weaponsData, hitTables, mapsData;

// Canvas setup
const canvas = document.getElementById('map-canvas');
const app = document.getElementById('app');
const startMenuOverlay = document.getElementById('start-menu-overlay');


/** Reference to the resize handler so it can be removed for cleanup. */
let _resizeHandler = null;
/** Reference to the keydown handler so it can be removed for cleanup. */
let _keydownHandler = null;

function resizeCanvas() {
  const container = document.getElementById('map-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  if (mapRenderer) {
    mapRenderer.canvas = canvas;
    mapRenderer.ctx = canvas.getContext('2d');
  }
}

/** Clean up state from a previous game before starting a new one. */
function teardownGame() {
  if (gameEngine) {
    gameEngine.eventBus.removeAllListeners();
  }
  gameEngine = null;
  mapRenderer = null;
  if (ui) {
    try { ui.destroy(); } catch (_) { /* ignore */ }
    ui = null;
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

/**
 * The state the local viewer is allowed to see (R1 projection, p82).
 * Every render, hit test and keyboard selection reads this rather than
 * gameEngine.stateManager.getState(), so a hidden unit cannot leak.
 */
function viewState() {
  if (!gameEngine) return null;
  return projectStateForPlayer(gameEngine.stateManager.getState(), VIEWER_ID);
}

// ---- Initialize Game with Selected Forces ----
async function startGame(forceBuilder) {
  // Clean up any previous game to prevent listener leaks and stale references
  teardownGame();

  const players = forceBuilder.getPlayers();
  const selectedMapId = forceBuilder.selectedMapId;

  // Create hex grid from selected map or default
  let hexGrid;
  if (selectedMapId && mapsData) {
    // maps/index.json only lists the maps; the hexes live in the map file.
    const entry = mapsData.maps.find(m => m.id === selectedMapId);
    if (entry) {
      try {
        const mapDef = entry.file ? await loadJSON(`src/data/maps/${entry.file}`) : entry;
        const { Hex } = await import('./models/Hex.js');
        const { BuildingRegistry } = await import('./rules/urban/Buildings.js');
        hexGrid = new HexGrid(mapDef.width, mapDef.height);
        for (const [key, data] of Object.entries(mapDef.hexes || {})) {
          hexGrid.setHex(key, new Hex(key, { terrainType: data.terrain, level: data.level || 0 }));
        }
        // Buildings become per-hex objects so LOS, rendering and the urban
        // rules all read the same CF/level data (p66).
        BuildingRegistry.fromMap(mapDef).applyToHexes(hexGrid.hexes);
      } catch (error) {
        console.error(`Could not load map "${selectedMapId}":`, error);
        hexGrid = undefined;
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
  // Reuse Unit instances directly instead of double-wrapping them in new Unit()
  let unitIndex = 0;
  for (let playerIdx = 0; playerIdx < 2; playerIdx++) {
    const player = players[playerIdx];
    const homeRow = playerIdx === 0 ? 3 : hexGrid.height - 4;
    const units = player.units || [];

    for (let i = 0; i < units.length; i++) {
      const unit = units[i]; // already a Unit instance from ForceBuilder
      unit.id = `unit-${unitIndex++}`;

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
  ui = new UIController({ viewerId: VIEWER_ID });
  ui.init(gameEngine, mapRenderer);

  // Trigger initial phase
  gameEngine.phaseManager.enterPhase('initiative');

  // Hook up render updates
  gameEngine.eventBus.on('phaseChanged', () => {
    mapRenderer.render(viewState());
    updateUI();
  });
  gameEngine.eventBus.on('unitMoved', () => {
    mapRenderer.render(viewState());
  });
  gameEngine.eventBus.on('damageApplied', () => {
    mapRenderer.render(viewState());
  });
  gameEngine.eventBus.on('unitDestroyed', () => {
    mapRenderer.render(viewState());
  });

  // Show game UI
  showGame();

  // Initial render
  updateUI();
  mapRenderer.render(viewState());

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
    onStartGame: (data) => {
      if (data.error) {
        alert(data.error);
        return;
      }
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
  // Store handler references for potential future cleanup
  _resizeHandler = () => {
    resizeCanvas();
    if (gameEngine && mapRenderer) {
      mapRenderer.render(viewState());
    }
  };
  window.addEventListener('resize', _resizeHandler);

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
  const state = viewState();
  if (!state) return;
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left - mapRenderer.offsetX;
  const py = event.clientY - rect.top - mapRenderer.offsetY;
  const hexKey = pixelToHex(px, py, mapRenderer.hexSize);

  const hex = state.map.hexes.get(hexKey);
  if (!hex) return;

  // Check if clicking on a unit
  const unitOnHex = Object.values(state.units).find(u => u.position.hexKey === hexKey);

  if (unitOnHex) {
    // If a friendly unit is selected and clicking an enemy, treat as target.
    // The target must be on the projected target list, so a hidden unit's hex
    // behaves exactly like an empty hex.
    if (ui.selectedUnitId && ui.selectedUnitId !== unitOnHex.id) {
      const selectedUnit = state.getUnit(ui.selectedUnitId);
      const clickedUnit = unitOnHex;
      const targetable = ui.getTargetableUnits(ui.selectedUnitId);
      if (selectedUnit && targetable.some(unit => unit.id === clickedUnit.id)) {
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
          // Re-project so a target revealed by this shot appears right away.
          mapRenderer.render(viewState());
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
    mapRenderer.render(viewState());
  }
});

// Keyboard shortcuts - stored as a named handler for cleanup
_keydownHandler = (event) => {
  if (!gameEngine) return;
  const state = viewState();
  if (!state) return;

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
        const units = ui.getVisibleUnits(state.currentPlayer);
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
};
document.addEventListener('keydown', _keydownHandler);

function updateUI() {
  if (!gameEngine) return;
  const state = viewState();
  if (!state) return;
  document.getElementById('turn-label').textContent = `Turn: ${state.turn}`;
  document.getElementById('phase-label').textContent = `Phase: ${state.phase}`;
}

// Start
init();
