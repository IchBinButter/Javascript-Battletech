/**
 * Line of sight and partial cover (BMM p22, p26, p32).
 *
 * LOS level = hex level + Mech height (2 standing, 1 prone). Intervening
 * terrain that reaches the lower of the two LOS levels blocks the line; woods
 * block by accumulation instead (3 points). Partial cover is a hex one level
 * higher than the target's own, adjacent along the LOS.
 */

import { describe, it, expect } from 'vitest';
import { LineOfSight } from '../../../src/rules/combat/LineOfSight.js';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import { Hex } from '../../../src/models/Hex.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };
import { createWeaponDef } from '../../helpers/testUtils.js';

const los = new LineOfSight();

function makeMap(hexDefs) {
  const hexes = new Map();
  for (const [key, data] of Object.entries(hexDefs)) {
    hexes.set(key, new Hex(key, data));
  }
  return { map: { hexes } };
}

/** Minimal unit stub: only position, prone and height matter to LOS. */
function unit(hexKey, { prone = false } = {}) {
  return {
    position: { hexKey, facing: 0 },
    prone,
    getHeightLevels() {
      return this.prone ? 1 : 2;
    }
  };
}

/** A straight corridor of clear hexes on one level. */
function corridor(keys, level = 0) {
  const defs = {};
  for (const key of keys) defs[key] = { terrainType: 'clear', level };
  return defs;
}

const LINE = ['5,4', '5,5', '5,6', '5,7'];

// =============================================================================
// 1.2 LOS levels and blocking
// =============================================================================

describe('LOS levels', () => {
  it('adds the Mech height to the hex level', () => {
    const attacker = unit('5,4');
    const target = unit('5,7');
    const gs = makeMap(corridor(LINE));

    const result = los.calculateLOS('5,4', '5,7', gs, { attacker, target });

    expect(result.attackerLOS).toBe(2);
    expect(result.targetLOS).toBe(2);
  });

  it('drops a prone Mech to one level', () => {
    const attacker = unit('5,4');
    const target = unit('5,7', { prone: true });
    const gs = makeMap(corridor(LINE));

    const result = los.calculateLOS('5,4', '5,7', gs, { attacker, target });

    expect(result.targetLOS).toBe(1);
  });

  it('adds hill levels', () => {
    const gs = makeMap({ ...corridor(LINE), '5,4': { terrainType: 'clear', level: 2 } });
    const result = los.calculateLOS('5,4', '5,7', gs, { attacker: unit('5,4'), target: unit('5,7') });
    expect(result.attackerLOS).toBe(4);
  });
});

describe('intervening terrain', () => {
  it('does not block on clear ground', () => {
    const result = los.calculateLOS('5,4', '5,7', makeMap(corridor(LINE)), {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.blocked).toBe(false);
  });

  it('does not block on a single Level 1 hex (that is partial cover)', () => {
    const gs = makeMap({ ...corridor(LINE), '5,6': { terrainType: 'clear', level: 1 } });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.blocked).toBe(false);
    expect(result.partialCover).toBe(true);
  });

  it('blocks on a Level 2 hex between two standing Mechs', () => {
    const gs = makeMap({ ...corridor(LINE), '5,6': { terrainType: 'clear', level: 2 } });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('5,6');
  });

  it('hides a prone Mech behind an adjacent Level 1 hex (p26)', () => {
    const gs = makeMap({ ...corridor(LINE), '5,6': { terrainType: 'clear', level: 1 } });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7', { prone: true })
    });
    expect(result.blocked).toBe(true);
  });

  it('blocks an attacker firing down past the target level', () => {
    const gs = makeMap({
      ...corridor(LINE),
      '5,4': { terrainType: 'clear', level: 2 },
      '5,6': { terrainType: 'clear', level: 2 }
    });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.blocked).toBe(true);
  });

  it('counts woods by points, not height', () => {
    const one = makeMap({ ...corridor(LINE), '5,5': { terrainType: 'light_woods', level: 0 } });
    expect(los.calculateLOS('5,4', '5,7', one, {
      attacker: unit('5,4'), target: unit('5,7')
    }).blocked).toBe(false);

    const three = makeMap({
      ...corridor(['5,4', '5,5', '5,6', '5,7', '5,8']),
      '5,5': { terrainType: 'light_woods', level: 0 },
      '5,6': { terrainType: 'light_woods', level: 0 },
      '5,7': { terrainType: 'light_woods', level: 0 }
    });
    const result = los.calculateLOS('5,4', '5,8', three, {
      attacker: unit('5,4'), target: unit('5,8')
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('woods');
  });
});

// =============================================================================
// 1.3 Partial cover
// =============================================================================

