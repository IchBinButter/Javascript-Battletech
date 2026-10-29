import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller,
  advanceToPhase
} from '../helpers/testUtils.js';
import { MovementCalculator } from '../../src/rules/movement/MovementCalculator.js';
import { HeatManager } from '../../src/rules/heat/HeatManager.js';

// =========================================================================
// CASE (Cellular Ammunition Storage Equipment)
// =========================================================================

describe('Equipment: CASE containment', () => {
  function createAmmoTestUnit(withCase = false, withArmor = true) {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };

    if (!withArmor) {
      atlas.armor.leftTorso.front = 1;
    }

    if (withCase) {
      atlas.criticalSlots.leftTorso.push({ slot: 13, item: 'case', status: 'ok' });
    }

    return atlas;
  }

  // p118 CASE: the blast is contained to the internal structure of the
  // location that holds the ammunition; the excess is ignored. p44: an
  // ammunition explosion bypasses armour entirely, so the armour value does
  // not change at all.
  it('CASE in same location contains the blast in internal structure, leaving armour intact', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(true) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    // One bin = one critical slot = one ton of LRM-20 ammunition (6 shots).
    atlas.equipment.ammo.lrm20_ammo.shots = 6;
    const initialLTArmor = atlas.getArmor('leftTorso');
    const initialLAArmor = atlas.getArmor('leftArm');
    const initialCTarmor = atlas.getArmor('centerTorso');
    const initialCTis = atlas.getInternal('centerTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
    // p44: "explosions bypass armour" — the left torso armour is untouched.
    expect(atlas.getArmor('leftTorso')).toBe(initialLTArmor);
    expect(atlas.getInternal('leftTorso')).toBe(0);
    // p44: a destroyed side torso takes its arm with it.
    expect(atlas.isLocationDestroyed('leftArm')).toBe(true);
    expect(atlas.getArmor('leftArm')).toBe(initialLAArmor); // the arm itself is undamaged
    // p118: CASE ignores the excess, so nothing reaches the centre torso.
    expect(atlas.getArmor('centerTorso')).toBe(initialCTarmor);
    expect(atlas.getInternal('centerTorso')).toBe(initialCTis);
    // p58: an ammunition explosion injures the MechWarrior for 2 points.
    expect(atlas.pilot.hits).toBe(2);
  });

  // p102: a missile bin explodes for the launcher size in damage per shot, so
  // two LRM-20 shots are 40 points, not 2 (p96/p118).
  it('an LRM-20 bin explodes for 20 per shot, not 1 per shot (p102)', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo.lrm20_ammo.shots = 2;
    const initialArmor = atlas.getArmor('leftTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    // p44: the explosion bypasses the left torso's 32 armour and destroys its
    // 21 internal structure; the remaining 19 points transfer inward.
    expect(atlas.getArmor('leftTorso')).toBe(initialArmor);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
    expect(atlas.getInternal('centerTorso')).toBe(31 - 19); // 12
  });

  // p44: without CASE the excess keeps transferring inward, past armour.
  it('ammo explosion without CASE transfers inward past armour (p44)', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo.lrm20_ammo.shots = 6; // one ton = 6 LRM-20 shots
    const initialCTarmor = atlas.getArmor('centerTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
    expect(atlas.isLocationDestroyed('leftArm')).toBe(true);
    // 6 LRM-20 shots = 120 points: the left torso (21) and the centre torso
    // (31) are both destroyed; the centre torso armour is never touched.
    expect(atlas.getInternal('centerTorso')).toBe(0);
    expect(atlas.getArmor('centerTorso')).toBe(initialCTarmor);
    expect(atlas.isLocationDestroyed('centerTorso')).toBe(true);
  });

  it('CASE in wrong location does not protect ammo in a different location', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.criticalSlots.rightTorso.push({ slot: 13, item: 'case', status: 'ok' });
    atlas.equipment.ammo.lrm20_ammo.shots = 6;
    const initialArmor = atlas.getArmor('leftTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    expect(atlas.getArmor('leftTorso')).toBe(initialArmor);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
  });

  it('destroyed CASE does not protect against ammo explosion', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.criticalSlots.leftTorso.push({ slot: 13, item: 'case', status: 'destroyed' });
    atlas.equipment.ammo.lrm20_ammo.shots = 6;
    const initialArmor = atlas.getArmor('leftTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    expect(atlas.getArmor('leftTorso')).toBe(initialArmor);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
  });

  it('CASE in rightTorso contains ammo explosion there and destroys rightArm', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.criticalSlots.rightTorso.push({ slot: 13, item: 'case', status: 'ok' });
    atlas.criticalSlots.rightTorso.push({ slot: 14, item: 'ac20_ammo', status: 'ok' });
    // One AC/20 bin per critical slot (p52): give the new right-torso slot its
    // own bin next to the Atlas's centre-torso AC/20 bin.
    atlas.equipment.ammo['ac20_ammo#2'] = {
      type: 'ac20', shots: 5, explosive: true, location: 'rightTorso', slot: 14
    };
    const initialCTis = atlas.getInternal('centerTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'ac20_ammo#2', makeDiceRoller(7));

    expect(atlas.equipment.ammo['ac20_ammo#2'].shots).toBe(0);
    expect(atlas.equipment.ammo.ac20_ammo.shots).toBe(5); // other bin untouched
    expect(atlas.isLocationDestroyed('rightTorso')).toBe(true);
    expect(atlas.isLocationDestroyed('rightArm')).toBe(true);
    expect(atlas.getInternal('centerTorso')).toBe(initialCTis);
  });

  // D-05/p52: the Atlas carries two LRM-20 bins (slots 6 and 7 of the left
  // torso). Only the bin that explodes loses its shots and feeds the blast.
  it('explodes only the named bin when a Mech carries two LRM-20 bins (p52)', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo['lrm20_ammo#2'].shots = 1; // slot 7 has one round left

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo#2', makeDiceRoller(7));

    expect(atlas.equipment.ammo['lrm20_ammo#2'].shots).toBe(0);
    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(6); // slot 6 keeps its ton
    // One LRM-20 shot is 20 damage; the left torso's 21 internal structure
    // survives with 1 point, so nothing transfers inward.
    expect(atlas.getInternal('leftTorso')).toBe(1);
    expect(atlas.isLocationDestroyed('centerTorso')).toBe(false);
    expect(atlas.pilot.hits).toBe(2);
  });

  it('a critical hit maps to that slot\'s bin, not the first bin of the type (p52)', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo['lrm20_ammo#2'].shots = 1;

    // Left torso slot 7 is the second LRM-20 bin.
    const result = engine.damageResolver.applyItemCritical(
      atlas,
      atlas.criticalSlots.leftTorso[6],
      'leftTorso',
      makeDiceRoller(7)
    );

    expect(result.ammoBin).toBe('lrm20_ammo#2');
    expect(atlas.equipment.ammo['lrm20_ammo#2'].shots).toBe(0);
    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(6);
  });
});

