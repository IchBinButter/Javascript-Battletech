/**
 * MovementCalculator - BattleTech movement rules.
 * Computes valid moves, MP costs, and validates movement paths.
 *
 * Dependencies: HexGrid, HexMath, Unit, GameState, terrain.json
 */

import { hexToPixel, hexDistance, directionBetween, getNeighborInDirection, hexKey } from '../../hex/HexMath.js';
import { parseHexKey } from '../../utils/helpers.js';
import equipmentData from '../../data/equipment.json' with { type: 'json' };
import { getMaxMP as computeMaxMP } from './maxMP.js';
import { movementModifier } from '../weather/WeatherRules.js';

const MASC_DATA = equipmentData.equipment.find(e => e.id === 'masc') || { mpMultiplier: 2, failureRollTarget: 3 };

/**
 * Movement Costs Table (BMM p17/p136): the total cost to enter a dry hex —
 * "Cost to Enter Any Hex 1" plus the terrain's own cost (Clear +0,
 * Light Woods +1, Heavy Woods +2, Rough +1, Rubble +1, Swamp +1, Paved/Bridge
 * +0). Level changes, ice / mud / deep snow and weather are priced separately
 * by the table and are added afterwards. Water is not in this table because
 * its depth is a level offset; see WATER_DEPTH_BY_TERRAIN and
 * calculateMPCost.
 */
const TERRAIN_MP_COSTS = {
  clear: 1,
  light_woods: 2,
  heavy_woods: 3,
  rough: 2,
  rubble: 2,
  // Swamp is a terrain type in this project; p17/p136 plus p61's missing body
  // leave it at the existing 3 MP (see M-31, owned by the data fix).
  swamp: 3,
  // Paved/Bridge are +0 terrain; a road hex therefore costs the base 1 MP and
  // level changes are still charged (p20 Road Movement).
  pavement: 1,
  bridge: 1
};

/**
 * Water is priced as terrain depth, not as an absolute entry cost (p60/p136):
 * Depth 1 is +1 MP, Depth 2+ is +3 MP, and the level change is charged
 * separately. Depth is a negative level offset (p64: "treating depth as
 * negative numbers"), which is what produces p128's worked example —
 * Depth 1 from Level 0 = 1 (hex) + 1 (water) + 1 (level change) = 3 MP and
 * Depth 2 from Level 0 = 1 + 3 + 2 = 6 MP.
 */
const WATER_DEPTH_BY_TERRAIN = {
  water_depth1: 1,
  water_depth2: 2,
  water_depth3: 3,
  water_depth4: 4
};

export class MovementCalculator {
  /**
   * Depth of a water hex, 0 for dry terrain.
   * @param {Hex} hex
   * @returns {number}
   */
  waterDepthOf(hex) {
    if (!hex) return 0;
    if (Number.isFinite(hex.waterDepth)) return hex.waterDepth;
    const byType = WATER_DEPTH_BY_TERRAIN[hex.terrainType];
    if (byType) return byType;
    const match = /^water_depth(\d+)$/.exec(hex.terrainType || '');
    return match ? Number(match[1]) : 0;
  }

  /**
   * The level movement sees for a hex. Water depth counts as a negative level
   * (BMM p64), so a Depth 1 hex is one level below its surface (p128).
   *
   * Depth is capped at two levels for costing: p136 prices "Depth 2+" as one
   * row, and capping keeps a Depth 3+ hex reachable instead of tripping the
   * p15 three-level prohibition.
   */
  movementLevelOf(hex) {
    if (!hex) return 0;
    return (hex.level || 0) - Math.min(this.waterDepthOf(hex), 2);
  }

  /**
   * Calculate MP cost to enter a specific hex.
   *
   * Formula (BMM p17/p136, p20, p128):
   *   1 MP to enter any hex
   *   + the target hex's terrain cost (+0 clear/pavement, +1 light woods, ...)
   *   + 1 MP per level changed, up OR down (1-2 levels; 3+ is not a legal move)
   *   + 1 MP each for ice, mud and deep snow
   *   + the weather MP modifier
   *
   * @param {Hex} fromHex - Hex being left (for level change check)
   * @param {Hex} toHex - Hex being entered
   * @param {Unit} unit - Moving unit
   * @param {string} movementType - 'walk', 'run', 'jump'
   * @returns {number} MP cost
   */
  calculateMPCost(fromHex, toHex, unit, movementType, weather = null) {
    // Jump jets ignore terrain and level changes (p18).
    if (movementType === 'jump') return 1;

    // "Cost to Enter Any Hex 1" plus the terrain's own cost (p136). Water is
    // not a terrain row — p60/p136 price it as Depth 1 +1 and Depth 2+ +3, and
    // its depth is charged as a level change below.
    const waterDepth = this.waterDepthOf(toHex);
    let cost = waterDepth > 0
      ? 1 + (waterDepth === 1 ? 1 : 3)
      : (TERRAIN_MP_COSTS[toHex.terrainType] || 1);

    // Building terrain cost (Movement Costs Table, p136): light +1, medium +2,
    // heavy +3, hardened +4 on top of the cost to enter any hex.
    if (toHex.building) {
      const buildingCosts = { light: 1, medium: 2, heavy: 3, hardened: 4 };
      cost += buildingCosts[toHex.building.type] || 0;
    }

    // Level change (up or down): 1 level +1, 2 levels +2 (p17/p136). A 3+ level
    // change is a fall, not a move (the prohibition itself is unverified, see
    // M-02), and it applies to descents too — the old code only charged climbs.
    const levelDiff = this.movementLevelOf(toHex) - this.movementLevelOf(fromHex);
    if (Math.abs(levelDiff) >= 3) {
      return Infinity;
    }
    cost += Math.abs(levelDiff);

    // Terrain modifications for ice, mud and deep snow: +1 MP each (p136).
    const modifiers = toHex.modifiers || {};
    if (modifiers.ice) cost += 1;
    if (modifiers.mud) cost += 1;
    if (modifiers.deepSnow) cost += 1;

    // Weather: fog and darkness add MP per hex (p62).
    if (weather) {
      cost += movementModifier(weather);
    }

    return cost;
  }

  /**
   * Get the maximum MP available for a movement type.
   */
  getMaxMP(unit, movementType) {
    return computeMaxMP(unit, movementType);
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

        const terrainCost = this.calculateMPCost(currentHex, neighborHex, unit, movementType, gameState.weather);
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

      const terrainCost = this.calculateMPCost(fromHex, toHex, unit, movementType, gameState.weather);
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
