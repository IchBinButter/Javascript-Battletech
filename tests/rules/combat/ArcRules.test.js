/**
 * Firing arcs (BMM p24).
 *
 * Geometry under test: facing 0 = north, increasing clockwise
 * (0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW). The forward arc covers three hexsides
 * (offsets 0, 1 and 5); the left, right and rear arcs are one hexside each.
 */

import { describe, it, expect } from 'vitest';
import {
  ARC,
  getTargetArc,
  getWeaponArc,
  canWeaponFireAt,
  normalizeHexside,
  isArmLocation,
  isLegLocation
} from '../../../src/rules/combat/ArcRules.js';
import { getNeighborInDirection } from '../../../src/hex/HexMath.js';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import { Hex } from '../../../src/models/Hex.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };
import {
  createTestUnit,
  createTestEngine,
  createWeaponDef,
  makeDiceRoller
} from '../../helpers/testUtils.js';

const ATTACKER_HEX = '5,7';

function makeAttacker(overrides = {}) {
  return {
    position: { hexKey: ATTACKER_HEX, facing: 0 },
    torsoTwist: 0,
    armsReversed: false,
    equipment: { weapons: [], ammo: {}, other: {} },
    ...overrides
  };
}

/** Adjacent hex in a direction from the attacker (0 = N, clockwise). */
function hexToward(direction) {
  return getNeighborInDirection(ATTACKER_HEX, direction);
}

// =============================================================================
// Geometry
// =============================================================================

describe('normalizeHexside', () => {
  it('folds any offset into 0..5', () => {
    expect(normalizeHexside(0)).toBe(0);
    expect(normalizeHexside(5)).toBe(5);
    expect(normalizeHexside(6)).toBe(0);
    expect(normalizeHexside(-1)).toBe(5);
    expect(normalizeHexside(-3)).toBe(3);
  });
});

describe('location helpers', () => {
  it('recognises arms and legs', () => {
    expect(isArmLocation('leftArm')).toBe(true);
    expect(isArmLocation('rightArm')).toBe(true);
    expect(isArmLocation('centerTorso')).toBe(false);
    expect(isLegLocation('leftLeg')).toBe(true);
    expect(isLegLocation('head')).toBe(false);
  });
});

describe('getTargetArc', () => {
  it.each([
    [0, ARC.FORWARD],
    [1, ARC.FORWARD],
    [5, ARC.FORWARD],
    [2, ARC.RIGHT],
    [3, ARC.REAR],
    [4, ARC.LEFT]
  ])('direction %i from a north-facing Mech is %s', (direction, expected) => {
    const attacker = makeAttacker();
    expect(getTargetArc(attacker, hexToward(direction))).toBe(expected);
  });

  it('returns forward for a target in the same hex', () => {
    expect(getTargetArc(makeAttacker(), ATTACKER_HEX)).toBe(ARC.FORWARD);
  });

  it('is relative to the Mech facing', () => {
    const attacker = makeAttacker({ position: { hexKey: ATTACKER_HEX, facing: 3 } });
    // A target to the north is behind a south-facing Mech.
    expect(getTargetArc(attacker, hexToward(0))).toBe(ARC.REAR);
  });

  it('ignores torso twist - incoming attacks do not care (p24, p32)', () => {
    const twisted = makeAttacker({ torsoTwist: 1 });
    expect(getTargetArc(twisted, hexToward(2))).toBe(ARC.RIGHT);
  });
});

describe('getWeaponArc and torso twists', () => {
  it('matches the facing when not twisted', () => {
    expect(getWeaponArc(makeAttacker(), 'rightArm', hexToward(2))).toBe(ARC.RIGHT);
  });

  it('shifts by one hexside when the torso is twisted right', () => {
    const twisted = makeAttacker({ torsoTwist: 1 });
    expect(getWeaponArc(twisted, 'rightArm', hexToward(2))).toBe(ARC.FORWARD);
  });

  it('shifts the other way when twisted left', () => {
    const twisted = makeAttacker({ torsoTwist: -1 });
    expect(getWeaponArc(twisted, 'leftArm', hexToward(1))).toBe(ARC.RIGHT);
  });

  it('does not move leg-mounted weapons', () => {
    const twisted = makeAttacker({ torsoTwist: 1 });
    expect(getWeaponArc(twisted, 'leftLeg', hexToward(2))).toBe(ARC.RIGHT);
  });
});

