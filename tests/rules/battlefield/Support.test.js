/**
 * Battlefield Support scheduled-strike rules (BMM p.75-79): the support table,
 * scheduling, target numbers, damage groupings, scatter and expiry.
 */

import { describe, it, expect } from 'vitest';
import {
  BATTLEFIELD_SUPPORT_TABLE, DAMAGE_PER_GROUPING, SCATTER_DIRECTIONS,
  normalizeSupportType, supportTypeData, scheduleSupportStrike, scheduledStrikes,
  dueSupportStrikes, expireSupportStrike, scatterDestination, resolveSupportStrike
} from '../../../src/rules/battlefield/BattlefieldSupport.js';
import { createTestGameState } from '../../helpers/testUtils.js';

/** Dice roller with explicit 2D6/1D6 results, consumed in order. */
function queueRoller(rolls) {
  let index = 0;
  return {
    roll2d6() { return rolls[index++]; },
    roll1d6() { return rolls[index++]; },
    next() { return 0.5; }
  };
}

function emptyState(turn = 1) {
  return createTestGameState({ turn });
}

describe('Battlefield Support table (p.78)', () => {
  it('mirrors the target numbers and damage groupings', () => {
    expect(BATTLEFIELD_SUPPORT_TABLE.light_strike)
      .toMatchObject({ targetNumber: 5, damageGroupings: 2 });
    expect(BATTLEFIELD_SUPPORT_TABLE.heavy_bombing)
      .toMatchObject({ targetNumber: 7, damageGroupings: 6 });
    expect(BATTLEFIELD_SUPPORT_TABLE.strafing)
      .toMatchObject({ targetNumber: 7, damageGroupings: 3 });
    expect(BATTLEFIELD_SUPPORT_TABLE.thumper)
      .toMatchObject({ targetNumber: 8, damageGroupings: [3, 1] });
    expect(BATTLEFIELD_SUPPORT_TABLE.long_tom)
      .toMatchObject({ targetNumber: 8, damageGroupings: [5, 3, 1] });
  });

  it('marks which attacks scatter when they miss', () => {
    expect(BATTLEFIELD_SUPPORT_TABLE.light_strike.scatters).toBe(false);
    expect(BATTLEFIELD_SUPPORT_TABLE.light_bombing.scatters).toBe(true);
    expect(BATTLEFIELD_SUPPORT_TABLE.heavy_bombing.scatters).toBe(true);
    expect(BATTLEFIELD_SUPPORT_TABLE.sniper.scatters).toBe(true);
  });

  it('treats every Damage Value grouping as five points of damage', () => {
    expect(DAMAGE_PER_GROUPING).toBe(5);
  });

  it('normalises support type spellings', () => {
    expect(normalizeSupportType('Light Strike')).toBe('light_strike');
    expect(normalizeSupportType('heavy-bombing')).toBe('heavy_bombing');
    expect(normalizeSupportType('HeavyBombing')).toBe('heavy_bombing');
    expect(normalizeSupportType('Long Tom')).toBe('long_tom');
    expect(normalizeSupportType('banana')).toBeNull();
    expect(supportTypeData('thumper').key).toBe('thumper');
  });
});

describe('scheduling a strike', () => {
  it('appends a plain-data record and waits for its turn', () => {
    const state = emptyState(1);
    const record = scheduleSupportStrike(state, {
      hexKey: '5,5', turn: 2, type: 'Heavy Strike', owner: 1
    });

    expect(record).toEqual({ hexKey: '5,5', turn: 2, type: 'heavy_strike', owner: 1 });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    expect(scheduledStrikes(state)).toEqual([record]);
    expect(state.battlefieldSupport.points).toBe(9); // 12 - heavy strike's 3 BSP
    expect(dueSupportStrikes(state)).toEqual([]);

    state.turn = 2;
    expect(dueSupportStrikes(state)).toEqual([record]);

    expireSupportStrike(state, record);
    expect(scheduledStrikes(state)).toEqual([]);
  });

  it('defaults the turn and the owner to the acting player and spends the BSP cost', () => {
    const state = emptyState(3);
    const record = scheduleSupportStrike(state, { hexKey: '7,7', type: 'sniper' });

    expect(record).toEqual({ hexKey: '7,7', turn: 3, type: 'sniper', owner: 0 });
    expect(state.battlefieldSupport.points).toBe(8); // 12 - sniper's 4 BSP
  });

  it('refuses a strike when the BSP pool cannot pay for it', () => {
    const state = emptyState();
    state.battlefieldSupport.points = 1;

    expect(() => scheduleSupportStrike(state, { hexKey: '7,7', type: 'heavy_strike' }))
      .toThrow(/Not enough Battlefield Support Points for Heavy Strike: 1 available, 3 needed/);
    expect(state.battlefieldSupport.points).toBe(1);
    expect(scheduledStrikes(state)).toEqual([]);
  });

  it('rejects unknown types, minefields and malformed schedules', () => {
    const state = emptyState();
    expect(() => scheduleSupportStrike(state, { hexKey: '5,5', type: 'orbital_banana' }))
      .toThrow(/Unknown Battlefield Support type/);
    expect(() => scheduleSupportStrike(state, { hexKey: '5,5', type: 'heavy_density' }))
      .toThrow(/Minefields are placed before deployment/);
    expect(() => scheduleSupportStrike(state, { hexKey: '5,5', type: 'light_strike', turn: 0 }))
      .toThrow(/Invalid strike turn/);
    expect(() => scheduleSupportStrike(state, { hexKey: '', type: 'light_strike' }))
      .toThrow(/target hexKey/);

    const noActingPlayer = emptyState();
    noActingPlayer.currentPlayer = null;
    expect(() => scheduleSupportStrike(noActingPlayer, { hexKey: '5,5', type: 'light_strike' }))
      .toThrow(/needs an owner/);
  });
});

