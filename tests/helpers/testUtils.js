import { GameState } from '../../src/models/GameState.js';
import { Unit } from '../../src/models/Unit.js';
import { Hex } from '../../src/models/Hex.js';
import { HexGrid } from '../../src/hex/HexGrid.js';
import { Weapon } from '../../src/models/Weapon.js';
import { GameEngine } from '../../src/engine/GameEngine.js';
import hitTables from '../../src/data/hitTables.json' with { type: 'json' };
import weaponsData from '../../src/data/weapons.json' with { type: 'json' };
import mechsData from '../../src/data/mechs.json' with { type: 'json' };

export function makeDiceRoller(fixedRoll = 7) {
  let callCount = 0;
  return {
    roll2d6() { return fixedRoll; },
    roll1d6() { return Math.ceil(fixedRoll / 2); },
    next() { return 0.5; }
  };
}

export function makeSequencedDiceRoller(rolls) {
  let idx = 0;
  return {
    roll2d6() { return rolls[idx++ % rolls.length]; },
    roll1d6() { return Math.ceil(rolls[idx++ % rolls.length] / 2); },
    next() { return 0.5; }
  };
}

export function createTestMap(hexDefs = {}) {
  const hexes = new Map();
  for (const [key, data] of Object.entries(hexDefs)) {
    hexes.set(key, new Hex(key, {
      terrainType: data.terrainType || 'clear',
      level: data.level || 0,
      ...data
    }));
  }
  return { hexes };
}

export function createStandardTestMap() {
  const hexDefs = {};
  for (let col = 0; col < 17; col++) {
    for (let row = 0; row < 15; row++) {
      hexDefs[`${col},${row}`] = { terrainType: 'clear', level: 0 };
    }
  }
  return createTestMap(hexDefs);
}

export function createTestUnit(mechId, playerId, unitId) {
  const mechDef = mechsData.mechs.find(m => m.id === mechId);
  if (!mechDef) throw new Error(`Mech not found: ${mechId}`);
  return new Unit(mechDef, playerId, unitId);
}

export function createWeaponDef(weaponId) {
  const def = weaponsData.weapons.find(w => w.id === weaponId);
  if (!def) throw new Error(`Weapon not found: ${weaponId}`);
  return new Weapon(def);
}

export function createTestGameState(config = {}) {
  const map = config.map || createStandardTestMap();
  const players = config.players || [
    { id: 0, name: 'Player 1' },
    { id: 1, name: 'Player 2' }
  ];

  const state = new GameState({
    turn: config.turn || 1,
    phase: config.phase || 'initiative',
    players,
    map,
    units: {}
  });

  if (config.units) {
    for (const unit of Object.values(config.units)) {
      state.addUnit(unit);
    }
  }

  return state;
}

export function createTestEngine(config = {}) {
  const state = createTestGameState(config);
  const engine = new GameEngine(state);
  engine.initCombat(hitTables);
  return engine;
}

export function createEngagementMap(distance = 5) {
  const hexDefs = {};
  for (let col = 0; col < 17; col++) {
    for (let row = 0; row < 15; row++) {
      hexDefs[`${col},${row}`] = { terrainType: 'clear', level: 0 };
    }
  }
  return createTestMap(hexDefs);
}

export { hitTables, weaponsData, mechsData };
