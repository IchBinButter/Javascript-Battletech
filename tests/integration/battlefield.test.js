/**
 * Battlefield rules through the engine: terrain modifications (p61), weather
 * (p62-63) and fire/smoke (p63-64).
 */

import { describe, it, expect } from 'vitest';
import { createTestEngine, createTestUnit, createWeaponDef, makeDiceRoller } from '../helpers/testUtils.js';
import { Hex } from '../../src/models/Hex.js';

/**
 * Dice that hand out fixed sequences: 2D6 results from twoD6, 1D6 results (the
 * critical-hit block and slot rolls) from oneD6. Values repeat when a list runs
 * out so a test can leave the tail of a sequence unspecified.
 */
function makeQueuedRoller({ twoD6 = [7], oneD6 = [1] } = {}) {
  let i2 = 0;
  let i1 = 0;
  return {
    roll2d6() { return twoD6[Math.min(i2++, twoD6.length - 1)]; },
    roll1d6() { return oneD6[Math.min(i1++, oneD6.length - 1)]; },
    next() { return 0.5; }
  };
}

function engineWith({ playerHex = '5,5', targetHex = '5,4', weather = null } = {}) {
  const attacker = createTestUnit('atlas-as7d', 0, 'atlas');
  const target = createTestUnit('locust-lct1v', 1, 'locust');
  attacker.position = { hexKey: playerHex, facing: 0 };
  target.position = { hexKey: targetHex, facing: 3 };

  const engine = createTestEngine({ units: { atlas: attacker, locust: target } });
  if (weather) engine.stateManager.getState().weather = weather;
  return { engine, attacker, target };
}

describe('terrain modifications (p61)', () => {
  it('ice forces a PSR that can put the Mech on the ground', () => {
    const unit = createTestUnit('locust-lct1v', 0, 'locust');
    unit.position = { hexKey: '4,5', facing: 2 }; // facing the ice hex

    const engine = createTestEngine({ units: { locust: unit } });
    engine.diceRoller = makeDiceRoller(7); // 5 piloting + 3 ice = 8, so 7 fails
    engine.stateManager.getState().map.hexes.get('5,5').modifiers.ice = true;

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(result.success).toBe(true);
    expect(unit.prone).toBe(true);
  });
});

describe('weather conditions (p62)', () => {
  it('adds the night modifier to weapon attacks', () => {
    const { engine, attacker, target } = engineWith({ weather: { light: 'moonless' } });
    const calc = engine.attackResolver.calculateTargetNumber(
      attacker, createWeaponDef('med_laser'), target, engine.stateManager.getState(), {}
    );

    expect(calc.modifiers).toContain('Weather: +3');
  });

  it('penalises PSRs in heavy rain', () => {
    const unit = createTestUnit('locust-lct1v', 0, 'locust');
    unit.position = { hexKey: '4,5', facing: 2 };

    const engine = createTestEngine({ units: { locust: unit } });
    engine.diceRoller = makeDiceRoller(5); // 5 piloting + 1 rain = 6, so 5 fails
    engine.stateManager.getState().weather = { precipitation: 'heavy_rain' };

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    expect(unit.prone).toBe(true);
  });

  it('charges extra MP in heavy fog', () => {
    const unit = createTestUnit('locust-lct1v', 0, 'locust');
    unit.position = { hexKey: '4,5', facing: 2 };

    const engine = createTestEngine({ units: { locust: unit } });
    engine.stateManager.getState().weather = { fog: 'heavy' };

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;

    const result = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,5', '5,5'], movementType: 'walk'
    });

    // 1 MP to enter + 2 for heavy fog.
    expect(result.success).toBe(true);
    expect(result.remainingMP).toBe(unit.currentMP - 3);
  });
});

