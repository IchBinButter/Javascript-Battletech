/**
 * Combat modifiers 1.5-1.8 and the damage consequences of phase 2.
 *
 * p28 target/attacker state modifiers, p28 attacker damage modifiers, p27
 * secondary targets, p24-25 torso twists and arm flipping, and the critical
 * damage effects that feed them (p47-50).
 */

import { describe, it, expect } from 'vitest';
import { AttackResolver } from '../../../src/rules/combat/AttackResolver.js';
import { PhysicalAttackResolver } from '../../../src/rules/combat/PhysicalAttackResolver.js';
import { getMaxMP } from '../../../src/rules/movement/maxMP.js';
import { PSRCalculator } from '../../../src/rules/movement/PSRCalculator.js';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };
import {
  createTestUnit,
  createTestEngine,
  createStandardTestMap,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller
} from '../../helpers/testUtils.js';

const resolver = new AttackResolver(hitTables);
// `resolver` is used throughout the unit-level cases below.

function mk(hexKey, { facing = 0, ...rest } = {}) {
  return {
    position: { hexKey, facing },
    pilot: { gunnery: 4, piloting: 5, hits: 0, conscious: true },
    hexesMoved: 0,
    heat: 0,
    equipment: { other: {} },
    criticalSlots: { head: [], leftArm: [], rightArm: [], leftLeg: [], rightLeg: [] },
    getAttackerMovementModifier: () => 0,
    getTargetMovementModifier: () => 0,
    ...rest
  };
}

function gs() {
  return { map: createStandardTestMap() };
}

function slots(location, items) {
  return { head: [], leftArm: [], rightArm: [], leftLeg: [], rightLeg: [], [location]: items };
}

const weapon = createWeaponDef('med_laser');

// =============================================================================
// 1.5 Target and attacker state (p28)
// =============================================================================

describe('state modifiers', () => {
  it('a prone attacker is +2 to fire', () => {
    const calc = resolver.calculateTargetNumber(mk('5,4', { prone: true }), weapon, mk('5,6'), gs());
    expect(calc.modifiers).toContain('Attacker prone: +2');
  });

  it('an attacker that skidded is +1', () => {
    const calc = resolver.calculateTargetNumber(mk('5,4', { skidding: true }), weapon, mk('5,6'), gs());
    expect(calc.modifiers).toContain('Attacker skidding: +1');
  });

  it('a skidding target is +2', () => {
    const calc = resolver.calculateTargetNumber(mk('5,4'), weapon, mk('5,6', { skidding: true }), gs());
    expect(calc.modifiers).toContain('Target skidding: +2');
  });
});

// =============================================================================
// 1.6 Attacker damage (p28)
// =============================================================================

describe('attacker damage modifiers', () => {
  it('a sensor hit is +2 to every weapon attack', () => {
    const attacker = mk('5,4', { criticalSlots: slots('head', [{ item: 'sensors', status: 'destroyed' }]) });
    const calc = resolver.calculateTargetNumber(attacker, weapon, mk('5,6'), gs());
    expect(calc.modifiers).toContain('Sensors hit: +2');
  });

  it('an arm actuator is +1 per destroyed actuator for that arm', () => {
    const attacker = mk('5,4', {
      facing: 3,
      criticalSlots: slots('rightArm', [
        { item: 'upper_arm_actuator', status: 'destroyed' },
        { item: 'lower_arm_actuator', status: 'destroyed' }
      ])
    });
    const target = mk('5,6', { facing: 0 });
    const calc = resolver.calculateTargetNumber(attacker, weapon, target, gs(), {
      weaponLocation: 'rightArm'
    });
    expect(calc.modifiers).toContain('Arm actuators damaged: +2');
  });

  it('a destroyed shoulder is +4 and ignores the other actuators in that arm', () => {
    const attacker = mk('5,4', {
      facing: 3,
      criticalSlots: slots('rightArm', [
        { item: 'shoulder', status: 'destroyed' },
        { item: 'upper_arm_actuator', status: 'destroyed' }
      ])
    });
    const target = mk('5,6', { facing: 0 });
    const calc = resolver.calculateTargetNumber(attacker, weapon, target, gs(), {
      weaponLocation: 'rightArm'
    });
    expect(calc.modifiers).toContain('Arm actuators damaged: +4');
  });

  it('does not apply arm damage to a torso weapon', () => {
    const attacker = mk('5,4', {
      facing: 3,
      criticalSlots: slots('rightArm', [{ item: 'shoulder', status: 'destroyed' }])
    });
    const calc = resolver.calculateTargetNumber(attacker, weapon, mk('5,6'), gs(), {
      weaponLocation: 'centerTorso'
    });
    expect(calc.modifiers.join(' | ')).not.toContain('Arm actuators');
  });
});

