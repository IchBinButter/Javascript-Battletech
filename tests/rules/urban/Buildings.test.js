/**
 * Multi-hex buildings (BMM p66-73).
 *
 * A building is a group of hexes with a shared structure, but each hex keeps its
 * own Construction Factor: damage to one hex never reaches its neighbours, and
 * only losing more than half the hexes brings the rest down.
 */

import { describe, it, expect } from 'vitest';
import { BuildingRegistry, buildingDefaults, buildingTypeForTerrain, entryPSRModifier, entryDamage, damageReduction, collapseDamage, buildingCombat } from '../../../src/rules/urban/Buildings.js';
import { Hex } from '../../../src/models/Hex.js';
import { hexLine } from '../../../src/hex/HexMath.js';
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

  it('knows the default CF, levels and PSR modifier for each type', () => {
    expect(buildingDefaults('light')).toMatchObject({ type: 'light', levels: 1, cf: 15, psrModifier: 0 });
    expect(buildingDefaults('medium')).toMatchObject({ type: 'medium', levels: 2, cf: 40, psrModifier: 1 });
    expect(buildingDefaults('heavy')).toMatchObject({ type: 'heavy', levels: 3, cf: 90, psrModifier: 2 });
    // p54/p142 Building Movement: entering a hardened building hex is +5.
    expect(buildingDefaults('hardened')).toMatchObject({ type: 'hardened', levels: 4, cf: 120, psrModifier: 5 });
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

describe('urban helpers (p67-73)', () => {
  it('gives each building type its entering PSR modifier', () => {
    expect(entryPSRModifier('light')).toBe(0);
    expect(entryPSRModifier('medium')).toBe(1);
    expect(entryPSRModifier('heavy')).toBe(2);
    expect(entryPSRModifier('hardened')).toBe(5); // p54/p142
    expect(entryPSRModifier('nonsense')).toBe(0);
  });

  it('damages a hex by tonnage / 10, rounded up', () => {
    expect(entryDamage({ tonnage: 20 })).toBe(2);
    expect(entryDamage({ tonnage: 70 })).toBe(7);
    expect(entryDamage({ tonnage: 75 })).toBe(8);
    expect(entryDamage({})).toBe(0);
  });

  it('absorbs CF / 10 of each hit, rounded up', () => {
    expect(damageReduction({ building: { currentCF: 38 } })).toBe(4);
    expect(damageReduction({ building: { currentCF: 40 } })).toBe(4);
    expect(damageReduction({ building: { currentCF: 10 } })).toBe(1);
    expect(damageReduction({ building: { currentCF: 0 } })).toBe(0);
    expect(damageReduction({})).toBe(0);
  });

  it('scales collapse damage by the levels above the Mech', () => {
    // p73 Archer example: CF 7, two levels above -> 0.7 x 3 = 2.1 -> 3
    expect(collapseDamage(7, 2)).toBe(3);
    expect(collapseDamage(37, 0)).toBe(4);
    expect(collapseDamage(30, 0)).toBe(3);
  });

  it('caps the intervening-building modifier at +3', () => {
    const line = hexLine('0,0', '6,0');
    const between = line.slice(1, -1);

    const hexes = new Map();
    for (const key of line) {
      hexes.set(key, new Hex(key, between.includes(key) ? { building: { levels: 2 } } : {}));
    }
    const state = { map: { hexes } };
    const attacker = { position: { hexKey: '0,0' } };
    const target = { position: { hexKey: '6,0' } };

    const combat = buildingCombat(attacker, target, state);
    expect(combat.intervening).toBe(between.length);
    expect(combat.modifier).toBe(3); // capped at +3
    expect(combat.losBlocked).toBe(true); // more than two intervene
  });

  it('does not block the line for a single intervening building hex', () => {
    const line = hexLine('0,0', '2,0');
    const between = line.slice(1, -1);
    const hexes = new Map();
    for (const key of line) {
      hexes.set(key, new Hex(key, between.includes(key) ? { building: { levels: 1 } } : {}));
    }

    const combat = buildingCombat(
      { position: { hexKey: '0,0' } },
      { position: { hexKey: '2,0' } },
      { map: { hexes } }
    );

    expect(combat.losBlocked).toBe(false);
    expect(combat.modifier).toBe(between.length);
  });

  it('reports no modifier in the open', () => {
    const state = {
      map: { hexes: new Map([['0,0', new Hex('0,0')], ['2,0', new Hex('2,0')], ['1,0', new Hex('1,0')]]) }
    };
    const combat = buildingCombat({ position: { hexKey: '0,0' } }, { position: { hexKey: '2,0' } }, state);

    expect(combat).toMatchObject({ targetInside: false, intervening: 0, modifier: 0, losBlocked: false });
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
