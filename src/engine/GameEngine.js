/**
 * GameEngine - Central orchestrator tying together all game systems.
 * Handles action processing, delegates to rules engines.
 */

import { EventBus } from './EventBus.js';
import { StateManager } from './StateManager.js';
import { PhaseManager } from './PhaseManager.js';
import { InitiativeManager } from './InitiativeManager.js';
import { MovementCalculator } from '../rules/movement/MovementCalculator.js';
import { PSRCalculator } from '../rules/movement/PSRCalculator.js';
import { SkiddingRules } from '../rules/movement/SkiddingRules.js';
import { LineOfSight } from '../rules/combat/LineOfSight.js';
import { AttackResolver } from '../rules/combat/AttackResolver.js';
import {
  canSee,
  hiddenEnemyAt,
  revealInBuildings,
  revealOnFire,
  revealOnAdjacentMove,
  revealOnMove,
  revealUnit
} from './visibility.js';
import { toTransferable } from '../utils/helpers.js';
import { entryPSRModifier, entryDamage, damageReduction, collapseDamage, buildingCombat, BuildingRegistry } from '../rules/urban/Buildings.js';
import { rollBasement, basementFallDamage, basementCollapseDamage } from '../rules/urban/Basements.js';
import { terrainPSRModifier } from '../rules/movement/TerrainRules.js';
import { psrModifier } from '../rules/weather/WeatherRules.js';
import {
  canBurn, attemptIgnition, spreadsOnRoll, spreadDistance, downwindHexes,
  BUILDING_FIRE_CF_LOSS
} from '../rules/terrain/FireRules.js';
import {
  minefieldAt, minefieldHexesEntered, resolveMinefieldTrigger
} from '../rules/battlefield/Minefields.js';
import {
  dueSupportStrikes, expireSupportStrike, resolveSupportStrike,
  scheduleSupportStrike as scheduleStrike
} from '../rules/battlefield/BattlefieldSupport.js';
import { canWeaponFireAt, getTargetArc, ARC } from '../rules/combat/ArcRules.js';
import { hasActuatorSlot } from '../rules/combat/UnitDamage.js';
import { isWeaponMountDestroyed, weaponMountKey } from '../rules/combat/WeaponMounts.js';
import { quirkHeatModifier } from '../rules/quirks/Quirks.js';
import { DamageResolver } from '../rules/combat/DamageResolver.js';
import { PhysicalAttackResolver } from '../rules/combat/PhysicalAttackResolver.js';
import { HeatManager } from '../rules/heat/HeatManager.js';
import { createSeededDice } from '../utils/dice.js';
import { hexDistance } from '../hex/HexMath.js';
import { parseHexKey } from '../utils/helpers.js';

/**
 * Fired-set key for ONE mounted weapon instance.
 *
 * p24 gives each weapon one attack per turn, and a 'Mech can carry several
 * identical weapons in one location (the Atlas AS7-D has two medium lasers in
 * its right arm). The weapon id plus its location therefore cannot identify a
 * weapon: the position in `unit.equipment.weapons` does, and that position is
 * stable for the whole game - damage marks critical slots, it never removes
 * mounted entries.
 *
 * The format is owned by the rules helper that also maps a mount to the
 * physical critical-slot component it occupies (`WeaponMounts.weaponMountKey`),
 * so firing identity and mount identity are always the same key.
 *
 * @param {string} weaponId - weapon definition id (e.g. 'med_laser')
 * @param {string} location - mounted location (e.g. 'rightArm')
 * @param {number} weaponIndex - index into `unit.equipment.weapons`
 * @returns {string} e.g. 'med_laser@rightArm#1'
 */
export function weaponInstanceKey(weaponId, location, weaponIndex) {
  return weaponMountKey(weaponId, location, weaponIndex);
}

/**
 * The pre-instance fired key (`<id>@<location>`).
 *
 * `_validateWeaponDeclaration` used to record this, and a caller (or a test
 * fixture) may still hand one in. It is honoured as the conservative reading -
 * "this model in this location has fired" - so a record written before
 * per-instance identity can never let a weapon fire twice, while new records
 * are always per-instance and identical mounts stay independent.
 */
export function weaponModelKey(weaponId, location) {
  return `${weaponId}@${location}`;
}

export class GameEngine {
  /** Sequential game ids, so nothing depends on the wall clock. */
  static _gameSequence = 0;

  constructor(gameState, config = {}) {
    this.eventBus = new EventBus();
    this.stateManager = new StateManager(gameState);
    this.phaseManager = new PhaseManager();
    this.phaseManager.setEngine(this);
    this.initiativeManager = new InitiativeManager();

    // Rules engines
    this.movementCalc = new MovementCalculator();
    this.psrCalc = new PSRCalculator();
    this.skiddingRules = new SkiddingRules();
    this.los = new LineOfSight();

    // Attack and damage resolvers will be initialized after loading hit tables
    this.attackResolver = null;
    this.damageResolver = new DamageResolver();
    this.physicalResolver = new PhysicalAttackResolver();
    this.heatManager = new HeatManager();

    // Dice roller. The game id seeds it, so a server assigns it up front and
    // every replay of the same game uses the same dice stream.
    this.gameId = config.gameId || `game-${++GameEngine._gameSequence}`;
    this.diceRoller = config.diceRoller || createSeededDice(this.gameId, gameState.turn);

    // p24/p31/p46 declaration checks (mounted, once per turn, not destroyed,
    // ammo available). Enabled by default; test fixtures that fire synthetic
    // weapons not on the chassis opt out explicitly.
    this.enforceWeaponDeclarations = config.enforceWeaponDeclarations !== false;

    // Weapon data lookup (populated after init from JSON)
    this._weaponsData = null;

    // Action log
    this.actionLog = [];
  }

  /**
   * Initialize attack resolver with hit tables (loaded from JSON asynchronously).
   */
  initCombat(hitTables) {
    this.attackResolver = new AttackResolver(hitTables);
    this.hitTables = hitTables;
  }

  /**
   * Extract the relevant unit ID from an action for queue validation.
   */
  _getActionUnitId(action) {
    return action.unitId || action.attackerId || null;
  }

  /**
   * Process a player action. Main entry point for all player interactions.
   */
  processAction(playerId, action) {
    const unitId = this._getActionUnitId(action);
    // A batched weapon declaration answers to the same phase/queue rules as a
    // single shot; the per-weapon declaration checks run inside _handleFire for
    // each shot. PhaseManager owns those rules, so the action type is mapped
    // here rather than taught a second fire action there.
    const validationType = action.type === 'fireWeapons' ? 'fire' : action.type;
    const validation = this.phaseManager.validateAction(validationType, playerId, unitId);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    let result;

    switch (action.type) {
      case 'move':
        result = this._handleMove(playerId, action);
        break;
      case 'fire':
        result = this._handleFire(playerId, action);
        break;
      case 'fireWeapons':
        result = this._handleFireWeapons(playerId, action);
        break;
      case 'physicalAttack':
        result = this._handlePhysicalAttack(playerId, action);
        break;
      case 'endPhase':
        result = this._handleEndPhase(playerId);
        break;
      case 'confirmFacing':
        result = this._handleConfirmFacing(playerId, action);
        break;
      case 'twistTorso':
        result = this._handleTwistTorso(playerId, action);
        break;
      case 'flipArms':
        result = this._handleFlipArms(playerId, action);
        break;
      case 'selectUnit':
        result = this._handleSelectUnit(playerId, action);
        break;
      case 'pass':
        result = this._handlePass(playerId, action);
        break;
      default:
        result = { success: false, error: `Unknown action: ${action.type}` };
    }

    this.actionLog.push({ playerId, action, result, phase: this.phaseManager.currentPhase });

    // The payload is broadcast to clients, so it must not carry class
    // instances (a Weapon arrives without its methods).
    this.eventBus.emit('actionProcessed', toTransferable({ playerId, action, result }));

    // Advance the unit queue after actions that consume a unit's turn. A
    // batched weapon declaration is one declaration, so it advances one slot.
    if (result.success
      && ['move', 'fire', 'fireWeapons', 'physicalAttack', 'pass'].includes(action.type)) {
      this.phaseManager.advanceQueueOrNextPhase();
    }

    return result;
  }

