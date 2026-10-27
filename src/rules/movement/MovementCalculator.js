/**
 * MovementCalculator - BattleTech movement rules.
 * Computes valid moves, MP costs, and validates movement paths.
 *
 * Dependencies: HexGrid, HexMath, Unit, GameState, terrain.json
 */

import { hexToPixel, hexDistance, directionBetween, getNeighborInDirection, hexKey } from '../../hex/HexMath.js';
import { parseHexKey } from '../../utils/helpers.js';
import equipmentData from '../../data/equipment.json' with { type: 'json' };

const MASC_DATA = equipmentData.equipment.find(e => e.id === 'masc') || { mpMultiplier: 2, failureRollTarget: 3 };

const TERRAIN_MP_COSTS = {
  clear: 1,
  light_woods: 2,
  heavy_woods: 3,
  water_depth1: 2,
  water_depth2: 3,
  rough: 2,
  rubble: 2,
  swamp: 3,
  pavement: 1,
  bridge: 1
};

export class MovementCalculator {
  /**
   * Calculate MP cost to enter a specific hex.
   * @param {Hex} fromHex - Hex being left (for level change check)
   * @param {Hex} toHex - Hex being entered
   * @param {Unit} unit - Moving unit
   * @param {string} movementType - 'walk', 'run', 'jump'
   * @returns {number} MP cost
   */
  calculateMPCost(fromHex, toHex, unit, movementType) {
    // Jump jets ignore terrain
    if (movementType === 'jump') return 1;

    let cost = TERRAIN_MP_COSTS[toHex.terrainType] || 1;

    const levelDiff = toHex.level - fromHex.level;
    if (levelDiff >= 3) {
      return Infinity;
    }
    if (levelDiff > 0) {
      cost += levelDiff;
    }

    // Modifiers for ice, mud, deep snow (additive +1 MP each)
    if (toHex.modifiers.ice) {
      cost += 1;
    }
    if (toHex.modifiers.mud || toHex.modifiers.deepSnow) {
      cost += 1;
    }

    // Road bonus: pavement overrides terrain cost (flat 1)
    if (toHex.terrainType === 'pavement') {
      cost = 1;
    }

    return cost;
  }

  /**
   * Get the maximum MP available for a movement type.
   */
  getMaxMP(unit, movementType) {
    const base = unit.movement;
    let mp;
    switch (movementType) {
      case 'walk':
        mp = base.walk;
        if (unit.mascActive) {
          mp = Math.floor(mp * MASC_DATA.mpMultiplier);
        }
        break;
      case 'run': mp = base.run; break;
      case 'jump': mp = base.jump; break;
      default: mp = base.walk; break;
    }

    if (movementType !== 'jump') {
      const heat = unit.heat || 0;
      if (heat >= 25) mp -= 5;
      else if (heat >= 20) mp -= 4;
      else if (heat >= 15) mp -= 3;
      else if (heat >= 10) mp -= 2;
      else if (heat >= 5) mp -= 1;
    }

    return Math.max(0, mp);
  }

  /**
   * Calculate facing change cost when moving between two hexes.
   * @param {string} fromKey
   * @param {string} toKey
   * @param {number} currentFacing - Current facing (0-5)
   * @returns {number} MP cost for turning (0, 1, or 2)
   */
  calculateFacingChange(fromKey, toKey, currentFacing) {
    if (fromKey === toKey) return 0;

    const moveDirection = directionBetween(fromKey, toKey);
    if (moveDirection === -1) return 0;

    // Difference between current facing and move direction
    const diff = ((moveDirection - currentFacing + 3) % 6 + 3) % 6;
    // 0 = straight ahead (0 cost), 1 = one hexside (1 cost), 2 = two hexsides (2 cost)
    // 3 = rear (can't normally move backward in same hex)
    if (diff <= 2) return diff;
    // Turn the other way (3 hexsides = still 2 MP since you go the shorter way)
    return 6 - diff;
  }

  /**
   * Find all hexes a unit can reach using BFS over the hex grid.
   * @returns {Map<string, { cost: number, path: string[], facing: number }>}
   */
  getValidMoves(unit, gameState, movementType) {
    const maxMP = this.getMaxMP(unit, movementType);
    const startKey = unit.position.hexKey;
    const startFacing = unit.position.facing;
    const startHex = gameState.map.hexes.get(startKey);
    if (!startHex) return new Map();

    const stateKey = (hexKey, facing) => `${hexKey}:${facing}`;
    const startState = stateKey(startKey, startFacing);

    const visited = new Map();
    visited.set(startState, {
      cost: 0,
      path: [startKey],
      facing: startFacing,
      prevFacing: startFacing
    });

    // BFS queue: [hexKey, facing, accumulatedCost, path]
    const queue = [[startKey, startFacing, 0, [startKey]]];

    while (queue.length > 0) {
      const [currentKey, currentFacing, currentCost, currentPath] = queue.shift();

      // Skip if we've already reached this state with a lower cost
      const currentState = stateKey(currentKey, currentFacing);
      const existing = visited.get(currentState);
      if (existing && existing.cost < currentCost) continue;

      const currentHex = gameState.map.hexes.get(currentKey);
      if (!currentHex) continue;

      const directions = [0, 1, 2, 3, 4, 5];
      for (const dir of directions) {
        const neighborKey = getNeighborInDirection(currentKey, dir);
        const neighborHex = gameState.map.hexes.get(neighborKey);
        if (!neighborHex) continue;

        if (neighborHex.occupiedBy && neighborKey !== startKey) continue;

        const terrainCost = this.calculateMPCost(currentHex, neighborHex, unit, movementType);
        if (terrainCost === Infinity) continue;

        const moveDir = directionBetween(currentKey, neighborKey);

        const facingChangeCost = this.calculateFacingChangeFromDirection(currentFacing, moveDir);
        const newCost = currentCost + terrainCost + facingChangeCost;
        if (newCost > maxMP) continue;

        const newPath = [...currentPath, neighborKey];
        const newFacing = moveDir;
        const newState = stateKey(neighborKey, newFacing);

        if (!visited.has(newState) || visited.get(newState).cost > newCost) {
          visited.set(newState, {
            cost: newCost,
            path: newPath,
            facing: newFacing,
            prevFacing: currentFacing,
            remainingMP: maxMP - newCost
          });

          queue.push([neighborKey, newFacing, newCost, newPath]);
        }
      }
    }

    // Convert state-keyed map to hexKey-keyed map for compatibility (keeping best cost per hex)
    const result = new Map();
    for (const [skey, data] of visited) {
      const hexKey = skey.split(':')[0];
      if (!result.has(hexKey) || result.get(hexKey).cost > data.cost) {
        result.set(hexKey, data);
      }
    }

    return result;
  }

