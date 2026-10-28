/**
 * Buildings - multi-hex building registry (BMM p66-73).
 *
 * A map declares buildings as groups of hexes that share one structure; each hex
 * keeps its own Construction Factor, because damage never transfers between the
 * hexes of a building. Maps that only mark building terrain get synthetic
 * one-hex buildings so older mapsheets keep working.
 */

import terrainData from '../../data/terrain.json' with { type: 'json' };
import { hexNeighbors } from '../../hex/HexMath.js';

const TERRAIN_TO_TYPE = {
  light_building: 'light',
  medium_building: 'medium',
  heavy_building: 'heavy',
  hardened_building: 'hardened'
};

/** Building type implied by a terrain type, or null. */
export function buildingTypeForTerrain(terrainType) {
  return TERRAIN_TO_TYPE[terrainType] || null;
}

/** Default stats for a building type (p66 defaults, mirrored in terrain.json). */
export function buildingDefaults(type) {
  const def = terrainData.buildings[type];
  if (!def) return null;
  return { type, levels: def.levels, cf: def.cf };
}

export class BuildingRegistry {
  constructor() {
    /** @type {Map<string, {id,type,levels,hexes:string[]}>} */
    this.buildings = new Map();
    /** @type {Map<string, {id,type,levels,cf,currentCF}>} */
    this.byHex = new Map();
  }

  /**
   * Build a registry from a map definition.
   * Declared `buildings` win; remaining building terrain becomes one-hex buildings.
   */
  static fromMap(mapDef) {
    const registry = new BuildingRegistry();
    if (!mapDef) return registry;

    const claimed = new Set();
    const declared = Array.isArray(mapDef.buildings) ? mapDef.buildings : [];

    for (const entry of declared) {
      const defaults = buildingDefaults(entry.type);
      if (!defaults) continue;

      const levels = Number.isFinite(entry.levels) ? entry.levels : defaults.levels;
      const hexes = entry.hexes || {};

      for (const [hexId, hexDef] of Object.entries(hexes)) {
        const cf = Number.isFinite(hexDef && hexDef.cf) ? hexDef.cf : defaults.cf;
        registry._register(entry.id, { type: entry.type, levels, cf }, hexId);
        claimed.add(hexId);
      }
    }

    for (const [hexId, data] of Object.entries(mapDef.hexes || {})) {
      if (claimed.has(hexId)) continue;

      const type = buildingTypeForTerrain(data && data.terrain);
      if (!type) continue;

      const defaults = buildingDefaults(type);
      registry._register(`auto-${hexId}`, { type, levels: defaults.levels, cf: defaults.cf }, hexId);
    }

    return registry;
  }

  _register(id, { type, levels, cf }, hexId) {
    if (!this.buildings.has(id)) {
      this.buildings.set(id, { id, type, levels, hexes: [] });
    }
    const building = this.buildings.get(id);
    if (!building.hexes.includes(hexId)) building.hexes.push(hexId);

    this.byHex.set(hexId, { id, type, levels, cf, currentCF: cf });
  }

  /** Building data for a hex, or null. */
  getForHex(hexId) {
    return this.byHex.get(hexId) || null;
  }

  /** The structure record for a building id. */
  get(id) {
    return this.buildings.get(id) || null;
  }

  list() {
    return [...this.buildings.values()];
  }

  get size() {
    return this.buildings.size;
  }

  /** Write the per-hex building objects onto Hex instances. */
  applyToHexes(hexes) {
    for (const [hexId, building] of this.byHex) {
      const hex = hexes.get(hexId);
      if (hex) hex.building = { ...building };
    }
  }

  /** Has this hex's structure been reduced to rubble? */
  static isDestroyed(hex) {
    return Boolean(hex && hex.building && hex.building.currentCF <= 0);
  }

  /**
   * Is more than half of a building in ruins? That is what brings the rest of
   * it down (p73); a single destroyed hex does not affect its neighbours.
   */
  static isMostlyDestroyed(buildingId, hexes) {
    const registry = new Map();
    for (const [, hex] of hexes) {
      if (hex.building && hex.building.id === buildingId) {
        registry.set(hex.hexKey, hex);
      }
    }
    const all = [...registry.values()];
    if (all.length === 0) return false;

    const destroyed = all.filter(hex => hex.building.currentCF <= 0).length;
    return destroyed * 2 > all.length;
  }

  /**
   * Structural problems with a map's buildings: disconnected groups, bad CF or
   * levels, or a hex claimed by two buildings.
   * @returns {string[]} problems (empty when valid)
   */
  static validate(mapDef, registry = BuildingRegistry.fromMap(mapDef)) {
    const problems = [];

    // Types are checked against the declaration: unknown types never make it
    // into the registry.
    for (const entry of mapDef.buildings || []) {
      if (!buildingDefaults(entry.type)) {
        problems.push(`building ${entry.id}: unknown type "${entry.type}"`);
      }
    }

    for (const building of registry.list()) {
      if (!Number.isFinite(building.levels) || building.levels < 1) {
        problems.push(`building ${building.id}: invalid levels`);
      }
      if (!isConnected(building.hexes)) {
        problems.push(`building ${building.id}: hexes are not contiguous`);
      }
    }

    for (const [hexId, building] of registry.byHex) {
      if (!Number.isFinite(building.cf) || building.cf <= 0) {
        problems.push(`${hexId}: CF must be positive`);
      }
      const declared = (mapDef.buildings || []).filter(b => b.hexes && b.hexes[hexId]);
      if (declared.length > 1) {
        problems.push(`${hexId}: claimed by ${declared.length} buildings`);
      }
    }

    return problems;
  }

  /** Drop every per-hex building object it previously wrote. */
  clearFromHexes(hexes) {
    for (const hexId of this.byHex.keys()) {
      const hex = hexes.get(hexId);
      if (hex) hex.building = null;
    }
  }
}

/** Are all of these hex keys connected through hex adjacency? */
function isConnected(hexIds) {
  if (hexIds.length <= 1) return true;
  const remaining = new Set(hexIds);
  const queue = [hexIds[0]];
  remaining.delete(hexIds[0]);

  while (queue.length) {
    const current = queue.pop();
    for (const neighbour of hexNeighbors(current)) {
      if (remaining.has(neighbour)) {
        remaining.delete(neighbour);
        queue.push(neighbour);
      }
    }
  }

  return remaining.size === 0;
}
