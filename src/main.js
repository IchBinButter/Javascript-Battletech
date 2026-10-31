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
import { Logger, attachGameLogging } from './utils/logger.js';

// ---- Globals ----
const HEX_SIZE = 30;
// Solo play looks at the game through player 0's eyes. The projection removes
// hidden enemy units, so they never reach the renderer, the UI or a click test.
const VIEWER_ID = 0;

// Phases whose rules declare one 'Mech per side, in initiative order. The
// local viewer commands only one side (there is no AI opponent yet), so the
// queue in these phases can stop on a slot nobody controls; see
// skipUncontrolledDeclarations().
const DECLARATION_PHASES = new Set(['movement', 'weapon_attack', 'physical_attack']);

let gameEngine;
let mapRenderer;
let ui;
let startMenu;
let weaponsLookup;
let mechsData, weaponsData, hitTables, mapsData;

/** Re-entrancy guard for skipUncontrolledDeclarations(). */
let _skippingDeclarations = false;

// Canvas setup
const canvas = document.getElementById('map-canvas');
const app = document.getElementById('app');
const startMenuOverlay = document.getElementById('start-menu-overlay');

// ---- Structured debug log ----
/**
 * Engine events recorded in the debug log: every player action the engine
 * processed, every turn/phase/queue move, and each rules result that changes
 * the board. Kept next to the game wiring in this file so a new live-facing
 * event is easy to add; `attachGameLogging` owns the actual subscriptions.
 */
const LOGGED_ENGINE_EVENTS = [
  'actionProcessed',
  'phaseChanged',
  'queueAdvanced',
  'unitMoved',
  'damageApplied',
  'unitAttacked',
  'unitFell',
  'unitDestroyed',
  'fireStarted',
  'buildingDamaged',
  'minefieldTriggered',
  'supportStrikeScheduled',
  'supportStrikeResolved'
];

/**
 * Session log. `debug`/`info` only feed the ring buffer (default 2000 entries),
 * so the app does not spam the console; see `window.BT_LOG` and Ctrl+Shift+L for
 * the export. A live report can now be reconstructed after the fact.
 */
const gameLog = new Logger({ level: 'debug' });

/** Log wiring for the running game; disposed by teardownGame(). */
let gameLogging = null;


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
  // Stop mirroring first: this removes the engine event subscriptions, the
  // window error handlers and the ui.log wrapper, so a second game records
  // exactly once instead of growing a duplicate listener per game.
  if (gameLogging) {
    try { gameLogging.dispose(); } catch (_) { /* ignore */ }
    gameLogging = null;
  }
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

// ---- Structured log export ----

/** File-safe timestamp slug for an exported log: 2026-10-31T05-04-03-123Z. */
function logTimestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Timestamped .txt filename: battletech-log-<gameId>-<timestamp>.txt */
function logFilename() {
  const { gameId } = gameLog.getContext();
  return `battletech-log-${gameId || 'nogame'}-${logTimestampSlug()}.txt`;
}

/**
 * Download the recorded log as a timestamped .txt file.
 *
 * Returns `{ filename, text }` so the export can also be inspected directly
 * (and so a headless environment without `URL.createObjectURL` still gets the
 * text). A failed download is recorded in the log, never thrown at the player.
 */
function downloadLog() {
  const text = gameLog.toText();
  const filename = logFilename();
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    gameLog.error('export', 'log download failed', { message: error && error.message });
  }
  return { filename, text };
}

/**
 * Console handle on the structured log:
 * - `BT_LOG.dump()` returns the export text;
 * - `BT_LOG.download()` downloads the timestamped .txt;
 * - `BT_LOG.clear()` empties the buffer (recording continues).
 */
window.BT_LOG = {
  dump: () => gameLog.toText(),
  download: () => downloadLog(),
  clear: () => { gameLog.clear(); }
};

// ---- Data loading ----
async function loadJSON(path) {
  const resp = await fetch(path);
  return resp.json();
}

// ---- Show/hide game UI ----
/** Deployment columns of a formation, three hexes apart, inside the map. */
function formationColumns(width) {
  const cols = [];
  for (let col = 4; col < width; col += 3) cols.push(col);
  if (cols.length === 0) cols.push(0);
  return cols;
}

