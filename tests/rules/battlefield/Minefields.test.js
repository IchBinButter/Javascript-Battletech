/**
 * Minefield rules (BMM p.75-79): the density table, trigger rolls, damage
 * groupings and the (assumed) Kick Location Table hit locations.
 */

import { describe, it, expect } from 'vitest';
import hitTables from '../../../src/data/hitTables.json' with { type: 'json' };
import {
  MINEFIELD_DENSITIES,
  normalizeMinefieldType, createMinefield, placeMinefield, minefieldAt,
  minefieldHexesEntered, resolveMinefieldTrigger
} from '../../../src/rules/battlefield/Minefields.js';
import { DAMAGE_PER_GROUPING } from '../../../src/rules/battlefield/BattlefieldSupport.js';
import { createTestEngine, createTestUnit } from '../../helpers/testUtils.js';

/** Dice roller with explicit 2D6/1D6 results, consumed in order. */
function queueRoller(rolls) {
  let index = 0;
  return {
    roll2d6() { return rolls[index++]; },
    roll1d6() { return rolls[index++]; },
    next() { return 0.5; }
  };
}

/** A roller that fails the test if anything asks for dice. */
function forbiddenRoller() {
  const fail = () => { throw new Error('no dice roll expected'); };
  return { roll2d6: fail, roll1d6: fail, next: () => 0.5 };
}

function minedEngine({ fields = {}, unit = 'atlas-as7d', hexKey = '5,5', facing = 3 } = {}) {
  const mech = createTestUnit(unit, 0, 'mover');
  mech.position = { hexKey, facing };

  const engine = createTestEngine({ units: { mover: mech } });
  Object.assign(engine.stateManager.getState().minefields, fields);

  engine.phaseManager.enterPhase('movement');
  engine.phaseManager.clearQueue();
  engine.stateManager.getState().currentPlayer = 0;

  return { engine, mech };
}

describe('Minefield Support table (p.78)', () => {
  it('uses the light/medium/heavy density target numbers and groupings', () => {
    expect(MINEFIELD_DENSITIES.light).toMatchObject({ targetNumber: 9, damageGroupings: 2 });
    expect(MINEFIELD_DENSITIES.medium).toMatchObject({ targetNumber: 8, damageGroupings: 4 });
    expect(MINEFIELD_DENSITIES.heavy).toMatchObject({ targetNumber: 7, damageGroupings: 6 });
    // Footnote **: every Damage Value grouping is five points of damage.
    expect(DAMAGE_PER_GROUPING).toBe(5);
  });

  it('normalises spellings used by scenario data', () => {
    expect(normalizeMinefieldType('Light')).toBe('light');
    expect(normalizeMinefieldType('light density')).toBe('light');
    expect(normalizeMinefieldType('Light-Density')).toBe('light');
    expect(normalizeMinefieldType('MEDIUM')).toBe('medium');
    expect(normalizeMinefieldType('banana')).toBeNull();
  });

  it('creates plain JSON records with the density grouping count as strength', () => {
    const field = createMinefield('Medium');
    expect(field).toEqual({ type: 'medium', strength: 4 });
    expect(JSON.parse(JSON.stringify(field))).toEqual(field);
    expect(createMinefield('heavy', { strength: 2, owner: 1 }))
      .toEqual({ type: 'heavy', strength: 2, owner: 1 });
    expect(() => createMinefield('banana')).toThrow(/Unknown minefield density/);
  });
});