  /**
   * Resolve a fall (p56/p58/p74).
   *
   * PSRCalculator's `resolveFall` picks the facing-after-fall hit-location
   * column (p143), makes the MechWarrior's PSR with the triggers of the PSR
   * that caused the fall (p58) and returns the 'Mech's falling damage in
   * 5-point Damage Value groupings (p74). This method applies the warrior's
   * Consciousness Roll and the damage to the 'Mech, which is what the manual's
   * "the caller applies `damage`" split leaves to the engine.
   *
   * @param {object} unit
   * @param {{levelsFallen?: number, causeTriggers?: Array, fallDirection?: number}} [options]
   *   causeTriggers are the triggers of the PSR that caused the fall; their
   *   modifiers carry over to the warrior's roll.
   * @returns {object} the PSRCalculator fall result, with `damageResults`
   */
  applyFall(unit, { levelsFallen = 0, causeTriggers = [], fallDirection = null } = {}) {
    const pilotHitsBefore = unit.pilot ? (unit.pilot.hits || 0) : 0;
    const direction = Number.isFinite(fallDirection)
      ? fallDirection
      : (unit.position ? unit.position.facing : 0);

    const fall = this.psrCalc.resolveFall(unit, direction, this.diceRoller, levelsFallen, {
      causeTriggers
    });
    unit.prone = true;

    // p58: the warrior's fall injury forces its Consciousness Roll immediately,
    // and it is made before any falling damage reaches the 'Mech.
    this.rollConsciousnessForNewPilotHits(unit, pilotHitsBefore);

    // p56/p74: falling damage is applied in 5-point groupings, each on the
    // facing-after-fall hit-location column.
    fall.damageResults = [];
    for (const grouping of fall.damageGroupings || []) {
      if (grouping <= 0) continue;
      let location = 'centerTorso';
      let isRear = false;
      if (this.attackResolver) {
        const locRoll = this.diceRoller.roll2d6();
        const rolled = this.attackResolver.determineHitLocation(
          locRoll, fall.hitLocationColumn || 'front'
        );
        location = rolled.location;
        // p56/p57: the Facing-After-Fall "Opposite Direction" (Rear) result
        // sends torso damage to rear armour; arms, legs and the head have no
        // rear facing, so the table only marks torso entries as rear.
        isRear = Boolean(rolled.isRear);
      }
      fall.damageResults.push(this._applyDamageTo(unit, location, grouping, isRear));
    }

    this.eventBus.emit('unitFell', { unitId: unit.id, fall });

    return fall;
  }

  /**
   * Apply damage to a unit and make the Consciousness Rolls it forces (p58).
   *
   * "Every time a warrior takes a point of damage, its controller must
   * immediately make a Consciousness Roll." The damage resolver funnels all
   * MechWarrior damage through `applyPilotDamage`, so wrapping the call is
   * enough to roll for head hits, ammunition explosions, falls, heat damage
   * and everything else in one place.
   *
   * @returns {object} the DamageResolver result
   */
  _applyDamageTo(unit, location, damage, isRear = false) {
    const hitsBefore = unit.pilot ? (unit.pilot.hits || 0) : 0;
    const result = this.damageResolver.applyDamage(unit, location, damage, isRear, this.diceRoller);
    this.rollConsciousnessForNewPilotHits(unit, hitsBefore);
    return result;
  }

  /**
   * Make one Consciousness Roll per point of MechWarrior damage added since
   * `hitsBefore` (p58). Rolls stop as soon as the warrior is knocked out - "if
   * a MechWarrior is knocked unconscious, no further Consciousness Rolls need
   * be made that turn" - or dies on the sixth point.
   *
   * @param {object} unit
   * @param {number} hitsBefore - damage total the caller has already accounted for
   * @param {number|null} [hitsAfter] - cap the damage total to this many hits
   *   (used by the Heat Phase, so a fall caused later in the same phase is not
   *   counted twice)
   */
  rollConsciousnessForNewPilotHits(unit, hitsBefore, hitsAfter = null) {
    const rolls = [];
    if (!unit || !unit.pilot) return rolls;

    const limit = Number.isFinite(hitsAfter) ? hitsAfter : (unit.pilot.hits || 0);
    const first = Math.max(0, Number.isFinite(hitsBefore) ? hitsBefore : 0) + 1;

    for (let hits = first; hits <= limit; hits++) {
      const result = this.phaseManager.rollConsciousness(unit, { hits });
      rolls.push(result);
      if (result.dead) break;
      if (result.rolled && result.passed === false) break;
    }

    return rolls;
  }

  /**
   * Spend a unit's declaration slot without acting (p10/p52/p58).
   *
   * A shut-down 'Mech or one whose warrior is unconscious is immobile and may
   * not move, fire or make physical attacks, but p10 still has its player
   * assign it a movement selection and its slot in the alternating declaration
   * order is consumed. This is that "no action" declaration.
   */
  _handlePass(playerId, action) {
    const entry = this.phaseManager.getCurrentQueueEntry();
    const unitId = action.unitId || (entry ? entry.unitId : null);
    return { success: true, unitId, passed: true };
  }

  /**
   * p72: a building hex absorbs min(hit damage, ceil(CF/10)) from every hit on
   * a 'Mech inside it, measured against the CF the hex had at the start of the
   * Weapon Attack Phase. The absorbed damage is banked on the hex during the
   * phase and charged to its CF here, at the end of the Weapon Attack Phase -
   * "Resolve damage to the building's CF at the end of the Weapon Attack
   * Phase." A hex reduced to 0 collapses right after (p73).
   *
   * @returns {Array<{hexKey: string, damage: number, currentCF: number}>}
   */
  applyPendingBuildingDamage() {
    const state = this.stateManager.getState();
    const damaged = [];

    const hasPending = [...state.map.hexes.values()].some(hex => (hex._pendingCFDamage || 0) > 0);
    if (!hasPending) return damaged;

    this.stateManager.applyStateChange(() => {
      for (const [, hex] of state.map.hexes) {
        const pending = hex._pendingCFDamage || 0;
        if (pending <= 0) continue;
        if (!hex.building) {
          hex._pendingCFDamage = 0;
          continue;
        }

        hex.building.currentCF = Math.max(0, (hex.building.currentCF ?? hex.building.cf) - pending);
        hex._pendingCFDamage = 0;
        damaged.push({ hexKey: hex.hexKey, damage: pending, currentCF: hex.building.currentCF });
      }

      this._resolvePendingBuildingCollapses();
    });

    for (const record of damaged) {
      this.eventBus.emit('buildingDamaged', record);
    }

    return damaged;
  }

