/**
 * Physical combat rules (BMM p34-40, p140).
 *
 * Covers the Different Levels table, prone targets, physical weapons, the
 * fired-arm restriction, and the PSR consequences of physical attacks.
 */

import { describe, it, expect } from 'vitest';
import { PhysicalAttackResolver } from '../../../src/rules/combat/PhysicalAttackResolver.js';
import {
  createTestUnit,
  createTestEngine,
  makeDiceRoller,
  makeSequencedDiceRoller
} from '../../helpers/testUtils.js';

const resolver = new PhysicalAttackResolver();
// Physical hit locations are 1D6 (p139/p140); to-hit rolls stay 2D6.
const dice = (n) => ({
  roll2d6: () => n,
  roll1d6: () => ((Math.max(1, Math.floor(n)) - 1) % 6) + 1
});

function mk(overrides = {}) {
  return {
    pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
    tonnage: 50,
    prone: false,
    heat: 0,
    gyro: { hits: 0 },
    movement: {},
    position: { hexKey: '5,7', facing: 0 },
    criticalSlots: { leftArm: [], rightArm: [], leftLeg: [], rightLeg: [] },
    equipment: { other: {} },
    getAttackerMovementModifier: () => 0,
    getTargetMovementModifier: () => 0,
    isLocationDestroyed: () => false,
    ...overrides
  };
}

const north = (overrides = {}) => mk({ position: { hexKey: '5,6', facing: 3 }, ...overrides });

// =============================================================================
// Different Levels table (p140)
// =============================================================================