describe('minefield attacks (hit locations assumed; KB has no p.79 body)', () => {
  // ASSUMPTION: the project KB does not contain the p.79 minefield body, so
  // rolling each Damage Value grouping on the front column of the Kick
  // Location Table is an assumption encoded in Minefields.js; this test mirrors
  // that implementation choice, not a verified manual citation.
  it('assumed: rolls 2D6 against the density target number and one Kick-table hit per grouping', () => {
    const field = { type: 'light', strength: 2 };
    const result = resolveMinefieldTrigger(field, queueRoller([9, 7, 8]));

    expect(result).toMatchObject({
      type: 'light',
      targetNumber: 9,
      roll: 9,
      triggered: true,
      strengthBefore: 2,
      strengthAfter: 1,
      groupingDamage: 5
    });
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({
      location: hitTables.hitLocation.kick['7'].location,
      damage: 5,
      roll: 7,
      isRear: false
    });
    expect(result.hits[1].location).toBe(hitTables.hitLocation.kick['8'].location);
  });

  it('leaves the field active and undamaged on a miss', () => {
    const result = resolveMinefieldTrigger({ type: 'medium', strength: 4 }, queueRoller([7]));

    expect(result.triggered).toBe(false);
    expect(result.roll).toBe(7);
    expect(result.strengthBefore).toBe(4);
    expect(result.strengthAfter).toBe(4);
    expect(result.hits).toEqual([]);
  });

  it('does nothing for an unknown density or a depleted field', () => {
    expect(resolveMinefieldTrigger({ type: 'banana', strength: 1 }, forbiddenRoller()))
      .toMatchObject({ triggered: false, reason: 'unknown density' });
    expect(resolveMinefieldTrigger({ type: 'light', strength: 0 }, forbiddenRoller()))
      .toMatchObject({ triggered: false, reason: 'depleted', strengthAfter: 0 });
  });

  it('returns plain data that survives a JSON hop', () => {
    const result = resolveMinefieldTrigger({ type: 'heavy', strength: 2 }, queueRoller([7, 3, 5]));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('minefield placement and entry', () => {
  it('stores fields by hex key and reads them back', () => {
    const engine = createTestEngine({ units: {} });
    const state = engine.stateManager.getState();
    const field = placeMinefield(state, '5,6', 'light');

    expect(field).toEqual({ type: 'light', strength: 2 });
    expect(minefieldAt(state, '5,6')).toBe(field);
    expect(minefieldAt(state, '9,9')).toBeNull();
  });

  it('counts every entered hex on the ground but only the landing hex when jumping', () => {
    const path = ['5,5', '5,6', '5,7'];
    expect(minefieldHexesEntered(path, 'walk')).toEqual(['5,6', '5,7']);
    expect(minefieldHexesEntered(path, 'run')).toEqual(['5,6', '5,7']);
    expect(minefieldHexesEntered(path, 'jump')).toEqual(['5,7']);
    expect(minefieldHexesEntered(['5,5'], 'walk')).toEqual([]);
  });
});

describe('minefields through the engine', () => {
  it('damages a Mech entering a mined hex and consumes one grouping', () => {
    const { engine, mech } = minedEngine({ fields: { '5,6': { type: 'light', strength: 2 } } });
    engine.diceRoller = queueRoller([9, 7, 7]);

    const events = [];
    engine.eventBus.on('minefieldTriggered', event => events.push(event));

    const armourBefore = mech.armor.rightLeg.front;
    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(result.minefields).toHaveLength(1);
    // Two 5-point groupings on the kick table's right leg (hit-location
    // assumption; see the rules test above).
    expect(mech.armor.rightLeg.front).toBe(armourBefore - 10);
    expect(engine.stateManager.getState().minefields['5,6'].strength).toBe(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      unitId: 'mover',
      hexKey: '5,6',
      type: 'light',
      targetNumber: 9,
      roll: 9,
      triggered: true,
      strengthBefore: 2,
      strengthAfter: 1
    });
    expect(events[0].hits).toHaveLength(2);
    expect(events[0].hits[0].damageResult).toBeDefined();
    expect(JSON.parse(JSON.stringify(events[0]))).toEqual(events[0]);
  });

  it('does not roll at all for a clear hex', () => {
    const { engine, mech } = minedEngine({ fields: { '9,9': { type: 'heavy', strength: 6 } } });
    engine.diceRoller = forbiddenRoller();

    const events = [];
    engine.eventBus.on('minefieldTriggered', event => events.push(event));

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(result.minefields).toEqual([]);
    expect(events).toHaveLength(0);
    expect(engine.stateManager.getState().minefields['9,9'].strength).toBe(6);
    expect(mech.armor.rightLeg.front).toBe(41);
  });

  it('triggers a field that is walked through, not just the destination', () => {
    const { engine } = minedEngine({ fields: { '5,6': { type: 'light', strength: 1 } } });
    engine.diceRoller = queueRoller([9, 7]);

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6', '5,7'], movementType: 'walk'
    });

    expect(result.finalHex).toBe('5,7');
    expect(result.minefields.map(hit => hit.hexKey)).toEqual(['5,6']);
  });

  it('ignores a field jumped over but triggers the landing hex', () => {
    const { engine } = minedEngine({
      unit: 'jenner-jr7d',
      fields: {
        '5,6': { type: 'light', strength: 1 },
        '5,7': { type: 'light', strength: 1 }
      }
    });
    engine.diceRoller = queueRoller([9, 7]);

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6', '5,7'], movementType: 'jump'
    });

    expect(result.finalHex).toBe('5,7');
    expect(result.minefields.map(hit => hit.hexKey)).toEqual(['5,7']);
  });

  it('leaves the field and Mech alone when the attack misses', () => {
    const { engine, mech } = minedEngine({ fields: { '5,6': { type: 'light', strength: 2 } } });
    engine.diceRoller = queueRoller([8]);

    const events = [];
    engine.eventBus.on('minefieldTriggered', event => events.push(event));

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'walk'
    });

    expect(result.minefields[0]).toMatchObject({ triggered: false, roll: 8 });
    expect(events[0].hits).toEqual([]);
    expect(mech.armor.rightLeg.front).toBe(41);
    expect(engine.stateManager.getState().minefields['5,6'].strength).toBe(2);
  });
});