// =============================================================================
// 1.7 Secondary targets (p27)
// =============================================================================

describe('secondary targets', () => {
  it('adds the secondary target modifier it is given', () => {
    const calc = resolver.calculateTargetNumber(mk('5,4'), weapon, mk('5,6'), gs(), {
      multipleTargetModifier: 2
    });
    expect(calc.modifiers).toContain('Secondary target: +2');
  });

  it('charges +1 for a second target in the forward arc, +2 behind', () => {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const first = createTestUnit('jenner-jr7d', 1, 'target-1');
    const second = createTestUnit('jenner-jr7d', 1, 'target-2');
    const rear = createTestUnit('jenner-jr7d', 1, 'target-3');

    attacker.position = { hexKey: '5,7', facing: 0 };
    first.position = { hexKey: '5,6', facing: 3 };   // forward
    second.position = { hexKey: '6,7', facing: 3 };  // forward, other side
    rear.position = { hexKey: '6,8', facing: 0 };    // right side arc

    const engine = createTestEngine({
      units: { 'atlas-0': attacker, 'target-1': first, 'target-2': second, 'target-3': rear }
    });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    engine.diceRoller = makeDiceRoller(12);

    const fire = (targetId) => engine.processAction(0, {
      type: 'fire', attackerId: 'atlas-0', targetId,
      weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
    });

    const firstShot = fire('target-1');
    expect(firstShot.modifiers.join(' | ')).not.toContain('Secondary target');

    const secondShot = fire('target-2');
    expect(secondShot.modifiers.join(' | ')).toContain('Secondary target: +1');

    const rearShot = fire('target-3');
    expect(rearShot.modifiers.join(' | ')).toContain('Secondary target: +2');
  });
});

// =============================================================================
// 1.8 Torso twist and arm flipping (p24-25)
// =============================================================================

