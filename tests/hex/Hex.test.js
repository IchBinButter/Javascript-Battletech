/**
 * Hex model and utility helpers.
 */

import { describe, it, expect } from 'vitest';
import { Hex } from '../../src/models/Hex.js';
import { parseHexKey, hexKey, deepClone, clamp, getInternalStructure } from '../../src/utils/helpers.js';

describe('Hex', () => {
  it('defaults to clear level 0', () => {
    const hex = new Hex('1,1');
    expect(hex.terrainType).toBe('clear');
    expect(hex.level).toBe(0);
    expect(hex.getHeight()).toBe(0);
  });

  it('adds building levels to its height', () => {
    const hex = new Hex('1,1', { level: 2, building: { type: 'medium', levels: 3, cf: 40 } });
    expect(hex.getHeight()).toBe(5);
  });

  it('reads MP cost from the terrain table with a clear default', () => {
    const hex = new Hex('1,1', { terrainType: 'heavy_woods' });
    const terrain = { heavy_woods: { mpCost: 3 }, clear: { mpCost: 1 } };

    expect(hex.getMPCost(terrain)).toBe(3);
    expect(hex.getMPCost(null)).toBe(1);
    expect(new Hex('1,1').getMPCost(terrain)).toBe(1);
  });

  it('reports whether the terrain blocks line of sight', () => {
    const terrain = { heavy_woods: { blocksLOS: true } };
    expect(new Hex('1,1', { terrainType: 'heavy_woods' }).blocksLOS(terrain)).toBe(true);
    expect(new Hex('1,1', { terrainType: 'clear' }).blocksLOS(terrain)).toBe(false);
    expect(new Hex('1,1').blocksLOS(null)).toBe(false);
  });

  it('tracks occupancy', () => {
    const hex = new Hex('1,1', { occupiedBy: 'unit-1' });
    expect(hex.isOccupied()).toBe(true);
    expect(new Hex('1,1').isOccupied()).toBe(false);
  });

  it('clones without sharing state', () => {
    const original = new Hex('1,1', { terrainType: 'light_woods', level: 1, building: { type: 'light', levels: 1, cf: 20 } });
    const copy = original.clone();

    expect(copy.terrainType).toBe('light_woods');
    expect(copy.level).toBe(1);
    expect(copy.building.levels).toBe(1);

    copy.level = 5;
    copy.building.levels = 3;
    expect(original.level).toBe(1);
    expect(original.building.levels).toBe(1);
  });
});

describe('helpers', () => {
  it('parses and rebuilds hex keys', () => {
    expect(parseHexKey('12,34')).toEqual({ col: 12, row: 34 });
    expect(hexKey(12, 34)).toBe('12,34');
    expect(parseHexKey(hexKey(3, 4))).toEqual({ col: 3, row: 4 });
  });

  it('deep clones nested objects', () => {
    const source = { a: { b: [1, 2, 3] }, c: 'x' };
    const copy = deepClone(source);

    expect(copy).toEqual(source);
    copy.a.b.push(4);
    expect(source.a.b).toHaveLength(3);
  });

  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('derives internal structure from tonnage', () => {
    const light = getInternalStructure(20);
    const assault = getInternalStructure(100);

    expect(light.head).toBe(3);
    expect(assault.centerTorso).toBe(100);
    expect(assault.centerTorso).toBeGreaterThan(light.centerTorso);
  });
});
