/**
 * HexGrid - A hex grid container for game maps.
 * Manages the collection of hexes and grid-level operations.
 */

import { Hex } from '../models/Hex.js';
import { hexNeighbors, hexKey } from './HexMath.js';
import { parseHexKey } from '../utils/helpers.js';

export class HexGrid {
  constructor(width = 17, height = 15) {
    this.width = width;
    this.height = height;
    this.hexes = new Map();
  }

  /** Generate a grid with default clear terrain and random elevation */
  generate(terrainTypes = ['clear', 'light_woods', 'heavy_woods', 'rough', 'water_depth1']) {
    this.hexes.clear();
    for (let col = 0; col < this.width; col++) {
      for (let row = 0; row < this.height; row++) {
        const key = hexKey(col, row);
        const terrainType = terrainTypes[Math.floor(Math.random() * terrainTypes.length)];

        // Simple elevation hills
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const distFromCenter = Math.sqrt(
          (col - centerX) ** 2 + (row - centerY) ** 2
        );
        const level = distFromCenter < 2 ? 1 : (distFromCenter < 4 && Math.random() > 0.6 ? 1 : 0);

        this.hexes.set(key, new Hex(key, { terrainType, level }));
      }
    }
  }

  /** Get a hex by key */
  getHex(key) {
    return this.hexes.get(key) || null;
  }

  /** Set a hex (or update) */
  setHex(key, hex) {
    this.hexes.set(key, hex);
  }

  /** Check if coordinates are within grid bounds */
  isInBounds(col, row) {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  /** Check if a hex key is within grid bounds */
  isKeyInBounds(key) {
    const { col, row } = parseHexKey(key);
    return this.isInBounds(col, row);
  }

  /** Get all neighbor keys that are within bounds */
  getNeighbors(key) {
    return hexNeighbors(key).filter(k => this.isKeyInBounds(k));
  }

  /** Get all hex keys in the grid */
  getAllKeys() {
    return Array.from(this.hexes.keys());
  }

  /** Get all hex objects */
  getAllHexes() {
    return Array.from(this.hexes.values());
  }

  /** Find all hexes matching a terrain type */
  findHexesByTerrain(terrainType) {
    return this.getAllHexes().filter(h => h.terrainType === terrainType);
  }

  /** Create a simple default map with mixed terrain */
  static createDefaultMap() {
    const grid = new HexGrid(17, 15);

    for (let col = 0; col < grid.width; col++) {
      for (let row = 0; row < grid.height; row++) {
        const key = hexKey(col, row);

        // Default: mostly clear with scattered terrain
        let terrainType = 'clear';
        let level = 0;

        // Create a small hill in center
        const cx = 8, cy = 7;
        const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
        if (dist < 1.5) {
          level = 2;
          terrainType = 'clear';
        } else if (dist < 3) {
          level = 1;
          terrainType = Math.random() > 0.5 ? 'clear' : 'light_woods';
        }

        // Scattered woods
        if (Math.random() > 0.85 && dist >= 3) {
          terrainType = Math.random() > 0.5 ? 'light_woods' : 'heavy_woods';
        }

        // Water on edges
        if (col <= 1 || col >= grid.width - 2 || row <= 1 || row >= grid.height - 2) {
          if (Math.random() > 0.8 && dist >= 4) {
            terrainType = 'water_depth1';
          }
        }

        // Road through middle
        if (row === 7 && col >= 2 && col <= 14) {
          terrainType = 'pavement';
        }

        grid.setHex(key, new Hex(key, { terrainType, level }));
      }
    }

    return grid;
  }
}

/** A grid hex key is "${col},${row}" */
