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
import { canWeaponFireAt, getTargetArc, ARC } from '../rules/combat/ArcRules.js';
import { hasActuatorSlot } from '../rules/combat/UnitDamage.js';
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
      unit.hexesMoved = path.length - 1;

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
          let levelsFallen = 1;
          if (path.length > 1) {
            const startHex = state.map.hexes.get(path[0]);
            const endHex = state.map.hexes.get(path[path.length - 1]);
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

    return {
      success: true,
      unitId: unit.id,
      finalHex: unit.position.hexKey,
      remainingMP: Math.max(0, this.movementCalc.getMaxMP(unit, movementType) - validation.totalCost),
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
        multipleTargetModifier
      }
    );

    this.stateManager.applyStateChange(() => {
      attacker.heat += weaponDef.heat;

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

      if (result.hit) {
        for (const hitLoc of result.hitLocations) {
          // A hit absorbed by partial cover does nothing to the Mech (p26).
          if (hitLoc.absorbedByCover) {
            hitLoc.damageResult = { absorbedByCover: true, coverHex: hitLoc.coverHex };
            continue;
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

    this.eventBus.emit('unitAttacked', { attackerId: attacker.id, targetId: target.id, result });

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

    this.eventBus.emit('physicalAttackResolved', { attackerId: attacker.id, targetId: target.id, result });

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

  _handleEndPhase(playerId) {
    const nextPhase = this.phaseManager.nextPhase();
    return { success: true, nextPhase };
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