  _handleMove(playerId, action) {
    const state = this.stateManager.getState();
    const unit = state.getUnit(action.unitId);
    if (!unit) return { success: false, error: 'Unit not found' };

    // p52/p58: a shut-down 'Mech and one with an unconscious warrior are
    // immobile and cannot move; p131: a destroyed 'Mech is out of the game.
    if (this.phaseManager.isDestroyedUnit(unit)) {
      return { success: false, error: 'Unit has been destroyed' };
    }
    if (this.phaseManager.isImmobile(unit)) {
      return {
        success: false,
        error: unit.shutdown
          ? 'A shut-down Mech cannot move'
          : 'A MechWarrior who is unconscious cannot move'
      };
    }

    // p82: "Hidden 'Mechs revealed in these ways cannot move that phase." The
    // revealed unit forfeits its movement slot; advance the queue instead of
    // leaving the phase stuck on a unit that may not act.
    if (this._cannotMoveAfterReveal(unit.id)) {
      this.phaseManager.advanceQueueOrNextPhase();
      return { success: false, error: 'Revealed by enemy movement; it cannot move this phase' };
    }

    const { path, movementType } = action;
    // p82 Minefields: only a hidden 'Mech that walks or runs out of a mined hex
    // is attacked by that hex's field; capture the hidden flag before the move
    // reveals it.
    const wasHidden = Boolean(
      state.hiddenUnits && state.hiddenUnits[unit.id] && state.hiddenUnits[unit.id].hidden
    );

    // p18: "A jumping 'Mech also ignores facing ... when it lands it chooses
    // any facing desired." The landing facing travels with the move action;
    // the calculator applies it and reports it as the validation's finalFacing,
    // which is written to unit.position.facing below. Without the choice the
    // 'Mech keeps the facing it took off with. Ground movement still derives
    // its facing from the path, so the option is jump-only.
    const moveOptions = movementType === 'jump' && action.landingFacing !== undefined
      ? { landingFacing: action.landingFacing }
      : {};

    // p19 MOVEMENT IN WATER: "Jump jets cannot be fired while submerged. As
    // such, a 'Mech standing in Depth 1 water may not fire jump jets located in
    // its legs, and a 'Mech standing in Depth 2 or deeper water cannot jump at
    // all." Capture the jump MP the standing hex actually provides before the
    // move, so the result reports the same pool the validation spent (the unit
    // is standing in its landing hex by the time the result is built).
    const availableJumpMP = movementType === 'jump'
      ? this.movementCalc.getAvailableJumpMP(unit, state)
      : null;

    const validation = this.movementCalc.validateMovement(
      unit, path, movementType, state, moveOptions
    );

    if (!validation.valid) {
      return { success: false, error: `Invalid movement: ${validation.errors.join(', ')}` };
    }

    // Hidden units (p82): a 'Mech ordered into a hex containing a hidden enemy
    // 'Mech stops in the previous hex instead, and the hidden 'Mech is
    // revealed. Any later hex is the same rule - a unit cannot run through a
    // hidden 'Mech either. The move is re-validated against the shortened path
    // so MP and facing reflect where it actually stopped.
    //
    // Jumping is the exception (p82 Jumping): a jump ignores hidden 'Mechs in
    // hexes it passes over, and a jump into a hidden 'Mech's hex still lands
    // there (the stop-short rule is ground movement only).
    const isJump = movementType === 'jump';
    const blocker = this._hiddenUnitBlockingMove(state, unit, path, movementType);
    const effectivePath = blocker ? path.slice(0, blocker.index) : path;
    const landingHiddenId = isJump
      ? hiddenEnemyAt(state, path[path.length - 1], unit)
      : null;
    // "Jumping over hexes does not reveal 'Mechs hidden in them."
    const overflownHexes = isJump ? new Set(path.slice(1, -1)) : null;

    let effectiveValidation = validation;
    if (blocker) {
      effectiveValidation = effectivePath.length > 1
        ? this.movementCalc.validateMovement(unit, effectivePath, movementType, state)
        // Stopped in the hex it started in: no MP was spent and it did not turn.
        : { valid: true, totalCost: 0, errors: [], finalFacing: unit.position.facing };
    }

    this.stateManager.applyStateChange(() => {
      // p82: a hidden 'Mech is revealed at the start of its own move.
      revealOnMove(state, unit.id);

      // Hidden 'Mechs this move gives away; p82 says they cannot move this
      // phase. The mover itself is not recorded - it is moving right now.
      const revealedByThisMove = [];

      // Running into a hidden 'Mech reveals it as well, and a jump into its
      // hex lands and reveals it (p82 Jumping).
      if (blocker && revealUnit(state, blocker.unitId)) {
        revealedByThisMove.push(blocker.unitId);
      }
      if (landingHiddenId && revealUnit(state, landingHiddenId)) {
        revealedByThisMove.push(landingHiddenId);
      }

      unit.position.hexKey = effectivePath[effectivePath.length - 1];
      // A unit stopped in its starting hex never entered the blocked hex and
      // does not turn; a real move keeps the validated final facing.
      if (effectivePath.length > 1 && effectiveValidation.finalFacing !== undefined) {
        unit.position.facing = effectiveValidation.finalFacing;
      }
      unit.hexesMoved = effectivePath.length - 1;

      // p50 "Fire": a 'Mech absorbs 2 Heat Points "for each burning hex it moved
      // through during the Movement Phase". Record the burning hexes actually
      // entered (a jump only enters its landing hex) with the turn, so the Heat
      // Phase can charge them and a list from an earlier turn is ignored.
      const enteredHexes = movementType === 'jump'
        ? effectivePath.slice(-1)
        : effectivePath.slice(1);
      const burningHexes = Array.isArray(state.fireHexes) ? state.fireHexes : [];
      unit._burningHexesMovedThrough = {
        turn: state.turn,
        hexes: enteredHexes.filter(hexKey => burningHexes.includes(hexKey))
      };

      // p82: a 'Mech that ends its move next to a hidden enemy reveals THAT
      // ENEMY - the mover is not given away by adjacency. A hidden mover was
      // already revealed above, at the start of its move.
      revealedByThisMove.push(
        ...revealOnAdjacentMove(state, unit.id, { excludeHexes: overflownHexes })
      );

      // p82 Buildings: moving into or ending next to a building hex reveals
      // every hidden enemy 'Mech in that building.
      revealedByThisMove.push(
        ...revealInBuildings(state, unit.id, { excludeHexes: overflownHexes })
      );

      this._noteRevealedMovement(state, revealedByThisMove);

      switch (movementType) {
        case 'walk': unit._movementModifier = 1; break;
        case 'run': unit._movementModifier = 2; break;
        case 'jump': unit._movementModifier = 3; break;
        default: unit._movementModifier = 0;
      }

      // Urban movement (p67): entering a building hex at Level 0 costs a PSR
      // and damages the hex whether the roll succeeds or not.
      const destination = state.map.hexes.get(unit.position.hexKey);
      if (destination && destination.building && movementType !== 'jump') {
        this._enterBuilding(state, unit, destination);
      }

      // p54/p142 Piloting Skill Roll Table: the causes come from the hex the
      // 'Mech entered at the end of its move. p60 gives both woods rows "PSR
      // Modifier: No PSR", so woods are deliberately not read here; jungle
      // (+1 light / +2 heavy), sand (+1) and rubble (0) are. Water carries its
      // depth: Depth 1 -1, Depth 2 0, Depth 3+ +1, Depth 0 no PSR at all.
      const terrainType = destination ? destination.terrainType : null;
      const waterDepth = destination ? this.movementCalc.waterDepthOf(destination) : 0;
      const psrTriggers = this.psrCalc.getPSRTriggers(unit, {
        isSkidding: false,
        type: movementType,
        enteredLightJungle: terrainType === 'light_jungle',
        enteredHeavyJungle: terrainType === 'heavy_jungle',
        enteredSand: terrainType === 'sand',
        enteredRubble: terrainType === 'rubble',
        enteredWater: waterDepth > 0,
        waterDepth,
        terrainPSR: destination ? terrainPSRModifier(destination) : { modifier: 0, reasons: [] },
        weatherPSR: psrModifier(state.weather)
      }, state);

      if (psrTriggers.length > 0) {
        const psrResult = this.psrCalc.makePSR(unit, this.diceRoller, psrTriggers);
        if (!psrResult.passed) {
          // p56: "Unless stated otherwise, 'Mech falls are 0-level falls; this
          // includes 'Mechs that fall due to jumping." Only a displacement
          // downwards two or more levels (p55) changes the number of levels
          // fallen; displacement is not modelled on a normal move, so a failed
          // movement PSR is always a 0-level fall regardless of the drop.
          this.applyFall(unit, { levelsFallen: 0, causeTriggers: psrTriggers });
        }
      }
    });

    this.eventBus.emit('unitMoved', { unitId: unit.id, hexKey: unit.position.hexKey, facing: unit.position.facing });

    // Minefields (p.75-79) attack as soon as a 'Mech enters the mined hex.
    // Only the hexes actually entered count; the blocked hex was never entered.
    // p82 gives a hidden 'Mech's own starting hex a trigger as well if it walks
    // or runs out of it.
    const minefieldExitHex = wasHidden &&
      (movementType === 'walk' || movementType === 'run') &&
      effectivePath.length > 1 &&
      minefieldAt(state, path[0])
      ? path[0]
      : null;
    const minefields = this._resolveMinefields(unit, effectivePath, movementType,
      minefieldExitHex ? { extraHexes: [minefieldExitHex] } : undefined);

    return {
      success: true,
      unitId: unit.id,
      finalHex: unit.position.hexKey,
      // p19: a jump spends the Jumping MP available from the standing hex
      // (submerged jets do not contribute), not the dry-land rating.
      remainingMP: Math.max(0,
        (availableJumpMP ?? this.movementCalc.getMaxMP(unit, movementType))
        - effectiveValidation.totalCost),
      facing: unit.position.facing,
      // p18: a jump reports the facing it actually landed with - the hexside
      // chosen in the action, or the take-off facing when none was given.
      ...(isJump ? { landingFacing: unit.position.facing } : {}),
      minefields,
      ...(blocker ? { stoppedShortOf: blocker.unitId } : {})
    };
  }

  /**
   * The first hex on `path` where a hidden enemy of `unit` waits (p82).
   * Returns `{ index, unitId, hexKey }` for the blocked hex, or null.
   *
   * The stop-short rule is ground movement only (p82 Jumping): a jump lands in
   * the hex it was ordered into, so a jump never has a blocker.
   */
  _hiddenUnitBlockingMove(state, unit, path, movementType = 'walk') {
    if (movementType === 'jump') return null;

    for (let i = 1; i < path.length; i++) {
      const hiddenUnitId = hiddenEnemyAt(state, path[i], unit);
      if (hiddenUnitId) return { index: i, unitId: hiddenUnitId, hexKey: path[i] };
    }
    return null;
  }

  /**
   * p82: "Hidden 'Mechs revealed in these ways cannot move that phase."
   *
   * The marker lives on the unit's `hiddenUnits` entry (`cannotMoveTurn`) so it
   * round-trips through save/load and replay; projections drop `hiddenUnits`
   * wholesale, so it never reaches a client. The engine has no general
   * per-unit/Movement-Phase state, and a turn has exactly one Movement Phase,
   * so a turn number is enough to expire it.
   */
  _noteRevealedMovement(state, unitIds) {
    if (!Array.isArray(unitIds) || unitIds.length === 0) return;

    for (const unitId of unitIds) {
      const entry = state.hiddenUnits && state.hiddenUnits[unitId];
      if (entry) entry.cannotMoveTurn = state.turn;
    }
  }

