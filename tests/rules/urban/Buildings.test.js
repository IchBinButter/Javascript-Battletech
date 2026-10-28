/**
 * Multi-hex buildings (BMM p66-73).
 *
 * A building is a group of hexes with a shared structure, but each hex keeps its
 * own Construction Factor: damage to one hex never reaches its neighbours, and
 * only losing more than half the hexes brings the rest down.
 */

import { describe, it, expect } from 'vitest';
import { BuildingRegistry, buildingDefaults, buildingTypeForTerrain } from '../../../src/rules/urban/Buildings.js';
import { Hex } from '../../../src/models/Hex.js';
import urbanMap from '../../../src/data/maps/urban.json' with { type: 'json' };

const blockMap = () => ({
  width: 8,
  height: 8,
  hexes: {
    '2,2': { terrain: 'medium_building' },
    '3,2': { terrain: 'medium_building' },
    '2,3': { terrain: 'medium_building' },
    '3,3': { terrain: 'medium_building' }
  },
  buildings: [
    { id: 'block', type: 'medium', hexes: { '2,2': {}, '3,2': {}, '2,3': {}, '3,3': { cf: 30 } } }
  ]
});

const hexesOf = (hexKeys) => {
  const map = new Map();
  for (const key of hexKeys) map.set(key, new Hex(key, { terrainType: 'medium_building' }));
  return map;
};

describe('building type mapping', () => {
  it('maps building terrain to its type', () => {
    expect(buildingTypeForTerrain('light_building')).toBe('light');
    expect(buildingTypeForTerrain('heavy_building')).toBe('heavy');
    expect(buildingTypeForTerrain('clear')).toBeNull();
  });

  it('knows the default CF and levels for each type', () => {
    expect(buildingDefaults('light')).toEqual({ type: 'light', levels: 1, cf: 15 });
    expect(buildingDefaults('medium')).toEqual({ type: 'medium', levels: 2, cf: 40 });
    expect(buildingDefaults('heavy')).toEqual({ type: 'heavy', levels: 3, cf: 90 });
    expect(buildingDefaults('hardened')).toEqual({ type: 'hardened', levels: 4, cf: 120 });
    expect(buildingDefaults('nonsense')).toBeNull();
  });
});

describe('BuildingRegistry.fromMap', () => {
  it('groups declared hexes into one building', () => {
    const registry = BuildingRegistry.fromMap(blockMap());

    expect(registry.size).toBe(1);
    expect(registry.get('block').hexes).toHaveLength(4);
    expect(registry.getForHex('2,2').id).toBe('block');
    expect(registry.getForHex('3,3').id).toBe('block');
  });

  it('keeps a per-hex CF override', () => {
    const registry = BuildingRegistry.fromMap(blockMap());

    expect(registry.getForHex('2,2').cf).toBe(40);
    expect(registry.getForHex('3,3').cf).toBe(30);
    expect(registry.getForHex('2,2').currentCF).toBe(40);
  });

  it('synthesises one-hex buildings for terrain-only maps', () => {
    const map = {
      width: 4, height: 4,
      hexes: { '1,1': { terrain: 'light_building' }, '1,2': { terrain: 'clear' } }
    };
    const registry = BuildingRegistry.fromMap(map);

    expect(registry.size).toBe(1);
    expect(registry.getForHex('1,1').type).toBe('light');
    expect(registry.getForHex('1,1').levels).toBe(1);
    expect(registry.getForHex('1,2')).toBeNull();
  });

  it('writes the building onto Hex objects', () => {
    const hexes = hexesOf(['2,2', '3,2']);
    BuildingRegistry.fromMap(blockMap()).applyToHexes(hexes);

    expect(hexes.get('2,2').building.type).toBe('medium');
    expect(hexes.get('2,2').getHeight()).toBe(2);
    expect(hexes.get('3,2').building.id).toBe('block');
  });
});

describe('the urban map', () => {
  it('loads its three multi-hex buildings', () => {
    const registry = BuildingRegistry.fromMap(urbanMap);

    expect(registry.size).toBe(3);
    expect(registry.get('light-block').type).toBe('light');
    expect(registry.get('medium-block').type).toBe('medium');
    expect(registry.get('heavy-block').type).toBe('heavy');
    expect(registry.get('heavy-block').hexes).toHaveLength(4);
  });

  it('keeps the heavy block CF override', () => {
    const registry = BuildingRegistry.fromMap(urbanMap);
    expect(registry.getForHex('10,3').cf).toBe(70);
    expect(registry.getForHex('10,2').cf).toBe(90);
  });

  it('is structurally valid', () => {
    expect(BuildingRegistry.validate(urbanMap)).toEqual([]);
  });
});

describe('BuildingRegistry.validate', () => {
  it('flags a building whose hexes are not contiguous', () => {
    const map = {
      width: 9, height: 9,
      hexes: {},
      buildings: [{ id: 'split', type: 'medium', hexes: { '0,0': {}, '8,8': {} } }]
    };
    expect(BuildingRegistry.validate(map).join(' ')).toContain('not contiguous');
  });

  it('flags an unknown building type', () => {
    const map = { hexes: {}, buildings: [{ id: 'x', type: 'cardboard', hexes: { '1,1': {} } }] };
    expect(BuildingRegistry.validate(map).join(' ')).toContain('unknown type');
  });

  it('flags a hex claimed by two buildings', () => {
    const map = {
      hexes: {},
      buildings: [
        { id: 'a', type: 'light', hexes: { '1,1': {} } },
        { id: 'b', type: 'light', hexes: { '1,1': {} } }
      ]
    };
    expect(BuildingRegistry.validate(map).join(' ')).toContain('claimed by 2 buildings');
  });

  it('flags a non-positive CF', () => {
    const map = { hexes: {}, buildings: [{ id: 'a', type: 'light', hexes: { '1,1': { cf: 0 } } }] };
    expect(BuildingRegistry.validate(map).join(' ')).toContain('CF must be positive');
  });
});

describe('collapse thresholds (p73)', () => {
  it('treats a hex at zero CF as destroyed', () => {
    const hex = new Hex('1,1', { building: { levels: 2, currentCF: 0 } });
    expect(BuildingRegistry.isDestroyed(hex)).toBe(true);
    expect(BuildingRegistry.isDestroyed(new Hex('1,1', { building: { levels: 2, currentCF: 12 } }))).toBe(false);
  });

  it('needs more than half the hexes down before the building follows', () => {
    const hexes = hexesOf(['2,2', '3,2', '2,3', '3,3']);
    BuildingRegistry.fromMap(blockMap()).applyToHexes(hexes);

    hexes.get('2,2').building.currentCF = 0;
    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(false);

    hexes.get('3,2').building.currentCF = 0;
    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(false); // exactly half

    hexes.get('2,3').building.currentCF = 0;
    expect(BuildingRegistry.isMostlyDestroyed('block', hexes)).toBe(true);
  });
});