// =========================================================================
// Targeting Computer
// =========================================================================

describe('Equipment: Targeting Computer', () => {
  function setupTargetCompAttack(targetCompInstalled = true) {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 0 };
    jenner.position = { hexKey: '7,7', facing: 3 };

    if (targetCompInstalled) {
      atlas.equipment.other.targeting_computer = { installed: true };
    }

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    return { engine, atlas, jenner };
  }

  it('gives -1 TN for direct energy (DE) weapons', () => {
    const { engine } = setupTargetCompAttack(true);
    engine.diceRoller = makeDiceRoller(8);

    const medLaser = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(result.hit).toBe(true);
    expect(result.targetNumber).toBe(3);
    expect(result.modifiers).toContain('Targeting Computer: -1');
  });

  it('does NOT give -1 TN for missile (M) weapons', () => {
    const { engine } = setupTargetCompAttack(true);
    engine.diceRoller = makeDiceRoller(8);

    const srm = createWeaponDef('srm6');
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: srm,
      weaponLocation: 'leftTorso'
    });

    expect(result.targetNumber).toBe(4);
    expect(result.modifiers).not.toContain('Targeting Computer: -1');
  });

  it('target number baseline is 4 when no targeting computer', () => {
    const { engine } = setupTargetCompAttack(false);
    engine.diceRoller = makeDiceRoller(8);

    const medLaser = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(result.targetNumber).toBe(4);
    expect(result.modifiers).not.toContain('Targeting Computer: -1');
  });

  it('stacks with other GATOR modifiers', () => {
    const { engine, atlas } = setupTargetCompAttack(true);
    engine.diceRoller = makeDiceRoller(10);

    atlas._movementModifier = 2;
    atlas.heat = 8; // +1 TN starts at heat 8 on the record sheet

    const medLaser = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(result.targetNumber).toBe(6);
    expect(result.modifiers).toContain('Attacker moved: +2');
    expect(result.modifiers).toContain('Attacker heat: +1');
    expect(result.modifiers).toContain('Targeting Computer: -1');
  });
});