  /** Has `unitId` been revealed by enemy movement this turn? (p82) */
  _cannotMoveAfterReveal(unitId) {
    const state = this.stateManager.getState();
    const entry = state.hiddenUnits && state.hiddenUnits[unitId];
    return Boolean(entry && entry.cannotMoveTurn === state.turn);
  }

  /**
   * Resolve minefields triggered by a move (p.79, p82).
   *
   * Walking or running through a mined hex triggers the field; a jumping
   * 'Mech only triggers the field in its landing hex.  A field that is
   * triggered and inflicts damage loses one Damage Value grouping, and one at
   * zero has no further effect.
   *
   * `extraHexes` carries the starting hex of a hidden 'Mech that walked or ran
   * out of a mined hex: p82 gives that hex's minefield a trigger too.
   */
  _resolveMinefields(unit, path, movementType, { extraHexes = [] } = {}) {
    const state = this.stateManager.getState();
    const entered = [...extraHexes, ...minefieldHexesEntered(path, movementType)]
      .filter((hexKey, index, all) => all.indexOf(hexKey) === index);
    const results = [];

    for (const hexKey of entered) {
      const field = minefieldAt(state, hexKey);
      if (!field) continue;

      const resolution = resolveMinefieldTrigger(field, this.diceRoller);
      if (resolution.strengthBefore <= 0) continue;

      if (resolution.triggered && resolution.hits.length > 0) {
        this.stateManager.applyStateChange(() => {
          for (const hit of resolution.hits) {
            hit.damageResult = this._applyDamageTo(unit, hit.location, hit.damage, hit.isRear);
          }
          field.strength = resolution.strengthAfter;

          // A minefield attack gives a hidden 'Mech away (p82).
          revealUnit(state, unit.id);
        });
      }

      // The controlling player announces the field and its roll (p.79), so a
      // miss is reported too; the field simply stays active.
      const payload = { ...resolution, unitId: unit.id, hexKey };
      results.push(payload);
      this.eventBus.emit('minefieldTriggered', payload);

      if (typeof unit.isDestroyed === 'function' && unit.isDestroyed()) {
        this.eventBus.emit('unitDestroyed', { unitId: unit.id });
        break;
      }
    }

    return results;
  }

  /**
   * Reset the unit's fired-weapon record when it belongs to another turn.
   *
   * p24's "once per turn" is per mounted instance, and the record is a Set on
   * the unit itself, so no two units can ever share it. The set only holds
   * keys for the current turn: the turn number alongside it is what resets it.
   *
   * @returns {Set<string>} the unit's current-turn fired-instance keys
   */
  _ensureFiredWeaponsRecord(unit, state) {
    if (!(unit.firedWeaponsThisTurn instanceof Set) || unit.firedWeaponsTurn !== state.turn) {
      unit.firedWeaponsThisTurn = new Set();
      unit.firedWeaponsTurn = state.turn;
    }
    return unit.firedWeaponsThisTurn;
  }

  /**
   * Decide which MOUNTED instance a declaration names.
   *
   * - `action.weaponIndex` (an index into `unit.equipment.weapons`) names the
   *   instance exactly. The UI sends it, so two identical weapons in one
   *   location are two independent declarations.
   * - Without an index - every caller written before per-instance identity -
   *   the first instance of that weapon in the requested location that has not
   *   fired and whose component is still intact is allocated. A destroyed mount
   *   cannot fire, so it never shadows its surviving sibling; when nothing is
   *   left the first candidate is returned, so validation reports the familiar
   *   "already fired" or "has been destroyed" error.
   *
   * An explicit index is still checked against the declared weapon and
   * location, so it cannot be used to fire a weapon the declaration does not
   * name.
   *
   * @returns {{ok: true, entry: object, weaponIndex: number}|
   *   {ok: false, error: string}}
   */
  _resolveMountedWeapon(attacker, action, matches, mounted) {
    const weaponDef = action.weapon;

    if (action.weaponIndex !== undefined && action.weaponIndex !== null) {
      const weaponIndex = Number(action.weaponIndex);
      const entry = Number.isInteger(weaponIndex) ? mounted[weaponIndex] : undefined;
      if (!entry) {
        return {
          ok: false,
          error: `Weapon ${weaponDef.id} is not mounted at index ${action.weaponIndex}`
        };
      }
      if (entry.type !== weaponDef.id && entry.type !== weaponDef.type) {
        return { ok: false, error: `Weapon ${weaponDef.id} is not mounted at index ${weaponIndex}` };
      }
      if (action.weaponLocation && entry.location !== action.weaponLocation) {
        return {
          ok: false,
          error: `Weapon ${weaponDef.id} is not mounted in ${action.weaponLocation} at index ${weaponIndex}`
        };
      }
      return { ok: true, entry, weaponIndex };
    }

    const candidates = action.weaponLocation
      ? matches.filter(w => w.location === action.weaponLocation)
      : matches;
    if (candidates.length === 0) {
      return { ok: false, error: `Weapon ${weaponDef.id} is not mounted in ${action.weaponLocation}` };
    }

    const unfired = candidates.filter(candidate => !this._weaponInstanceFired(
      attacker, weaponDef, candidate, mounted.indexOf(candidate)
    ));
    const intact = unfired.find(candidate =>
      !isWeaponMountDestroyed(attacker, mounted.indexOf(candidate)));
    const entry = intact || unfired[0] || candidates[0];
    return { ok: true, entry, weaponIndex: mounted.indexOf(entry) };
  }

  /**
   * Has this mounted instance already fired this turn?
   *
   * Reads the per-instance key first, then the pre-instance model key: a
   * record written before per-instance identity (or by a caller that still
   * uses the old key) is the conservative reading that the model has fired.
   * The caller has already discarded a record from an earlier turn.
   */
  _weaponInstanceFired(attacker, weaponDef, entry, weaponIndex) {
    const fired = attacker.firedWeaponsThisTurn;
    if (!(fired instanceof Set)) return false;
    if (fired.has(weaponInstanceKey(weaponDef.id, entry.location, weaponIndex))) return true;
    return fired.has(weaponModelKey(weaponDef.id, entry.location));
  }

  /**
   * Validate a weapon declaration before any heat, ammo or dice are spent
   * (p24 "a 'Mech can fire each weapon only once per turn", p31 ammunition,
   * p46 destroyed weapons).
   *
   * The once-per-turn check is per mounted INSTANCE (`weaponIndex` in
   * `unit.equipment.weapons`), not per weapon model: firing one of the Atlas'
   * two right-arm medium lasers must leave the other one able to fire. The p46
   * destroyed check is per mounted COMPONENT (`WeaponMounts.js`): a multi-slot
   * weapon dies with any of its slots, while one destroyed single-slot mount
   * does not take its identical sibling with it.
   *
   * @returns {{ok: boolean, error?: string, weaponLocation?: string,
   *   ammoBin?: string|null, key?: string, weaponIndex?: number}}
   */
  _validateWeaponDeclaration(attacker, action, state) {
    const weaponDef = action.weapon;
    if (!weaponDef || !weaponDef.id) return { ok: false, error: 'No weapon declared' };

    const mounted = (attacker.equipment && attacker.equipment.weapons) || [];
    const matches = mounted.filter(w => w.type === weaponDef.id || w.type === weaponDef.type);
    if (matches.length === 0) return { ok: false, error: `Weapon ${weaponDef.id} is not mounted` };

    this._ensureFiredWeaponsRecord(attacker, state);

    const resolved = this._resolveMountedWeapon(attacker, action, matches, mounted);
    if (!resolved.ok) return resolved;
    const { entry, weaponIndex } = resolved;

    // p24: one attack per weapon INSTANCE per turn.
    const key = weaponInstanceKey(weaponDef.id, entry.location, weaponIndex);
    if (this._weaponInstanceFired(attacker, weaponDef, entry, weaponIndex)) {
      return { ok: false, error: `Weapon ${weaponDef.id} has already fired this turn` };
    }

    // p46: a mount whose own critical-slot component is destroyed cannot fire.
    // A multi-slot weapon is one component (any destroyed slot disables it), and
    // two identical single-slot mounts are two components (losing one slot
    // disables only the mount that occupies it). WeaponMounts.js owns that
    // mapping, and the UI picker reads the same helper.
    if (isWeaponMountDestroyed(attacker, weaponIndex)) {
      return { ok: false, error: `Weapon ${weaponDef.id} has been destroyed` };
    }

    // p31: ammunition comes from a real bin with enough shots.
    let ammoBin = action.ammoBin || null;
    const usesAmmo = typeof weaponDef.usesAmmo === 'function' ? weaponDef.usesAmmo() : Boolean(weaponDef.ammoPerShot);
    if (usesAmmo) {
      const ammo = (attacker.equipment && attacker.equipment.ammo) || {};
      const needed = weaponDef.ammoPerShot || 1;

      if (ammoBin) {
        const bin = ammo[ammoBin];
        if (!bin) return { ok: false, error: `No ammunition bin named ${ammoBin}` };
        if (bin.type && bin.type !== weaponDef.id) {
          return { ok: false, error: `Ammunition bin ${ammoBin} does not feed ${weaponDef.id}` };
        }
        if ((bin.shots || 0) < needed) return { ok: false, error: `Ammunition bin ${ammoBin} is empty` };
      } else {
        // p31: the automatic pick must be a bin for this weapon, not just any bin.
        ammoBin = Object.keys(ammo).find(name => {
          const bin = ammo[name];
          const feeds = !bin.type || bin.type === weaponDef.id;
          return feeds && (bin.shots || 0) >= needed;
        }) || null;
        if (!ammoBin) return { ok: false, error: `No ammunition remaining for ${weaponDef.id}` };
      }
    } else {
      ammoBin = null;
    }

    return { ok: true, weaponLocation: entry.location, ammoBin, key, weaponIndex };
  }