describe('fire and smoke (p63-64)', () => {
  const burning = () => {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas');
    const target = createTestUnit('locust-lct1v', 1, 'locust');
    attacker.position = { hexKey: '5,5', facing: 0 };
    target.position = { hexKey: '5,4', facing: 3 };

    const engine = createTestEngine({ units: { atlas: attacker, locust: target } });
    engine.diceRoller = makeDiceRoller(7);
    engine.stateManager.getState().map.hexes.get('5,4').terrainType = 'light_woods';

    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'locust',
      weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
    });

    return { engine, target };
  };

  it('ignites a woods hex when a laser hits it', () => {
    const { engine } = burning();
    const state = engine.stateManager.getState();

    engine.resolveEndPhaseFire();

    expect(state.fireHexes).toContain('5,4');
    // Smoke fills the two hexes downwind.
    expect(Object.keys(state.smokeHexes).length).toBe(2);
  });

  it('adds 5 heat to a Mech standing in a burning hex (p50)', () => {
    const { engine, target } = burning();
    const state = engine.stateManager.getState();
    const armourBefore = JSON.stringify(target.armor);

    engine.resolveEndPhaseFire();
    expect(state.fireHexes).toContain('5,4');

    // p50: "During the Heat Phase, a 'Mech in a burning hex absorbs an
    // additional 5 Heat Points." Fire causes heat, never armour damage.
    const sinks = target.getHeatDissipation();
    target.heat = sinks;

    const results = engine.heatManager.resolveHeatPhase(state, engine.diceRoller);
    const result = results.find(r => r.unitId === 'locust');

    expect(result.fireHeat).toBe(5);
    expect(result.outsideHeat).toBe(5);
    expect(result.effects).toContain('Fire: +5 heat');
    expect(target.heat).toBe(5); // sinks + 5 fire - sinks dissipation
    expect(JSON.stringify(target.armor)).toBe(armourBefore);
  });

  it('adds 2 heat for each burning hex the Mech moved through (p50)', () => {
    const mover = createTestUnit('locust-lct1v', 0, 'locust');
    mover.position = { hexKey: '4,4', facing: 2 };

    const engine = createTestEngine({ units: { locust: mover } });
    engine.diceRoller = makeDiceRoller(7);
    const state = engine.stateManager.getState();
    state.fireHexes = ['5,4'];

    engine.phaseManager.enterPhase('movement');
    engine.phaseManager.clearQueue();
    state.currentPlayer = 0;

    const move = engine.processAction(0, {
      type: 'move', unitId: 'locust', path: ['4,4', '5,4', '6,4'], movementType: 'walk'
    });
    expect(move.success).toBe(true);
    // The Mech walked through the burning hex but ended outside it.
    expect(mover.position.hexKey).toBe('6,4');

    const sinks = mover.getHeatDissipation();
    mover.heat = sinks;

    const results = engine.heatManager.resolveHeatPhase(state, engine.diceRoller);
    const result = results.find(r => r.unitId === 'locust');

    // p50: "A 'Mech also absorbs 2 Heat Points for each burning hex it moved
    // through during the Movement Phase."
    expect(result.fireHeat).toBe(2);
    expect(result.outsideHeat).toBe(2);
    expect(mover.heat).toBe(2); // sinks + 2 fire - sinks dissipation
  });

  it('does not repeat heat from burning hexes moved through in an earlier turn', () => {
    const mover = createTestUnit('locust-lct1v', 0, 'locust');
    mover.position = { hexKey: '6,4', facing: 2 };
    mover._burningHexesMovedThrough = { turn: 0, hexes: ['5,4'] };

    const engine = createTestEngine({ units: { locust: mover } });
    engine.diceRoller = makeDiceRoller(7);
    const state = engine.stateManager.getState();
    state.fireHexes = ['5,4'];
    state.turn = 2;

    const results = engine.heatManager.resolveHeatPhase(state, engine.diceRoller);
    const result = results.find(r => r.unitId === 'locust');

    expect(result.fireHeat).toBe(0);
    expect(result.outsideHeat).toBe(0);
  });

  it('lands the fire heat in the engine Heat Phase (p50)', () => {
    const { engine, target } = burning();
    const state = engine.stateManager.getState();

    engine.resolveEndPhaseFire(); // 5,4 is now burning under the Locust

    const sinks = target.getHeatDissipation();
    target.heat = sinks;

    // The Heat Phase is where fire is absorbed, before dissipation.
    engine.phaseManager.enterPhase('heat');

    expect(state.fireHexes).toContain('5,4');
    expect(target.heat).toBe(5); // sinks + 5 fire - sinks dissipation
  });

  it('caps cumulative outside heat at 15 per turn (p50)', () => {
    const { engine, target } = burning();
    const state = engine.stateManager.getState();

    engine.resolveEndPhaseFire(); // 5,4 is now burning under the Locust
    target._externalHeat = 10; // plasma and other outside sources share the cap
    state.weather = { temperature: 100 }; // extreme heat adds another 5

    const results = engine.heatManager.resolveHeatPhase(state, engine.diceRoller);
    const result = results.find(r => r.unitId === 'locust');

    // 5 fire + 10 plasma + 5 weather = 20, capped to 15.
    expect(result.fireHeat).toBe(5);
    expect(result.outsideHeat).toBe(15);
  });

  it('costs a burning building 2 CF per End Phase', () => {
    const { engine } = burning();
    const state = engine.stateManager.getState();
    const hex = state.map.hexes.get('5,4');
    hex.terrainType = 'clear';
    hex.building = { id: 'b1', type: 'light', levels: 1, cf: 15, currentCF: 15 };

    engine.resolveEndPhaseFire();

    expect(state.fireHexes).toContain('5,4');
    expect(hex.building.currentCF).toBe(13);
  });
});