// =============================================================================
// Weapon legality (p24)
// =============================================================================

describe('canWeaponFireAt', () => {
  it('allows any weapon into the forward arc', () => {
    const attacker = makeAttacker();
    for (const location of ['leftArm', 'rightArm', 'leftTorso', 'centerTorso', 'head']) {
      expect(canWeaponFireAt(attacker, {}, hexToward(0), { weaponLocation: location }).legal).toBe(true);
    }
  });

  it('lets the right arm fire into the right side arc', () => {
    const result = canWeaponFireAt(makeAttacker(), {}, hexToward(2), { weaponLocation: 'rightArm' });
    expect(result.legal).toBe(true);
    expect(result.arc).toBe(ARC.RIGHT);
  });

  it('does not let the left arm fire into the right side arc', () => {
    const result = canWeaponFireAt(makeAttacker(), {}, hexToward(2), { weaponLocation: 'leftArm' });
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('right arc');
  });

  it('does not let torso weapons fire into a side arc', () => {
    const result = canWeaponFireAt(makeAttacker(), {}, hexToward(2), { weaponLocation: 'centerTorso' });
    expect(result.legal).toBe(false);
  });

  it('keeps non-rear weapons out of the rear arc', () => {
    const result = canWeaponFireAt(makeAttacker(), {}, hexToward(3), { weaponLocation: 'rightArm' });
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('rear arc');
  });

  it('lets rear-mounted weapons fire only into the rear arc', () => {
    const attacker = makeAttacker();
    const rear = { mount: 'rear' };
    expect(canWeaponFireAt(attacker, rear, hexToward(3), { weaponLocation: 'centerTorso' }).legal).toBe(true);
    expect(canWeaponFireAt(attacker, rear, hexToward(0), { weaponLocation: 'centerTorso' }).legal).toBe(false);
  });

  it('reads the mount from the weapon definition', () => {
    const attacker = makeAttacker();
    expect(canWeaponFireAt(attacker, { mount: 'rear' }, hexToward(3), { weaponLocation: 'leftTorso' }).legal).toBe(true);
  });

  it('allows a shot within the same hex', () => {
    expect(canWeaponFireAt(makeAttacker(), {}, ATTACKER_HEX, { weaponLocation: 'centerTorso' }).legal).toBe(true);
  });
});

describe('reversing (flipping) arms', () => {
  it('moves arm weapons to the rear arc', () => {
    const flipped = makeAttacker({ armsReversed: true });
    expect(canWeaponFireAt(flipped, {}, hexToward(3), { weaponLocation: 'rightArm' }).legal).toBe(true);
  });

  it('takes arm weapons out of the forward arc', () => {
    const flipped = makeAttacker({ armsReversed: true });
    const result = canWeaponFireAt(flipped, {}, hexToward(0), { weaponLocation: 'rightArm' });
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('reversed');
  });

  it('leaves torso weapons where they were', () => {
    const flipped = makeAttacker({ armsReversed: true });
    expect(canWeaponFireAt(flipped, {}, hexToward(0), { weaponLocation: 'centerTorso' }).legal).toBe(true);
    expect(canWeaponFireAt(flipped, {}, hexToward(3), { weaponLocation: 'centerTorso' }).legal).toBe(false);
  });

  it('combines with a torso twist on the rear arc', () => {
    const flipped = makeAttacker({ armsReversed: true, torsoTwist: 1 });
    // Twisted right one hexside, the rear arc now covers absolute direction 4.
    expect(canWeaponFireAt(flipped, {}, hexToward(4), { weaponLocation: 'leftArm' }).legal).toBe(true);
  });
});

// =============================================================================
// AttackResolver integration
// =============================================================================

