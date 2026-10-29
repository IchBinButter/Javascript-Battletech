/**
 * MovementCalculator - BattleTech movement rules.
 * Computes valid moves, MP costs, and validates movement paths.
 *
 * Dependencies: HexGrid, HexMath, Unit, GameState, terrain.json
 */

import { hexToPixel, hexDistance, directionBetween, getNeighborInDirection, hexKey } from '../../hex/HexMath.js';
import { parseHexKey } from '../../utils/helpers.js';
import equipmentData from '../../data/equipment.json' with { type: 'json' };
import terrainData from '../../data/terrain.json' with { type: 'json' };
import { getMaxMP as computeMaxMP, getAvailableJumpMP as computeAvailableJumpMP } from './maxMP.js';
import { movementModifier } from '../weather/WeatherRules.js';

const MASC_DATA = equipmentData.equipment.find(e => e.id === 'masc') || { mpMultiplier: 2, failureRollTarget: 3 };

/**
 * Movement Costs Table (BMM p17/p136): the total cost to enter a dry hex —
 * "Cost to Enter Any Hex 1" plus the terrain's own cost (Clear +0,
 * Light Woods +1, Heavy Woods +2, Light Jungle +2, Heavy Jungle +3, Rough +1,
 * Rubble +1, Sand +0, Swamp +1, Paved/Bridge +0). The values are read from
 * terrain.json's mpCost (which stores the same totals) so the data file and
 * the rules table cannot drift apart again. Level changes, ice / mud / deep
 * snow and weather are priced separately by the table and added afterwards by
 * calculateMPCost. Water is not priced from here because its depth is a level
 * offset; see WATER_DEPTH_BY_TERRAIN and calculateMPCost.
 */