describe('torso twist and arm flipping', () => {
  function setupArmlessUnit() {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 0 };
    // Strip the hand and lower-arm actuators: only then may arms be flipped.
    for (const arm of ['leftArm', 'rightArm']) {
      unit.criticalSlots[arm] = unit.criticalSlots[arm]
        .filter(s => !/hand_actuator|lower_arm_actuator/.test(s.item || ''));
    }
    return unit;
  }

  function setupEngine(unit) {
    const enemy = createTestUnit('jenner-jr7d', 1, 'target-1');
    enemy.position = { hexKey: '5,6', facing: 3 };
    const engine = createTestEngine({ units: { 'atlas-0': unit, 'target-1': enemy } });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    return engine;
  }

  it('sets the twist and shifts the arcs', () => {
    const unit = setupArmlessUnit();
    const engine = setupEngine(unit);

    const result = engine.processAction(0, { type: 'twistTorso', unitId: 'atlas-0', direction: 1 });

    expect(result.success).toBe(true);
    expect(unit.torsoTwist).toBe(1);
  });

  it('is refused outside the weapon attack phase', () => {
    const unit = setupArmlessUnit();
    const engine = setupEngine(unit);
    engine.phaseManager.enterPhase('movement');

    const result = engine.processAction(0, { type: 'twistTorso', unitId: 'atlas-0', direction: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('weapon attack phase');
  });

  it('cannot twist and flip arms in the same turn', () => {
    const unit = setupArmlessUnit();
    const engine = setupEngine(unit);

    engine.processAction(0, { type: 'twistTorso', unitId: 'atlas-0', direction: -1 });
    const flip = engine.processAction(0, { type: 'flipArms', unitId: 'atlas-0' });

    expect(flip.success).toBe(false);
    expect(flip.error).toContain('same turn');
  });

  it('flips the arms of a Mech with no hand or lower-arm actuators', () => {
    const unit = setupArmlessUnit();
    const engine = setupEngine(unit);

    const result = engine.processAction(0, { type: 'flipArms', unitId: 'atlas-0' });

    expect(result.success).toBe(true);
    expect(unit.armsReversed).toBe(true);
  });

  it('refuses to flip a Mech that has hand actuators', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.position = { hexKey: '5,7', facing: 0 };
    // mechs.json does not list actuators, so add one to model a Mech that has
    // them: a hand actuator makes the arms impossible to reverse (p24).
    unit.criticalSlots.rightArm[0] = { slot: 1, item: 'hand_actuator', status: 'ok' };
    const engine = setupEngine(unit);

    const result = engine.processAction(0, { type: 'flipArms', unitId: 'atlas-0' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot reverse');
  });
});

// =============================================================================
// Phase 2 damage consequences
// =============================================================================

describe('damage consequences', () => {
  it('a hip halves walking MP, two hips stop the Mech (p48)', () => {
    const oneHip = mk('5,4', {
      movement: { walk: 5, run: 8, jump: 0 },
      criticalSlots: slots('leftLeg', [{ item: 'hip_actuator', status: 'destroyed' }])
    });
    expect(getMaxMP(oneHip, 'walk')).toBe(3); // ceil(5/2)

    const twoHips = mk('5,4', {
      movement: { walk: 5, run: 8, jump: 0 },
      criticalSlots: {
        head: [], leftArm: [], rightArm: [],
        leftLeg: [{ item: 'hip_actuator', status: 'destroyed' }],
        rightLeg: [{ item: 'hip_actuator', status: 'destroyed' }]
      }
    });
    expect(getMaxMP(twoHips, 'walk')).toBe(0);
  });

  it('an engine hit adds heat each turn (p50)', () => {
    const engine = createTestEngine({ units: {} });
    const unit = mk('5,4');

    unit.engine = { hits: 0 };
    expect(engine.heatManager.calculateHeatGeneration(unit, [], 'stationary')).toBe(0);

    unit.engine = { hits: 1 };
    expect(engine.heatManager.calculateHeatGeneration(unit, [], 'stationary')).toBe(5);

    unit.engine = { hits: 2 };
    expect(engine.heatManager.calculateHeatGeneration(unit, [], 'stationary')).toBe(10);
  });

  it('a shutdown Mech automatically fails PSRs (p52)', () => {
    const calc = new PSRCalculator();
    const unit = mk('5,4', { shutdown: true });
    const result = calc.makePSR(unit, makeDiceRoller(12), [{ trigger: 'Anything', baseModifier: 0 }]);
    expect(result.passed).toBe(false);
    expect(result.targetNumber).toBe(999);
  });

  it('a head hit damages the MechWarrior (p58)', () => {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const target = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    attacker.position = { hexKey: '5,8', facing: 0 };
    target.position = { hexKey: '5,7', facing: 3 };

    const engine = createTestEngine({ units: { 'atlas-0': attacker, 'jenner-1': target } });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    engine.diceRoller = makeSequencedDiceRoller([12, 12]); // hit, then head on the front table

    engine.processAction(0, {
      type: 'fire', attackerId: 'atlas-0', targetId: 'jenner-1',
      weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
    });

    expect(target.pilot.hits).toBe(1);
  });

  it('six points of pilot damage kill the MechWarrior (p58)', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas-0');
    unit.applyPilotDamage(5);
    expect(unit.pilot.dead).toBeUndefined();

    unit.applyPilotDamage(1);
    expect(unit.pilot.dead).toBe(true);
    expect(unit.pilot.conscious).toBe(false);
  });
});

// =============================================================================
// The roster data now carries the slots these rules read
// =============================================================================

describe('roster data drives the damage rules', () => {
  const dice = makeDiceRoller(12);

  it('a hip crit halves the Atlas walking MP', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const hip = atlas.criticalSlots.leftLeg.find(s => s.item === 'hip');
    hip.status = 'destroyed';

    expect(getMaxMP(atlas, 'walk')).toBe(2); // base 3, halved and rounded up
  });

  it('a shoulder crit stops that arm punching', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    const shoulder = atlas.criticalSlots.rightArm.find(s => s.item === 'shoulder');
    shoulder.status = 'destroyed';

    const target = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    target.position = { hexKey: '5,6', facing: 3 };

    const result = new PhysicalAttackResolver().resolvePunch(atlas, target, dice, { arm: 'rightArm' });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Shoulder');
  });

  it('an arm actuator now adds to the weapon attack roll', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    const actuator = atlas.criticalSlots.rightArm.find(s => s.item === 'upper_arm_actuator');
    actuator.status = 'destroyed';

    const target = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    target.position = { hexKey: '5,8', facing: 0 };

    const calc = resolver.calculateTargetNumber(atlas, weapon, target, gs(), {
      weaponLocation: 'rightArm'
    });
    expect(calc.modifiers).toContain('Arm actuators damaged: +1');
  });

  it('the Banshee refit may reverse its arms', () => {
    const banshee = createTestUnit('banshee-bnc3e-refit', 0, 'banshee-0');
    banshee.position = { hexKey: '5,7', facing: 0 };

    const enemy = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    enemy.position = { hexKey: '5,6', facing: 3 };

    const engine = createTestEngine({ units: { 'banshee-0': banshee, 'jenner-1': enemy } });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, { type: 'flipArms', unitId: 'banshee-0' });
    expect(result.success).toBe(true);
    expect(banshee.armsReversed).toBe(true);
  });
});