  _handleFire(playerId, action) {
    if (!this.attackResolver) {
      return { success: false, error: 'Combat resolver not initialized' };
    }

    const state = this.stateManager.getState();
    const attacker = state.getUnit(action.attackerId);
    const target = state.getUnit(action.targetId);

    if (!attacker) return { success: false, error: 'Attacker not found' };
    if (!target) return { success: false, error: 'Target not found' };

    // p52/p58: shut-down 'Mechs and 'Mechs with an unconscious warrior cannot
    // attack or take any other action (the queue validation has the same guard;
    // this catches direct callers too).
    if (this.phaseManager.isDestroyedUnit(attacker)) {
      return { success: false, error: 'Attacker has been destroyed' };
    }
    if (this.phaseManager.isImmobile(attacker)) {
      return {
        success: false,
        error: attacker.shutdown
          ? 'A shut-down Mech cannot fire'
          : 'A MechWarrior who is unconscious cannot fire'
      };
    }

    // Hidden units (p82) cannot be targeted until revealed.
    if (!canSee(playerId, target.id, state)) {
      return { success: false, error: 'Target is hidden' };
    }

    const weaponDef = action.weapon;

    // p24/p31/p46: the declaration must name a mounted weapon INSTANCE that has
    // not already fired this turn, is not destroyed, and has ammo. A caller
    // that did not name an instance learns which one was allocated.
    let declaration = null;
    if (this.enforceWeaponDeclarations) {
      declaration = this._validateWeaponDeclaration(attacker, action, state);
      if (!declaration.ok) return { success: false, error: declaration.error };
      if (!action.weaponLocation) action.weaponLocation = declaration.weaponLocation;
      if (declaration.ammoBin) action.ammoBin = declaration.ammoBin;
      // Canonicalise the instance index: an explicit one was validated by the
      // declaration, and a legacy caller that named none gets its allocation.
      if (Number.isInteger(declaration.weaponIndex)) action.weaponIndex = declaration.weaponIndex;
    }

    // p72 "Combat Within Buildings" is scoped to 'Mechs in the SAME building:
    // the same building hex on different levels, or different hexes of a
    // multi-hex building. Only that pair gets the p72 LOS rule and the +1
    // target modifier. buildingCombat reads the building level each unit
    // occupies (position.level; units with no level are inside on the ground
    // floor) and handles roof occupants, who are not "inside" and get no
    // inside modifier.
    const urban = buildingCombat(attacker, target, state);
    const combatWithinBuilding = urban.sameBuilding;

    // Indirect fire (p30) needs a friendly spotter with line of sight, and the
    // attacker must not have a line of sight of its own.
    let indirect = null;
    if (action.indirect) {
      indirect = this._validateIndirectFire(attacker, target, weaponDef, action.spotterId, state);
      if (!indirect.valid) return { success: false, error: indirect.reason };
    } else if (!combatWithinBuilding) {
      // Everything else is NOT p72 combat within a building, so p72's
      // modifications do not apply.
      // - A shot from outside into a building (including a roof 'Mech firing
      //   at a 'Mech inside another building) uses p71 "Attacking 'Mechs
      //   Inside Buildings": the target's own building hex does not count, but
      //   every intervening building hex blocks the line (whatever its
      //   height), and there is no +1 target modifier. The building's CF
      //   absorption still protects the inside target below.
      // - Otherwise the generic p22 LOS applies unchanged.
      if (urban.targetInside && urban.interveningHexes > 0) {
        const count = urban.interveningHexes;
        return {
          success: false,
          error: `LOS blocked by ${count} intervening building hex${count === 1 ? '' : 'es'}`
        };
      }
      const losResult = this.los.calculateLOS(
        attacker.position.hexKey, target.position.hexKey, state, { attacker, target }
      );
      if (losResult.blocked) {
        return { success: false, error: `LOS blocked: ${losResult.reason}` };
      }
    }

    // p72's own LOS rule, for a same-building pair only: more than two
    // intervening building hexes/levels block the line.
    if (combatWithinBuilding && urban.losBlocked) {
      return {
        success: false,
        error: `LOS blocked by ${urban.intervening} intervening building hexes/levels`
      };
    }

    // Firing arcs (p24): reject an out-of-arc shot before any ammo or heat is
    // spent, so an illegal declaration costs nothing.
    if (action.weaponLocation) {
      const arcCheck = canWeaponFireAt(attacker, weaponDef, target.position.hexKey, {
        weaponLocation: action.weaponLocation
      });
      if (!arcCheck.legal) {
        return { success: false, error: `Weapon cannot fire: ${arcCheck.reason}` };
      }
    }

    if (weaponDef.usesAmmo() && action.ammoBin) {
      const hasAmmo = attacker.consumeAmmo(action.ammoBin, weaponDef.ammoPerShot);
      if (!hasAmmo) {
        return { success: false, error: 'No ammo for weapon' };
      }
    }

    // Secondary target modifier (p27): the first target of the phase is free,
    // every other target costs +1 forward or +2 in the side/rear arcs.
    const attacked = attacker.targetsAttackedThisPhase instanceof Set
      ? attacker.targetsAttackedThisPhase
      : new Set();
    let multipleTargetModifier = 0;
    if (attacked.size > 0 && !attacked.has(target.id)) {
      const arc = getTargetArc(attacker, target.position.hexKey);
      multipleTargetModifier = arc === ARC.FORWARD ? 1 : 2;
    }

    let result = null;

    this.stateManager.applyStateChange(() => {
      // The resolver applies the through-armour critical (p32/p139) while it
      // resolves the hit, so it runs inside the state change: the critical
      // belongs to this action, not to the snapshot taken before it (history
      // and the state diff must both see it).
      result = this.attackResolver.resolveWeaponAttack(
        attacker, weaponDef, { location: action.weaponLocation }, target, state, this.diceRoller,
        {
          indirect: Boolean(action.indirect),
          spotter: indirect ? indirect.spotter : null,
          spotterAttacked: Boolean(indirect && indirect.spotter.attackedThisPhase),
          aimedLocation: action.aimedLocation,
          multipleTargetModifier,
          // p72's +1 inside / +1 per intervening building hex-or-level is
          // scoped to 'Mechs in the same building; p71 outside-into-inside
          // attacks carry no such target modifier.
          buildingModifier: combatWithinBuilding ? urban.modifier : 0
        }
      );

      // Weapon heat, plus design quirks such as Poor Cooling Jacket (p88).
      attacker.heat += weaponDef.heat + quirkHeatModifier(attacker, weaponDef);

      // Attack and spotting records for the rest of this phase (p30).
      attacker.attackedThisPhase = true;
      if (!(attacker.targetsAttackedThisPhase instanceof Set)) {
        attacker.targetsAttackedThisPhase = new Set();
      }
      attacker.targetsAttackedThisPhase.add(target.id);
      if (indirect && indirect.spotter) {
        indirect.spotter.spottedThisPhase = target.id;
      }

      // Remember which arms fired: a physical attack cannot use that arm (p38).
      if (action.weaponLocation) {
        if (!(attacker.firedThisTurn instanceof Set)) attacker.firedThisTurn = new Set();
        attacker.firedThisTurn.add(action.weaponLocation);
      }

      // p24: this mounted instance has now fired this turn.
      if (declaration && declaration.key) attacker.firedWeaponsThisTurn.add(declaration.key);

      // Hidden units (p82): firing reveals the attacker, hit or miss.  Run
      // before the damage/attack emits so projections already see the reveal.
      revealOnFire(state, attacker.id);

      if (result.hit) {
        // Fire is rolled for at the end of the phase, once per hit (p63).
        this._recordFireCandidate(state, target.position.hexKey, weaponDef);

        const targetHex = state.map.hexes.get(target.position.hexKey);

        for (const hitLoc of result.hitLocations) {
          // A hit absorbed by partial cover does nothing to the Mech (p26).
          if (hitLoc.absorbedByCover) {
            hitLoc.damageResult = { absorbedByCover: true, coverHex: hitLoc.coverHex };
            continue;
          }

          // Urban cover (p72): a building absorbs up to CF/10 of each hit and
          // takes that damage itself; the remainder reaches the target. The
          // protection uses the CF at the start of the phase, and the hex's CF
          // is only charged once the phase ends (see applyPendingBuildingDamage).
          // Only a 'Mech INSIDE the building is protected: a roof occupant is
          // not inside it, so it takes the full hit and the hex's CF is not
          // reduced (buildingCombat locates the target with the position.level
          // model: position.level >= building.levels means the roof).
          if (urban.targetInside) {
            const reduction = damageReduction(targetHex);
            const absorbed = Math.min(hitLoc.damage, reduction);
            if (absorbed > 0) {
              hitLoc.damage -= absorbed;
              hitLoc.buildingAbsorbed = absorbed;
              targetHex._pendingCFDamage = (targetHex._pendingCFDamage || 0) + absorbed;
              if (!(state._buildingCollapseQueue instanceof Set)) {
                state._buildingCollapseQueue = new Set();
              }
              state._buildingCollapseQueue.add(targetHex.hexKey);
            }
            if (hitLoc.damage <= 0) {
              hitLoc.damageResult = { absorbedByBuilding: absorbed };
              continue;
            }
          }

          const damageResult = this._applyDamageTo(target, hitLoc.location, hitLoc.damage, hitLoc.isRear);
          hitLoc.damageResult = damageResult;

          // p58: a head hit injures the MechWarrior, armour or no armour, and
          // the damage forces an immediate Consciousness Roll.
          if (hitLoc.location === 'head' && typeof target.applyPilotDamage === 'function') {
            const pilotHitsBefore = target.pilot ? (target.pilot.hits || 0) : 0;
            target.applyPilotDamage(1);
            hitLoc.pilotDamage = 1;
            this.rollConsciousnessForNewPilotHits(target, pilotHitsBefore);
          }
        }
      }
    });

    if (result.hit) {
      for (const hitLoc of result.hitLocations) {
        this.eventBus.emit('damageApplied', {
          attackerId: attacker.id,
          targetId: target.id,
          location: hitLoc.location,
          damage: hitLoc.damage,
          result: hitLoc.damageResult
        });

        if (target.isDestroyed()) {
          this.eventBus.emit('unitDestroyed', { unitId: target.id });
          break;
        }
      }
    }

    this.eventBus.emit('unitAttacked', toTransferable({ attackerId: attacker.id, targetId: target.id, result }));

    result.success = true;
    // Which mounted instance resolved the declaration (p24): a caller that did
    // not name one gets the allocated index back, and `fireWeapons` reports it
    // per shot so identical mounts stay distinguishable.
    if (Number.isInteger(action.weaponIndex)) result.weaponIndex = action.weaponIndex;
    return result;
  }