describe('partial cover', () => {
  const coverMap = () => makeMap({ ...corridor(LINE), '5,6': { terrainType: 'clear', level: 1 } });

  it('applies when the adjacent hex is one level higher', () => {
    const result = los.calculateLOS('5,4', '5,7', coverMap(), {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.partialCover).toBe(true);
    expect(result.partialCoverHex).toBe('5,6');
    expect(result.partialCoverKind).toBe('hill');
  });

  it('does not apply when the adjacent hex is level with the target', () => {
    const result = los.calculateLOS('5,4', '5,7', makeMap(corridor(LINE)), {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.partialCover).toBe(false);
  });

  it('is negated by an attacker firing downhill', () => {
    const gs = makeMap({
      ...corridor(LINE),
      '5,4': { terrainType: 'clear', level: 2 },
      '5,6': { terrainType: 'clear', level: 1 }
    });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.attackerLOS).toBe(4);
    expect(result.partialCover).toBe(false);
  });

  it('survives a downhill attacker when the cover is a building', () => {
    const gs = makeMap({
      ...corridor(LINE),
      '5,4': { terrainType: 'clear', level: 2 },
      '5,6': { terrainType: 'clear', level: 0, building: { type: 'medium', levels: 1, cf: 40 } }
    });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.partialCover).toBe(true);
    expect(result.partialCoverKind).toBe('building');
  });

  it('is never granted to a prone Mech', () => {
    const result = los.calculateLOS('5,4', '5,7', coverMap(), {
      attacker: unit('5,4'), target: unit('5,7', { prone: true })
    });
    expect(result.partialCover).toBe(false);
  });

  it('is granted by Depth 1 water regardless of levels', () => {
    const gs = makeMap({
      ...corridor(LINE),
      '5,4': { terrainType: 'clear', level: 2 },
      '5,7': { terrainType: 'water_depth1', level: 0 }
    });
    const result = los.calculateLOS('5,4', '5,7', gs, {
      attacker: unit('5,4'), target: unit('5,7')
    });
    expect(result.partialCover).toBe(true);
    expect(result.partialCoverKind).toBe('water');
  });

  it('does not apply to adjacent Mechs', () => {
    const gs = makeMap({ '5,6': { terrainType: 'clear', level: 1 }, '5,7': { terrainType: 'clear', level: 0 } });
    const result = los.calculateLOS('5,6', '5,7', gs, {
      attacker: unit('5,6'), target: unit('5,7')
    });
    expect(result.partialCover).toBe(false);
  });
});

// =============================================================================
// 1.3 The leg-hit rule (p26, p32)
// =============================================================================

describe('partial cover absorbs leg hits', () => {
  const resolver = new AttackResolver(hitTables);

  function makeAttacker(hexKey) {
    return {
      position: { hexKey, facing: 3 },
      pilot: { gunnery: 4, hits: 0 },
      prone: false,
      torsoTwist: 0,
      armsReversed: false,
      equipment: { other: {} },
      heat: 0,
      getAttackerMovementModifier: () => 0,
      getHeightLevels() { return 2; }
    };
  }

  function makeTarget(hexKey) {
    return {
      position: { hexKey, facing: 3 },
      prone: false,
      hexesMoved: 0,
      equipment: { ammo: {}, other: {} },
      getTargetMovementModifier: () => 0,
      getHeightLevels() { return 2; }
    };
  }

  function roller(...rolls) {
    let i = 0;
    return { roll2d6: () => rolls[Math.min(i++, rolls.length - 1)] };
  }

  function gameStateWithCover() {
    const gs = makeMap({ ...corridor(LINE), '5,6': { terrainType: 'clear', level: 1 } });
    // The target hex needs to exist too.
    gs.map.hexes.set('5,7', new Hex('5,7', { terrainType: 'clear', level: 0 }));
    return gs;
  }

  it('turns a leg hit into cover, with no damage', () => {
    const gs = gameStateWithCover();
    const attacker = makeAttacker('5,4');
    const target = makeTarget('5,7');

    // 12 hits, then 5 = Right Leg on the front table.
    const result = resolver.resolveWeaponAttack(
      attacker, createWeaponDef('med_laser'), { location: 'centerTorso' }, target, gs, roller(12, 5)
    );

    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].location).toBe('rightLeg');
    expect(result.hitLocations[0].absorbedByCover).toBe(true);
    expect(result.hitLocations[0].damage).toBe(0);
    expect(result.hitLocations[0].coverHex).toBe('5,6');
  });

  it('does not absorb a torso hit', () => {
    const gs = gameStateWithCover();
    const attacker = makeAttacker('5,4');
    const target = makeTarget('5,7');

    // 12 hits, then 7 = Center Torso.
    const result = resolver.resolveWeaponAttack(
      attacker, createWeaponDef('med_laser'), { location: 'centerTorso' }, target, gs, roller(12, 7)
    );

    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].location).toBe('centerTorso');
    expect(result.hitLocations[0].absorbedByCover).toBe(false);
    expect(result.hitLocations[0].damage).toBe(5);
  });

  it('adds the +1 modifier to the target number', () => {
    const gs = gameStateWithCover();
    const calc = resolver.calculateTargetNumber(
      makeAttacker('5,4'), createWeaponDef('med_laser'), makeTarget('5,7'), gs,
      { weaponLocation: 'centerTorso' }
    );
    expect(calc.modifiers).toContain('Partial cover: +1');
  });
});
