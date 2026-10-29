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

  it('does not block a same-building line for a single intervening building hex', () => {
    // p72: 'Mechs in different hexes of one multi-hex building can attack one
    // another; only more than two intervening building hexes/levels block.
    const line = hexLine('0,0', '2,0');
    const between = line.slice(1, -1);
    const hexes = new Map();
    for (const key of line) {
      hexes.set(key, new Hex(key, {
        building: { id: 'block', type: 'medium', levels: 2, cf: 40, currentCF: 40 }
      }));
    }

    const combat = buildingCombat(
      { position: { hexKey: '0,0', level: 0 } },
      { position: { hexKey: '2,0', level: 0 } },
      { map: { hexes } }
    );

    expect(combat.sameBuilding).toBe(true);
    expect(combat.targetInside).toBe(true);
    expect(combat.interveningHexes).toBe(between.length);
    expect(combat.losBlocked).toBe(false);
    expect(combat.modifier).toBe(1 + between.length); // +1 inside, +1 per hex
  });

  it('reports no modifier in the open', () => {
    const state = {
      map: { hexes: new Map([['0,0', new Hex('0,0')], ['2,0', new Hex('2,0')], ['1,0', new Hex('1,0')]]) }
    };
    const combat = buildingCombat({ position: { hexKey: '0,0' } }, { position: { hexKey: '2,0' } }, state);

    expect(combat).toMatchObject({ targetInside: false, intervening: 0, modifier: 0, losBlocked: false });
  });
});

describe('combat within buildings across levels (p72)', () => {
  // The p72 building combat diagram: Hex A is a Level 4 heavy building hex and
  // Hex C an adjacent Level 3 heavy hex of the same building; the building has
  // CF 60 on every level. The BattleMaster enters Hex A at Level 0.
  const p72Buildings = () => new Map([
    ['5,5', new Hex('5,5', { building: { id: 'p72', type: 'heavy', levels: 4, cf: 60, currentCF: 60 } })],
    ['6,5', new Hex('6,5', { building: { id: 'p72', type: 'heavy', levels: 3, cf: 60, currentCF: 60 } })]
  ]);
  const p72State = () => ({ map: { hexes: p72Buildings() } });
  /** A unit standing at a building level: 0 is the ground floor, levels is the roof. */
  const at = (hexKey, level) => ({ position: { hexKey, level } });

  it('reads an explicit position.level as the building floor', () => {
    const combat = buildingCombat(at('5,5', 0), at('5,5', 1), p72State());

    expect(combat).toMatchObject({
      attackerLevel: 0,
      targetLevel: 1,
      targetInside: true,
      targetOnRoof: false,
      interveningHexes: 0,
      interveningLevels: 1,
      intervening: 1,
      modifier: 2,
      losBlocked: false
    });
  });

  it('treats a unit with no position.level as inside on the ground floor', () => {
    // Units have no elevation field, so the absent level is the documented
    // approximation: inside the building, not on the roof.
    const attacker = { position: { hexKey: '5,5' } };
    const target = { position: { hexKey: '5,5' } };
    const combat = buildingCombat(attacker, target, p72State());

    expect(combat.attackerLevel).toBe(0);
    expect(combat.targetLevel).toBe(0);
    expect(combat.targetInside).toBe(true);
    expect(combat.targetOnRoof).toBe(false);
    expect(combat.modifier).toBe(1);
  });

  it('does not treat a roof occupant as inside', () => {
    const combat = buildingCombat(at('5,5', 0), at('5,5', 4), p72State());

    expect(combat.targetOnRoof).toBe(true);
    expect(combat.targetInside).toBe(false);
    // Levels 1-3 lie between the ground floor and the Level 4 roof.
    expect(combat.interveningLevels).toBe(3);
    expect(combat.losBlocked).toBe(true);
  });

  it('still counts the levels between an inside Mech and a roof occupant', () => {
    // A Medium building's roof is Level 2, so from Level 0 one level (Level 1)
    // is between: the roof is visible and takes +1, but no inside +1.
    const hexes = new Map([
      ['2,2', new Hex('2,2', { building: { id: 'medium', type: 'medium', levels: 2, cf: 40, currentCF: 40 } })]
    ]);
    const combat = buildingCombat(at('2,2', 0), at('2,2', 2), { map: { hexes } });

    expect(combat.targetInside).toBe(false);
    expect(combat.interveningLevels).toBe(1);
    expect(combat.modifier).toBe(1);
    expect(combat.losBlocked).toBe(false);
  });

  it('blocks at three intervening levels but not at two', () => {
    // Across two hexes of one building: Level 0 vs Level 3 leaves two whole
    // levels between (Levels 1 and 2), so the line is still open.
    const hexes = new Map([
      ['5,5', new Hex('5,5', { building: { id: 'tower', levels: 4, cf: 60, currentCF: 60 } })],
      ['6,5', new Hex('6,5', { building: { id: 'tower', levels: 4, cf: 60, currentCF: 60 } })]
    ]);
    const twoLevels = buildingCombat(at('5,5', 0), at('6,5', 3), { map: { hexes } });
    expect(twoLevels.targetInside).toBe(true);
    expect(twoLevels.interveningLevels).toBe(2);
    expect(twoLevels.modifier).toBe(3); // +1 inside, +2 levels (table cap +3)
    expect(twoLevels.losBlocked).toBe(false);

    // Level 0 vs the Level 4 roof of the same hex: three levels between.
    const threeLevels = buildingCombat(at('5,5', 0), at('5,5', 4), { map: { hexes } });
    expect(threeLevels.targetInside).toBe(false);
    expect(threeLevels.interveningLevels).toBe(3);
    expect(threeLevels.losBlocked).toBe(true);
  });

  it('reproduces the p72 worked example modifiers and target numbers', () => {
    const state = p72State();
    const battlemaster = at('5,5', 0); // Level 0, Hex A
    const warhammer = at('5,5', 1);    // Level 1, Hex A
    const locust = at('6,5', 2);       // Level 2, Hex C
    const wolverine = at('5,5', 4);    // Level 4 (the roof), Hex A

    // p72: Warhammer TN 10 = 4 Gunnery + 2 (the BattleMaster ran) + 2 (the
    // Warhammer moved 5 hexes) + 1 (target inside) + 1 (intervening level).
    const vsWarhammer = buildingCombat(battlemaster, warhammer, state);
    expect(vsWarhammer.modifier).toBe(2);
    expect(4 + 2 + 2 + vsWarhammer.modifier).toBe(10);

    // p72: Locust TN 8 = 4 Gunnery + 2 (ran) + 1 (target inside) + 1
    // (intervening level); the Locust did not move.
    const vsLocust = buildingCombat(battlemaster, locust, state);
    expect(vsLocust.targetInside).toBe(true);
    expect(vsLocust.modifier).toBe(2);
    expect(4 + 2 + vsLocust.modifier).toBe(8);

    // p72: "three building hex levels are between the BattleMaster (Level 0,
    // Hex A) and the Wolverine (Level 4, Hex A)" -> line of sight is not valid.
    const vsWolverine = buildingCombat(battlemaster, wolverine, state);
    expect(vsWolverine.interveningLevels).toBe(3);
    expect(vsWolverine.losBlocked).toBe(true);
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
