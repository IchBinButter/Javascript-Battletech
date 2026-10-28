/**
 * Indirect fire, spotting and aimed shots (BMM p30-31).
 *
 * Geometry used throughout: the attacker at 2,7 has a Level 3 hill sitting on
 * its line to the target at 8,7, so it has no LOS; the spotter at 5,4 does.
 */

import { describe, it, expect } from 'vitest';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };
import {
  createTestUnit,
  createTestEngine,
  createStandardTestMap,
  createWeaponDef,
  makeDiceRoller
} from '../../helpers/testUtils.js';

const resolver = new AttackResolver(hitTables);

function roller(...rolls) {
  let i = 0;
  return { roll2d6: () => rolls[Math.min(i++, rolls.length - 1)] };
}

function unit(hexKey, { facing = 0, ...rest } = {}) {
  return {
    id: `u-${hexKey}`,
    position: { hexKey, facing },
    pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
    hexesMoved: 0,
    heat: 0,
    equipment: { other: {} },
    _movementModifier: 0,
    getAttackerMovementModifier() { return this._movementModifier; },
    getTargetMovementModifier: () => 0,
    ...rest
  };
}

function gameStateWith(hexLevels = {}) {
  const map = createStandardTestMap();
  for (const [key, level] of Object.entries(hexLevels)) {
    const hex = map.hexes.get(key);
    if (hex) hex.level = level;
  }
  return { map };
}

// =============================================================================
// Spotting and the indirect target number (p30)
// =============================================================================

describe('indirect fire target number', () => {
  const attacker = unit('2,7');
  const spotter = unit('5,4');
  const target = unit('8,7', { facing: 3 });
  const gs = gameStateWith({ '5,6': 3 });
  const lrm = createWeaponDef('lrm15');

  it('adds +1 for indirect fire', () => {
    const calc = resolver.calculateTargetNumber(attacker, lrm, target, gs, {
      indirect: true, spotter
    });
    expect(calc.canFire).toBe(true);
    expect(calc.modifiers).toContain('Indirect fire: +1');
    expect(calc.indirect).toBe(true);
  });

  it('adds the spotter movement modifier', () => {
    const moved = { ...spotter, _movementModifier: 2 };
    const calc = resolver.calculateTargetNumber(attacker, lrm, target, gs, {
      indirect: true, spotter: moved
    });
    expect(calc.modifiers).toContain('Spotter moved: +2');
  });

  it('adds +1 when the spotter also attacked', () => {
    const calc = resolver.calculateTargetNumber(attacker, lrm, target, gs, {
      indirect: true, spotter, spotterAttacked: true
    });
    expect(calc.modifiers).toContain('Spotter attacked: +1');
  });

  it("takes terrain from the spotter's line of sight, not the attacker's", () => {
    // Light woods on the spotter's line to the target (7,5), not the attacker's.
    const gsWoods = gameStateWith({ '5,6': 3 });
    gsWoods.map.hexes.get('7,5').terrainType = 'light_woods';

    const indirect = resolver.calculateTargetNumber(attacker, lrm, target, gsWoods, {
      indirect: true, spotter
    });
    expect(indirect.modifiers).toContain('Woods between: +1');
  });

  it('a Mech that spots and also attacks takes +1 on its own attacks', () => {
    const spotting = { ...attacker, spottedThisPhase: 'target-1' };
    const calc = resolver.calculateTargetNumber(spotting, lrm, target, gs);
    expect(calc.modifiers).toContain('Spotting for indirect fire: +1');
  });
});

// =============================================================================
// Indirect damage and partial cover (p30)
// =============================================================================

describe('indirect fire and partial cover', () => {
  const attacker = unit('2,7');
  const spotter = unit('5,4');
  const laser = createWeaponDef('med_laser');

  it('a leg hit still damages a target behind a hill', () => {
    // The spotter sees the target past a Level 1 hex at 7,6: partial cover.
    const gs = gameStateWith({ '5,6': 3, '7,6': 1 });
    const target = unit('8,7', { facing: 3 });

    const result = resolver.resolveWeaponAttack(
      attacker, laser, { location: 'centerTorso' }, target, gs, roller(12, 5), // roll 5 = rightLeg
      { indirect: true, spotter }
    );

    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].location).toBe('rightLeg');
    expect(result.hitLocations[0].absorbedByCover).toBe(false);
    expect(result.hitLocations[0].damage).toBe(5);
  });

  it('a leg hit is still absorbed when the cover is water', () => {
    const gs = gameStateWith({ '5,6': 3 });
    gs.map.hexes.get('8,7').terrainType = 'water_depth1';
    const target = unit('8,7', { facing: 3 });

    const result = resolver.resolveWeaponAttack(
      attacker, laser, { location: 'centerTorso' }, target, gs, roller(12, 5),
      { indirect: true, spotter }
    );

    expect(result.hitLocations[0].absorbedByCover).toBe(true);
    expect(result.hitLocations[0].damage).toBe(0);
  });
});

