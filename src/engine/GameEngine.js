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
  BUILDING_FIRE_CF_LOSS, fireDamageRoll
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
import { quirkHeatModifier } from '../rules/quirks/Quirks.js';
import { DamageResolver } from '../rules/combat/DamageResolver.js';
import { PhysicalAttackResolver } from '../rules/combat/PhysicalAttackResolver.js';
import { HeatManager } from '../rules/heat/HeatManager.js';
import { createSeededDice } from '../utils/dice.js';
import { hexDistance } from '../hex/HexMath.js';
import { parseHexKey } from '../utils/helpers.js';

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
    const validation = this.phaseManager.validateAction(action.type, playerId, unitId);
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
      default:
        result = { success: false, error: `Unknown action: ${action.type}` };
    }

    this.actionLog.push({ playerId, action, result, phase: this.phaseManager.currentPhase });

    // The payload is broadcast to clients, so it must not carry class
    // instances (a Weapon arrives without its methods).
    this.eventBus.emit('actionProcessed', toTransferable({ playerId, action, result }));

    // Advance the unit queue after actions that consume a unit's turn
    if (result.success && ['move', 'fire', 'physicalAttack'].includes(action.type)) {
      this.phaseManager.advanceQueueOrNextPhase();
    }

    return result;
  }

  _handleMove(playerId, action) {
    const state = this.stateManager.getState();
    const unit = state.getUnit(action.unitId);
    if (!unit) return { success: false, error: 'Unit not found' };

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

    const validation = this.movementCalc.validateMovement(unit, path, movementType, state);

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

      const psrTriggers = this.psrCalc.getPSRTriggers(unit, {
        enteredHeavyWoods: false,
        enteredRubble: false,
        largeLevelDrop: false,
        isSkidding: false,
        rapidTurnWhileRunning: false,
        type: movementType,
        terrainPSR: destination ? terrainPSRModifier(destination) : { modifier: 0, reasons: [] },
        weatherPSR: psrModifier(state.weather)
      }, state);

      if (psrTriggers.length > 0) {
        const psrResult = this.psrCalc.makePSR(unit, this.diceRoller, psrTriggers);
        if (!psrResult.passed) {
          let levelsFallen = 1;
          if (effectivePath.length > 1) {
            const startHex = state.map.hexes.get(effectivePath[0]);
            const endHex = state.map.hexes.get(effectivePath[effectivePath.length - 1]);
            if (startHex && endHex) {
              const totalDrop = startHex.level - endHex.level;
              if (totalDrop > 0) levelsFallen = totalDrop;
            }
          }
          this.psrCalc.resolveFall(unit, unit.position.facing, this.diceRoller, levelsFallen);
          unit.prone = true;
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
      remainingMP: Math.max(0, this.movementCalc.getMaxMP(unit, movementType) - effectiveValidation.totalCost),
      facing: unit.position.facing,
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
            hit.damageResult = this.damageResolver.applyDamage(
              unit, hit.location, hit.damage, hit.isRear, this.diceRoller
            );
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

  _handleFire(playerId, action) {
    if (!this.attackResolver) {
      return { success: false, error: 'Combat resolver not initialized' };
    }

    const state = this.stateManager.getState();
    const attacker = state.getUnit(action.attackerId);
    const target = state.getUnit(action.targetId);

    if (!attacker) return { success: false, error: 'Attacker not found' };
    if (!target) return { success: false, error: 'Target not found' };

    // Hidden units (p82) cannot be targeted until revealed.
    if (!canSee(playerId, target.id, state)) {
      return { success: false, error: 'Target is hidden' };
    }

    const weaponDef = action.weapon;

    // Indirect fire (p30) needs a friendly spotter with line of sight, and the
    // attacker must not have a line of sight of its own.
    let indirect = null;
    if (action.indirect) {
      indirect = this._validateIndirectFire(attacker, target, weaponDef, action.spotterId, state);
      if (!indirect.valid) return { success: false, error: indirect.reason };
    } else {
      const losResult = this.los.calculateLOS(
        attacker.position.hexKey, target.position.hexKey, state, { attacker, target }
      );
      if (losResult.blocked) {
        return { success: false, error: `LOS blocked: ${losResult.reason}` };
      }
    }

    // Combat within buildings (p72): more than two intervening building hexes
    // or levels block the shot entirely.
    const urban = buildingCombat(attacker, target, state);
    if (urban.losBlocked) {
      return { success: false, error: 'LOS blocked by intervening building hexes' };
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

    const result = this.attackResolver.resolveWeaponAttack(
      attacker, weaponDef, { location: action.weaponLocation }, target, state, this.diceRoller,
      {
        indirect: Boolean(action.indirect),
        spotter: indirect ? indirect.spotter : null,
        spotterAttacked: Boolean(indirect && indirect.spotter.attackedThisPhase),
        aimedLocation: action.aimedLocation,
        multipleTargetModifier,
        buildingModifier: urban.modifier
      }
    );

    this.stateManager.applyStateChange(() => {
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
          // takes that damage itself; the remainder reaches the target.
          if (targetHex && targetHex.building) {
            const reduction = damageReduction(targetHex);
            const absorbed = Math.min(hitLoc.damage, reduction);
            if (absorbed > 0) {
              hitLoc.damage -= absorbed;
              hitLoc.buildingAbsorbed = absorbed;
              if (targetHex._cfAtPhaseStart === undefined) {
                targetHex._cfAtPhaseStart = targetHex.building.currentCF;
              }
              targetHex.building.currentCF = Math.max(0, targetHex.building.currentCF - absorbed);
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

          const damageResult = this.damageResolver.applyDamage(
            target, hitLoc.location, hitLoc.damage, hitLoc.isRear, this.diceRoller
          );
          hitLoc.damageResult = damageResult;

          // p58: a head hit injures the MechWarrior, armour or no armour.
          if (hitLoc.location === 'head' && typeof target.applyPilotDamage === 'function') {
            target.applyPilotDamage(1);
            hitLoc.pilotDamage = 1;
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
    return result;
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

    // Attacking across levels changes what is legal and which hit table
    // applies (Different Levels table, p140).
    const levelDifference = this._levelDifference(attacker, target, state);
    const options = {
      arm: action.arm,
      levelDifference,
      usePunchTable: Boolean(action.usePunchTable)
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
          this.damageResolver.applyDamage(target, hitLoc.location, hitLoc.damage, false, this.diceRoller);
        }
      }

      if (result.type === 'dfa' && result.attackerDamage > 0) {
        this.damageResolver.applyDamage(attacker, 'leftLeg', result.attackerDamage, false, this.diceRoller);
        this.damageResolver.applyDamage(attacker, 'rightLeg', result.attackerDamage, false, this.diceRoller);
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
   * Heat Phase fire damage: one roll per unit standing in a fire hex.
   */
  resolveFireDamage() {
    const state = this.stateManager.getState();
    if (!Array.isArray(state.fireHexes) || state.fireHexes.length === 0) return [];

    const results = [];
    for (const hexKey of state.fireHexes) {
      for (const unit of Object.values(state.units)) {
        if (unit.position.hexKey !== hexKey) continue;

        const damage = fireDamageRoll(this.diceRoller);
        const locRoll = this.diceRoller.roll2d6();
        const loc = this.attackResolver.determineHitLocation(locRoll, 'front');
        this.damageResolver.applyDamage(unit, loc.location, damage, loc.isRear ?? false, this.diceRoller);

        results.push({ hexKey, unitId: unit.id, damage });
        this.eventBus.emit('fireDamage', { hexKey, unitId: unit.id, damage });
      }
    }
    return results;
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

          hit.damageResult = this.damageResolver.applyDamage(
            unit, hit.location, hit.damage, Boolean(hit.isRear), this.diceRoller
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
    // Building collapse from weapon damage resolves at the end of the Weapon
    // Attack Phase (p73).
    this._resolvePendingBuildingCollapses();

    const nextPhase = this.phaseManager.nextPhase();

    // CF snapshots are per phase, so start the new one clean.
    const state = this.stateManager.getState();
    if (state.map && state.map.hexes) {
      for (const [, hex] of state.map.hexes) {
        delete hex._cfAtPhaseStart;
      }
    }

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
      this.damageResolver.applyDamage(unit, loc.location, damage, loc.isRear ?? false, this.diceRoller);
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
      this.damageResolver.applyDamage(unit, loc.location, fallDamage, loc.isRear ?? false, this.diceRoller);
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
      this.damageResolver.applyDamage(occupant, loc.location, damage, loc.isRear ?? false, this.diceRoller);
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
