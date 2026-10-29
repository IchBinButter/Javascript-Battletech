/**
 * Buildings - multi-hex building registry (BMM p66-73).
 *
 * A map declares buildings as groups of hexes that share one structure; each hex
 * keeps its own Construction Factor, because damage never transfers between the
 * hexes of a building. Maps that only mark building terrain get synthetic
 * one-hex buildings so older mapsheets keep working.
 */

import terrainData from '../../data/terrain.json' with { type: 'json' };
import { hexNeighbors, hexLine } from '../../hex/HexMath.js';

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
  return { type, levels: def.levels, cf: def.cf, psrModifier: def.psrModifier || 0 };
}

/** PSR modifier for entering a building at Level 0 (Building Modifiers Table, p67). */
export function entryPSRModifier(type) {
  const def = terrainData.buildings[type];
  return def ? (def.psrModifier || 0) : 0;
}

/** Damage a Mech does to a building hex by walking into it: tonnage / 10 (p72). */
export function entryDamage(unit) {
  return Math.ceil((unit.tonnage || 0) / 10);
}

/**
 * Damage a building hex absorbs from each hit on a Mech inside it (p72).
 *
 * "A building reduces the damage of each hit on a 'Mech inside it by its
 * current CF / 10 (round up; treat each Damage Value grouping as a separate
 * hit)." The manual's worked example fixes the value for the whole phase (five
 * attacks all use "38 ÷10 = 3.8, rounded up to 4" although the hex's CF is only
 * cut to 19 at the end of the phase), so the phase-start CF snapshot wins when
 * one is present. `GameEngine` takes that snapshot when the Weapon Attack Phase
 * begins and charges the absorbed damage to the hex at the phase's end.
 */
export function damageReduction(hex) {
  const building = hex && hex.building;
  if (!building) return 0;
  const cf = hex._cfAtPhaseStart ?? building.currentCF ?? building.cf;
  return Math.ceil(cf / 10);
}

/**
 * Damage from a collapsing hex (p73): the hex's CF at the start of the phase
 * divided by 10, plus that base for every building level above the Mech,
 * rounded up.
 */
export function collapseDamage(cfAtPhaseStart, levelsAbove) {
  const base = (cfAtPhaseStart || 0) / 10;
  return Math.ceil(base * (1 + Math.max(0, levelsAbove)));
}

/**
 * The building level a unit occupies (p72).
 *
 * `position.level` is the building floor, NOT the elevation of the underlying
 * hex: 0 is the ground floor inside the hex, 1..levels-1 are the upper floors,
 * and `building.levels` is the roof (p66 treats a building's levels as a hill,
 * so its top surface sits at that level). The engine has no elevation model,
 * so a unit with no finite `position.level` is taken to be inside on the
 * ground floor, which is the common case for the existing maps and scenarios.
 * A caller that places a unit on an upper floor or the roof sets it explicitly.
 */
function buildingLevelOf(unit) {
  const raw = unit && unit.position ? unit.position.level : undefined;
  return Number.isFinite(raw) ? raw : 0;
}

/** Is the unit standing on the roof rather than inside the building? */
function onRoof(level, building) {
  return Boolean(building) && Number.isFinite(building.levels) && level >= building.levels;
}

/** Do the two hexes belong to the same building (or are they the same hex)? */
function sameBuilding(attackerHexKey, targetHexKey, attackerBuilding, targetBuilding) {
  if (!attackerBuilding || !targetBuilding) return false;
  if (attackerHexKey === targetHexKey) return true;
  return attackerBuilding.id != null && attackerBuilding.id === targetBuilding.id;
}

/**
 * Combat within a building (p72).
 *
 * A target inside a building costs +1, and each intervening building hex or
 * level costs another +1 (capped at +3 by the attack modifiers table). More
 * than two intervening building hexes/levels blocks line of sight entirely.
 *
 * A 'Mech on a roof is NOT inside (p72 Rooftops): it never receives the
 * automatic +1, but an inside 'Mech and the roof occupant of the same
 * building still count building levels between them.
 *
 * Level counting follows the p72 worked example. Between different hexes of a
 * building the target's hex is what the automatic +1 stands for, so only the
 * building levels strictly between the two positions interpose (BattleMaster
 * at Level 0 vs the Locust at Level 2 in another hex: one intervening level).
 * In the same hex the target's own floor is counted, which is why the
 * BattleMaster at Level 0 vs the Warhammer at Level 1 gets "the intervening
 * level" even though no whole level lies between them; a roof target is not a
 * building level, so only the levels below the roof interpose (three levels
 * from Level 0 to a Level 4 roof, blocking line of sight).
 */
export function buildingCombat(attacker, target, state) {
  const hexes = (state && state.map && state.map.hexes) || new Map();
  const attackerKey = attacker.position.hexKey;
  const targetKey = target.position.hexKey;
  const attackerHex = hexes.get(attackerKey);
  const targetHex = hexes.get(targetKey);

  const attackerBuilding = attackerHex && attackerHex.building ? attackerHex.building : null;
  const targetBuilding = targetHex && targetHex.building ? targetHex.building : null;
  const attackerLevel = buildingLevelOf(attacker);
  const targetLevel = buildingLevelOf(target);
  const targetOnRoof = onRoof(targetLevel, targetBuilding);
  const targetInside = Boolean(targetBuilding) && !targetOnRoof;
  const sharedBuilding = sameBuilding(attackerKey, targetKey, attackerBuilding, targetBuilding);
  const sameHex = attackerKey === targetKey;

  // Building hexes on the line of sight, excluding the attacker's and target's
  // own hexes (their own hex is the target's +1, not intervening terrain).
  let interveningHexes = 0;
  if (attackerHex && targetHex && !sameHex) {
    const line = hexLine(attackerKey, targetKey);
    for (const key of line.slice(1, -1)) {
      const hex = hexes.get(key);
      if (hex && hex.building) interveningHexes++;
    }
  }

  // Building levels between the two positions. Levels are only comparable
  // inside one building; across buildings the level difference says nothing
  // about intervening structure.
  let interveningLevels = 0;
  if (sharedBuilding) {
    const gap = Math.abs(targetLevel - attackerLevel);
    interveningLevels = Math.max(0, gap - 1);
    if (sameHex && targetInside && targetLevel > attackerLevel) {
      // p72 example: in the same hex the target's own floor counts.
      interveningLevels = targetLevel - attackerLevel;
    }
  }

  const intervening = interveningHexes + interveningLevels;
  const modifier = (targetInside ? 1 : 0) + Math.min(intervening, 3);

  return {
    // Positions used for the level model (exposed for callers and tests).
    attackerLevel,
    targetLevel,
    targetOnRoof,
    targetInside,
    sameBuilding: sharedBuilding,
    interveningHexes,
    interveningLevels,
    intervening,
    modifier,
    losBlocked: intervening > 2
  };
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