  /**
   * Resolve a whole weapon declaration: every checked weapon of one 'Mech at
   * one target, in a single per-'Mech declaration slot (p24/p31).
   *
   * The single-shot `fire` action spends the unit's declaration slot on its
   * own, so a UI that called it once per checked weapon lost every shot after
   * the first to "Not your turn" - the queue had already advanced. This action
   * runs each shot through the same `_handleFire` path (declaration validation,
   * arc, range, LOS, heat, ammo and hit resolution all stay in one place),
   * collects a per-shot result, and lets `processAction` advance the queue
   * exactly once.
   *
   * A rejected shot does not abort the rest of the declaration: it is reported
   * in `shots` with `success:false` and its `error`, while the accepted shots
   * still resolve. If every shot is rejected the action fails and no slot is
   * spent (the caller can retry with a legal weapon), matching the single-shot
   * failure behaviour.
   *
   * Each shot keeps its own mounted-instance identity (p24): `shot.weaponIndex`
   * is handed to `_handleFire` unchanged, so two identical weapons in one
   * location are two shots and each result reports the instance it used.
   *
   * @param {number} playerId
   * @param {{attackerId: string, targetId: string,
   *   shots: Array<{weapon: object, weaponLocation?: string, weaponIndex?: number,
   *     ammoBin?: string, indirect?: boolean, spotterId?: string,
   *     aimedLocation?: string}>}} action
   * @returns {{success: boolean, attackerId: string, targetId: string,
   *   fired: number, rejected: number, shots: Array<object>, error?: string}}
   */
  _handleFireWeapons(playerId, action) {
    const shots = Array.isArray(action.shots) ? action.shots : [];
    const results = [];
    let fired = 0;
    let firstError = null;

    for (const shot of shots) {
      // A malformed entry is reported per shot like any other rejection; the
      // single-shot path assumes it was handed a weapon.
      if (!shot || !shot.weapon) {
        const error = 'No weapon declared';
        if (!firstError) firstError = error;
        results.push({
          weapon: null, weaponLocation: null, weaponIndex: null, ammoBin: null,
          success: false, error
        });
        continue;
      }

      // Each shot reuses the single-shot path with its own action object, so a
      // declaration that resolves the ammo bin, weapon location or instance
      // index cannot leak into the next shot's validation.
      const fireAction = {
        type: 'fire',
        attackerId: action.attackerId,
        targetId: action.targetId,
        weapon: shot.weapon,
        weaponLocation: shot.weaponLocation,
        ammoBin: shot.ammoBin || null
      };
      if (shot.weaponIndex !== undefined && shot.weaponIndex !== null) {
        fireAction.weaponIndex = shot.weaponIndex;
      }
      if (shot.indirect) {
        fireAction.indirect = true;
        fireAction.spotterId = shot.spotterId;
      }
      if (shot.aimedLocation) fireAction.aimedLocation = shot.aimedLocation;

      const result = this._handleFire(playerId, fireAction);
      if (result && result.success) {
        fired++;
      } else {
        const error = (result && result.error) || 'Weapon could not fire';
        if (!firstError) firstError = error;
      }

      results.push({
        weapon: fireAction.weapon,
        weaponLocation: fireAction.weaponLocation,
        // The instance the shot declared, or the one the declaration allocated;
        // a successful shot also reports it in `result.weaponIndex`.
        weaponIndex: fireAction.weaponIndex,
        ammoBin: fireAction.ammoBin,
        ...result
      });
    }

    return {
      success: fired > 0,
      attackerId: action.attackerId,
      targetId: action.targetId,
      fired,
      rejected: results.length - fired,
      shots: results,
      ...(fired === 0 ? { error: firstError || 'No weapon could fire' } : {})
    };
  }

  /**
   * Indirect fire validation (p30). LRMs may be fired at a target the attacker
   * cannot see, provided a friendly spotter can.
   */
  _validateIndirectFire(attacker, target, weaponDef, spotterId, state) {
    if (!weaponDef || weaponDef.type !== 'LRM') {
      return { valid: false, reason: 'Only LRM launchers may fire indirectly' };
    }

    const spotter = spotterId ? state.getUnit(spotterId) : null;
    if (!spotter) return { valid: false, reason: 'Indirect fire needs a spotter' };
    if (spotter.id === attacker.id) return { valid: false, reason: 'A Mech cannot spot for itself' };
    if (spotter.player !== attacker.player) return { valid: false, reason: 'The spotter must be friendly' };
    if (typeof spotter.isDestroyed === 'function' && spotter.isDestroyed()) {
      return { valid: false, reason: 'The spotter is destroyed' };
    }

    const attackerLOS = this.los.calculateLOS(
      attacker.position.hexKey, target.position.hexKey, state, { attacker, target }
    );
    if (!attackerLOS.blocked) {
      return { valid: false, reason: 'A Mech with line of sight cannot fire indirectly' };
    }

    const spotterLOS = this.los.calculateLOS(
      spotter.position.hexKey, target.position.hexKey, state, { attacker: spotter, target }
    );
    if (spotterLOS.blocked) {
      return { valid: false, reason: 'The spotter has no line of sight to the target' };
    }

    return { valid: true, spotter };
  }