// =============================================================================
// Engine state changes (follow-up from the damage task)
// =============================================================================

describe('through-armour criticals land inside the state change (p32/p139)', () => {
  function tacEngine() {
    const attacker = createTestUnit('atlas-as7d', 0, 'atlas');
    const target = createTestUnit('jenner-jr7d', 1, 'jenner');
    attacker.position = { hexKey: '5,5', facing: 0 };
    target.position = { hexKey: '5,4', facing: 3 };

    const engine = createTestEngine({ units: { atlas: attacker, jenner: target } });
    engine.phaseManager.enterPhase('weapon_attack');
    engine.phaseManager.clearQueue();
    engine.stateManager.getState().currentPlayer = 0;
    return { engine, attacker, target };
  }

  it('records the crit in the action, so history, diff and undo all see it', () => {
    const { engine, target } = tacEngine();
    // Attack 12 (hit), hit location 2 = centre torso [critical], crit roll 9
    // (one critical), block 1 / slot 1 = the first engine slot.
    engine.diceRoller = makeQueuedRoller({ twoD6: [12, 2, 9], oneD6: [1, 1] });

    const armourBefore = target.getArmor('centerTorso');
    const result = engine.processAction(0, {
      type: 'fire', attackerId: 'atlas', targetId: 'jenner',
      weapon: createWeaponDef('med_laser'), weaponLocation: 'rightArm'
    });

    expect(result.hit).toBe(true);
    expect(result.hitLocations[0].location).toBe('centerTorso');
    expect(result.hitLocations[0].critical).toBe(true);
    expect(result.hitLocations[0].throughArmorCritical.roll).toBe(9);
    expect(target.engine.hits).toBe(1);

    // The snapshot taken before the action must not already contain the crit:
    // the TAC has to be part of this state change, not of the pre-change state.
    const snapshot = engine.stateManager._history[engine.stateManager._historyIndex];
    expect(snapshot.getUnit('jenner').engine.hits).toBe(0);
    expect(snapshot.getUnit('jenner').getArmor('centerTorso')).toBe(armourBefore);

    // The diff from that snapshot to the live state carries the critical.
    const diff = engine.stateManager.getStateDiff(snapshot, engine.stateManager.getState());
    expect(diff.unitUpdates.jenner.engine.hits).toBe(1);
    expect(diff.unitUpdates.jenner.armor.centerTorso.front).toBe(armourBefore - 5);

    // Undo rolls the whole action back - the crit included.
    engine.stateManager.undo();
    const reverted = engine.stateManager.getState().getUnit('jenner');
    expect(reverted.engine.hits).toBe(0);
    expect(reverted.getArmor('centerTorso')).toBe(armourBefore);
  });
});