const TERRAIN_MP_COSTS = Object.freeze(Object.fromEntries(
  Object.entries(terrainData.terrain)
    .filter(([type]) => !type.startsWith('water'))
    .map(([type, def]) => [type, def.mpCost || 1])
));

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
   * Jumping MP available for a jump that begins where the unit is standing.
   *
   * p19 MOVEMENT IN WATER: "Jump jets cannot be fired while submerged. As such,
   * a 'Mech standing in Depth 1 water may not fire jump jets located in its
   * legs, and a 'Mech standing in Depth 2 or deeper water cannot jump at all."
   * The p18 worked example (6 jets, 2 in the legs, standing in Depth 1) leaves
   * 4 available and a Level 3 ceiling (4 + the starting level -1).
   *
   * @param {Unit} unit
   * @param {GameState} gameState
   * @returns {number} 0 means no jump is possible from this hex
   */
  getAvailableJumpMP(unit, gameState) {
    const hex = this._hexAt(unit && unit.position && unit.position.hexKey, gameState);
    return computeAvailableJumpMP(unit, this.waterDepthOf(hex));
  }

  /** Map lookup that accepts either a Map of hexes or a plain object. */
  _hexAt(hexKey, gameState) {
    const hexes = gameState && gameState.map && gameState.map.hexes;
    if (!hexKey || !hexes) return null;
    return typeof hexes.get === 'function' ? hexes.get(hexKey) : hexes[hexKey];
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
   * Find all hexes a unit can reach.
   *
   * Ground movement is priced hex by hex (terrain, level changes and facing).
   * Jumping is a different model (p18): the 'Mech flies over the intervening
   * hexes, so jump destinations are generated by range instead of by an
   * adjacent-hex walk. See `_generateJumpMoves`.
   *
   * @param {Unit} unit
   * @param {GameState} gameState
   * @param {'walk'|'run'|'jump'} movementType
   * @param {{ landingFacing?: number }} [options] - jump only: the facing the
   *   player chooses for the landing (p18: "when it lands it chooses any facing
   *   desired"). Ignored by ground movement, which derives facing from the path.
   * @returns {Map<string, { cost: number, path: string[], facing: number }>}
   */
  getValidMoves(unit, gameState, movementType, options = {}) {
    // Jumping ignores facing and terrain; it has its own range/height model.
    if (movementType === 'jump') {
      return this._generateJumpMoves(unit, gameState, options);
    }

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
   * Jump destinations (BMM p18).
   *
   * "A jumping 'Mech can move 1 hex for each available Jumping MP. Terrain does
   * not affect this MP cost: if a hex is legal to enter, it costs 1 MP to move
   * over or into it, period." The hex the jump begins in is not entered and so
   * costs nothing: a jump of N hexes costs N MP.
   *
   * "A jumping 'Mech ignores terrain (and other 'Mechs) in hexes it jumps
   * over." Occupied hexes therefore stay passable while plotting the flight
   * path, but are not offered as landing hexes (p18 Stacking: "only one 'Mech
   * can be in any single hex").
   *
   * "a 'Mech cannot enter a hex with a level higher than the sum of its
   * current Jumping MP plus the level of the hex its jump began in." A
   * destination is reachable only if at least one shortest path stays at or
   * below that level; a hex that is too high blocks every path through it.
   *
   * Water limits jump availability (p18/p19): a 'Mech standing in Depth 1 water
   * loses its submerged leg-mounted jets, and one standing in Depth 2 or deeper
   * water cannot jump at all, so no destination is offered from such a hex.
   *
   * @param {Unit} unit
   * @param {GameState} gameState
   * @param {{ landingFacing?: number }} [options]
   * @returns {Map<string, { cost: number, path: string[], facing: number }>}
   */
  _generateJumpMoves(unit, gameState, options = {}) {
    const startKey = unit.position.hexKey;
    const startFacing = unit.position.facing;
    const startHex = gameState.map.hexes.get(startKey);
    const moves = new Map();
    if (!startHex) return moves;

    // p19: "a 'Mech standing in Depth 2 or deeper water cannot jump at all."
    // No destination is offered from such a hex - not even the free "no move"
    // entry, because jumping itself is unavailable there.
    if (this.waterDepthOf(startHex) >= 2) return moves;

    // p18/p19: submerged jets do not fire. Depth 1 loses the leg-mounted jets;
    // on dry land this is the full (possibly damaged) rating.
    const jumpMP = this.getAvailableJumpMP(unit, gameState);

    // Jumping ignores facing. The preview shows the take-off facing until the
    // player picks a landing facing (p18).
    const landingFacing = this._resolveLandingFacing(startFacing, options.landingFacing);

    // The start hex is the "stand still" projection: it is not entered, so it
    // costs no MP. A deliberate in-place jump (p18: "A 'Mech may jump into the
    // same hex it began the turn in, for 1 MP") is validated separately, where
    // a path that repeats the start hex costs 1 MP.
    moves.set(startKey, {
      cost: 0,
      path: [startKey],
      facing: landingFacing,
      prevFacing: startFacing,
      remainingMP: jumpMP
    });
    if (jumpMP < 1) return moves;

    // p18: the starting hex's level is the 'Mech's own level, so Depth 1 water
    // (level 0, depth 1) starts the jump at level -1 (worked example, p18).
    const startLevel = this.movementLevelOf(startHex);
    const maxClearableLevel = jumpMP + startLevel;

    // Distances on the full hex graph (ignoring terrain, heights and units)
    // define which routes are the "fewest number of hexes" shortest paths.
    const distances = this._hexDistances(startKey, gameState);

    // Walk shortest-path edges only, and only through hexes the jump clears.
    // Every hex reached this way has at least one legal shortest path, which is
    // exactly the p18 test: "If all such paths are illegal ... the 'Mech cannot
    // jump to the destination hex at all."
    const pathTo = new Map([[startKey, [startKey]]]);
    const queue = [startKey];
    while (queue.length > 0) {
      const currentKey = queue.shift();
      const currentDistance = distances.get(currentKey);
      if (currentDistance === undefined || currentDistance >= jumpMP) continue;

      for (let dir = 0; dir < 6; dir++) {
        const neighborKey = getNeighborInDirection(currentKey, dir);
        const neighborHex = gameState.map.hexes.get(neighborKey);
        if (!neighborHex) continue;

        // Only follow edges that make progress on the shortest-path graph; a
        // jump cannot take a detour.
        if (distances.get(neighborKey) !== currentDistance + 1) continue;

        // p18 height limit: the hex must be clearable by Jumping MP + the
        // starting level. Trees and other terrain heights do not matter, only
        // the hex's own level ("trees do not affect jumping", p18).
        if (this.movementLevelOf(neighborHex) > maxClearableLevel) continue;

        if (pathTo.has(neighborKey)) continue;

        const path = [...pathTo.get(currentKey), neighborKey];
        pathTo.set(neighborKey, path);
        queue.push(neighborKey);

        // Occupied hexes can be flown over (and expanded through), but a
        // 'Mech cannot land in one.
        if (neighborHex.occupiedBy && neighborHex.occupiedBy !== unit.id) continue;

        const cost = currentDistance + 1;
        moves.set(neighborKey, {
          cost,
          path,
          facing: landingFacing,
          prevFacing: startFacing,
          remainingMP: jumpMP - cost
        });
      }
    }

    return moves;
  }

  /**
   * Hop count from `startKey` to every hex on the map, ignoring terrain,
   * heights and units. These are the p18 "fewest number of hexes" distances
   * that define the legal jump shortest paths.
   * @returns {Map<string, number>}
   */
  _hexDistances(startKey, gameState) {
    const distances = new Map([[startKey, 0]]);
    const queue = [startKey];
    while (queue.length > 0) {
      const key = queue.shift();
      const distance = distances.get(key);
      for (let dir = 0; dir < 6; dir++) {
        const neighborKey = getNeighborInDirection(key, dir);
        if (!gameState.map.hexes.has(neighborKey)) continue;
        if (distances.has(neighborKey)) continue;
        distances.set(neighborKey, distance + 1);
        queue.push(neighborKey);
      }
    }
    return distances;
  }

  /**
   * Normalise a chosen landing facing to 0-5. Jumping ignores facing, so an
   * explicit choice is honoured and the 'Mech otherwise keeps the facing it
   * took off with (one of the legal "any facing desired" choices, p18).
   * @returns {number}
   */
  _resolveLandingFacing(startFacing, requestedFacing) {
    const normalized = (facing) => {
      if (!Number.isFinite(facing)) return null;
      return ((Math.trunc(facing) % 6) + 6) % 6;
    };
    return normalized(requestedFacing) ?? normalized(startFacing) ?? 0;
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
   *
   * Jump paths obey a different rule set (p18) and are handled by
   * `_validateJumpMovement`.
   *
   * @param {Unit} unit
   * @param {string[]} path
   * @param {'walk'|'run'|'jump'} movementType
   * @param {GameState} gameState
   * @param {{ landingFacing?: number }} [options] - jump only: the facing the
   *   player chooses for the landing.
   * @returns {{ valid: boolean, totalCost: number, errors: string[], finalFacing?: number }}
   */
  validateMovement(unit, path, movementType, gameState, options = {}) {
    if (movementType === 'jump') {
      return this._validateJumpMovement(unit, path, gameState, options);
    }

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
   * Validate a jump path (BMM p18).
   *
   * Jump costs are flat: "Terrain does not affect this MP cost: if a hex is
   * legal to enter, it costs 1 MP to move over or into it, period." Facing is
   * ignored as well ("it can jump in any direction for the same MP cost,
   * regardless of its initial facing"), so a jump never pays a facing change
   * and the player picks the landing facing.
   *
   * The paths produced by `_generateJumpMoves` list every hex flown over, so
   * the height limit is checked for each of them. Callers that hand in a
   * shorter, non-adjacent path (legacy engine tests) are still priced at
   * 1 Jumping MP per listed hex; the start hex itself is never charged.
   *
   * Water limits jump availability (p18/p19): at Depth 1 the leg-mounted jets
   * are submerged and do not count towards the Jumping MP or the height
   * ceiling; in Depth 2 or deeper water the 'Mech cannot jump at all.
   *
   * @param {Unit} unit
   * @param {string[]} path
   * @param {GameState} gameState
   * @param {{ landingFacing?: number }} [options]
   * @returns {{ valid: boolean, totalCost: number, errors: string[], finalFacing: number }}
   */
  _validateJumpMovement(unit, path, gameState, options = {}) {
    const startFacing = unit.position.facing;
    const landingFacing = this._resolveLandingFacing(startFacing, options.landingFacing);

    if (!Array.isArray(path) || path.length < 2) {
      return {
        valid: false,
        totalCost: 0,
        errors: ['Path must have at least 2 hexes'],
        finalFacing: landingFacing
      };
    }

    const errors = [];
    if (path[0] !== unit.position.hexKey) {
      errors.push(`Jump must begin in the unit's hex: ${unit.position.hexKey}`);
    }

    const startHex = gameState.map.hexes.get(path[0]);
    if (!startHex) {
      return {
        valid: false,
        totalCost: 0,
        errors: [...errors, `Hex not found: ${path[0]}`],
        finalFacing: landingFacing
      };
    }

    // p19 MOVEMENT IN WATER: "a 'Mech standing in Depth 2 or deeper water
    // cannot jump at all." Reject with the actual cause instead of a generic
    // 0 MP range error.
    const stanceHex = this._hexAt(unit.position.hexKey, gameState) || startHex;
    const stanceDepth = this.waterDepthOf(stanceHex);
    if (stanceDepth >= 2) {
      return {
        valid: false,
        totalCost: 0,
        errors: [...errors, `Cannot jump from Depth ${stanceDepth} water: jump jets cannot be fired while submerged`],
        finalFacing: landingFacing
      };
    }

    // p18/p19: available Jumping MP excludes submerged leg jets at Depth 1.
    const jumpMP = this.getAvailableJumpMP(unit, gameState);

    // p18: the sum of Jumping MP and the starting hex's level is the highest
    // level the jump can enter; Depth 1 water lowers the start level to -1.
    const startLevel = this.movementLevelOf(startHex);
    const maxClearableLevel = jumpMP + startLevel;
    const hexesEntered = path.length - 1;

    // p18: 1 Jumping MP per hex entered, start hex excluded.
    if (hexesEntered > jumpMP) {
      errors.push(`Exceeded max MP: jump of ${hexesEntered} hexes > ${jumpMP} Jumping MP`);
    }

    let contiguous = true;
    for (let i = 1; i < path.length; i++) {
      if (hexDistance(path[i - 1], path[i]) !== 1) contiguous = false;

      const toHex = gameState.map.hexes.get(path[i]);
      if (!toHex) {
        errors.push(`Hex not found: ${path[i]}`);
        continue;
      }

      const level = this.movementLevelOf(toHex);
      if (level > maxClearableLevel) {
        errors.push(
          `Jump height exceeded at ${path[i]}: level ${level} > Jumping MP ${jumpMP} + start level ${startLevel} = ${maxClearableLevel}`
        );
      }
    }

    // p18: "A 'Mech can only jump to its destination hex via the shortest path
    // (i.e. the fewest number of hexes required to get there)." Enforced for
    // paths that name every hex; legacy compressed paths are not distance-checked.
    const landingKey = path[path.length - 1];
    if (contiguous) {
      const shortestPath = hexDistance(path[0], landingKey);
      if (hexesEntered !== shortestPath) {
        errors.push(`Jump must follow the shortest path: ${hexesEntered} hexes vs ${shortestPath}`);
      }
    }

    // A jump may fly over occupied hexes, but the landing hex must be free.
    const landingHex = gameState.map.hexes.get(landingKey);
    if (landingHex && landingHex.occupiedBy && landingHex.occupiedBy !== unit.id) {
      errors.push(`Cannot land in an occupied hex: ${landingKey}`);
    }

    return {
      valid: errors.length === 0,
      totalCost: hexesEntered,
      errors,
      finalFacing: landingFacing
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