function makeGameState(hexKeys) {
  const hexes = new Map();
  for (const key of hexKeys) {
    hexes.set(key, new Hex(key, { terrainType: 'clear', level: 0 }));
  }
  return { map: { hexes } };
}

describe('AttackResolver integration', () => {
  const resolver = new AttackResolver(hitTables);

  function makeUnits(targetKey) {
    const attacker = makeAttacker({
      pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
      getAttackerMovementModifier: () => 0
    });
    const target = {
      position: { hexKey: targetKey, facing: 0 },
      hexesMoved: 0,
      equipment: { ammo: {}, other: {} },
      getTargetMovementModifier: () => 0
    };
    return { attacker, target };
  }

  it('refuses an out-of-arc shot and says why', () => {
    const targetKey = hexToward(3); // directly behind
    const { attacker, target } = makeUnits(targetKey);
    const gs = makeGameState([ATTACKER_HEX, targetKey]);
    const weapon = createWeaponDef('med_laser');

    const calc = resolver.calculateTargetNumber(attacker, weapon, target, gs, { weaponLocation: 'rightArm' });

    expect(calc.canFire).toBe(false);
    expect(calc.outOfArc).toBe(true);
    expect(calc.arc).toBe(ARC.REAR);
    expect(calc.reason).toContain('rear arc');
  });

  it('fires normally into the forward arc and reports the arc', () => {
    const targetKey = hexToward(0);
    const { attacker, target } = makeUnits(targetKey);
    const gs = makeGameState([ATTACKER_HEX, targetKey]);
    const weapon = createWeaponDef('med_laser');

    const calc = resolver.calculateTargetNumber(attacker, weapon, target, gs, { weaponLocation: 'rightArm' });

    expect(calc.canFire).toBe(true);
    expect(calc.arc).toBe(ARC.FORWARD);
  });

  it('marks resolveWeaponAttack results that never left the Mech', () => {
    const targetKey = hexToward(2); // right side, torso weapon cannot bear
    const { attacker, target } = makeUnits(targetKey);
    const gs = makeGameState([ATTACKER_HEX, targetKey]);
    const weapon = createWeaponDef('med_laser');

    const result = resolver.resolveWeaponAttack(
      attacker, weapon, { location: 'centerTorso' }, target, gs, makeDiceRoller(12)
    );

    expect(result.hit).toBe(false);
    expect(result.canFire).toBe(false);
    expect(result.outOfArc).toBe(true);
    expect(result.details).toContain('Cannot fire');
  });

  it('leaves legacy calls without a location untouched', () => {
    const targetKey = hexToward(3);
    const { attacker, target } = makeUnits(targetKey);
    const gs = makeGameState([ATTACKER_HEX, targetKey]);
    const weapon = createWeaponDef('med_laser');

    const calc = resolver.calculateTargetNumber(attacker, weapon, target, gs);
    expect(calc.canFire).toBe(true);
    expect(calc.arc).toBeUndefined();
  });
});

// =============================================================================
// GameEngine integration
// =============================================================================

describe('GameEngine firing arcs', () => {
  function setup(targetHex) {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const target = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    attacker.position = { hexKey: ATTACKER_HEX, facing: 0 };
    target.position = { hexKey: targetHex, facing: 0 };

    const engine = createTestEngine({ units: { 'atlas-0': attacker, 'jenner-1': target } });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    return { engine, attacker, target };
  }

  it('rejects a shot into the rear arc and spends no heat', () => {
    const { engine, attacker } = setup(hexToward(3));

    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser'),
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('rear arc');
    expect(attacker.heat).toBe(0);
  });

  it('rejects a torso weapon into a side arc', () => {
    const { engine } = setup(hexToward(2));

    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser'),
      weaponLocation: 'centerTorso'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('right arc');
  });

  it('allows the arm on that side to fire into its own side arc', () => {
    const { engine, attacker } = setup(hexToward(2));

    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser'),
      weaponLocation: 'rightArm'
    });

    expect(result.success).toBe(true);
    expect(result.arc).toBe(ARC.RIGHT);
    expect(attacker.heat).toBe(3);
  });
});