// =========================================================================
// MASC (Myomer Accelerator Signal Circuitry)
// =========================================================================

describe('Equipment: MASC', () => {
  let movCalc;

  beforeEach(() => {
    movCalc = new MovementCalculator();
  });

  function createMASCUnit(hasMasc = true) {
    const atlas = createTestUnit('atlas-as7d', 0, 'masc-test');
    atlas.position = { hexKey: '5,7', facing: 0 };
    if (hasMasc) {
      atlas.equipment.other.masc = { installed: true };
    }
    return atlas;
  }

  it('detects MASC equipment on a unit', () => {
    const withMasc = createMASCUnit(true);
    const withoutMasc = createMASCUnit(false);

    expect(movCalc.hasMASC(withMasc)).toBe(true);
    expect(movCalc.hasMASC(withoutMasc)).toBe(false);
  });

  it('activateMASC sets mascActive and increments turns active', () => {
    const unit = createMASCUnit(true);
    expect(unit.mascActive).toBeUndefined();

    const result = movCalc.activateMASC(unit);
    expect(result).toBe(true);
    expect(unit.mascActive).toBe(true);
    expect(unit.mascTurnsActive).toBe(1);

    movCalc.activateMASC(unit);
    expect(unit.mascTurnsActive).toBe(2);
  });

  it('activateMASC returns false for unit without MASC', () => {
    const unit = createMASCUnit(false);
    const result = movCalc.activateMASC(unit);
    expect(result).toBe(false);
    expect(unit.mascActive).toBeUndefined();
  });

  // p116 MASC: "On a result of 3 or higher, the 'Mech can run that turn at a
  // speed equal to double its current Walking MP." Walking MP itself is not
  // increased, so the attack modifier stays "ran +2" (p28).
  it('does NOT change walk MP when MASC is active', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);

    const mp = movCalc.getMaxMP(unit, 'walk');
    expect(mp).toBe(3); // Atlas walk 3
  });

  it('doubles run MP when MASC is active', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);

    expect(movCalc.getMaxMP(unit, 'run')).toBe(6); // 2 x walk 3
  });

  it('run MP without MASC is 1.5 x walk (Atlas: 5)', () => {
    const unit = createMASCUnit(true);
    expect(movCalc.getMaxMP(unit, 'run')).toBe(5); // ceil(3 x 1.5)
  });

  it('does NOT change walk MP when MASC is not active', () => {
    const unit = createMASCUnit(true);
    const mp = movCalc.getMaxMP(unit, 'walk');
    expect(mp).toBe(3); // Normal walk MP
  });

  it('deactivateMASC resets active flag and turn counter', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);
    movCalc.activateMASC(unit);
    expect(unit.mascTurnsActive).toBe(2);

    movCalc.deactivateMASC(unit);
    expect(unit.mascActive).toBe(false);
    expect(unit.mascTurnsActive).toBe(0);
  });

  it('rollMASC succeeds on high roll (first turn, target 2)', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);

    const result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.failed).toBe(false);
    expect(result.roll).toBe(8);
    expect(result.target).toBe(2);
    expect(unit.mascActive).toBe(true);
  });

  it('rollMASC fails on low roll and damages leg actuator', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);
    unit.criticalSlots.leftLeg.push({ slot: 7, item: 'hip_actuator', status: 'ok' });
    unit.criticalSlots.leftLeg.push({ slot: 8, item: 'lower_leg_actuator', status: 'ok' });

    const result = movCalc.rollMASC(unit, makeDiceRoller(2));
    expect(result.failed).toBe(true);
    expect(result.roll).toBe(2);
    expect(result.target).toBe(2);
    expect(unit.mascActive).toBe(false);
    expect(unit.mascTurnsActive).toBe(0);

    const legSlots = [
      ...(unit.criticalSlots.leftLeg || []),
      ...(unit.criticalSlots.rightLeg || [])
    ];
    const destroyedActuators = legSlots.filter(s =>
      s.item && s.item.includes('actuator') && s.status === 'destroyed'
    );
    expect(destroyedActuators.length).toBeGreaterThan(0);
  });

  it('failure target increases by 2 per consecutive turn active', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);

    let result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.target).toBe(2); // turn 1

    unit.mascActive = true;
    unit.mascTurnsActive = 2;
    result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.target).toBe(4); // turn 2

    unit.mascActive = true;
    unit.mascTurnsActive = 3;
    result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.target).toBe(6); // turn 3
  });

  it('rollMASC returns no-op when MASC is not active', () => {
    const unit = createMASCUnit(true);
    const result = movCalc.rollMASC(unit, makeDiceRoller(2));

    expect(result.roll).toBeNull();
    expect(result.failed).toBe(false);
  });

  it('MASC activation fails when unit has no MASC equipment', () => {
    const unit = createMASCUnit(false);
    const activated = movCalc.activateMASC(unit);
    expect(activated).toBe(false);
    const mp = movCalc.getMaxMP(unit, 'walk');
    expect(mp).toBe(3);
  });

  it('mascActive flag alone doubles run MP even without equipment installed', () => {
    const unit = createMASCUnit(false);
    unit.mascActive = true;
    expect(movCalc.getMaxMP(unit, 'walk')).toBe(3);
    expect(movCalc.getMaxMP(unit, 'run')).toBe(6);
  });
});

