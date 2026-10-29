/**
 * Minefields and battlefield support through the real engine (BMM p.75-79):
 * movement triggers, End Phase scheduled strikes, expiry and wire-safe events.
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit } from '../helpers/testUtils.js';
import { placeMinefield } from '../../src/rules/battlefield/Minefields.js';
import {
  scheduledStrikes, scatterDestination
} from '../../src/rules/battlefield/BattlefieldSupport.js';

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

/** Mirrors tests/engine/wire.test.js: throws on anything JSON cannot carry. */
function assertPlain(value, path = 'payload') {
  if (value === null || value === undefined) return;

  const kind = typeof value;
  if (kind === 'function') throw new Error(`function at ${path}`);
  if (kind !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlain(entry, `${path}[${index}]`));
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${value.constructor ? value.constructor.name : 'class'} instance at ${path}`);
  }

  for (const [key, entry] of Object.entries(value)) {
    assertPlain(entry, `${path}.${key}`);
  }
}

function movementEngine({ unit = 'atlas-as7d', hexKey = '5,5', facing = 3, fields = {}, unitId = 'mover', hidden = false } = {}) {
  const mech = createTestUnit(unit, 0, unitId);
  mech.position = { hexKey, facing };

  const engine = createTestEngine({ units: { [unitId]: mech } });
  const state = engine.stateManager.getState();
  for (const [key, field] of Object.entries(fields)) {
    placeMinefield(state, key, field.type, { strength: field.strength });
  }
  if (hidden) state.hiddenUnits = { [unitId]: { hidden: true } };

  engine.phaseManager.enterPhase('movement');
  engine.phaseManager.clearQueue();
  state.currentPlayer = 0;

  return { engine, mech };
}

function collect(engine, eventName) {
  const events = [];
  engine.eventBus.on(eventName, payload => events.push(payload));
  return events;
}

describe('minefields during movement', () => {
  it('attacks the Mech, reports the trigger and reduces the field', () => {
    const { engine, mech } = movementEngine({ fields: { '5,6': { type: 'light', strength: 2 } } });
    engine.diceRoller = queueRoller([9, 1, 2]);
    const events = collect(engine, 'minefieldTriggered');

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    // Two 5-point groupings on the right leg (p139 front Kick column, 1-3).
    expect(mech.armor.rightLeg.front).toBe(31); // 41 - 10
    expect(engine.stateManager.getState().minefields['5,6'].strength).toBe(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      unitId: 'mover', hexKey: '5,6', type: 'light', triggered: true, roll: 9
    });
    expect(() => assertPlain(events[0], 'minefieldTriggered')).not.toThrow();
    expect(JSON.parse(JSON.stringify(events[0]))).toEqual(events[0]);
  });

  it('does not trigger on a clear hex and never rolls dice', () => {
    const { engine, mech } = movementEngine({ fields: { '9,9': { type: 'heavy', strength: 6 } } });
    engine.diceRoller = forbiddenRoller();
    const events = collect(engine, 'minefieldTriggered');

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(result.minefields).toEqual([]);
    expect(events).toHaveLength(0);
    expect(mech.armor.rightLeg.front).toBe(41);
  });

  it('keeps minefields in plain state that round-trips through toJSON', () => {
    const { engine } = movementEngine({ fields: { '5,6': { type: 'medium', strength: 4 } } });
    const wire = JSON.parse(JSON.stringify(engine.stateManager.getState().toJSON()));

    expect(wire.minefields['5,6']).toEqual({ type: 'medium', strength: 4 });
  });
});

describe('hidden Mech minefield exit (p82)', () => {
  const walkOut = (engine) => engine.processAction(0, {
    type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'walk'
  });

  it('attacks a hidden Mech that walks out of a mined hex and reveals it', () => {
    const { engine, mech } = movementEngine({
      hexKey: '5,5',
      fields: { '5,5': { type: 'light', strength: 2 } },
      hidden: true
    });
    engine.diceRoller = queueRoller([9, 1, 2]);
    const events = collect(engine, 'minefieldTriggered');

    const result = walkOut(engine);

    expect(result.success).toBe(true);
    // The move itself reveals the hidden Mech (p82); the exit trigger is the
    // hidden-'Mech exception that makes its starting hex attack.
    expect(engine.stateManager.getState().hiddenUnits.mover.hidden).toBe(false);
    expect(result.minefields).toHaveLength(1);
    expect(result.minefields[0]).toMatchObject({ unitId: 'mover', hexKey: '5,5', triggered: true });
    expect(engine.stateManager.getState().minefields['5,5'].strength).toBe(1);
    // Two 5-point groups on the right leg (p139 front Kick column, 1-3).
    expect(mech.armor.rightLeg.front).toBe(31);
    expect(events).toHaveLength(1);
    expect(events[0].hexKey).toBe('5,5');
  });

  it('gives a visible Mech no exit trigger from the hex it started in', () => {
    const { engine } = movementEngine({
      hexKey: '5,5',
      fields: { '5,5': { type: 'light', strength: 2 } }
    });
    engine.diceRoller = forbiddenRoller();

    const result = walkOut(engine);

    expect(result.success).toBe(true);
    expect(result.minefields).toEqual([]);
  });

  it('attacks a hidden Mech that runs out of a mined hex too', () => {
    const { engine } = movementEngine({
      hexKey: '5,5',
      fields: { '5,5': { type: 'light', strength: 2 } },
      hidden: true
    });
    engine.diceRoller = queueRoller([9, 1, 2]);

    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'run'
    });

    expect(result.success).toBe(true);
    expect(result.minefields).toHaveLength(1);
    expect(result.minefields[0]).toMatchObject({ hexKey: '5,5', triggered: true });
  });

  it('gives a hidden Mech no exit trigger when it jumps out instead', () => {
    const { engine } = movementEngine({
      unit: 'jenner-jr7d',
      hexKey: '5,5',
      facing: 3,
      fields: { '5,5': { type: 'light', strength: 2 } },
      hidden: true
    });
    engine.diceRoller = forbiddenRoller();

    // p82: the minefields attack if the hidden 'Mech tries to walk or run out.
    const result = engine.processAction(0, {
      type: 'move', unitId: 'mover', path: ['5,5', '5,6'], movementType: 'jump'
    });

    expect(result.success).toBe(true);
    expect(result.minefields).toEqual([]);
  });
});

describe('scheduled battlefield support', () => {
  it('resolves in the End Phase of its turn, applies damage and expires', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.position = { hexKey: '5,5', facing: 0 };
    const engine = createTestEngine({ units: { atlas } });
    engine.diceRoller = queueRoller([5, 2, 7, 8]);

    const events = collect(engine, 'supportStrikeResolved');
    engine.scheduleSupportStrike({ hexKey: '5,5', turn: 1, type: 'light_strike', owner: 1 });

    // Not before the End Phase.
    engine.phaseManager.enterPhase('weapon_attack');
    expect(events).toHaveLength(0);
    expect(scheduledStrikes(engine.stateManager.getState())).toHaveLength(1);

    engine.phaseManager.enterPhase('end');

    expect(events).toHaveLength(1);
    expect(scheduledStrikes(engine.stateManager.getState())).toHaveLength(0);
    expect(events[0]).toMatchObject({
      type: 'light_strike', targetNumber: 5, roll: 5, success: true, attackDirection: 'front'
    });
    expect(events[0].hits).toHaveLength(2);
    expect(atlas.armor.centerTorso.front).toBe(42); // front table 7
    expect(atlas.armor.leftTorso.front).toBe(27); // front table 8

    expect(() => assertPlain(events[0], 'supportStrikeResolved')).not.toThrow();
    expect(JSON.parse(JSON.stringify(events[0]))).toEqual(events[0]);
  });

  it('waits for its turn and expires anyway', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.position = { hexKey: '5,5', facing: 0 };
    const engine = createTestEngine({ units: { atlas } });
    engine.diceRoller = forbiddenRoller();

    const events = collect(engine, 'supportStrikeResolved');
    engine.scheduleSupportStrike({ hexKey: '5,5', turn: 2, type: 'light_strike' });

    engine.phaseManager.enterPhase('end'); // turn 1
    expect(events).toHaveLength(0);
    expect(scheduledStrikes(engine.stateManager.getState())).toHaveLength(1);

    const state = engine.stateManager.getState();
    state.turn = 2;
    engine.diceRoller = queueRoller([5, 2, 7, 7]);
    engine.phaseManager.enterPhase('end'); // turn 2

    expect(events).toHaveLength(1);
    expect(scheduledStrikes(state)).toHaveLength(0);
  });

  it('scatters a bombing miss onto another unit and still expires', () => {
    const target = createTestUnit('jenner-jr7d', 1, 'target');
    target.position = { hexKey: '5,5', facing: 0 };
    const bystander = createTestUnit('atlas-as7d', 0, 'bystander');
    bystander.position = { hexKey: '5,6', facing: 0 };

    const engine = createTestEngine({ units: { target, bystander } });
    // Heavy bombing TN 7, roll 6 (MoF 1), scatter direction 4 = south.
    engine.diceRoller = queueRoller([6, 4, 7, 7, 7, 7, 7, 7]);

    const events = collect(engine, 'supportStrikeResolved');
    engine.scheduleSupportStrike({ hexKey: '5,5', turn: 1, type: 'heavy_bombing' });
    engine.phaseManager.enterPhase('end');

    expect(events).toHaveLength(1);
    expect(events[0].success).toBe(false);
    expect(events[0].scatter).toEqual({
      marginOfFailure: 1,
      directionRoll: 4,
      direction: 'S',
      hexKey: scatterDestination('5,5', 4, 1)
    });
    expect(events[0].scatter.hexKey).toBe('5,6');
    expect(events[0].hits).toHaveLength(6);
    expect(events[0].hits.every(hit => hit.unitId === 'bystander' && hit.automatic)).toBe(true);
    // The original target is untouched; the Atlas in the scattered hex takes all 30 points.
    expect(target.armor.centerTorso.front).toBe(10);
    expect(bystander.armor.centerTorso.front).toBe(17);
    expect(scheduledStrikes(engine.stateManager.getState())).toHaveLength(0);
  });

  it('records the acting player as the default owner and spends the BSP cost', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.position = { hexKey: '5,5', facing: 0 };
    const engine = createTestEngine({ units: { atlas } });
    const state = engine.stateManager.getState();
    state.currentPlayer = 1;

    const events = collect(engine, 'supportStrikeScheduled');
    const result = engine.scheduleSupportStrike({
      hexKey: '5,5', turn: 2, type: 'light_strike'
    });

    expect(result).toMatchObject({
      success: true,
      strike: { hexKey: '5,5', turn: 2, type: 'light_strike', owner: 1 }
    });
    expect(state.battlefieldSupport.points).toBe(10); // 12 - light strike's 2 BSP
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(result.strike);
    expect(JSON.parse(JSON.stringify(events[0]))).toEqual(events[0]);
  });

  it('refuses a strike it cannot pay for and leaves the pool untouched', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.position = { hexKey: '5,5', facing: 0 };
    const engine = createTestEngine({ units: { atlas } });
    const state = engine.stateManager.getState();
    state.battlefieldSupport.points = 1;

    const events = collect(engine, 'supportStrikeScheduled');
    const result = engine.scheduleSupportStrike({
      hexKey: '5,5', turn: 1, type: 'heavy_strike'
    });

    expect(result.success).toBe(false);
    expect(result.error)
      .toMatch(/Not enough Battlefield Support Points for Heavy Strike: 1 available, 3 needed/);
    expect(scheduledStrikes(state)).toHaveLength(0);
    expect(state.battlefieldSupport.points).toBe(1);
    expect(events).toHaveLength(0);
  });

  it('serialises scheduled strikes through GameState.toJSON', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas');
    atlas.position = { hexKey: '5,5', facing: 0 };
    const engine = createTestEngine({ units: { atlas } });
    engine.scheduleSupportStrike({ hexKey: '5,5', turn: 2, type: 'sniper', owner: 1 });

    const wire = JSON.parse(JSON.stringify(engine.stateManager.getState().toJSON()));
    expect(wire.battlefieldSupport.strikes).toEqual([
      { hexKey: '5,5', turn: 2, type: 'sniper', owner: 1 }
    ]);
    expect(wire.battlefieldSupport.points).toBe(8); // 12 - sniper's 4 BSP
  });
});
