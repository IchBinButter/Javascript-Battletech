/**
 * Physical attack hit locations and modifiers (BMM p29, p38, p139, p140).
 *
 * p140 'Mech Punch Location Table (1D6, biped) — columns Left Side | Front/Rear | Right Side:
 *   1 Left Torso | Left Arm | Right Torso
 *   2 Left Torso | Left Torso | Right Torso
 *   3 Center Torso | Center Torso | Center Torso
 *   4 Left Arm | Right Torso | Right Arm
 *   5 Left Arm | Right Arm | Right Arm
 *   6 Head | Head | Head
 *
 * p139 'Mech Kick Location Table (1D6, biped) — columns Left Side | Front/Rear | Right Side:
 *   1-3 Left Leg | Right Leg | Right Leg
 *   4-6 Left Leg | Left Leg | Right Leg
 *
 * p140 Different Levels Table:
 *   target 1 level higher: Charge, Club (Kick Table), DFA, Physical Weapon (Kick
 *     Table), Punch (Kick Table)  => kick is not allowed
 *   target 1 level lower:  Charge, Club (Punch Table), DFA, Kick (Punch Table),
 *     Physical Weapon (Punch Table) => punch is not allowed
 *
 * p38: "Determine the damage location by rolling 1D6 and consulting the
 * appropriate column of the Kick Location Table."
 * p29/p138: an upper/lower arm actuator adds +2 to punching and physical weapon
 * attacks, but halves damage only for punching.
 * p38: "A 'Mech cannot kick with a leg if it fired weapons mounted in that leg
 * that turn."
 */

import { describe, it, expect } from 'vitest';
import { PhysicalAttackResolver } from '../../../src/rules/combat/PhysicalAttackResolver.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };

const PUNCH = hitTables.hitLocation.punch;
const KICK = hitTables.hitLocation.kick;

// p140 'Mech Punch Location Table (biped).
const P140_PUNCH = {
  left: { 1: 'leftTorso', 2: 'leftTorso', 3: 'centerTorso', 4: 'leftArm', 5: 'leftArm', 6: 'head' },
  front: { 1: 'leftArm', 2: 'leftTorso', 3: 'centerTorso', 4: 'rightTorso', 5: 'rightArm', 6: 'head' },
  right: { 1: 'rightTorso', 2: 'rightTorso', 3: 'centerTorso', 4: 'rightArm', 5: 'rightArm', 6: 'head' }
};

// p139 'Mech Kick Location Table (biped).
const P139_KICK = {
  left: { 1: 'leftLeg', 2: 'leftLeg', 3: 'leftLeg', 4: 'leftLeg', 5: 'leftLeg', 6: 'leftLeg' },
  front: { 1: 'rightLeg', 2: 'rightLeg', 3: 'rightLeg', 4: 'leftLeg', 5: 'leftLeg', 6: 'leftLeg' },
  right: { 1: 'rightLeg', 2: 'rightLeg', 3: 'rightLeg', 4: 'rightLeg', 5: 'rightLeg', 6: 'rightLeg' }
};

const COLUMNS = ['left', 'front', 'right'];

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

/** Dice roller with independent 2D6 (to-hit) and 1D6 (location) results. */
function makeDice({ hit = 12, location = 1 } = {}) {
  return {
    roll2d6() { return hit; },
    roll1d6() { return location; }
  };
}

/** Dice roller that records which dice were asked for. */
function makeRecordingDice({ hit = 12, location = 3 } = {}) {
  const calls = [];
  return {
    calls,
    roll2d6() { calls.push('2d6'); return hit; },
    roll1d6() { calls.push('1d6'); return location; }
  };
}

// =============================================================================
// Hit location tables (p139/p140)
// =============================================================================

