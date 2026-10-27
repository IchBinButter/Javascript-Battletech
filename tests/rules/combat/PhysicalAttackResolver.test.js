import { describe, it, expect } from 'vitest';
import { PhysicalAttackResolver } from '../../../src/rules/combat/PhysicalAttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };

const PUNCH = hitTables.hitLocation.punch;
const KICK  = hitTables.hitLocation.kick;

function makeUnit(overrides = {}) {
  return {
    pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
    tonnage: 50,
    prone: false,
    gyro: { hits: 0 },
    movement: {},
    position: { hexKey: '5,7', facing: 0 },
    criticalSlots: { leftArm: [], rightArm: [], leftLeg: [], rightLeg: [] },
    _movementModifier: 0,
    _targetMovementModifier: 0,
    getAttackerMovementModifier() { return this._movementModifier; },
    getTargetMovementModifier() { return this._targetMovementModifier; },
    isLocationDestroyed() { return false; },
    ...overrides
  };
}

/** A unit with specific critical slots destroyed. */
function withDestroyed(location, items) {
  const slots = items.map(item => ({ item, status: 'destroyed' }));
  const base = { leftArm: [], rightArm: [], leftLeg: [], rightLeg: [] };
  base[location] = slots;
  return base;
}

function makeDiceRoller(fixedRoll) {
  return { roll2d6() { return fixedRoll; } };
}

describe('PhysicalAttackResolver - punch table (JSON)', () => {
  const resolver = new PhysicalAttackResolver();

  const EXPECTED_PUNCH = {
    2: 'head',  3: 'rightArm', 4: 'rightArm',
    5: 'rightTorso', 6: 'rightTorso', 7: 'centerTorso',
    8: 'leftTorso', 9: 'leftTorso', 10: 'leftArm',
    11: 'leftArm', 12: 'head'
  };

  for (let roll = 2; roll <= 12; roll++) {
    it(`roll ${roll} -> ${EXPECTED_PUNCH[roll]}`, () => {
      expect(PUNCH[roll.toString()].location).toBe(EXPECTED_PUNCH[roll]);
      expect(resolver.punchLocation(roll)).toBe(EXPECTED_PUNCH[roll]);
    });
  }
});

describe('PhysicalAttackResolver - kick table (JSON)', () => {
  const resolver = new PhysicalAttackResolver();

  const EXPECTED_KICK = {
    2: 'leftLeg',  3: 'rightLeg', 4: 'leftLeg',
    5: 'rightLeg', 6: 'leftLeg',  7: 'rightLeg',
    8: 'leftLeg',  9: 'rightLeg', 10: 'leftLeg',
    11: 'rightLeg', 12: 'leftLeg'
  };

  for (let roll = 2; roll <= 12; roll++) {
    it(`roll ${roll} -> ${EXPECTED_KICK[roll]}`, () => {
      expect(KICK[roll.toString()].location).toBe(EXPECTED_KICK[roll]);
      expect(resolver.kickLocation(roll)).toBe(EXPECTED_KICK[roll]);
    });
  }

  it('all kick locations are legs only', () => {
    for (let roll = 2; roll <= 12; roll++) {
      const loc = KICK[roll.toString()].location;
      expect(['leftLeg', 'rightLeg']).toContain(loc);
    }
  });
});

describe('PhysicalAttackResolver - charge uses punch table', () => {
  const resolver = new PhysicalAttackResolver();

  for (let roll = 2; roll <= 12; roll++) {
    it(`chargeLocation(${roll}) === punchLocation(${roll})`, () => {
      expect(resolver.chargeLocation(roll)).toBe(resolver.punchLocation(roll));
    });
  }
});

// =============================================================================
// Target numbers (Physical Attack Modifiers Table, p137)
// =============================================================================

