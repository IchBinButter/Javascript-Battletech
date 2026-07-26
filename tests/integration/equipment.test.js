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

  it('CASE in same location contains ammo explosion, destroying the location but leaving armor on associated arm', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(true) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo.lrm20_ammo.shots = 12;
    const initialCTarmor = atlas.getArmor('centerTorso');
    const initialCTis = atlas.getInternal('centerTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.ammoDestroyed !== undefined ? atlas.equipment.ammo.lrm20_ammo.shots : 0).toBe(0);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
    expect(atlas.getArmor('leftTorso')).toBe(0);
    expect(atlas.getInternal('leftTorso')).toBe(0);
    expect(atlas.isLocationDestroyed('leftArm')).toBe(true);
    expect(atlas.getArmor('centerTorso')).toBe(initialCTarmor);
    expect(atlas.getInternal('centerTorso')).toBe(initialCTis);
  });

  it('ammo explosion without CASE damages internal structure but preserves armor', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo.lrm20_ammo.shots = 2;
    const initialArmor = atlas.getArmor('leftTorso');
    const initialIS = atlas.getInternal('leftTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    expect(atlas.getArmor('leftTorso')).toBe(initialArmor);
    expect(atlas.getInternal('leftTorso')).toBe(initialIS - 2);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(false);
  });

  it('ammo explosion without CASE destroys location when damage exceeds IS', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.equipment.ammo.lrm20_ammo.shots = 30;
    const initialCTis = atlas.getInternal('centerTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'lrm20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.lrm20_ammo.shots).toBe(0);
    expect(atlas.isLocationDestroyed('leftTorso')).toBe(true);
    expect(atlas.isLocationDestroyed('leftArm')).toBe(true);
    expect(atlas.getInternal('centerTorso')).toBe(initialCTis);
  });

  it('CASE in wrong location does not protect ammo in a different location', () => {
    const engine = createTestEngine({
      units: { 'atlas-0': createAmmoTestUnit(false) }
    });
    const atlas = engine.stateManager.getState().getUnit('atlas-0');
    atlas.criticalSlots.rightTorso.push({ slot: 13, item: 'case', status: 'ok' });
    atlas.equipment.ammo.lrm20_ammo.shots = 30;
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
    atlas.equipment.ammo.lrm20_ammo.shots = 30;
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
    const ctSlots = atlas.criticalSlots.centerTorso;
    for (const slot of ctSlots) {
      if (slot.item === 'ac20_ammo') slot.item = 'empty';
    }
    atlas.equipment.ammo.ac20_ammo.shots = 5;
    const initialCTis = atlas.getInternal('centerTorso');

    engine.damageResolver.resolveAmmoExplosion(atlas, 'ac20_ammo', makeDiceRoller(7));

    expect(atlas.equipment.ammo.ac20_ammo.shots).toBe(0);
    expect(atlas.isLocationDestroyed('rightTorso')).toBe(true);
    expect(atlas.isLocationDestroyed('rightArm')).toBe(true);
    expect(atlas.getInternal('centerTorso')).toBe(initialCTis);
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
    atlas.heat = 7;

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

  it('doubles walk MP when MASC is active', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);

    const mp = movCalc.getMaxMP(unit, 'walk');
    expect(mp).toBe(6); // Atlas walk 3 × 2 = 6
  });

  it('does NOT double walk MP when MASC is not active', () => {
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

  it('rollMASC succeeds on high roll (first turn, target 3)', () => {
    const unit = createMASCUnit(true);
    movCalc.activateMASC(unit);

    const result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.failed).toBe(false);
    expect(result.roll).toBe(8);
    expect(result.target).toBe(3);
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
    expect(result.target).toBe(3);
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
    expect(result.target).toBe(3); // turn 1

    unit.mascActive = true;
    unit.mascTurnsActive = 2;
    result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.target).toBe(5); // turn 2: 3 + 2

    unit.mascActive = true;
    unit.mascTurnsActive = 3;
    result = movCalc.rollMASC(unit, makeDiceRoller(8));
    expect(result.target).toBe(7); // turn 3: 3 + 4
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

  it('mascActive flag alone doubles MP even without equipment installed', () => {
    const unit = createMASCUnit(false);
    unit.mascActive = true;
    const mp = movCalc.getMaxMP(unit, 'walk');
    expect(mp).toBe(6);
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

  it('gives +2 walk MP at heat 9', () => {
    const unit = createTSMUnit(true);
    unit.heat = 9;

    const heatManager = new HeatManager();
    const effects = heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(5); // base walk 3 + 2 TSM
  });

  it('gives +2 walk MP at heat 15 (no MP reduction at this level)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 15;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(5); // base 3, no MP reduction at heat 15, +2 TSM = 5
  });

  it('TSM +2 bonus partially offsets -1 MP reduction at heat 18', () => {
    const unit = createTSMUnit(true);
    unit.heat = 18;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(4); // base 3 - 1 MP + 2 TSM = 4
  });

  it('does NOT give TSM bonus below heat 9', () => {
    const unit = createTSMUnit(true);
    unit.heat = 8;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(3); // base walk 3, no TSM bonus
  });

  it('does NOT give TSM bonus at heat 0 without TSM equipment', () => {
    const unit = createTSMUnit(false);
    unit.heat = 9;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(3); // no TSM bonus since no equipment
  });

  it('TSM bonus persists at extreme heat (20+)', () => {
    const unit = createTSMUnit(true);
    unit.heat = 21;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(1); // base 3 - 4 MP + 2 TSM = 1
  });

  it('TSM at heat 14 with no MP reduction gives full bonus', () => {
    const unit = createTSMUnit(true);
    unit.heat = 14;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(unit, makeDiceRoller(7));

    expect(unit.currentMP).toBe(5); // base 3 + 2 TSM, no MP reduction at 14
  });

  it('TSM with Jenner at heat 9+ provides +2 MP on top of base 7 walk', () => {
    const jenner = createTestUnit('jenner-jr7d', 0, 'jenner-tsm');
    jenner.position = { hexKey: '5,7', facing: 0 };
    jenner.equipment.other.tsm = { installed: true };
    jenner.heat = 9;

    const heatManager = new HeatManager();
    heatManager.applyHeatEffects(jenner, makeDiceRoller(7));

    expect(jenner.currentMP).toBe(9); // base walk 7 + 2 TSM
  });
});