// =========================================================================
// TSM (Triple-Strength Myomer)
// =========================================================================

describe('Equipment: Triple-Strength Myomer (TSM)', () => {
  function createTSMUnit(hasTsm = true) {
    const atlas = createTestUnit('atlas-as7d', 0, 'tsm-test');
    atlas.position = { hexKey: '5,7', facing: 0 };
    if (hasTsm) {
      atlas.equipment.other.tsm = { installed: true };
    }
    return atlas;
  }

  // Atlas AS7-D walk MP is 3; TSM adds 2 from heat 9 while the record-sheet
  // heat penalty takes away 1/2/3/4/5 at heat 5/10/15/20/25.
  it('gives +2 walk MP at heat 9 (3 - 1 + 2 = 4)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 9;
    expect(unit.currentMP).toBe(4);
  });

  it('nets out the -2 penalty at heat 10 (3 - 2 + 2 = 3)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 10;
    expect(unit.currentMP).toBe(3);
  });

  it('offsets the -2 penalty at heat 14 (3 - 2 + 2 = 3)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 14;
    expect(unit.currentMP).toBe(3);
  });

  it('still loses MP against the -3 penalty at heat 18 (3 - 3 + 2 = 2)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 18;
    expect(unit.currentMP).toBe(2);
  });

  it('does NOT give TSM bonus below heat 9', () => {
    const unit = createTSMUnit(true);
    unit.heat = 8;
    expect(unit.currentMP).toBe(2); // -1 MP, no TSM
  });

  it('does NOT give TSM bonus without TSM equipment', () => {
    const unit = createTSMUnit(false);
    unit.heat = 9;
    expect(unit.currentMP).toBe(2); // -1 MP, no bonus
  });

  it('TSM bonus persists at extreme heat (3 - 4 + 2 = 1)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 21;
    expect(unit.currentMP).toBe(1);
  });

  it('TSM with Jenner at heat 9: 7 - 1 + 2 = 8', () => {
    const jenner = createTestUnit('jenner-jr7d', 0, 'jenner-tsm');
    jenner.position = { hexKey: '5,7', facing: 0 };
    jenner.equipment.other.tsm = { installed: true };
    jenner.heat = 9;
    expect(jenner.currentMP).toBe(8);
  });
});
