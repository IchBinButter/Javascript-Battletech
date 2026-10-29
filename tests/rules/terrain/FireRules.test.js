/**
 * Fire and smoke (BMM pp63-64).
 */

import { describe, it, expect } from 'vitest';
import { Hex } from '../../../src/models/Hex.js';
import {
  canBurn, environmentModifier, fireTargetNumber, attemptIgnition,
  spreadsOnRoll, spreadDistance, downwindHexes, temperatureModifier,
  fireHeat, capOutsideHeat,
  FIRE_HEAT_STANDING, FIRE_HEAT_MOVED_THROUGH, OUTSIDE_HEAT_CAP
} from '../../../src/rules/terrain/FireRules.js';
import * as FireRules from '../../../src/rules/terrain/FireRules.js';

const woods = () => new Hex('1,1', { terrainType: 'light_woods' });
const jungle = (density = 'light') => new Hex('1,1', { terrainType: `${density}_jungle` });
const building = (type) => new Hex('1,1', { terrainType: 'clear', building: { type, levels: 2, cf: 40, currentCF: 40 } });

describe('what can burn', () => {
  it('burns woods but not clear ground or water', () => {
    expect(canBurn(woods())).toBe(true);
    expect(canBurn(new Hex('1,1', { terrainType: 'clear' }))).toBe(false);
    expect(canBurn(new Hex('1,1', { terrainType: 'water_depth1' }))).toBe(false);
  });

  // p63/p64: jungle is woods-like terrain and catches fire the same way.
  it('burns light and heavy jungle (p63)', () => {
    expect(canBurn(jungle('light'))).toBe(true);
    expect(canBurn(jungle('heavy'))).toBe(true);
  });

  it('burns light and medium buildings but not heavy or hardened', () => {
    expect(canBurn(building('light'))).toBe(true);
    expect(canBurn(building('medium'))).toBe(true);
    expect(canBurn(building('heavy'))).toBe(false);
    expect(canBurn(building('hardened'))).toBe(false);
  });
});

describe('Fire Table (p64)', () => {
  it('uses the weapon category target numbers', () => {
    expect(fireTargetNumber({ id: 'flamer', type: 'DE' }, woods())).toBe(4);
    expect(fireTargetNumber({ id: 'med_laser', type: 'DE' }, woods())).toBe(7);
    expect(fireTargetNumber({ id: 'lrm20', type: 'LRM' }, woods())).toBe(9);
    expect(fireTargetNumber({ id: 'ac20', type: 'DB' }, woods())).toBe(9);
  });

  it('treats plasma and inferno as automatic', () => {
    expect(fireTargetNumber({ id: 'plasma_rifle', type: 'DE' }, woods())).toBe(0);
    expect(fireTargetNumber({ id: 'inferno_srm', type: 'SRM' }, woods())).toBe(0);
  });

  it('applies the environment modifier', () => {
    expect(environmentModifier(woods())).toBe(0);
    expect(environmentModifier(building('light'))).toBe(-2);
    expect(environmentModifier(building('medium'))).toBe(-1);
    expect(environmentModifier(building('heavy'))).toBeNull(); // cannot burn
  });

  // p64 Fire Table environment: woods +0, jungle +1 (light and heavy alike).
  it('jungle ignites one point harder than woods (p64)', () => {
    expect(environmentModifier(jungle('light'))).toBe(1);
    expect(environmentModifier(jungle('heavy'))).toBe(1);
    expect(fireTargetNumber({ id: 'med_laser', type: 'DE' }, jungle('light'))).toBe(8);
    expect(fireTargetNumber({ id: 'med_laser', type: 'DE' }, jungle('heavy'))).toBe(8);
    expect(fireTargetNumber({ id: 'flamer', type: 'DE' }, jungle('light'))).toBe(5);
  });

  it('a laser needs 5+ in a light building', () => {
    expect(fireTargetNumber({ id: 'med_laser', type: 'DE' }, building('light'))).toBe(5);
  });

  it('hot weather makes fires easier, cold weather harder', () => {
    expect(temperatureModifier(20)).toBe(0);
    expect(temperatureModifier(40)).toBe(-1);
    expect(temperatureModifier(60)).toBe(-3);
    expect(temperatureModifier(-40)).toBe(1);
    expect(fireTargetNumber({ id: 'med_laser', type: 'DE' }, woods(), 40)).toBe(6);
    expect(fireTargetNumber({ id: 'med_laser', type: 'DE' }, woods(), -40)).toBe(8);
  });

  it('resolves the roll', () => {
    expect(attemptIgnition({ id: 'med_laser', type: 'DE' }, woods(), 7).ignited).toBe(true);
    expect(attemptIgnition({ id: 'med_laser', type: 'DE' }, woods(), 6).ignited).toBe(false);
    expect(attemptIgnition({ id: 'flamer', type: 'DE' }, woods(), 3).ignited).toBe(false);
    expect(attemptIgnition({ id: 'med_laser', type: 'DE' }, new Hex('1,1'), 12)).toMatchObject({
      ignited: false, targetNumber: null
    });
  });
});

describe('heat from fire (p50)', () => {
  it('a Mech standing in a burning hex absorbs 5 heat', () => {
    expect(FIRE_HEAT_STANDING).toBe(5);
    expect(fireHeat({ standingInFire: true })).toBe(5);
  });

  it('a Mech absorbs 2 heat for each burning hex it moved through', () => {
    expect(FIRE_HEAT_MOVED_THROUGH).toBe(2);
    expect(fireHeat({ burningHexesMovedThrough: 1 })).toBe(2);
    expect(fireHeat({ burningHexesMovedThrough: 2 })).toBe(4);
    expect(fireHeat({ burningHexesMovedThrough: 3 })).toBe(6);
  });

  it('standing in fire and moving through burning hexes are cumulative', () => {
    expect(fireHeat({ standingInFire: true, burningHexesMovedThrough: 2 })).toBe(9);
  });

  it('no fire means no heat', () => {
    expect(fireHeat()).toBe(0);
    expect(fireHeat({ standingInFire: false, burningHexesMovedThrough: 0 })).toBe(0);
  });

  it('caps cumulative outside heat at 15 per turn (p50)', () => {
    expect(OUTSIDE_HEAT_CAP).toBe(15);
    expect(capOutsideHeat(20)).toBe(15);
    expect(capOutsideHeat(15)).toBe(15);
    expect(capOutsideHeat(7)).toBe(7);
    // Cold weather cools the Mech; it is not a heat source and is not capped.
    expect(capOutsideHeat(-2)).toBe(-2);
  });

  it('has no armour-damage roll - fire is heat only', () => {
    expect(FireRules.fireDamageRoll).toBeUndefined();
  });
});

describe('spread', () => {
  it('spreads only on a 12', () => {
    expect(spreadsOnRoll(12)).toBe(true);
    expect(spreadsOnRoll(11)).toBe(false);
  });

  it('spreads two hexes in a gale or storm', () => {
    expect(spreadDistance('none')).toBe(1);
    expect(spreadDistance('moderate')).toBe(2);
    expect(spreadDistance('storm')).toBe(2);
  });

  it('walks downwind from the burning hex', () => {
    expect(downwindHexes('5,5', 0, 1)).toHaveLength(1);
    expect(downwindHexes('5,5', 0, 2)).toHaveLength(2);
    const [first, second] = downwindHexes('5,5', 0, 2);
    expect(first).toBe(downwindHexes('5,5', 0, 1)[0]);
    expect(second).not.toBe(first);
  });
});
