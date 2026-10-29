/**
 * LineOfSight - BattleTech LOS calculation (BMM p22).
 *
 * A Mech's LOS level is its own height (2 levels standing, 1 prone) plus the
 * level of the hex it occupies. Intervening terrain that reaches or exceeds
 * the lower of the two LOS levels blocks the line. Woods and jungle rise two
 * levels but block by accumulation instead: three points of intervening woods
 * (light = 1, heavy = 2) are enough.
 *
 * Partial cover (p26): a standing target adjacent to a hex one level higher
 * than its own, along the LOS, has cover — unless the attacker's LOS level is
 * higher than the target's, which firing downhill negates. Cover from water or
 * a building survives that exception. Prone Mechs never get partial cover.
 */

import { hexLine } from '../../hex/HexMath.js';

const STANDING_HEIGHT = 2;
const PRONE_HEIGHT = 1;

// p60 Terrain Types: light woods/jungle is worth 1 point, heavy is worth 2.
const LIGHT_WOODS_JUNGLE = new Set(['light_woods', 'light_jungle']);
const HEAVY_WOODS_JUNGLE = new Set(['heavy_woods', 'heavy_jungle']);

export class LineOfSight {
  _heightOf(unit) {
    if (!unit) return STANDING_HEIGHT;
    if (typeof unit.getHeightLevels === 'function') return unit.getHeightLevels();
    return unit.prone ? PRONE_HEIGHT : STANDING_HEIGHT;
  }

  /**
   * Calculate LOS between two hexes.
   * @param {string} fromKey
   * @param {string} toKey
   * @param {GameState} gameState
   * @param {{attacker?: Unit, target?: Unit}} [options] - units give the line of sight levels
   * @returns {{
   *   blocked: boolean,
   *   partialCover: boolean,
   *   partialCoverHex: string|null,
   *   partialCoverKind: string|null,
   *   woodsCount: number,
   *   waterDepth: number,
   *   interveningHexes: string[],
   *   attackerLOS: number,
   *   targetLOS: number,
   *   reason: string
   * }}
   */
  calculateLOS(fromKey, toKey, gameState, options = {}) {
    const result = {
      blocked: false,
      partialCover: false,
      partialCoverHex: null,
      partialCoverKind: null,
      woodsCount: 0,
      waterDepth: 0,
      interveningHexes: [],
      attackerLOS: 0,
      targetLOS: 0,
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

    const attackerLOS = fromHex.level + this._heightOf(options.attacker);
    const targetLOS = toHex.level + this._heightOf(options.target);
    result.attackerLOS = attackerLOS;
    result.targetLOS = targetLOS;

    // Water depth 2: submerged unit cannot attack or be attacked (p23/p64)
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

    // Only hexes between the two units count; their own hexes do not (p22)
    const line = hexLine(fromKey, toKey);
    const intervening = line.slice(1, -1);
    result.interveningHexes = intervening;

    // Anything reaching the lower LOS level blocks the line (p22/p26: a prone
    // Mech's 1-level LOS level is why an adjacent Level 1 hex hides it).
    const blockThreshold = Math.min(attackerLOS, targetLOS);

    let lightWoodsHexes = 0;
    let heavyWoodsHexes = 0;

    for (const ikey of intervening) {
      const ihex = gameState.map.hexes.get(ikey);
      if (!ihex) continue;

      if (LIGHT_WOODS_JUNGLE.has(ihex.terrainType)) lightWoodsHexes++;
      else if (HEAVY_WOODS_JUNGLE.has(ihex.terrainType)) heavyWoodsHexes++;

      // Hex height covers hills (level) and buildings (level + building levels)
      const hexHeight = typeof ihex.getHeight === 'function'
        ? ihex.getHeight()
        : (ihex.level || 0);

      if (hexHeight >= blockThreshold) {
        result.blocked = true;
        result.reason = `LOS blocked by terrain at ${ikey} (height ${hexHeight}, LOS level ${blockThreshold})`;
        return result;
      }
    }

    // Woods block by accumulation, not height: 3+ points (p22, p60)
    const woodsDensity = lightWoodsHexes + heavyWoodsHexes * 2;
    result.woodsCount = woodsDensity;
    result.lightWoodsHexes = lightWoodsHexes;
    result.heavyWoodsHexes = heavyWoodsHexes;

    if (woodsDensity >= 3) {
      result.blocked = true;
      result.reason = `LOS blocked by accumulated woods (light ${lightWoodsHexes}, heavy ${heavyWoodsHexes})`;
      return result;
    }

    this._applyPartialCover(result, toHex, intervening, gameState, options, attackerLOS, targetLOS);
    return result;
  }

  /**
   * Partial cover (p26). Mutates result.
   */
  _applyPartialCover(result, targetHex, intervening, gameState, options, attackerLOS, targetLOS) {
    // Prone Mechs cannot receive partial cover.
    if (options.target && options.target.prone) return;

    // Standing in Depth 1 water always gives cover, whatever the levels.
    if (targetHex.terrainType === 'water_depth1') {
      result.partialCover = true;
      result.partialCoverHex = targetHex.hexKey;
      result.partialCoverKind = 'water';
      return;
    }

    // The cover must be the hex adjacent to the target along the LOS.
    const coverHexKey = intervening.length ? intervening[intervening.length - 1] : null;
    if (!coverHexKey) return;

    const coverHex = gameState.map.hexes.get(coverHexKey);
    if (!coverHex) return;

    const isBuilding = Boolean(coverHex.building && coverHex.building.levels > 0);
    // Height the cover presents: a hill's level, or a building's roof line.
    const coverHeight = typeof coverHex.getHeight === 'function'
      ? coverHex.getHeight()
      : (coverHex.level || 0);
    const oneLevelHigher = coverHeight >= targetHex.level + 1;
    const attackerNotHigher = attackerLOS <= targetLOS;

    // Firing downhill negates cover, except when the cover is a building.
    if (oneLevelHigher && (attackerNotHigher || isBuilding)) {
      result.partialCover = true;
      result.partialCoverHex = coverHexKey;
      result.partialCoverKind = isBuilding ? 'building' : 'hill';
    }
  }

  /**
   * Quick check: is LOS clear between two hexes?
   */
  isLOSClear(fromKey, toKey, gameState, options = {}) {
    const los = this.calculateLOS(fromKey, toKey, gameState, options);
    return !los.blocked;
  }
}