describe('PhysicalAttackResolver - p140 punch table (1D6, three columns)', () => {
  const resolver = new PhysicalAttackResolver();

  for (const column of COLUMNS) {
    for (let roll = 1; roll <= 6; roll++) {
      it(`${column} column, 1D6 roll ${roll} -> ${P140_PUNCH[column][roll]}`, () => {
        expect(PUNCH[column][roll.toString()].location).toBe(P140_PUNCH[column][roll]);
        expect(resolver.punchLocation(roll, column)).toBe(P140_PUNCH[column][roll]);
      });
    }
  }

  it('has exactly the six 1D6 results in every column (no fabricated 2D6 rows)', () => {
    for (const column of COLUMNS) {
      expect(Object.keys(PUNCH[column]).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    }
    expect(Object.keys(PUNCH).sort()).toEqual([...COLUMNS].sort());
  });

  it('uses the Front/Rear column for a rear attack (p140), and front as the default', () => {
    expect(resolver.punchLocation(1, 'rear')).toBe(P140_PUNCH.front[1]);
    expect(resolver.punchLocation(1)).toBe(P140_PUNCH.front[1]);
  });
});

describe('PhysicalAttackResolver - p139 kick table (1D6, three columns)', () => {
  const resolver = new PhysicalAttackResolver();

  for (const column of COLUMNS) {
    for (let roll = 1; roll <= 6; roll++) {
      it(`${column} column, 1D6 roll ${roll} -> ${P139_KICK[column][roll]}`, () => {
        expect(KICK[column][roll.toString()].location).toBe(P139_KICK[column][roll]);
        expect(resolver.kickLocation(roll, column)).toBe(P139_KICK[column][roll]);
      });
    }
  }

  it('has exactly the six 1D6 results in every column (no fabricated 2D6 rows)', () => {
    for (const column of COLUMNS) {
      expect(Object.keys(KICK[column]).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    }
    expect(Object.keys(KICK).sort()).toEqual([...COLUMNS].sort());
  });

  it('every kick location is a leg', () => {
    for (const column of COLUMNS) {
      for (let roll = 1; roll <= 6; roll++) {
        expect(['leftLeg', 'rightLeg']).toContain(KICK[column][roll.toString()].location);
      }
    }
  });

  it('uses the Front/Rear column for a rear attack (p139), and front as the default', () => {
    expect(resolver.kickLocation(1, 'rear')).toBe(P139_KICK.front[1]);
    expect(resolver.kickLocation(1)).toBe(P139_KICK.front[1]);
  });
});

describe('PhysicalAttackResolver - charge and DFA use the punch table', () => {
  const resolver = new PhysicalAttackResolver();

  it('chargeLocation matches the punch table in every column', () => {
    for (const column of COLUMNS) {
      for (let roll = 1; roll <= 6; roll++) {
        expect(resolver.chargeLocation(roll, column)).toBe(resolver.punchLocation(roll, column));
      }
    }
  });

  it('a charge resolves its location with 1D6 on the punch table (p140)', () => {
    const dice = makeRecordingDice({ hit: 12, location: 1 });
    const result = resolver.resolveCharge(makeUnit(), makeUnit(), 3, dice);
    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].location).toBe(P140_PUNCH.front[1]);
    expect(dice.calls).toEqual(['2d6', '1d6']);
  });

  it('a DFA resolves its location with 1D6 on the punch table (p140)', () => {
    const dice = makeRecordingDice({ hit: 12, location: 4 });
    const attacker = makeUnit({ movement: { jump: 4 } });
    const result = resolver.resolveDFA(attacker, makeUnit(), dice);
    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].location).toBe(P140_PUNCH.front[4]);
    expect(dice.calls).toEqual(['2d6', '1d6']);
  });

  it('punch and kick resolve locations with 1D6, not 2D6', () => {
    const punchDice = makeRecordingDice({ hit: 12, location: 2 });
    resolver.resolvePunch(makeUnit(), makeUnit(), punchDice);
    expect(punchDice.calls).toEqual(['2d6', '1d6']);

    const kickDice = makeRecordingDice({ hit: 12, location: 2 });
    resolver.resolveKick(makeUnit(), makeUnit(), kickDice);
    expect(kickDice.calls).toEqual(['2d6', '1d6']);
  });
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
  const dice = makeDice();

  it('a destroyed shoulder forbids punching with that arm', () => {
    const a = makeUnit({ criticalSlots: withDestroyed('rightArm', ['shoulder']) });
    const result = resolver.resolvePunch(a, makeUnit(), dice, { arm: 'rightArm' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Shoulder');
  });

  it('an arm actuator adds +2 to the punch and halves the damage (p29/p138)', () => {
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

  it('an arm actuator adds +2 to a physical weapon but does not halve its damage (p29/p138)', () => {
    const a = makeUnit({
      tonnage: 50,
      criticalSlots: withDestroyed('rightArm', ['lower_arm_actuator'])
    });
    expect(resolver.calculatePhysicalTN(a, makeUnit(), 'physicalWeapon', {
      weapon: resolver.getPhysicalWeapon('hatchet'),
      arm: 'rightArm'
    })).toBe(6); // 5 - 1 (hatchet) + 2 (actuator)

    const result = resolver.resolvePhysicalWeapon(a, makeUnit(), 'hatchet', dice, { arm: 'rightArm' });
    expect(result.damage).toBe(10); // ceil(50/5), not halved
  });

  it('the flail keeps its fixed 9 damage with a damaged actuator (p38 footnote †)', () => {
    const a = makeUnit({
      tonnage: 50,
      criticalSlots: withDestroyed('rightArm', ['upper_arm_actuator'])
    });
    const result = resolver.resolvePhysicalWeapon(a, makeUnit(), 'flail', dice, { arm: 'rightArm' });
    expect(result.damage).toBe(9);
  });
});

// =============================================================================
// Attacks
// =============================================================================

describe('PhysicalAttackResolver - DFA', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDice();

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

  it('all DFA damage uses the punch table (p140)', () => {
    const attacker = makeUnit({ tonnage: 50, movement: { jump: 4 } });
    const result = resolver.resolveDFA(attacker, makeUnit(), dice);
    expect(result.hitLocations.length).toBe(1);
    const validPunchLocations = Object.values(PUNCH.front).map(e => e.location);
    expect(validPunchLocations).toContain(result.hitLocations[0].location);
  });
});

describe('PhysicalAttackResolver - punch', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDice();

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
    const behind = makeUnit({ position: { hexKey: '5,8', facing: 0 } });
    const result = resolver.resolvePunch(attacker, behind, dice);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('forward or side arc');
  });
});