describe('physical attacks across levels (p140)', () => {
  it('a punch one level higher is forced onto the kick table', () => {
    const result = resolver.resolvePunch(mk(), north(), dice(12), { levelDifference: 1 });
    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    expect(['leftLeg', 'rightLeg']).toContain(result.hitLocations[0].location);
  });

  it('a punch cannot reach a target one level lower (p140)', () => {
    const result = resolver.resolvePunch(mk(), north(), dice(12), { levelDifference: -1 });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('one level lower');
  });

  it('a kick cannot reach a target one level higher (p140)', () => {
    const result = resolver.resolveKick(mk(), north(), dice(12), { levelDifference: 1 });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('one level higher');
  });

  it('a kick one level lower is forced onto the punch table', () => {
    const result = resolver.resolveKick(mk(), north(), dice(12), { levelDifference: -1 });
    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    expect(['leftLeg', 'rightLeg']).not.toContain(result.hitLocations[0].location);
  });

  it('a charge reaches one level up or down but not two', () => {
    expect(resolver.resolveCharge(mk(), north(), 2, dice(12), { levelDifference: 1 }).success).toBe(true);
    expect(resolver.resolveCharge(mk(), north(), 2, dice(12), { levelDifference: -1 }).success).toBe(true);
    const tooFar = resolver.resolveCharge(mk(), north(), 2, dice(12), { levelDifference: 2 });
    expect(tooFar.success).toBe(false);
    expect(tooFar.reason).toContain('one level up or down');
  });

  it('a push needs the target at the same level', () => {
    const result = resolver.resolvePush(mk(), north(), dice(12), { levelDifference: 1 });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('same level');
  });

  it('a DFA can be made across any level difference', () => {
    const attacker = mk({ movement: { jump: 4 } });
    const result = resolver.resolveDFA(attacker, north(), dice(12), { levelDifference: 2 });
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// Prone targets (p35, p140)
// =============================================================================

describe('prone targets', () => {
  const proneTarget = north({ prone: true });

  it('can be punched', () => {
    expect(resolver.resolvePunch(mk(), proneTarget, dice(12)).success).toBe(true);
  });

  it('cannot be kicked', () => {
    const result = resolver.resolveKick(mk(), proneTarget, dice(12));
    expect(result.success).toBe(false);
    expect(result.reason).toContain('prone');
  });

  it('cannot be charged', () => {
    const result = resolver.resolveCharge(mk(), proneTarget, 2, dice(12));
    expect(result.success).toBe(false);
    expect(result.reason).toContain('prone');
  });

  it('one level lower can only be attacked by DFA', () => {
    const lowProne = north({ prone: true });
    const punch = resolver.resolvePunch(mk(), lowProne, dice(12), { levelDifference: -1 });
    expect(punch.success).toBe(false);
    expect(punch.reason).toContain('DFA');

    const dfa = resolver.resolveDFA(mk({ movement: { jump: 4 } }), lowProne, dice(12), { levelDifference: -1 });
    expect(dfa.success).toBe(true);
  });
});

// =============================================================================
// Physical weapons (p38)
// =============================================================================

describe('physical weapons', () => {
  it('lists every weapon from the p38 table', () => {
    const ids = resolver.physicalWeapons.map(w => w.id).sort();
    expect(ids).toEqual([
      'claws', 'flail', 'hatchet', 'lance', 'mace', 'retractable_blade', 'sword'
    ]);
  });

  it('a hatchet adds -1 to the target number and does 1 per 5 tons', () => {
    const attacker = mk({ tonnage: 50 });
    expect(resolver.calculatePhysicalTN(attacker, north(), 'physicalWeapon', { weapon: resolver.getPhysicalWeapon('hatchet') })).toBe(4);
    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'hatchet', dice(12));
    expect(result.damage).toBe(10); // ceil(50/5)
  });

  it('a sword does 1 per 10 tons plus 1', () => {
    const attacker = mk({ tonnage: 55 });
    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'sword', dice(12));
    expect(result.damage).toBe(7); // ceil(5.5) + 1
  });

  it('claws always roll on the punch table', () => {
    const result = resolver.resolvePhysicalWeapon(mk(), north(), 'claws', dice(12));
    expect(['leftLeg', 'rightLeg']).not.toContain(result.hitLocations[0].location);
  });

  it('an option weapon can use the punch table for +4', () => {
    const attacker = mk({ tonnage: 50 });
    const base = resolver.calculatePhysicalTN(attacker, north(), 'physicalWeapon', { weapon: resolver.getPhysicalWeapon('hatchet') });
    const declared = resolver.calculatePhysicalTN(attacker, north(), 'physicalWeapon', {
      weapon: resolver.getPhysicalWeapon('hatchet'),
      usePunchTable: true
    });
    expect(declared).toBe(base + 4);

    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'hatchet', dice(12), { usePunchTable: true });
    expect(['leftLeg', 'rightLeg']).not.toContain(result.hitLocations[0].location);
  });

  it('TSM doubles the damage of a TSM weapon', () => {
    const attacker = mk({
      tonnage: 50,
      heat: 9,
      equipment: { other: { tsm: true } }
    });
    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'hatchet', dice(12));
    expect(result.damage).toBe(20);
  });

  it('a destroyed hand actuator forbids the weapon', () => {
    const attacker = mk({
      criticalSlots: {
        leftArm: [], rightArm: [{ item: 'hand_actuator', status: 'destroyed' }],
        leftLeg: [], rightLeg: []
      }
    });
    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'hatchet', dice(12), { arm: 'rightArm' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Hand actuator');
  });

  it('an arm actuator adds +2 to a physical weapon but does not halve its damage (p29/p138)', () => {
    const attacker = mk({
      tonnage: 50,
      criticalSlots: {
        leftArm: [], rightArm: [{ item: 'lower_arm_actuator', status: 'destroyed' }],
        leftLeg: [], rightLeg: []
      }
    });
    // p29/p138: +2 to the attack; half damage is for punching only.
    expect(resolver.calculatePhysicalTN(attacker, north(), 'physicalWeapon', {
      weapon: resolver.getPhysicalWeapon('hatchet'),
      arm: 'rightArm'
    })).toBe(6); // 5 piloting - 1 hatchet + 2 actuator

    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'hatchet', dice(12), { arm: 'rightArm' });
    expect(result.damage).toBe(10); // ceil(50/5), not halved
  });

  it('the flail keeps its fixed 9 damage with a damaged actuator (p38 footnote †)', () => {
    const attacker = mk({
      tonnage: 50,
      criticalSlots: {
        leftArm: [], rightArm: [{ item: 'upper_arm_actuator', status: 'destroyed' }],
        leftLeg: [], rightLeg: []
      }
    });
    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'flail', dice(12), { arm: 'rightArm' });
    expect(result.damage).toBe(9);
  });

  it('rejects an unknown weapon', () => {
    const result = resolver.resolvePhysicalWeapon(mk(), north(), 'chainsaw', dice(12));
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Unknown physical weapon');
  });
});