  _handlePhysicalAttack(playerId, action) {
    const state = this.stateManager.getState();
    const attacker = state.getUnit(action.attackerId);
    const target = state.getUnit(action.targetId);

    if (!attacker || !target) return { success: false, error: 'Unit not found' };

    // p52/p58: an immobile 'Mech cannot make physical attacks either.
    if (this.phaseManager.isDestroyedUnit(attacker)) {
      return { success: false, error: 'Attacker has been destroyed' };
    }
    if (this.phaseManager.isImmobile(attacker)) {
      return {
        success: false,
        error: attacker.shutdown
          ? 'A shut-down Mech cannot make a physical attack'
          : 'A MechWarrior who is unconscious cannot make a physical attack'
      };
    }

    // Attacking across levels changes what is legal and which hit table
    // applies (Different Levels table, p140).
    const levelDifference = this._levelDifference(attacker, target, state);
    const attackerHex = state.map && state.map.hexes
      ? state.map.hexes.get(attacker.position.hexKey)
      : null;
    const options = {
      arm: action.arm,
      levelDifference,
      usePunchTable: Boolean(action.usePunchTable),
      // p19: jump jets cannot fire while submerged, so a 'Mech standing in
      // Depth 2+ water cannot jump and cannot make a death from above attack.
      // The resolver has no map, so hand it the attacker's standing depth.
      waterDepth: this.movementCalc.waterDepthOf(attackerHex)
    };

    let result;

    switch (action.attackType) {
      case 'punch':
        result = this.physicalResolver.resolvePunch(attacker, target, this.diceRoller, options);
        break;
      case 'kick':
        result = this.physicalResolver.resolveKick(attacker, target, this.diceRoller, options);
        break;
      case 'charge':
        result = this.physicalResolver.resolveCharge(attacker, target, action.distanceCharged || 1, this.diceRoller, options);
        break;
      case 'dfa':
        result = this.physicalResolver.resolveDFA(attacker, target, this.diceRoller, options);
        break;
      case 'push':
        result = this.physicalResolver.resolvePush(attacker, target, this.diceRoller, options);
        break;
      case 'physicalWeapon':
        result = this.physicalResolver.resolvePhysicalWeapon(attacker, target, action.weaponId, this.diceRoller, options);
        break;
      default:
        return { success: false, error: `Unknown physical attack: ${action.attackType}` };
    }

    if (!result.success) return result;

    this.stateManager.applyStateChange(() => {
      if (result.hit && result.hitLocations) {
        for (const hitLoc of result.hitLocations) {
          hitLoc.damageResult = this._applyDamageTo(target, hitLoc.location, hitLoc.damage, false);
        }
      }

      if (result.type === 'dfa' && result.attackerDamage > 0) {
        this._applyDamageTo(attacker, 'leftLeg', result.attackerDamage, false);
        this._applyDamageTo(attacker, 'rightLeg', result.attackerDamage, false);
        if (result.attackerProne) {
          attacker.prone = true;
        }
      }

      // Physical attacks have consequences beyond damage (p54).
      result.psrRolls = this._resolvePhysicalConsequences(result, attacker, target);
    });

    // The payload must survive a postMessage/WebSocket hop, and the result
    // carries Weapon instances (R4).
    this.eventBus.emit('physicalAttackResolved', {
      attackerId: attacker.id,
      targetId: target.id,
      result: toTransferable(result)
    });

    return result;
  }

  /** Level difference between two units, target minus attacker (p140). */
  _levelDifference(attacker, target, state) {
    const hexes = state.map && state.map.hexes;
    const a = hexes ? hexes.get(attacker.position.hexKey) : null;
    const t = hexes ? hexes.get(target.position.hexKey) : null;
    if (!a || !t) return 0;
    return (t.level || 0) - (a.level || 0);
  }

  /**
   * PSRs caused by a physical attack (p54): a kick forces the target to roll,
   * a missed kick forces the attacker to roll, a charge forces both at +2, and
   * a missed DFA drops the attacker automatically.
   */
  _resolvePhysicalConsequences(result, attacker, target) {
    const rolls = [];

    const attempt = (unit, modifier, label) => {
      const psr = this.psrCalc.makePSR(unit, this.diceRoller, [{ trigger: label, baseModifier: modifier }]);
      if (!psr.passed) unit.prone = true;
      rolls.push({
        unitId: unit.id,
        label,
        modifier,
        roll: psr.roll,
        targetNumber: psr.targetNumber,
        passed: psr.passed,
        fell: !psr.passed
      });
    };

    if (result.type === 'kick') {
      if (result.hit) attempt(target, 0, 'Kicked');
      else attempt(attacker, 0, 'Missed kick');
    } else if (result.type === 'charge' && result.hit) {
      attempt(attacker, 2, 'Successful charge');
      attempt(target, 2, 'Charged');
    } else if (result.type === 'dfa') {
      if (result.hit) {
        attempt(attacker, 4, 'Successful DFA');
      } else {
        attacker.prone = true;
        rolls.push({ unitId: attacker.id, label: 'DFA miss', automaticFall: true, fell: true });
      }
    }

    return rolls;
  }

  /**
   * Remember a hex that was hit this phase; the ignition roll happens at the
   * end of the phase so firing stays deterministic (p63).
   */
  _recordFireCandidate(state, hexKey, weaponDef) {
    if (!state._fireCandidates) state._fireCandidates = [];
    state._fireCandidates.push({
      hexKey,
      weaponId: weaponDef.id,
      weaponType: weaponDef.type
    });
  }

  /**
   * End Phase fire resolution (p63-64): ignition rolls, spread downwind,
   * smoke, and damage to burning building hexes.
   */
  resolveEndPhaseFire() {
    const state = this.stateManager.getState();
    const weather = state.weather || {};
    const temperature = Number.isFinite(weather.temperature) ? weather.temperature : 20;
    const windDirection = Number.isFinite(weather.windDirection) ? weather.windDirection : 0;

    const fireSet = new Set(state.fireHexes || []);
    const addFire = (hexKey) => {
      if (fireSet.has(hexKey)) return false;
      const hex = state.map.hexes.get(hexKey);
      if (!hex || !canBurn(hex)) return false;

      fireSet.add(hexKey);
      this.eventBus.emit('fireStarted', { hexKey });

      // p64: a burning hex fills the first two hexes downwind with smoke.
      for (const smokeKey of downwindHexes(hexKey, windDirection, 2)) {
        if (smokeKey === hexKey) continue;
        if (!state.smokeHexes[smokeKey]) {
          state.smokeHexes[smokeKey] = { level: 'light', turnsRemaining: 6 };
        }
      }
      return true;
    };

    // 1. Ignition rolls for every hex hit this phase.
    for (const candidate of state._fireCandidates || []) {
      const hex = state.map.hexes.get(candidate.hexKey);
      const result = attemptIgnition(
        { id: candidate.weaponId, type: candidate.weaponType },
        hex, this.diceRoller.roll2d6(), temperature
      );
      if (result.ignited) addFire(candidate.hexKey);
    }
    state._fireCandidates = [];

    // 2. Spread downwind on a 12.
    for (const hexKey of [...fireSet]) {
      if (!spreadsOnRoll(this.diceRoller.roll2d6())) continue;
      for (const target of downwindHexes(hexKey, windDirection, spreadDistance(weather.wind))) {
        addFire(target);
      }
    }

    // 3. Buildings on fire lose 2 CF every End Phase.
    for (const hexKey of fireSet) {
      const hex = state.map.hexes.get(hexKey);
      if (hex && hex.building) {
        hex.building.currentCF = Math.max(0, hex.building.currentCF - BUILDING_FIRE_CF_LOSS);
      }
    }

    state.fireHexes = [...fireSet];
    return state.fireHexes;
  }