describe('calculatePhysicalTN - base table', () => {
  const resolver = new PhysicalAttackResolver();
  const attacker = () => makeUnit();
  const target = () => makeUnit();

  it('punch is straight piloting skill', () => {
    expect(resolver.calculatePhysicalTN(attacker(), target(), 'punch')).toBe(5);
  });

  it('kick is piloting skill - 2', () => {
    expect(resolver.calculatePhysicalTN(attacker(), target(), 'kick')).toBe(3);
  });

  it('push is piloting skill - 1', () => {
    expect(resolver.calculatePhysicalTN(attacker(), target(), 'push')).toBe(4);
  });

  it('charge adds the comparative piloting modifier', () => {
    // Attacker 5, target 6: the better pilot subtracts 1.
    const t = makeUnit({ pilot: { piloting: 6, gunnery: 4, hits: 0, conscious: true } });
    expect(resolver.calculatePhysicalTN(attacker(), t, 'charge')).toBe(4);

    // Attacker 5, target 3: worse pilot, add 2.
    const t2 = makeUnit({ pilot: { piloting: 3, gunnery: 4, hits: 0, conscious: true } });
    expect(resolver.calculatePhysicalTN(attacker(), t2, 'charge')).toBe(7);
  });

  it('DFA is comparative piloting plus the +3 jumping modifier', () => {
    expect(resolver.calculatePhysicalTN(attacker(), target(), 'dfa')).toBe(8);
  });

  it('DFA ignores the attacker movement modifier but keeps the target one', () => {
    const a = makeUnit({ _movementModifier: 2 });
    const t = makeUnit({ _targetMovementModifier: 1 });
    expect(resolver.calculatePhysicalTN(a, t, 'dfa')).toBe(9); // 5 + 3 + 1
  });

  it('adds attacker and target movement modifiers to a punch', () => {
    const a = makeUnit({ _movementModifier: 2 });
    const t = makeUnit({ _targetMovementModifier: 1 });
    expect(resolver.calculatePhysicalTN(a, t, 'punch')).toBe(8);
  });

  it('does not add gyro damage: physical attacks are not PSRs (p130)', () => {
    const a = makeUnit({ gyro: { hits: 2 } });
    expect(resolver.calculatePhysicalTN(a, target(), 'punch')).toBe(5);
  });

  it('adds +2 for a prone attacker', () => {
    const a = makeUnit({ prone: true });
    expect(resolver.calculatePhysicalTN(a, target(), 'punch')).toBe(7);
  });

  it('clamps the target number to [2, 12]', () => {
    const slow = makeUnit({ _movementModifier: 20 });
    expect(resolver.calculatePhysicalTN(slow, target(), 'punch')).toBe(12);

    const quick = makeUnit({ pilot: { piloting: 0, gunnery: 4, hits: 0, conscious: true } });
    expect(resolver.calculatePhysicalTN(quick, target(), 'punch')).toBe(2);
  });
});

// =============================================================================
// Actuator damage (p29, p38)
// =============================================================================

describe('actuator damage', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(12);

  it('a destroyed shoulder forbids punching with that arm', () => {
    const a = makeUnit({ criticalSlots: withDestroyed('rightArm', ['shoulder']) });
    const result = resolver.resolvePunch(a, makeUnit(), dice, { arm: 'rightArm' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Shoulder');
  });

  it('an arm actuator adds +2 to the punch and halves the damage', () => {
    const a = makeUnit({ tonnage: 50, criticalSlots: withDestroyed('rightArm', ['lower_arm_actuator']) });
    expect(resolver.calculatePhysicalTN(a, makeUnit(), 'punch', { arm: 'rightArm' })).toBe(7);

    const result = resolver.resolvePunch(a, makeUnit(), dice, { arm: 'rightArm' });
    expect(result.damage).toBe(2); // ceil(50/10) = 5, halved and rounded down
  });

  it('a hand actuator adds +1 to the punch', () => {
    const a = makeUnit({ criticalSlots: withDestroyed('rightArm', ['hand_actuator']) });
    expect(resolver.calculatePhysicalTN(a, makeUnit(), 'punch', { arm: 'rightArm' })).toBe(6);
  });

  it('a destroyed hip forbids kicking', () => {
    const a = makeUnit({ criticalSlots: withDestroyed('leftLeg', ['hip_actuator']) });
    const result = resolver.resolveKick(a, makeUnit(), dice);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Hip');
  });

  it('a leg actuator adds +2 to the kick and halves the damage', () => {
    const a = makeUnit({ tonnage: 50, criticalSlots: withDestroyed('rightLeg', ['upper_leg_actuator']) });
    expect(resolver.calculatePhysicalTN(a, makeUnit(), 'kick')).toBe(5); // 5 - 2 + 2

    const result = resolver.resolveKick(a, makeUnit(), dice);
    expect(result.damage).toBe(5); // ceil(50/5) = 10, halved
  });

  it('two leg actuators quarter the kick damage', () => {
    const a = makeUnit({
      tonnage: 50,
      criticalSlots: withDestroyed('rightLeg', ['upper_leg_actuator', 'lower_leg_actuator'])
    });
    const result = resolver.resolveKick(a, makeUnit(), dice);
    expect(result.damage).toBe(2); // 10 / 4, rounded down
  });

  it('a foot actuator adds +1 to the kick without halving damage', () => {
    const a = makeUnit({ tonnage: 50, criticalSlots: withDestroyed('leftLeg', ['foot_actuator']) });
    expect(resolver.calculatePhysicalTN(a, makeUnit(), 'kick')).toBe(4); // 5 - 2 + 1

    const result = resolver.resolveKick(a, makeUnit(), dice);
    expect(result.damage).toBe(10);
  });
});

// =============================================================================
// Attacks
// =============================================================================

describe('PhysicalAttackResolver - DFA', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(12);

  it('uses comparative piloting plus the jumping modifier, no attacker move mod', () => {
    const attacker = makeUnit({ _movementModifier: 2 });
    const target = makeUnit();
    expect(resolver.calculatePhysicalTN(attacker, target, 'dfa')).toBe(8); // 5 + 3
  });

  it('rejects DFA with no jump jets', () => {
    const attacker = makeUnit({ movement: { jump: 0 } });
    const result = resolver.resolveDFA(attacker, makeUnit(), dice);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('No jump jets');
  });

  it('all DFA damage uses the punch table', () => {
    const attacker = makeUnit({ tonnage: 50, movement: { jump: 4 } });
    const result = resolver.resolveDFA(attacker, makeUnit(), dice);
    expect(result.hitLocations.length).toBe(1);
    const validPunchLocations = Object.values(PUNCH).map(e => e.location);
    expect(validPunchLocations).toContain(result.hitLocations[0].location);
  });
});

