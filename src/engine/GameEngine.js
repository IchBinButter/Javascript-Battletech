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
import { FacingRules } from '../rules/movement/FacingRules.js';
import { LineOfSight } from '../rules/combat/LineOfSight.js';
import { AttackResolver } from '../rules/combat/AttackResolver.js';
import { DamageResolver } from '../rules/combat/DamageResolver.js';
import { PhysicalAttackResolver } from '../rules/combat/PhysicalAttackResolver.js';
import { HeatManager } from '../rules/heat/HeatManager.js';
import { createSeededDice } from '../utils/dice.js';
import { hexDistance } from '../hex/HexMath.js';
import { parseHexKey } from '../utils/helpers.js';

export class GameEngine {
  constructor(gameState) {
    this.eventBus = new EventBus();
    this.stateManager = new StateManager(gameState);
    this.phaseManager = new PhaseManager();
    this.phaseManager.setEngine(this);
    this.initiativeManager = new InitiativeManager();

    // Rules engines
    this.movementCalc = new MovementCalculator();
    this.psrCalc = new PSRCalculator();
    this.skiddingRules = new SkiddingRules();
    this.facingRules = new FacingRules();
    this.los = new LineOfSight();

    // Attack and damage resolvers will be initialized after loading hit tables
    this.attackResolver = null;
    this.damageResolver = new DamageResolver();
    this.physicalResolver = new PhysicalAttackResolver();
    this.heatManager = new HeatManager();

    // Dice roller
    this.gameId = 'game-' + Date.now();
    this.diceRoller = createSeededDice(this.gameId, gameState.turn);

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
      case 'selectUnit':
        result = this._handleSelectUnit(playerId, action);
        break;
      default:
        result = { success: false, error: `Unknown action: ${action.type}` };
    }

    this.actionLog.push({ playerId, action, result, phase: this.phaseManager.currentPhase });

    this.eventBus.emit('actionProcessed', { playerId, action, result });

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

    const { path, movementType } = action;
    const validation = this.movementCalc.validateMovement(unit, path, movementType, state);

    if (!validation.valid) {
      return { success: false, error: `Invalid movement: ${validation.errors.join(', ')}` };
    }

    this.stateManager.applyStateChange(() => {
      unit.position.hexKey = path[path.length - 1];
      if (validation.finalFacing !== undefined) {
        unit.position.facing = validation.finalFacing;
      }
      unit.currentMP = Math.max(0, this.movementCalc.getMaxMP(unit, movementType) - validation.totalCost);

      switch (movementType) {
        case 'walk': unit._movementModifier = 1; break;
        case 'run': unit._movementModifier = 2; break;
        case 'jump': unit._movementModifier = 3; break;
        default: unit._movementModifier = 0;
      }

      const psrTriggers = this.psrCalc.getPSRTriggers(unit, {
        enteredHeavyWoods: false,
        enteredRubble: false,
        largeLevelDrop: false,
        isSkidding: false,
        rapidTurnWhileRunning: false,
        type: movementType
      }, state);

      if (psrTriggers.length > 0) {
        const psrResult = this.psrCalc.makePSR(unit, this.diceRoller, psrTriggers);
        if (!psrResult.passed) {
          this.psrCalc.resolveFall(unit, unit.position.facing, this.diceRoller);
          unit.prone = true;
        }
      }
    });

    this.eventBus.emit('unitMoved', { unitId: unit.id, hexKey: unit.position.hexKey, facing: unit.position.facing });

    return {
      success: true,
      unitId: unit.id,
      finalHex: unit.position.hexKey,
      remainingMP: unit.currentMP,
      facing: unit.position.facing
    };
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

    const losResult = this.los.calculateLOS(attacker.position.hexKey, target.position.hexKey, state);
    if (losResult.blocked) {
      return { success: false, error: `LOS blocked: ${losResult.reason}` };
    }

    const weaponDef = action.weapon;

    if (weaponDef.usesAmmo() && action.ammoBin) {
      const hasAmmo = attacker.consumeAmmo(action.ammoBin, weaponDef.ammoPerShot);
      if (!hasAmmo) {
        return { success: false, error: 'No ammo for weapon' };
      }
    }

    const result = this.attackResolver.resolveWeaponAttack(
      attacker, weaponDef, { location: action.weaponLocation }, target, state, this.diceRoller
    );

    this.stateManager.applyStateChange(() => {
      attacker.heat += weaponDef.heat;

      if (result.hit) {
        for (const hitLoc of result.hitLocations) {
          const damageResult = this.damageResolver.applyDamage(
            target, hitLoc.location, hitLoc.damage, hitLoc.isRear, this.diceRoller
          );
          hitLoc.damageResult = damageResult;
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

    this.eventBus.emit('unitAttacked', { attackerId: attacker.id, targetId: target.id, result });

    result.success = true;
    return result;
  }

  _handlePhysicalAttack(playerId, action) {
    const state = this.stateManager.getState();
    const attacker = state.getUnit(action.attackerId);
    const target = state.getUnit(action.targetId);

    if (!attacker || !target) return { success: false, error: 'Unit not found' };

    let result;

    switch (action.attackType) {
      case 'punch':
        result = this.physicalResolver.resolvePunch(attacker, target, this.diceRoller);
        break;
      case 'kick':
        result = this.physicalResolver.resolveKick(attacker, target, this.diceRoller);
        break;
      case 'charge':
        result = this.physicalResolver.resolveCharge(attacker, target, action.distanceCharged || 1, this.diceRoller);
        break;
      case 'dfa':
        result = this.physicalResolver.resolveDFA(attacker, target, this.diceRoller);
        break;
      case 'push':
        result = this.physicalResolver.resolvePush(attacker, target, this.diceRoller);
        break;
      default:
        return { success: false, error: `Unknown physical attack: ${action.attackType}` };
    }

    this.stateManager.applyStateChange(() => {
      if (result.hit && result.hitLocations) {
        for (const hitLoc of result.hitLocations) {
          this.damageResolver.applyDamage(target, hitLoc.location, hitLoc.damage, false, this.diceRoller);
        }
      }

      if (result.type === 'dfa' && result.attackerDamage > 0) {
        this.damageResolver.applyDamage(attacker, 'leftLeg', result.attackerDamage, false, this.diceRoller);
        this.damageResolver.applyDamage(attacker, 'rightLeg', Math.ceil(result.attackerDamage / 2), false, this.diceRoller);
        if (result.attackerProne) {
          attacker.prone = true;
        }
      }
    });

    this.eventBus.emit('physicalAttackResolved', { attackerId: attacker.id, targetId: target.id, result });

    return result;
  }

  _handleEndPhase(playerId) {
    const nextPhase = this.phaseManager.nextPhase();
    return { success: true, nextPhase };
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