  /**
   * Book a Battlefield Support strike (p.75-79).  The acting player is the
   * owner by default and the type's BSP cost is spent from
   * `state.battlefieldSupport.points`; an insufficient pool or invalid
   * schedule is refused without touching the queue or the point pool.
   *
   * @param {object} schedule - { hexKey, turn?, type, owner? }
   * @param {number|string|null} [playerId] - acting player (defaults to state.currentPlayer)
   * @returns {{success: true, strike: object}|{success: false, error: string}}
   */
  scheduleSupportStrike(schedule = {}, playerId = null) {
    const state = this.stateManager.getState();

    try {
      let record = null;
      this.stateManager.applyStateChange(() => {
        record = scheduleStrike(state, {
          ...schedule,
          owner: schedule.owner === undefined || schedule.owner === null
            ? (playerId === null || playerId === undefined ? state.currentPlayer : playerId)
            : schedule.owner
        });
      });

      this.eventBus.emit('supportStrikeScheduled', { ...record });
      return { success: true, strike: record };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * End Phase battlefield support (p.75-79): resolve every strike scheduled
   * for this turn with the Battlefield Support table's Target Number and
   * Damage Value groupings, then expire it.
   */
  resolveScheduledSupport() {
    const state = this.stateManager.getState();
    const due = dueSupportStrikes(state);
    if (due.length === 0) return [];

    const units = Object.values(state.units)
      .map(unit => ({
        id: unit.id,
        hexKey: unit.position && unit.position.hexKey
      }))
      .filter(unit => typeof unit.hexKey === 'string');

    const resolutions = [];
    const destroyed = new Set();

    this.stateManager.applyStateChange(() => {
      for (const strike of due) {
        const resolution = resolveSupportStrike(strike, {
          diceRoller: this.diceRoller,
          units
        });
        const areaEffect = resolution.weaponType === 'AE';

        for (const hit of resolution.hits) {
          const unit = state.getUnit(hit.unitId);
          if (!unit) continue;
          if (typeof unit.isDestroyed === 'function' && unit.isDestroyed()) continue;

          hit.damageResult = this._applyDamageTo(
            unit, hit.location, hit.damage, Boolean(hit.isRear)
          );

          // Area-effect attacks reveal hidden 'Mechs in the blast (p82).
          if (areaEffect) revealUnit(state, unit.id);

          if (typeof unit.isDestroyed === 'function' && unit.isDestroyed()) {
            destroyed.add(unit.id);
          }
        }

        resolutions.push(resolution);
      }

      // One-use only: the strike expires whether it hit or missed (p.75).
      for (const strike of due) {
        expireSupportStrike(state, strike);
      }
    });

    for (const resolution of resolutions) {
      this.eventBus.emit('supportStrikeResolved', resolution);
    }
    for (const unitId of destroyed) {
      this.eventBus.emit('unitDestroyed', { unitId });
    }

    return resolutions;
  }

  _handleEndPhase(playerId) {
    // End-of-phase work (banked building CF damage, per-phase snapshots) is
    // applied by PhaseManager.nextPhase as it leaves the current phase (p72).
    const nextPhase = this.phaseManager.nextPhase();
    return { success: true, nextPhase };
  }

  /**
   * Collapse any building hexes that attacks reduced to zero during the phase.
   */
  _resolvePendingBuildingCollapses() {
    const state = this.stateManager.getState();
    const queue = state._buildingCollapseQueue;
    if (!queue || queue.size === 0) return;

    for (const hexKey of [...queue]) {
      const hex = state.map.hexes.get(hexKey);
      if (hex && hex.building && hex.building.currentCF <= 0) {
        this._collapseBuildingHex(state, hex);
      }
    }
    queue.clear();
  }

  /**
   * Moving into a building hex at Level 0 (p67): a PSR modified by the building
   * type, the hex takes tonnage/10 damage whatever the roll, and a failed roll
   * costs the Mech the same damage.
   */
  _enterBuilding(state, unit, hex) {
    const building = hex.building;
    const damage = entryDamage(unit);

    if (hex._cfAtPhaseStart === undefined) {
      hex._cfAtPhaseStart = building.currentCF ?? building.cf;
    }

    const psr = this.psrCalc.makePSR(unit, this.diceRoller, [
      { trigger: `Entering ${building.type} building`, baseModifier: entryPSRModifier(building.type) }
    ]);

    building.currentCF = Math.max(0, (building.currentCF ?? building.cf) - damage);

    if (!psr.passed) {
      // Damage from moving into the hex is applied before collapse damage (p73).
      const roll = this.diceRoller.roll2d6();
      const loc = this.attackResolver.determineHitLocation(roll, 'front');
      this._applyDamageTo(unit, loc.location, damage, loc.isRear ?? false);
    }

    this.eventBus.emit('buildingEntered', {
      unitId: unit.id, hexKey: hex.hexKey, damage, currentCF: building.currentCF
    });

    // Basements (p66): rolled once per hex per scenario, on the first Level-0
    // entry. A Mech heavier than the hex's CF at the start of the phase falls
    // through regardless of the roll.
    if (hex.basement === undefined) {
      hex.basement = rollBasement(this.diceRoller);
    }

    const cfAtPhaseStart = hex._cfAtPhaseStart ?? building.currentCF;
    const overweight = (unit.tonnage || 0) > cfAtPhaseStart;

    if (overweight || hex.basement.depth > 0) {
      const depth = Math.max(1, hex.basement.depth);
      const fallDamage = basementFallDamage(unit, depth);
      const locRoll = this.diceRoller.roll2d6();
      const loc = this.attackResolver.determineHitLocation(locRoll, 'front');
      this._applyDamageTo(unit, loc.location, fallDamage, loc.isRear ?? false);
      unit.prone = true;
      unit.basementDepth = depth;

      // The floor gives way and the building hex takes the damage.
      building.currentCF = Math.max(0, building.currentCF - basementCollapseDamage(unit, depth));

      this.eventBus.emit('unitFellIntoBasement', {
        unitId: unit.id, hexKey: hex.hexKey, depth, damage: fallDamage, overweight
      });
    }

    if (building.currentCF <= 0) {
      this._collapseBuildingHex(state, hex);
    }
  }

  /**
   * Collapse a building hex (p73). Occupants take the collapse damage, the hex
   * becomes rubble, and losing more than half of a multi-hex building brings
   * the rest of it down.
   */
  _collapseBuildingHex(state, hex) {
    const building = hex.building;
    if (!building) return;

    const cfAtPhaseStart = hex._cfAtPhaseStart ?? building.currentCF;
    const levelsAbove = Math.max(0, building.levels - 1);

    const occupants = Object.values(state.units).filter(u => u.position.hexKey === hex.hexKey);
    for (const occupant of occupants) {
      const damage = collapseDamage(cfAtPhaseStart, levelsAbove);
      const roll = this.diceRoller.roll2d6();
      const loc = this.attackResolver.determineHitLocation(roll, 'front');
      this._applyDamageTo(occupant, loc.location, damage, loc.isRear ?? false);
      this.eventBus.emit('buildingCollapsed', { hexKey: hex.hexKey, unitId: occupant.id, damage });
    }

    hex.terrainType = 'rubble';
    hex.building = { ...building, currentCF: 0 };

    if (BuildingRegistry.isMostlyDestroyed(building.id, state.map.hexes)) {
      for (const [, other] of state.map.hexes) {
        if (other.hexKey === hex.hexKey) continue;
        if (other.building && other.building.id === building.id && other.building.currentCF > 0) {
          this._collapseBuildingHex(state, other);
        }
      }
    }
  }

  /**
   * Torso twist (p25): declared in the weapon attack phase. It shifts the arm
   * and torso firing arcs one hexside and never changes the Mech's facing.
   */
  _handleTwistTorso(playerId, action) {
    const state = this.stateManager.getState();
    const unit = state.getUnit(action.unitId);
    if (!unit) return { success: false, error: 'Unit not found' };
    if (unit.player !== playerId) return { success: false, error: 'Not your unit' };
    if (this.phaseManager.currentPhase !== 'weapon_attack') {
      return { success: false, error: 'Torso twists are declared in the weapon attack phase' };
    }
    if (unit.prone) return { success: false, error: 'A prone Mech cannot twist' };
    if (unit.armsReversed) {
      return { success: false, error: 'Cannot twist and reverse arms in the same turn' };
    }

    const direction = action.direction === -1 ? -1 : action.direction === 1 ? 1 : 0;
    this.stateManager.applyStateChange(() => { unit.torsoTwist = direction; });
    return { success: true, unitId: unit.id, torsoTwist: direction };
  }

  /**
   * Reversing (flipping) arms (p24): both arms must lack hand and lower-arm
   * actuators, the Mech cannot twist in the same turn, and arm weapons then
   * fire into the rear arc.
   */
  _handleFlipArms(playerId, action) {
    const state = this.stateManager.getState();
    const unit = state.getUnit(action.unitId);
    if (!unit) return { success: false, error: 'Unit not found' };
    if (unit.player !== playerId) return { success: false, error: 'Not your unit' };
    if (this.phaseManager.currentPhase !== 'weapon_attack') {
      return { success: false, error: 'Arms are reversed in the weapon attack phase' };
    }
    if (unit.prone) return { success: false, error: 'A prone Mech cannot reverse its arms' };
    if (unit.torsoTwist) {
      return { success: false, error: 'Cannot twist and reverse arms in the same turn' };
    }

    const blockers = /hand_actuator|lower_arm_actuator/;
    if (hasActuatorSlot(unit, 'leftArm', blockers) || hasActuatorSlot(unit, 'rightArm', blockers)) {
      return { success: false, error: 'This Mech cannot reverse its arms' };
    }

    const reversed = typeof action.reversed === 'boolean' ? action.reversed : true;
    this.stateManager.applyStateChange(() => { unit.armsReversed = reversed; });
    return { success: true, unitId: unit.id, armsReversed: reversed };
  }

  _handleConfirmFacing(playerId, action) {
    const state = this.stateManager.getState();
    const unit = state.getUnit(action.unitId);
    if (!unit) return { success: false, error: 'Unit not found' };

    this.stateManager.applyStateChange(() => {
      unit.position.facing = action.facing;
    });
    return { success: true };
  }

  _handleSelectUnit(playerId, action) {
    const state = this.stateManager.getState();
    const unit = state.getUnit(action.unitId);
    if (!unit) return { success: false, error: 'Unit not found' };
    if (unit.player !== playerId) return { success: false, error: 'Not your unit' };

    return { success: true, unitId: unit.id, unit: unit };
  }
}