describe('PhysicalAttackResolver - punch', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(12);

  it('rejects punching when both arms are destroyed', () => {
    const attacker = makeUnit({
      isLocationDestroyed: () => true
    });
    const result = resolver.resolvePunch(attacker, makeUnit(), dice);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('destroyed');
  });

  it('damages 1 per 10 tons, rounding fractions up', () => {
    const fifty = resolver.resolvePunch(makeUnit({ tonnage: 50 }), makeUnit(), dice);
    expect(fifty.damage).toBe(5);

    const fiftyFive = resolver.resolvePunch(makeUnit({ tonnage: 55 }), makeUnit(), dice);
    expect(fiftyFive.damage).toBe(6); // 5.5 rounded up
  });

  it('rejects a target outside the forward arc', () => {
    const attacker = makeUnit();
    const behind = makeUnit({ position: { hexKey: '5,8', facing: 0 } }); // south = rear
    const result = resolver.resolveKick(attacker, behind, dice);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Target not in forward arc');
  });
});

describe('PhysicalAttackResolver - kick', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(12);

  it('rejects kicking when a leg is destroyed', () => {
    const attacker = makeUnit({ isLocationDestroyed: (loc) => loc === 'leftLeg' });
    const result = resolver.resolveKick(attacker, makeUnit(), dice);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('destroyed');
  });

  it('damages 1 per 5 tons', () => {
    const attacker = makeUnit({ tonnage: 50 });
    const result = resolver.resolveKick(attacker, makeUnit(), dice);
    expect(result.damage).toBe(10);
  });

  it('a missed kick requires a PSR', () => {
    const attacker = makeUnit();
    const result = resolver.resolveKick(attacker, makeUnit(), makeDiceRoller(2));
    expect(result.hit).toBe(false);
    expect(result.psrRequired).toBe(true);
  });
});

describe('PhysicalAttackResolver - charge and push', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(12);

  it('charge damage is tonnage / 10 per hex, rounded up (p38 example)', () => {
    // 65 tons, 5 hexes: 6.5 x 5 = 32.5 -> 33
    const attacker = makeUnit({ tonnage: 65 });
    const target = makeUnit({ tonnage: 45 });
    const result = resolver.resolveCharge(attacker, target, 5, dice);
    expect(result.targetDamage).toBe(33);
    expect(result.attackerDamage).toBe(5); // ceil(45/10)
  });

  it('push requires an adjacent target', () => {
    const attacker = makeUnit();
    const far = makeUnit({ position: { hexKey: '5,4', facing: 0 } });
    const result = resolver.resolvePush(attacker, far, dice);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('adjacent');
  });

  it('push requires the target directly in front', () => {
    const attacker = makeUnit();
    const side = makeUnit({ position: { hexKey: '5,8', facing: 0 } }); // directly behind
    const result = resolver.resolvePush(attacker, side, dice);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('front');
  });
});