// =============================================================================
// Fired-leg restriction (p38)
// =============================================================================

describe('fired leg restriction', () => {
  it('cannot kick with a leg that fired weapons this turn', () => {
    const attacker = mk({ firedThisTurn: new Set(['rightLeg']) });
    const result = resolver.resolveKick(attacker, north(), dice(12));
    expect(result.success).toBe(false);
    expect(result.reason).toContain('fired');
  });

  it('can kick when only an arm fired this turn', () => {
    const attacker = mk({ firedThisTurn: new Set(['leftArm']) });
    expect(resolver.resolveKick(attacker, north(), dice(12)).success).toBe(true);
  });
});

// =============================================================================
// Fired-arm restriction (p38)
// =============================================================================

describe('fired arm restriction', () => {
  it('cannot punch with an arm that fired this turn', () => {
    const attacker = mk({ firedThisTurn: new Set(['rightArm']) });
    const result = resolver.resolvePunch(attacker, north(), dice(12), { arm: 'rightArm' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('fired');
  });

  it('can punch with the other arm', () => {
    const attacker = mk({ firedThisTurn: new Set(['rightArm']) });
    const result = resolver.resolvePunch(attacker, north(), dice(12), { arm: 'leftArm' });
    expect(result.success).toBe(true);
  });

  it('cannot use a physical weapon in an arm that fired', () => {
    const attacker = mk({ firedThisTurn: new Set(['rightArm']) });
    const result = resolver.resolvePhysicalWeapon(attacker, north(), 'hatchet', dice(12), { arm: 'rightArm' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('fired');
  });
});

// =============================================================================
// Consequences through the engine (p54)
// =============================================================================

describe('physical attack consequences', () => {
  function setup(attackSetup) {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const target = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    attacker.position = { hexKey: '5,8', facing: 0 };
    target.position = { hexKey: '5,7', facing: 3 };
    attackSetup(attacker, target);

    const engine = createTestEngine({ units: { 'atlas-0': attacker, 'jenner-1': target } });
    engine.phaseManager.enterPhase('physical_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    return { engine, attacker, target };
  }

  it('a successful kick forces a PSR on the target', () => {
    const { engine } = setup(() => {});
    engine.diceRoller = makeSequencedDiceRoller([12, 3, 2]); // hit, leg location, PSR fail
    const result = engine.processAction(0, {
      type: 'physicalAttack', attackerId: 'atlas-0', targetId: 'jenner-1', attackType: 'kick'
    });

    expect(result.hit).toBe(true);
    expect(result.psrRolls).toHaveLength(1);
    expect(result.psrRolls[0].label).toBe('Kicked');
    expect(result.psrRolls[0].modifier).toBe(0);
  });

  it('a missed kick forces a PSR on the attacker', () => {
    const { engine } = setup(() => {});
    engine.diceRoller = makeDiceRoller(2);
    const result = engine.processAction(0, {
      type: 'physicalAttack', attackerId: 'atlas-0', targetId: 'jenner-1', attackType: 'kick'
    });

    expect(result.hit).toBe(false);
    expect(result.psrRolls[0].label).toBe('Missed kick');
    expect(result.psrRolls[0].unitId).toBe('atlas-0');
  });

  it('a charge forces a PSR at +2 on both Mechs', () => {
    const { engine } = setup(() => {});
    engine.diceRoller = makeDiceRoller(12);
    const result = engine.processAction(0, {
      type: 'physicalAttack', attackerId: 'atlas-0', targetId: 'jenner-1',
      attackType: 'charge', distanceCharged: 3
    });

    expect(result.hit).toBe(true);
    const labels = result.psrRolls.map(r => r.label);
    expect(labels).toEqual(['Successful charge', 'Charged']);
    expect(result.psrRolls.every(r => r.modifier === 2)).toBe(true);
  });

  it('a failed DFA drops the attacker automatically', () => {
    const { engine, attacker } = setup((a) => { a.movement.jump = 5; });
    engine.diceRoller = makeDiceRoller(2);
    const result = engine.processAction(0, {
      type: 'physicalAttack', attackerId: 'atlas-0', targetId: 'jenner-1', attackType: 'dfa'
    });

    expect(result.hit).toBe(false);
    expect(attacker.prone).toBe(true);
    expect(result.psrRolls[0].automaticFall).toBe(true);
  });
});
