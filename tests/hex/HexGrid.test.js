/**
 * HexGrid container: bounds, neighbours and the generated default map.
 */

import { describe, it, expect } from 'vitest';
import { HexGrid } from '../../src/hex/HexGrid.js';
import { Hex } from '../../src/models/Hex.js';

describe('HexGrid', () => {
  it('starts empty with the requested size', () => {
    const grid = new HexGrid(17, 15);
    expect(grid.width).toBe(17);
    expect(grid.height).toBe(15);
    expect(grid.hexes.size).toBe(0);
  });

  it('stores and reads hexes', () => {
    const grid = new HexGrid(4, 4);
    const hex = new Hex('1,1', { terrainType: 'rough' });

    grid.setHex('1,1', hex);
    expect(grid.getHex('1,1')).toBe(hex);
    expect(grid.getHex('9,9')).toBeNull();
  });

  it('checks bounds by coordinate and by key', () => {
    const grid = new HexGrid(4, 3);

    expect(grid.isInBounds(0, 0)).toBe(true);
    expect(grid.isInBounds(3, 2)).toBe(true);
    expect(grid.isInBounds(4, 2)).toBe(false);
    expect(grid.isInBounds(0, 3)).toBe(false);
    expect(grid.isKeyInBounds('3,2')).toBe(true);
    expect(grid.isKeyInBounds('5,5')).toBe(false);
  });

  it('filters neighbours to those inside the grid', () => {
    const grid = new HexGrid(5, 5);

    expect(grid.getNeighbors('2,2')).toHaveLength(6);
    // The top-left hex touches the board edge: only two neighbours remain.
    expect(grid.getNeighbors('0,0')).toHaveLength(2);
  });

  it('lists keys, hexes and terrain matches', () => {
    const grid = new HexGrid(2, 2);
    grid.setHex('0,0', new Hex('0,0', { terrainType: 'clear' }));
    grid.setHex('1,0', new Hex('1,0', { terrainType: 'water_depth1' }));
    grid.setHex('0,1', new Hex('0,1', { terrainType: 'water_depth1' }));

    expect(grid.getAllKeys()).toHaveLength(3);
    expect(grid.getAllHexes()).toHaveLength(3);
    expect(grid.findHexesByTerrain('water_depth1')).toHaveLength(2);
    expect(grid.findHexesByTerrain('heavy_woods')).toHaveLength(0);
  });

  it('generates a full grid of hexes with the allowed terrain', () => {
    const grid = new HexGrid(4, 3);
    grid.generate(['clear', 'rough']);

    expect(grid.hexes.size).toBe(12);
    for (const hex of grid.getAllHexes()) {
      expect(hex).toBeInstanceOf(Hex);
      expect(['clear', 'rough']).toContain(hex.terrainType);
      expect([0, 1]).toContain(hex.level);
    }
  });
});

describe('HexGrid.createDefaultMap', () => {
  it('builds the standard 17x15 battlefield', () => {
    const grid = HexGrid.createDefaultMap();

    expect(grid.width).toBe(17);
    expect(grid.height).toBe(15);
    expect(grid.hexes.size).toBe(17 * 15);
  });

  it('puts a level 2 hill at the centre and a road along row 7', () => {
    const grid = HexGrid.createDefaultMap();

    expect(grid.getHex('8,7').level).toBe(2);
    expect(grid.getHex('5,7').terrainType).toBe('pavement');
    expect(grid.getHex('14,7').terrainType).toBe('pavement');
    // Outside the road span it is not pavement.
    expect(grid.getHex('16,7').terrainType).not.toBe('pavement');
  });
});
