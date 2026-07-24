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
    _movementModifier: 0,
    _targetMovementModifier: 0,
    getAttackerMovementModifier() { return this._movementModifier; },
    getTargetMovementModifier() { return this._targetMovementModifier; },
    isLocationDestroyed() { return false; },
    ...overrides
  };
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

describe('PhysicalAttackResolver - DFA', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(9); // always hits with 9 vs piloting 5

  it('TN = piloting + attacker move mod + target move mod (no flat +4)', () => {
    const attacker = makeUnit({ pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true }, _movementModifier: 2 });
    const target = makeUnit({ _targetMovementModifier: 1 });
    const tn = resolver.calculatePhysicalTN(attacker, target, 'dfa');
    // 5 (piloting) + 2 (attacker mod) + 1 (target mod) = 8, no flat +4
    expect(tn).toBe(8);
  });

  it('DFA TN does not add flat +4 modifier', () => {
    const attacker = makeUnit({ pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true } });
    const target = makeUnit();
    const tn = resolver.calculatePhysicalTN(attacker, target, 'dfa');
    expect(tn).toBe(5);
  });

  it('attacker takes floor(tonnage/5) self-damage on hit', () => {
    const attacker = makeUnit({
      tonnage: 50,
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      movement: { jump: 4 }
    });
    const target = makeUnit();
    const result = resolver.resolveDFA(attacker, target, dice);
    expect(result.hit).toBe(true);
    expect(result.attackerDamage).toBe(10); // floor(50/5) = 10
  });

  it('attacker takes floor(tonnage/5) self-damage on miss', () => {
    const attacker = makeUnit({
      tonnage: 55,
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      movement: { jump: 4 }
    });
    const target = makeUnit();
    const missDice = makeDiceRoller(2);
    const result = resolver.resolveDFA(attacker, target, missDice);
    expect(result.hit).toBe(false);
    expect(result.attackerDamage).toBe(11); // floor(55/5) = 11
  });

  it('all DFA damage uses punch table only', () => {
    const attacker = makeUnit({
      tonnage: 50,
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      movement: { jump: 4 }
    });
    const target = makeUnit();
    const result = resolver.resolveDFA(attacker, target, dice);
    expect(result.hitLocations.length).toBe(1);
    // Verify the location is from the punch table
    const validPunchLocations = Object.values(PUNCH).map(e => e.location);
    expect(validPunchLocations).toContain(result.hitLocations[0].location);
  });

  it('rejects DFA with no jump jets', () => {
    const attacker = makeUnit({ movement: { jump: 0 } });
    const target = makeUnit();
    const result = resolver.resolveDFA(attacker, target, dice);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('No jump jets');
  });
});

describe('PhysicalAttackResolver - punch', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(9);

  it('rejects with no functioning arms', () => {
    const attacker = makeUnit({
      isLocationDestroyed: (loc) => loc === 'leftArm' || loc === 'rightArm'
    });
    const result = resolver.resolvePunch(attacker, makeUnit(), dice);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('No functioning arms');
  });

  it('damages 1 per 10 tons', () => {
    const attacker = makeUnit({ tonnage: 50, pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true } });
    const result = resolver.resolvePunch(attacker, makeUnit(), dice);
    expect(result.damage).toBe(5);
  });
});

describe('PhysicalAttackResolver - kick', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDiceRoller(9);

  it('rejects with no functioning legs', () => {
    const attacker = makeUnit({
      isLocationDestroyed: (loc) => loc === 'leftLeg' || loc === 'rightLeg'
    });
    const result = resolver.resolveKick(attacker, makeUnit(), dice);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('No functioning legs');
  });

  it('damages 1 per 5 tons', () => {
    const attacker = makeUnit({ tonnage: 50, pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true } });
    const result = resolver.resolveKick(attacker, makeUnit(), dice);
    expect(result.damage).toBe(10);
  });

  it('missed kick requires PSR', () => {
    const attacker = makeUnit({ pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true } });
    const missDice = makeDiceRoller(2);
    const result = resolver.resolveKick(attacker, makeUnit(), missDice);
    expect(result.hit).toBe(false);
    expect(result.psrRequired).toBe(true);
  });
});

describe('PhysicalAttackResolver - calculatePhysicalTN', () => {
  const resolver = new PhysicalAttackResolver();

  it('punch TN with one missing arm adds +1', () => {
    const attacker = makeUnit({
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      isLocationDestroyed: (loc) => loc === 'leftArm'
    });
    const target = makeUnit();
    expect(resolver.calculatePhysicalTN(attacker, target, 'punch')).toBe(6);
  });

  it('kick TN with one missing leg adds +2', () => {
    const attacker = makeUnit({
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      isLocationDestroyed: (loc) => loc === 'leftLeg'
    });
    const target = makeUnit();
    expect(resolver.calculatePhysicalTN(attacker, target, 'kick')).toBe(7);
  });

  it('includes attacker and target movement modifiers', () => {
    const attacker = makeUnit({
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      _movementModifier: 2
    });
    const target = makeUnit({ _targetMovementModifier: 1 });
    expect(resolver.calculatePhysicalTN(attacker, target, 'punch')).toBe(8);
  });

  it('includes gyro damage', () => {
    const attacker = makeUnit({
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      gyro: { hits: 2 }
    });
    const target = makeUnit();
    expect(resolver.calculatePhysicalTN(attacker, target, 'punch')).toBe(7);
  });

  it('clamps TN to [2, 12]', () => {
    const attacker = makeUnit({
      pilot: { piloting: 5, gunnery: 4, hits: 0, conscious: true },
      _movementModifier: 20
    });
    const target = makeUnit();
    expect(resolver.calculatePhysicalTN(attacker, target, 'punch')).toBe(12);

    const attacker2 = makeUnit({
      pilot: { piloting: 0, gunnery: 4, hits: 0, conscious: true },
      _movementModifier: -10
    });
    expect(resolver.calculatePhysicalTN(attacker2, target, 'punch')).toBe(2);
  });
});
