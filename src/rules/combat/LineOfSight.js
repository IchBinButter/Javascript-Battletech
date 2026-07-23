/**
 * LineOfSight - BattleTech LOS calculation.
 * Uses Bresenham's line over hex grid, accounts for terrain height, woods, water.
 */

import { hexLine, hexDistance } from '../../hex/HexMath.js';
import { parseHexKey } from '../../utils/helpers.js';

export class LineOfSight {
  /**
   * Calculate LOS between two hexes.
   * @returns {{
   *   blocked: boolean,
   *   partialCover: boolean,
   *   woodsCount: number,
   *   waterDepth: number,
   *   interveningHexes: string[],
   *   reason: string
   * }}
   */
  calculateLOS(fromKey, toKey, gameState) {
    const result = {
      blocked: false,
      partialCover: false,
      woodsCount: 0,
      waterDepth: 0,
      interveningHexes: [],
      reason: ''
    };

    // Same hex: always visible
    if (fromKey === toKey) return result;

    const fromHex = gameState.map.hexes.get(fromKey);
    const toHex = gameState.map.hexes.get(toKey);
    if (!fromHex || !toHex) {
      result.blocked = true;
      result.reason = 'Hex not found';
      return result;
    }

    // Water depth 2: submerged unit cannot attack or be attacked
    if (toHex.terrainType === 'water_depth2') {
      result.blocked = true;
      result.reason = 'Target submerged in depth 2 water';
      result.waterDepth = 2;
      return result;
    }

    if (fromHex.terrainType === 'water_depth2') {
      result.blocked = true;
      result.reason = 'Attacker submerged in depth 2 water';
      return result;
    }

    // Get line using Bresenham's algorithm
    const line = hexLine(fromKey, toKey);

    // Skip first hex (attacker) and last hex (target)
    const intervening = line.slice(1, -1);
    result.interveningHexes = intervening;

    // Attacker and target heights
    const attackerHeight = fromHex.getHeight();
    const targetHeight = toHex.getHeight();

    // Accumulate woods data
    let lightWoodsHexes = 0;
    let heavyWoodsHexes = 0;

    for (const ikey of intervening) {
      const ihex = gameState.map.hexes.get(ikey);
      if (!ihex) continue;

      const hexHeight = ihex.getHeight();

      if (ihex.terrainType === 'light_woods') {
        lightWoodsHexes++;
      } else if (ihex.terrainType === 'heavy_woods') {
        heavyWoodsHexes++;
      }

      // Check terrain height blocking
      if (hexHeight > attackerHeight && hexHeight > targetHeight) {
        result.blocked = true;
        result.reason = `LOS blocked by terrain height at ${ikey} (height ${hexHeight})`;
        return result;
      }

      // Building blocks LOS
      if (ihex.building && ihex.building.levels > 0) {
        const buildingHeight = hexHeight + ihex.building.levels;
        if (buildingHeight > attackerHeight && buildingHeight > targetHeight) {
          result.blocked = true;
          result.reason = `LOS blocked by building at ${ikey}`;
          return result;
        }
      }
    }

    // Partial cover: target adjacent to hex with level >= targetHeight + 2 along LOS
    const lastTwo = intervening.slice(-2);
    for (const ikey of lastTwo) {
      const ihex = gameState.map.hexes.get(ikey);
      if (ihex && ihex.level >= targetHeight + 2) {
        result.partialCover = true;
        break;
      }
    }

    // Woods accumulation: 2+ heavy woods (density 4+) or 3+ light woods equivalent blocks
    const woodsDensity = lightWoodsHexes + heavyWoodsHexes * 2;
    if (woodsDensity >= 3) {
      result.blocked = true;
      result.reason = `LOS blocked by accumulated woods (light ${lightWoodsHexes}, heavy ${heavyWoodsHexes})`;
    }

    result.woodsCount = woodsDensity;
    result.lightWoodsHexes = lightWoodsHexes;
    result.heavyWoodsHexes = heavyWoodsHexes;
    return result;
  }

  /**
   * Quick check: is LOS clear between two hexes?
   */
  isLOSClear(fromKey, toKey, gameState) {
    const los = this.calculateLOS(fromKey, toKey, gameState);
    return !los.blocked;
  }
}