/**
 * Candidate deployment hexes for `playerIdx`, nearest that player's home edge
 * first.
 *
 * A formation fills one row at a time, marching from the home edge toward the
 * centre of the player's own half. The old fixed `4 + i * 3` column had no
 * bound, so on the standard 17-wide mapsheet the sixth 'Mech of a side landed
 * on `19,3` - a hex that does not exist. The unit stayed in `gameState.units`
 * but could never be drawn or clicked.
 *
 * @param {{width: number, height: number}} hexGrid
 * @param {number} playerIdx - 0 deploys from the north edge, 1 from the south
 * @returns {string[]} hex keys, preferred first
 */
function deploymentSlots(hexGrid, playerIdx) {
  const width = hexGrid.width;
  const height = hexGrid.height;
  if (!width || !height) return [];

  const homeRow = playerIdx === 0 ? 3 : height - 4;
  const half = Math.floor(height / 2);
  const rows = [];
  for (let row = 0; row < height; row++) {
    if (playerIdx === 0 ? row < half : row >= half) rows.push(row);
  }
  if (rows.length === 0) rows.push(Math.max(0, Math.min(height - 1, homeRow)));
  rows.sort((a, b) => {
    const distanceA = Math.abs(a - homeRow);
    const distanceB = Math.abs(b - homeRow);
    if (distanceA !== distanceB) return distanceA - distanceB;
    return playerIdx === 0 ? a - b : b - a;
  });

  const slots = [];
  for (const row of rows) {
    for (const col of formationColumns(width)) slots.push(`${col},${row}`);
  }
  return slots;
}

/**
 * The next free, real map hex for `playerIdx`.
 *
 * Formation slots come first; a force larger than the formation falls back to
 * any free hex on its own side, then to any free hex on the map, so no unit is
 * ever placed outside the map it has to stand on.
 *
 * @param {{width: number, height: number, hexes: Map<string, object>}} hexGrid
 * @param {number} playerIdx
 * @param {Set<string>} occupied - hex keys already taken by another unit
 * @returns {string}
 */
function nextDeploymentHex(hexGrid, playerIdx, occupied) {
  for (const hexKey of deploymentSlots(hexGrid, playerIdx)) {
    if (!occupied.has(hexKey) && hexGrid.hexes.has(hexKey)) return hexKey;
  }

  const half = Math.floor(hexGrid.height / 2);
  const onOwnSide = (hexKey) => {
    const row = Number(hexKey.split(',')[1]);
    return playerIdx === 0 ? row < half : row >= half;
  };
  for (const hexKey of hexGrid.hexes.keys()) {
    if (!occupied.has(hexKey) && onOwnSide(hexKey)) return hexKey;
  }
  for (const hexKey of hexGrid.hexes.keys()) {
    if (!occupied.has(hexKey)) return hexKey;
  }

  // Map full: keep the deployment deterministic rather than dropping a unit.
  return `${formationColumns(hexGrid.width)[0]},${playerIdx === 0 ? 3 : hexGrid.height - 4}`;
}