  /**
   * Helper: calculate facing change cost to face a given direction.
   */
  calculateFacingChangeFromDirection(currentFacing, targetDirection) {
    const diff = ((targetDirection - currentFacing + 3) % 6 + 3) % 6;
    if (diff <= 3) return diff;
    return 6 - diff;
  }

  /**
   * Validate a specific movement path.
   * @returns {{ valid: boolean, totalCost: number, errors: string[] }}
   */
  validateMovement(unit, path, movementType, gameState) {
    const errors = [];
    let totalCost = 0;

    if (path.length < 2) {
      return { valid: false, totalCost: 0, errors: ['Path must have at least 2 hexes'] };
    }

    const maxMP = this.getMaxMP(unit, movementType);
    let currentFacing = unit.position.facing;

    for (let i = 0; i < path.length - 1; i++) {
      const fromKey = path[i];
      const toKey = path[i + 1];
      const fromHex = gameState.map.hexes.get(fromKey);
      const toHex = gameState.map.hexes.get(toKey);

      if (!fromHex || !toHex) {
        errors.push(`Hex not found: ${!fromHex ? fromKey : toKey}`);
        continue;
      }

      const terrainCost = this.calculateMPCost(fromHex, toHex, unit, movementType);
      const moveDir = directionBetween(fromKey, toKey);

      const facingCost = this.calculateFacingChangeFromDirection(currentFacing, moveDir);
      totalCost += terrainCost + facingCost;
      currentFacing = moveDir;

      if (totalCost > maxMP) {
        errors.push(`Exceeded max MP at step ${i}: cost=${totalCost}, max=${maxMP}`);
      }
    }

    return {
      valid: errors.length === 0,
      totalCost,
      errors,
      finalFacing: currentFacing
    };
  }

  /**
   * Check if a unit has MASC equipment installed.
   */
  hasMASC(unit) {
    return !!(unit.equipment && unit.equipment.other && unit.equipment.other.masc);
  }

  /**
   * Activate MASC for a unit. Sets the mascActive flag.
   * Only activates if the unit has MASC equipment installed.
   * @returns {boolean} true if activation succeeded
   */
  activateMASC(unit) {
    if (!this.hasMASC(unit)) return false;
    unit.mascActive = true;
    unit.mascTurnsActive = (unit.mascTurnsActive || 0) + 1;
    return true;
  }

  /**
   * Deactivate MASC for a unit. Resets the active flag and turn counter.
   */
  deactivateMASC(unit) {
    unit.mascActive = false;
    unit.mascTurnsActive = 0;
  }

  /**
   * Roll for MASC failure. Called each turn MASC is active.
   * On failure (2D6 <= failureRollTarget), applies leg actuator damage
   * and deactivates MASC.
   * @param {DiceRoller} diceRoller
   * @returns {{ roll: number, failed: boolean }}
   */
  rollMASC(unit, diceRoller) {
    if (!unit.mascActive) return { roll: null, failed: false };

    const MASC_FAILURE_TABLE = [2, 4, 6, 10];
    const turnsActive = unit.mascTurnsActive || 1;

    if (turnsActive >= 5) {
      unit.mascActive = false;
      unit.mascTurnsActive = 0;
      this._applyMASCLegDamage(unit);
      return { roll: null, failed: true, target: "auto-fail (turn 5+)" };
    }

    const roll = diceRoller.roll2d6();
    const failureTarget = MASC_FAILURE_TABLE[turnsActive - 1];
    const failed = roll <= failureTarget;

    if (failed) {
      unit.mascActive = false;
      unit.mascTurnsActive = 0;
      this._applyMASCLegDamage(unit);
    }

    return { roll, failed, target: failureTarget };
  }

  _applyMASCLegDamage(unit) {
    for (const leg of ['leftLeg', 'rightLeg']) {
      const slots = unit.criticalSlots && unit.criticalSlots[leg];
      if (!slots) continue;
      for (const slot of slots) {
        if (slot.item && slot.item.includes('actuator') && slot.status === 'ok') {
          slot.status = 'destroyed';
          return;
        }
      }
    }
  }
}
