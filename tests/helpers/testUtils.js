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
  // Most fixtures fire weapons that are not on the chassis (a PPC from an
  // Atlas) to exercise a rule in isolation, so declaration checks default off
  // here. Tests for the checks themselves pass enforceWeaponDeclarations: true.
  const engine = new GameEngine(state, {
    enforceWeaponDeclarations: config.enforceWeaponDeclarations === true
  });
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

/**
 * Creates an engine with per-unit alternation queue active.
 * Enters the specified phase and builds the alternating unit queue.
 */
export function createEngineWithPerUnitAlternation(config = {}) {
  const engine = createTestEngine(config);
  const phase = config.phase || 'movement';
  engine.phaseManager.enterPhase(phase);
  return engine;
}

/**
 * Creates an engine with a specific initiative choice already made.
 * Rolls initiative and applies the winner's choice of goFirst.
 */
export function createEngineWithInitiativeChoice(config = {}) {
  const engine = createTestEngine(config);
  const goFirst = config.goFirst !== undefined ? config.goFirst : false;
  engine.phaseManager.enterPhase('initiative');
  engine.phaseManager.chooseInitiative(goFirst);
  return engine;
}

/**
 * Returns a dice roller suited for consciousness checks.
 *
 * Consciousness thresholds by pilot hits:
 *   1 hit -> target 3, 2 hits -> target 5,
 *   3 hits -> target 7, 4 hits -> target 10, 5+ -> auto fail
 *
 * Pass: rolls 12 (always >= any target). Fail: rolls 2 (always < any target).
 */
export function makeConsciousnessDiceRoller(passOrFail = true) {
  const roll = passOrFail ? 12 : 2;
  return makeDiceRoller(roll);
}

/**
 * Creates a test unit with a specific heat level preset.
 */
export function createHeatTestUnit(mechId, playerId, unitId, heatLevel) {
  const unit = createTestUnit(mechId, playerId, unitId);
  unit.heat = heatLevel;
  return unit;
}

/**
 * Advances the engine to a specific phase by calling enterPhase.
 */
export function advanceToPhase(engine, phase) {
  engine.phaseManager.enterPhase(phase);
  return engine;
}

/**
 * Creates a two-unit engagement ready for combat testing.
 * Returns { engine, attacker, target }.
 */
export function createEngagement(config = {}) {
  const attackerId = config.attackerId || 'atlas-as7d';
  const targetId = config.targetId || 'jenner-jr7d';
  const attackerPos = config.attackerPos || { hexKey: '5,7', facing: 0 };
  const targetPos = config.targetPos || { hexKey: '7,7', facing: 3 };
  const player1Id = config.player1Id !== undefined ? config.player1Id : 0;
  const player2Id = config.player2Id !== undefined ? config.player2Id : 1;

  const attacker = createTestUnit(attackerId, player1Id, config.attackerUnitId || 'attacker-0');
  const target = createTestUnit(targetId, player2Id, config.targetUnitId || 'target-1');
  attacker.position = { ...attackerPos };
  target.position = { ...targetPos };

  const engine = createTestEngine({
    units: { [attacker.id]: attacker, [target.id]: target }
  });

  return { engine, attacker, target };
}

/**
 * Fire a weapon from one unit at another.
 * Handles phase setup (enters weapon_attack if not already there)
 * and sets currentPlayer before firing.
 */
export function fireWeaponAtTarget(engine, attackerId, targetId, weaponIdOrDef, playerId, weaponLocation = 'rightArm') {
  const weaponDef = typeof weaponIdOrDef === 'string' ? createWeaponDef(weaponIdOrDef) : weaponIdOrDef;

  if (engine.phaseManager.currentPhase !== 'weapon_attack') {
    engine.phaseManager.clearQueue();
    engine.phaseManager.enterPhase('weapon_attack');
  }
  engine.stateManager.getState().currentPlayer = playerId;

  return engine.processAction(playerId, {
    type: 'fire',
    attackerId,
    targetId,
    weapon: weaponDef,
    weaponLocation
  });
}

export { hitTables, weaponsData, mechsData };