function showGame() {
  // Leave the menu properly: setting the overlay's display alone used to leave
  // the StartMenu thinking it was still on screen, so its document-level key
  // handler kept reacting during play (Enter ran New Game from inside a game).
  if (startMenu) startMenu.hide();
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

/** The display name of `playerId`, with a fallback for partial fixtures. */
function playerName(state, playerId) {
  const player = ((state && state.players) || []).find(p => p.id === playerId);
  return player ? player.name : `Player ${playerId + 1}`;
}

/** The 'Mech whose declaration slot is current, or null when the queue is empty. */
function queueEntry() {
  if (!gameEngine || !gameEngine.phaseManager) return null;
  return gameEngine.phaseManager.getCurrentQueueEntry();
}

/**
 * Can `unit` declare its movement right now?
 *
 * The engine accepts a move only from the 'Mech whose declaration slot is
 * current (`PhaseManager.validateAction`: "Not the current acting unit"), so
 * the click handler gates the preview on queue ownership rather than on the
 * unit merely belonging to the player who happens to be declaring.
 */
function isActingUnit(unit, state) {
  if (!unit) return false;
  const entry = queueEntry();
  if (entry) return entry.unitId === unit.id;
  return Boolean(state) && unit.player === state.currentPlayer;
}

/**
 * Spend the declaration slots of every side the local viewer does not control.
 *
 * Solo play has a single local viewer (player 0's eyes) and no AI opponent yet
 * (TODO.md "AI opponent"). The engine's movement/attack phases declare one
 * 'Mech per side in initiative order, so the queue regularly stops on a 'Mech
 * nobody can command. On the demo game's second turn the initiative loser is
 * player 1, whose slot is first: the viewer's own 'Mechs never become the
 * acting unit and every click on them silently does nothing - the "stuck on
 * turn two" report.
 *
 * Those slots are spent with the engine's own declaration pass
 * (`processAction {type:'pass'}`), so the rules engine stays authoritative and
 * the viewer's next 'Mech becomes the acting unit. When every remaining slot in
 * the phase belongs to the uncontrolled side the pass exhausts the queue and
 * the phase advances, exactly as it does after any other declaration.
 *
 * @returns {boolean} true when at least one declaration slot was passed
 */
function skipUncontrolledDeclarations() {
  if (!gameEngine || !mapRenderer || !ui || _skippingDeclarations) return false;

  const state = gameEngine.stateManager.getState();
  if (!DECLARATION_PHASES.has(state.phase)) return false;

  let passed = false;
  _skippingDeclarations = true;
  try {
    for (let guard = 0; guard < 64; guard++) {
      const current = gameEngine.stateManager.getState();
      if (!DECLARATION_PHASES.has(current.phase)) break;

      const entry = gameEngine.phaseManager.getCurrentQueueEntry();
      if (!entry || entry.playerId === VIEWER_ID) break;

      // Only name the 'Mech when the projection already shows it: an automatic
      // pass must not reveal the existence of a hidden enemy (p82).
      const projected = viewState();
      const visibleUnit = projected ? projected.getUnit(entry.unitId) : null;
      ui.log(
        `${playerName(current, entry.playerId)}: ${visibleUnit ? visibleUnit.name : 'unit'} declaration passed (no local controller)`,
        'info'
      );

      const result = gameEngine.processAction(entry.playerId, {
        type: 'pass',
        unitId: entry.unitId
      });
      if (!result || !result.success) break;
      passed = true;
    }
  } finally {
    _skippingDeclarations = false;
  }

  return passed;
}

/** Redraw the map and HUD after the engine state moved outside a click. */
function refreshGameView() {
  if (!gameEngine || !mapRenderer) return;
  updateUI();
  mapRenderer.render(viewState());
}

/** The map hex under a mouse event, in the same coordinates a click uses. */
function hexKeyAtPoint(event) {
  if (!mapRenderer) return null;
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left - mapRenderer.offsetX;
  const py = event.clientY - rect.top - mapRenderer.offsetY;
  return pixelToHex(px, py, mapRenderer.hexSize);
}

/**
 * Drop the hover preview. Renderer contract for render-fix:
 * - `hoveredHex`: the hex under the cursor, or null;
 * - `hoveredMove`: `{ hexKey, path, cost, remainingMP, facing }` when that hex
 *   is a legal destination for the selected 'Mech, else null.
 */
function clearHover() {
  if (!mapRenderer) return;
  mapRenderer.hoveredHex = null;
  mapRenderer.hoveredMove = null;
}

/** Drop the pending move and hover preview (selection or phase changed). */
function clearPendingMovement() {
  if (mapRenderer) {
    mapRenderer.validMoves = null;
    clearHover();
  }
  if (ui) ui._pendingMove = null;
}

/**
 * Build - or clear - the movement preview for a selected 'Mech.
 *
 * Selection stays available for inspection, but the reachable-hex preview (and
 * the move itself) follows the declaration queue: previewing moves for a 'Mech
 * the engine will refuse to move would promise something the click cannot
 * deliver.
 */
function refreshMovementPreview(unit, state) {
  if (!mapRenderer || !ui) return;

  clearPendingMovement();
  if (!unit || !state || state.phase !== 'movement') return;
  if (unit.player !== VIEWER_ID) return;

  if (!isActingUnit(unit, state)) {
    const entry = queueEntry();
    const acting = entry ? state.getUnit(entry.unitId) : null;
    ui.log(acting
      ? `${acting.name} is declaring movement now; finish its move first`
      : 'That Mech is not the current movement declaration', 'info');
    return;
  }

  mapRenderer.validMoves = gameEngine.movementCalc.getValidMoves(unit, state, ui.movementMode);
}

// ---- Initialize Game with Selected Forces ----
async function startGame(forceBuilder) {
  // Clean up any previous game to prevent listener leaks and stale references
  teardownGame();

  // One export describes one game: drop the previous game's entries. The log
  // header ({gameId, turn, phase}) is filled in once the engine exists.
  gameLog.clear();

  const players = forceBuilder.getPlayers();
  const selectedMapId = forceBuilder.selectedMapId;
  gameLog.info('game', 'startGame', {
    selectedMapId: selectedMapId || null,
    players: players.map(player => ({
      name: player.name || null,
      units: (player.units || []).map(unit => unit.name)
    }))
  });

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
        gameLog.error('game', 'map load failed', {
          mapId: selectedMapId,
          message: error && error.message
        });
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
  const occupiedHexes = new Set();
  for (let playerIdx = 0; playerIdx < 2; playerIdx++) {
    const player = players[playerIdx];
    const units = player.units || [];

    for (let i = 0; i < units.length; i++) {
      const unit = units[i]; // already a Unit instance from ForceBuilder
      unit.id = `unit-${unitIndex++}`;

      // Place units on their home edge, inside the loaded map (see
      // nextDeploymentHex for the off-map formation this replaces).
      const hexKey = nextDeploymentHex(hexGrid, playerIdx, occupiedHexes);
      occupiedHexes.add(hexKey);
      unit.position.hexKey = hexKey;
      unit.position.facing = playerIdx === 0 ? 3 : 0; // Face toward enemy

      gameState.addUnit(unit);
      // Where a force actually landed is a recurring live report; record it
      // per unit rather than only the total.
      gameLog.info('game', 'unit deployed', {
        unitId: unit.id,
        name: unit.name,
        player: playerIdx,
        tonnage: unit.tonnage,
        hexKey,
        facing: unit.position.facing
      });
    }
  }

  // If no units selected, use defaults
  let defaultsUsed = null;
  if (Object.keys(gameState.units).length === 0) {
    const defaults = [
      { def: mechsData.mechs[0], player: 0, col: 6, row: 3, facing: 3 },
      { def: mechsData.mechs[1], player: 0, col: 10, row: 3, facing: 3 },
      { def: mechsData.mechs[2], player: 1, col: 6, row: 12, facing: 0 },
      { def: mechsData.mechs[3], player: 1, col: 10, row: 12, facing: 0 }
    ];
    for (const d of defaults) {
      const unit = new Unit(d.def, d.player, `default-${d.player}-${d.col}`);
      const col = Math.min(d.col, hexGrid.width - 1);
      const row = Math.min(d.row, hexGrid.height - 1);
      unit.position.hexKey = `${col},${row}`;
      unit.position.facing = d.facing;
      gameState.addUnit(unit);
    }
    // The fallback is legitimate for an empty force, but the log must say so:
    // a silent fallback reads as "my Force Builder selection was ignored".
    defaultsUsed = defaults.map(d => d.def.name).join(', ');
    gameLog.info('game', 'no units selected; defaults deployed', {
      defaults: defaultsUsed,
      players: players.map(player => player.name || null)
    });
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

  // Mirror the engine and the dice log into the structured log before the
  // first phase event, so the export starts at the game's first turn. The
  // wiring is disposed by teardownGame() when this game ends.
  gameLogging = attachGameLogging({
    logger: gameLog,
    engine: gameEngine,
    ui,
    events: LOGGED_ENGINE_EVENTS,
    windowRef: window
  });
  gameLog.info('game', 'game started', {
    gameId: gameEngine.gameId,
    units: Object.keys(gameState.units).length,
    map: { width: hexGrid.width, height: hexGrid.height },
    defaultsUsed: defaultsUsed || null
  });

  // Trigger initial phase
  gameEngine.phaseManager.enterPhase('initiative');

  // Hook up render updates
  gameEngine.eventBus.on('phaseChanged', () => {
    clearHover();
    // A declaration phase can open on the side this view cannot command.
    skipUncontrolledDeclarations();
    refreshGameView();
  });
  gameEngine.eventBus.on('queueAdvanced', () => {
    // The viewer's declaration is spent; spend any uncontrolled slots now at
    // the front of the queue so the next usable 'Mech becomes the acting unit.
    if (skipUncontrolledDeclarations()) refreshGameView();
  });
  gameEngine.eventBus.on('unitMoved', () => {
    // The preview belonged to where the 'Mech used to stand.
    clearHover();
    mapRenderer.render(viewState());
  });
  gameEngine.eventBus.on('damageApplied', () => {
    mapRenderer.render(viewState());
  });
  gameEngine.eventBus.on('physicalAttackResolved', () => {
    // A punch/kick/charge/DFA can knock a unit prone or destroy a location
    // without a unitMoved event, so the board token needs a redraw. The unit
    // sheet refresh for the same event is wired in UIController.init.
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
  if (defaultsUsed) {
    ui.log(`No BattleMechs were selected in the Force Builder - deploying the default BattleMechs: ${defaultsUsed}`, 'info');
  }
  ui.log('Click a Mech to select it. Arrow keys to pan.');
}

// ---- Start Menu Setup ----
function showStartMenu() {
  hideGame();

  // A fresh menu per visit: destroy the previous instance first so its
  // document-level key handler cannot outlive the menu it belongs to.
  if (startMenu) {
    startMenu.destroy();
    startMenu = null;
  }

  startMenu = new StartMenu({
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
  // Leave the menu completely, not just visually: hiding only the overlay left
  // the StartMenu "visible" to its own key handler, so pressing Enter to confirm
  // a player name or roster choice in the Force Builder silently ran New Game
  // and stacked an empty second builder on top. Starting that one had no units,
  // so startGame's fallback deployed the four defaults - the live-play report
  // "whatever I choose in the Force Builder, the map deploys the defaults".
  if (startMenu) startMenu.hide();
  startMenuOverlay.style.display = 'none';

  // Never run two builders at once: a second one stacks over the first, so the
  // player can end up starting the wrong force (see the comment above).
  if (document.getElementById('force-builder-container')) return;

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
  if (!gameEngine || !mapRenderer) return;

  // The declaration queue may still be sitting on the side the local viewer
  // does not control; spend those slots before interpreting the click so the
  // state read below is the one the player is actually looking at.
  if (skipUncontrolledDeclarations()) refreshGameView();

  const state = viewState();
  if (!state) return;
  const hexKey = hexKeyAtPoint(event);

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
        // Record the target BEFORE refreshing anything that reads it. The
        // classic picker and the record-card inventory are both rebuilt from
        // the same `_getWeaponEligibility` verdict, so targets in the rear arc
        // disable the same rows in both views.
        ui._pendingTarget = unitOnHex.id;
        ui.log(`Target selected: ${clickedUnit.name}`);
        mapRenderer.selectedUnit = ui.selectedUnitId;

        // Two-step fire flow: picking the target only records it and refreshes
        // the weapon views, because target-dependent eligibility (out of arc,
        // out of range, no line of sight) can only be judged once the target is
        // known. "Fire Selected" resolves the checked weapons afterwards.
        ui.refreshWeaponViews();
        mapRenderer.render(state);
        return;
      }
    }

    // Normal selection. The panel stays an inspection tool - movement follows
    // the declaration queue (see refreshMovementPreview). The pending target
    // belonged to the previous attacker, so it is cleared BEFORE the render
    // that derives target-aware eligibility.
    mapRenderer.selectedUnit = unitOnHex.id;
    ui._pendingTarget = null;
    ui.refreshWeaponViews(unitOnHex);
    refreshMovementPreview(unitOnHex, state);
    mapRenderer.render(state);
    return;
  }

  // Clicked empty hex - handle movement
  if (ui.weaponFireMode) {
    // Cancelling the declaration also clears the target before the record card
    // is re-rendered; otherwise its rows would stay disabled for a target that
    // no longer exists.
    ui.weaponFireMode = false;
    ui._pendingTarget = null;
    ui.weaponPanel.style.display = 'none';
    ui.refreshWeaponViews();
    ui.log('Weapon fire cancelled', 'info');
    return;
  }

  if (state.phase === 'movement' && mapRenderer.selectedUnit) {
    const unit = state.getUnit(mapRenderer.selectedUnit);
    if (!unit) {
      mapRenderer.selectedUnit = null;
      ui.updateUnitPanel(null);
      clearPendingMovement();
      mapRenderer.render(state);
      return;
    }

    if (!isActingUnit(unit, state)) {
      const entry = queueEntry();
      const acting = entry ? state.getUnit(entry.unitId) : null;
      ui.log(acting
        ? `${acting.name} is declaring movement now; finish its move first`
        : 'That Mech is not the current movement declaration', 'info');
      mapRenderer.render(state);
      return;
    }

    const validMoves = mapRenderer.validMoves;
    if (validMoves && validMoves.has(hexKey)) {
      const moveData = validMoves.get(hexKey);
      ui._pendingMove = {
        path: moveData.path,
        movementType: ui.movementMode
      };
      // The pending destination doubles as the hover preview until the move is
      // resolved; `hoveredMove` is what render-fix draws the path/cost from.
      mapRenderer.hoveredHex = hexKey;
      mapRenderer.hoveredMove = {
        hexKey,
        path: [...moveData.path],
        cost: moveData.cost,
        remainingMP: moveData.remainingMP,
        facing: moveData.facing
      };
      ui.log(`Move pending to ${hexKey} (${moveData.cost} MP). Click Confirm Move.`);
    } else {
      ui.log('Cannot reach that hex', 'miss');
    }
    mapRenderer.render(state);
    return;
  }

  // Deselect
  if (state.phase !== 'movement') {
    mapRenderer.selectedUnit = null;
    ui.updateUnitPanel(null);
    clearPendingMovement();
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

// Hover tracking: the renderer previews the selected 'Mech's path under the
// cursor. `hoveredHex` is the hex under the pointer; when that hex is a legal
// destination `hoveredMove` carries the path, cost and destination facing.
canvas.addEventListener('mousemove', (event) => {
  if (!gameEngine || !mapRenderer) return;

  const hexKey = hexKeyAtPoint(event);
  const validMoves = mapRenderer.validMoves;
  const moveData = validMoves ? validMoves.get(hexKey) : null;
  const previous = mapRenderer.hoveredMove;

  const changed = mapRenderer.hoveredHex !== hexKey
    || Boolean(moveData) !== Boolean(previous)
    || Boolean(moveData && previous && (
      moveData.cost !== previous.cost || String(moveData.path) !== String(previous.path)
    ));

  mapRenderer.hoveredHex = hexKey;
  mapRenderer.hoveredMove = moveData ? {
    hexKey,
    path: [...moveData.path],
    cost: moveData.cost,
    remainingMP: moveData.remainingMP,
    facing: moveData.facing
  } : null;

  if (changed && validMoves) mapRenderer.render(viewState());
});

canvas.addEventListener('mouseleave', () => {
  if (!mapRenderer) return;
  clearHover();
  if (gameEngine) mapRenderer.render(viewState());
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
      ui.weaponFireMode = false;
      // Clear the target before the dependent panel render, then hide the
      // picker: both weapon views drop their target-aware arrows together.
      ui._pendingTarget = null;
      ui.weaponPanel.style.display = 'none';
      ui.updateUnitPanel(null);
      clearPendingMovement();
      break;
    case 'n':
      if (mapRenderer.selectedUnit) {
        const units = ui.getVisibleUnits(VIEWER_ID);
        const idx = units.findIndex(u => u.id === mapRenderer.selectedUnit);
        if (idx >= 0 && idx < units.length - 1) {
          const next = units[idx + 1];
          mapRenderer.selectedUnit = next.id;
          ui.updateUnitPanel(next);
          refreshMovementPreview(next, state);
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

/**
 * Ctrl+Shift+L downloads the structured debug log (same as BT_LOG.download()).
 * A module-level handler, registered once, so the start/teardown game cycle
 * cannot stack copies of it.
 */
document.addEventListener('keydown', (event) => {
  if (!event.ctrlKey || !event.shiftKey) return;
  if (event.key !== 'l' && event.key !== 'L') return;
  event.preventDefault();
  downloadLog();
});

function updateUI() {
  if (!gameEngine) return;
  const state = viewState();
  if (!state) return;
  document.getElementById('turn-label').textContent = `Turn: ${state.turn}`;
  document.getElementById('phase-label').textContent = `Phase: ${state.phase}`;
  const activePlayer = document.getElementById('active-player');
  if (activePlayer) activePlayer.textContent = `Active: ${playerName(state, state.currentPlayer)}`;
}

// Start
init();