// =============================================================================
// Aimed shots (p30)
// =============================================================================

describe('aimed shots', () => {
  const gs = gameStateWith();
  const laser = createWeaponDef('med_laser');

  it('hits the designated location on a 6, 7 or 8', () => {
    const attacker = unit('5,4', { facing: 3 });
    const target = unit('5,6', { facing: 3, immobile: true });

    const result = resolver.resolveWeaponAttack(
      attacker, laser, { location: 'centerTorso' }, target, gs, roller(12, 5, 7),
      { aimedLocation: 'head' }
    );

    expect(result.hit).toBe(true);
    expect(result.aimRoll).toBe(7);
    expect(result.hitLocations[0].location).toBe('head');
  });

  it('falls back to the normal table on any other roll', () => {
    const attacker = unit('5,4', { facing: 3 });
    const target = unit('5,6', { facing: 3, immobile: true });

    const result = resolver.resolveWeaponAttack(
      attacker, laser, { location: 'centerTorso' }, target, gs, roller(12, 5, 9),
      { aimedLocation: 'head' }
    );

    expect(result.aimRoll).toBe(9);
    expect(result.hitLocations[0].location).not.toBe('head');
  });

  it('cannot be aimed at a mobile target', () => {
    const attacker = unit('5,4', { facing: 3 });
    const target = unit('5,6', { facing: 3 });

    const result = resolver.resolveWeaponAttack(
      attacker, laser, { location: 'centerTorso' }, target, gs, roller(12, 5),
      { aimedLocation: 'head' }
    );

    expect(result.canFire).toBe(false);
    expect(result.details).toContain('immobile');
  });

  it('cannot be made with a cluster weapon', () => {
    const attacker = unit('5,4', { facing: 3 });
    const target = unit('5,6', { facing: 3, immobile: true });

    const result = resolver.resolveWeaponAttack(
      attacker, createWeaponDef('lrm15'), { location: 'centerTorso' }, target, gs, roller(12),
      { aimedLocation: 'head' }
    );

    expect(result.canFire).toBe(false);
    expect(result.details).toContain('Cluster');
  });
});

// =============================================================================
// Engine validation (p30)
// =============================================================================

describe('indirect fire through the engine', () => {
  function setup() {
    const map = createStandardTestMap();
    map.hexes.get('5,6').level = 3; // blocks the attacker's line of sight

    const attacker = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const spotter = createTestUnit('jenner-jr7d', 0, 'jenner-0');
    const target = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    attacker.position = { hexKey: '2,7', facing: 0 };
    spotter.position = { hexKey: '5,4', facing: 3 };
    target.position = { hexKey: '8,7', facing: 3 };

    const engine = createTestEngine({
      map,
      units: { 'atlas-0': attacker, 'jenner-0': spotter, 'jenner-1': target }
    });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    return { engine, attacker, spotter, target, map };
  }

  function fire(engine, extra = {}) {
    return engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('lrm15'),
      weaponLocation: 'rightArm',
      ...extra
    });
  }

  it('needs a spotter', () => {
    const { engine } = setup();
    const result = fire(engine, { indirect: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('spotter');
  });

  it('is refused when the attacker can see the target', () => {
    const { engine, map } = setup();
    map.hexes.get('5,6').level = 0; // line of sight is now clear

    const result = fire(engine, { indirect: true, spotterId: 'jenner-0' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('line of sight');
  });

  it('is refused when the spotter cannot see the target', () => {
    const { engine, map } = setup();
    map.hexes.get('7,5').level = 3; // blocks the spotter, not the attacker

    const result = fire(engine, { indirect: true, spotterId: 'jenner-0' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('spotter has no line of sight');
  });

  it('is refused for non-LRM weapons', () => {
    const { engine } = setup();
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser'),
      weaponLocation: 'rightArm',
      indirect: true,
      spotterId: 'jenner-0'
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('LRM');
  });

  it('fires with a valid spotter and records the spot', () => {
    const { engine, spotter } = setup();
    engine.diceRoller = makeDiceRoller(12);

    const result = fire(engine, { indirect: true, spotterId: 'jenner-0' });

    expect(result.success).toBe(true);
    expect(result.indirect).toBe(true);
    expect(spotter.spottedThisPhase).toBe('jenner-1');
  });

  it('adds +1 when the spotter has already attacked this phase', () => {
    const { engine, spotter } = setup();
    spotter.attackedThisPhase = true;
    engine.diceRoller = makeDiceRoller(12);

    const result = fire(engine, { indirect: true, spotterId: 'jenner-0' });

    expect(result.success).toBe(true);
    expect(result.modifiers).toContain('Spotter attacked: +1');
  });
});