describe('PhysicalAttackResolver - kick', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDice();

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
    const result = resolver.resolveKick(attacker, makeUnit(), makeDice({ hit: 2 }));
    expect(result.hit).toBe(false);
    expect(result.psrRequired).toBe(true);
  });
});

describe('fired-leg restriction on kicks (p38)', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDice();

  for (const leg of ['leftLeg', 'rightLeg']) {
    it(`cannot kick when the ${leg} fired this turn`, () => {
      const attacker = makeUnit({ firedThisTurn: new Set([leg]) });
      const result = resolver.resolveKick(attacker, makeUnit(), dice);
      expect(result.success).toBe(false);
      expect(result.reason).toContain('fired');
    });
  }

  it('can kick when only an arm fired this turn', () => {
    const attacker = makeUnit({ firedThisTurn: new Set(['rightArm']) });
    expect(resolver.resolveKick(attacker, makeUnit(), dice).success).toBe(true);
  });
});

// =============================================================================
// Physical weapons (p38)
// =============================================================================

describe('PhysicalAttackResolver - physical weapons', () => {
  const resolver = new PhysicalAttackResolver();
  const dice = makeDice();

  it('claws always roll on the punch table (1D6)', () => {
    const recording = makeRecordingDice({ hit: 12, location: 6 });
    const result = resolver.resolvePhysicalWeapon(makeUnit(), makeUnit(), 'claws', recording);
    expect(result.hitLocations[0].location).toBe('head');
    expect(recording.calls).toEqual(['2d6', '1d6']);
  });

  it('a standard-table weapon rolls 2D6 on the p139 hit-location table', () => {
    // Lance uses the standard table; 2D6 roll 12 is the head on the Front column.
    const recording = makeRecordingDice({ hit: 12, location: 1 });
    const result = resolver.resolvePhysicalWeapon(makeUnit(), makeUnit(), 'lance', recording);
    expect(result.hitLocations[0].location).toBe('head');
    expect(recording.calls).toEqual(['2d6', '2d6']);
  });
});