describe('resolving a strike (p.75-77)', () => {
  it('rolls against the table Target Number and applies one 5-point grouping per hit', () => {
    const units = [{ id: 'atlas', hexKey: '5,5' }];
    const result = resolveSupportStrike(
      { hexKey: '5,5', turn: 1, type: 'light_strike' },
      { diceRoller: queueRoller([5, 2, 7, 8]), units }
    );

    expect(result).toMatchObject({
      type: 'light_strike',
      targetNumber: 5,
      roll: 5,
      success: true,
      attackDirectionRoll: 2,
      attackDirection: 'front',
      groupingDamage: 5
    });
    expect(result.hits).toHaveLength(2);
    expect(result.hits.every(hit => hit.damage === 5 && hit.unitId === 'atlas')).toBe(true);
    expect(result.hits.map(hit => hit.location)).toEqual(['centerTorso', 'leftTorso']);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('rolls a rear attack direction on a direction roll of 5-6', () => {
    const result = resolveSupportStrike(
      { hexKey: '5,5', turn: 1, type: 'light_strike' },
      { diceRoller: queueRoller([5, 5, 7, 7]), units: [{ id: 'atlas', hexKey: '5,5' }] }
    );

    expect(result.attackDirection).toBe('rear');
    expect(result.hits[0].isRear).toBe(true);
  });

  it('does nothing on a miss for a strike that does not scatter', () => {
    const result = resolveSupportStrike(
      { hexKey: '5,5', turn: 1, type: 'heavy_strike' },
      { diceRoller: queueRoller([4]), units: [{ id: 'atlas', hexKey: '5,5' }] }
    );

    expect(result.success).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.scatter).toBeNull();
  });

  it('scatters a bombing miss one hex per Margin of Failure and hits the new hex', () => {
    const scatter = scatterDestination('5,5', 3, 5);
    const units = [
      { id: 'target', hexKey: '5,5' },
      { id: 'bystander', hexKey: scatter }
    ];

    const result = resolveSupportStrike(
      { hexKey: '5,5', turn: 1, type: 'heavy_bombing' },
      { diceRoller: queueRoller([2, 3, 7, 7, 7, 7, 7, 7]), units }
    );

    expect(result.success).toBe(false);
    expect(result.scatter).toEqual({
      marginOfFailure: 5,
      directionRoll: 3,
      direction: SCATTER_DIRECTIONS[2],
      hexKey: scatter
    });
    // Six groupings, all automatic hits on whoever is in the scattered hex.
    expect(result.hits).toHaveLength(6);
    expect(result.hits.every(hit => hit.unitId === 'bystander' && hit.automatic)).toBe(true);
    expect(result.hits.some(hit => hit.unitId === 'target')).toBe(false);
  });

  it('applies artillery groupings across the blast radius', () => {
    const result = resolveSupportStrike(
      { hexKey: '5,5', turn: 1, type: 'thumper' },
      {
        diceRoller: queueRoller([8, 1, 7, 7, 7, 7]),
        units: [
          { id: 'centre', hexKey: '5,5' },
          { id: 'edge', hexKey: '5,6' }
        ]
      }
    );

    expect(result.success).toBe(true);
    expect(result.hits.filter(hit => hit.unitId === 'centre')).toHaveLength(3);
    expect(result.hits.filter(hit => hit.unitId === 'edge')).toHaveLength(1);
    expect(result.hits.find(hit => hit.unitId === 'edge').radius).toBe(1);
  });

  it('throws for an unknown type and requires a dice roller', () => {
    expect(() => resolveSupportStrike({ hexKey: '5,5', type: 'banana' }, { diceRoller: queueRoller([7]) }))
      .toThrow(/Unknown Battlefield Support type/);
    expect(() => resolveSupportStrike({ hexKey: '5,5', type: 'light_strike' }, {}))
      .toThrow(/dice roller/);
  });
});
