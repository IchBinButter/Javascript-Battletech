/**
 * Hex - represents a single hex on the map.
 */

import { deepClone } from '../utils/helpers.js';

export class Hex {
  constructor(key, data = {}) {
    this.hexKey = key;
    this.terrainType = data.terrainType || 'clear';
    this.level = data.level || 0;
    this.sublevel = data.sublevel || false;

    this.building = data.building || null; // { type: 'medium', levels: 2, cf: 40, currentCF: 40 }

    this.modifiers = {
      ice: data.ice || false,
      mud: data.mud || false,
      deepSnow: data.deepSnow || false,
      swamp: data.swamp || false
    };

    this.occupiedBy = data.occupiedBy || null; // unitId or null

    // Optional properties
    this.label = data.label || null;
    this.notes = data.notes || null;
  }

  /** Get total height of hex (level + terrain height) */
  getHeight() {
    let h = this.level;
    if (this.building) {
      h += this.building.levels;
    }
    return h;
  }

  /** Get movement point cost to enter this hex */
  getMPCost(terrainData) {
    if (!terrainData || !terrainData[this.terrainType]) {
      return 1; // default to clear
    }
    return terrainData[this.terrainType].mpCost || 1;
  }

  /** Check if hex blocks line of sight */
  blocksLOS(terrainData) {
    if (!terrainData || !terrainData[this.terrainType]) return false;
    return terrainData[this.terrainType].blocksLOS || false;
  }

  /** Check if hex is occupied by any unit */
  isOccupied() {
    return this.occupiedBy !== null;
  }

  /** Quick clone for state immutability */
  clone() {
    return new Hex(this.hexKey, deepClone({
      terrainType: this.terrainType,
      level: this.level,
      sublevel: this.sublevel,
      building: this.building,
      ice: this.modifiers.ice,
      mud: this.modifiers.mud,
      deepSnow: this.modifiers.deepSnow,
      swamp: this.modifiers.swamp,
      occupiedBy: this.occupiedBy,
      label: this.label,
      notes: this.notes
    }));
  }

  /** Plain data for saving and for sending over the wire. */
  toJSON() {
    return {
      hexKey: this.hexKey,
      terrainType: this.terrainType,
      level: this.level,
      sublevel: this.sublevel,
      building: this.building,
      modifiers: { ...this.modifiers },
      occupiedBy: this.occupiedBy,
      label: this.label,
      notes: this.notes,
      basement: this.basement || null
    };
  }

  static fromJSON(json) {
    const hex = new Hex(json.hexKey, {
      terrainType: json.terrainType,
      level: json.level,
      sublevel: json.sublevel,
      building: json.building,
      ...(json.modifiers || {}),
      occupiedBy: json.occupiedBy,
      label: json.label,
      notes: json.notes
    });
    if (json.basement) hex.basement = json.basement;
    return hex;
  }
}
