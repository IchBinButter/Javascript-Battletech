import { describe, it, expect } from 'vitest';
import {
  createTestEngine,
  createTestUnit,
  createWeaponDef,
  makeDiceRoller,
  makeSequencedDiceRoller,
  advanceToPhase
} from '../helpers/testUtils.js';

function setupHeatTest(heatLevel, mechId = 'atlas-as7d', hexKey = '7,7', sinkCount = 0) {
  const mech = createTestUnit(mechId, 0, 'mech-0');
  mech.heat = heatLevel;
  mech.position = { hexKey, facing: 0 };
  mech.heatSinks = { count: sinkCount, damaged: 0, type: 'single' };
  if (!mech.equipment.other) mech.equipment.other = {};

  const engine = createTestEngine({
    units: { 'mech-0': mech }
  });

  return { engine, mech };
}

function enterHeatPhaseAndResolve(engine, diceRoller) {
  engine.diceRoller = diceRoller;
  advanceToPhase(engine, 'heat');
}

// =========================================================================
// HEAT SCALE - SIMPLIFIED (no auto targets)
// =========================================================================

describe('Heat thresholds 14-24+ (integration)', () => {
  it.each([
    [0,  3],
    [4,  3],
    [5,  2],
    [9,  2],
    [10, 1],
    [14, 1],
    [15, 0],
    [19, 0],
    [20, 0],
    [23, 0],
    [24, 0],
    [30, 0],
  ])('heat %i: expectedMP=%i after heat phase (0 sinks)', (heat, expectedMP) => {
    const { engine, mech } = setupHeatTest(heat, 'atlas-as7d', '7,7', 0);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.currentMP).toBe(expectedMP);
  });

  it('heat 24: auto shutdown + auto ammo, MP clamped to 0', () => {
    const { engine, mech } = setupHeatTest(24, 'atlas-as7d', '7,7', 0);
    mech.equipment.ammo = { ac5: { shots: 5 } };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.shutdown).toBe(true);
    expect(mech.currentMP).toBe(0);
    expect(mech.equipment.ammo.ac5.shots).toBe(0);
  });

  it('heat 30: auto shutdown + auto ammo, all bins drained', () => {
    const { engine, mech } = setupHeatTest(30, 'atlas-as7d', '7,7', 0);
    mech.equipment.ammo = { lrm15: { shots: 10 }, sr6: { shots: 5 } };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.shutdown).toBe(true);
    expect(mech.currentMP).toBe(0);
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
    expect(mech.equipment.ammo.sr6.shots).toBe(0);
  });

  it('heat 0-13: no shutdown, no ammo, full MP preserved', () => {
    for (const heat of [0, 5, 8, 10, 13]) {
      const { engine, mech } = setupHeatTest(heat, 'atlas-as7d', '7,7', 0);
      mech.equipment.ammo = { lrm15: { shots: 10 } };

      enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

      expect(mech.shutdown, `heat=${heat} shutdown`).toBe(false);
      expect(mech.equipment.ammo.lrm15.shots, `heat=${heat} ammo`).toBe(10);
      expect(mech.currentMP, `heat=${heat} MP`).toBe(3);
    }
  });

  it('heat 18 with standard atlas sinks: 18 - 20 = 0 heat, no effects', () => {
    const { engine, mech } = setupHeatTest(18, 'atlas-as7d', '7,7', 20);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(0);
    expect(mech.currentMP).toBe(3);
    expect(mech.shutdown).toBe(false);
  });

  it('heat 40 with standard atlas sinks: 40 - 20 = 20 heat, effects apply', () => {
    const { engine, mech } = setupHeatTest(40, 'atlas-as7d', '7,7', 20);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(20);
    expect(mech.currentMP).toBe(0);
  });

  it('currentMP is never negative even at extreme heat with no sinks', () => {
    const { engine, mech } = setupHeatTest(40, 'atlas-as7d', '7,7', 0);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.currentMP).toBe(0);
  });
});

// =========================================================================
// AMMO EXPLOSION ROLLS (escalating targets)
// =========================================================================

describe('Ammo explosion escalating targets (integration)', () => {
  function setupAmmoMech(heatLevel) {
    const mech = createTestUnit('atlas-as7d', 0, 'ammo-mech');
    mech.heat = heatLevel;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };
    mech.equipment.ammo = { lrm15: { shots: 10 } };

    const engine = createTestEngine({
      units: { 'ammo-mech': mech }
    });

    return { engine, mech };
  }

  it('heat 19 (ammo target 4+): roll 4 triggers, roll 3 does not', () => {
    const { engine } = setupAmmoMech(19);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(4));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);

    const { engine: engine2 } = setupAmmoMech(19);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(3));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.equipment.ammo.lrm15.shots).toBe(10);
  });

  it('heat 20 (ammo target 6+): roll 6 triggers, roll 5 does not', () => {
    const { engine } = setupAmmoMech(20);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(6));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);

    const { engine: engine2 } = setupAmmoMech(20);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(5));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.equipment.ammo.lrm15.shots).toBe(10);
  });

  it('heat 21 (ammo target 8+): roll 8 triggers, roll 7 does not', () => {
    const { engine } = setupAmmoMech(21);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(8));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);

    const { engine: engine2 } = setupAmmoMech(21);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(7));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.equipment.ammo.lrm15.shots).toBe(10);
  });

  it('heat 22 (ammo target 10+): roll 10 triggers, roll 9 does not', () => {
    const { engine } = setupAmmoMech(22);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(10));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);

    const { engine: engine2 } = setupAmmoMech(22);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(9));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.equipment.ammo.lrm15.shots).toBe(10);
  });

  it('heat 23 (ammo target 12+): roll 12 triggers, roll 11 does not', () => {
    const { engine } = setupAmmoMech(23);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(12));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);

    const { engine: engine2 } = setupAmmoMech(23);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(11));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.equipment.ammo.lrm15.shots).toBe(10);
  });

  it('heat 24+ auto ammo: all bins drained regardless of roll', () => {
    const { engine, mech } = setupAmmoMech(26);
    mech.equipment.ammo = { ac5: { shots: 10 }, lrm15: { shots: 15 }, sr6: { shots: 20 } };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(12));

    expect(mech.equipment.ammo.ac5.shots).toBe(0);
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
    expect(mech.equipment.ammo.sr6.shots).toBe(0);
  });

  it('ammo bins with 0 shots are skipped', () => {
    const { engine, mech } = setupAmmoMech(24);
    mech.equipment.ammo = {
      empty: { shots: 0 },
      lrm15: { shots: 10 }
    };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(12));

    expect(mech.equipment.ammo.empty.shots).toBe(0);
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
  });

  it('ammo explosion drains all ammo types', () => {
    const { engine, mech } = setupAmmoMech(24);
    mech.equipment.ammo = {
      ac5: { shots: 10 },
      lrm15: { shots: 15 },
      sr4: { shots: 25 }
    };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.equipment.ammo.ac5.shots).toBe(0);
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
    expect(mech.equipment.ammo.sr4.shots).toBe(0);
  });
});

// =========================================================================
// SHUTDOWN ROLLS (escalating targets)
// =========================================================================

describe('Shutdown escalating targets (integration)', () => {
  function setupShutdownMech(heatLevel) {
    const mech = createTestUnit('atlas-as7d', 0, 'sd-mech');
    mech.heat = heatLevel;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };

    const engine = createTestEngine({
      units: { 'sd-mech': mech }
    });

    return { engine, mech };
  }

  it('heat 20 (target 4+): roll 3 < 4 causes shutdown, roll 4 avoids', () => {
    const { engine } = setupShutdownMech(20);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(3));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(true);

    const { engine: engine2 } = setupShutdownMech(20);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(4));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.shutdown).toBe(false);
  });

  it('heat 21 (target 6+): roll 5 < 6 shutdown, roll 6 avoids', () => {
    const { engine } = setupShutdownMech(21);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(5));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(true);

    const { engine: engine2 } = setupShutdownMech(21);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(6));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.shutdown).toBe(false);
  });

  it('heat 22 (target 8+): roll 7 < 8 shutdown, roll 8 avoids', () => {
    const { engine } = setupShutdownMech(22);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(true);

    const { engine: engine2 } = setupShutdownMech(22);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(8));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.shutdown).toBe(false);
  });

  it('heat 23 (target 10+): roll 9 < 10 shutdown, roll 10 avoids', () => {
    const { engine } = setupShutdownMech(23);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(9));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(true);

    const { engine: engine2 } = setupShutdownMech(23);
    enterHeatPhaseAndResolve(engine2, makeDiceRoller(10));
    const mech2 = Object.values(engine2.stateManager.getState().units)[0];
    expect(mech2.shutdown).toBe(false);
  });

  it('heat 24+ targets: auto shutdown regardless of roll', () => {
    const { engine } = setupShutdownMech(30);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(12));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(true);
  });

  it('roll 12 always avoids shutdown for numeric targets', () => {
    const { engine } = setupShutdownMech(23);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(12));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(false);
  });

  it('roll 2 always fails to avoid shutdown for any numeric target', () => {
    const { engine } = setupShutdownMech(20);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(2));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    expect(mech.shutdown).toBe(true);
  });
});

// =========================================================================
// TSM (TRIPLE STRENGTH MYOMER) +2 WALK MP
// =========================================================================

describe('TSM +2 walk MP (integration through engine)', () => {
  function setupTSMMech(heatLevel) {
    const mech = createTestUnit('atlas-as7d', 0, 'tsm-mech');
    mech.heat = heatLevel;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };
    mech.equipment.other = { tsm: true };

    const engine = createTestEngine({
      units: { 'tsm-mech': mech }
    });

    return { engine, mech };
  }

  it('heat 9 (exact activation): walk MP 3 + 2 = 5', () => {
    const { engine, mech } = setupTSMMech(9);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(5);
  });

  it('heat 10 (above threshold): walk MP 3 + 2 = 5', () => {
    const { engine, mech } = setupTSMMech(10);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(5);
  });

  it('heat 13 (max before MP penalties): walk MP 3 + 2 = 5', () => {
    const { engine, mech } = setupTSMMech(13);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(5);
  });

  it('heat 8 (below activation): no TSM bonus, MP stays at 3', () => {
    const { engine, mech } = setupTSMMech(8);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(3);
  });

  it('heat 0: no TSM, MP stays at 3', () => {
    const { engine, mech } = setupTSMMech(0);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(3);
  });

  it('heat 18: offsets penalty (3 - 1 + 2 = 4)', () => {
    const { engine, mech } = setupTSMMech(18);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(4);
  });

  it('heat 19: offsets penalty (3 - 2 + 2 = 3)', () => {
    const { engine, mech } = setupTSMMech(19);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(3);
  });

  it('heat 20: offsets penalty (3 - 3 + 2 = 2)', () => {
    const { engine, mech } = setupTSMMech(20);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(2);
  });

  it('heat 21: offsets penalty (3 - 4 + 2 = 1)', () => {
    const { engine, mech } = setupTSMMech(21);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(1);
  });

  it('heat 22+: flooring to 0 (3 - 5 + 2 = 0)', () => {
    const { engine, mech } = setupTSMMech(22);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(0);
  });

  it('heat 23+: flooring to 0 (3 - 6 + 2 = 0)', () => {
    const { engine, mech } = setupTSMMech(23);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(0);
  });

  it('heat 24+: cannot overcome MP floor of 0', () => {
    const { engine, mech } = setupTSMMech(25);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(0);
  });

  it('no TSM equipment: heat 12 gives no bonus', () => {
    const { engine, mech } = setupTSMMech(12);
    mech.equipment.other = {};
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(3);
  });

  it('Jenner with TSM at heat 9: walk MP 7 + 2 = 9', () => {
    const mech = createTestUnit('jenner-jr7d', 0, 'tsm-jenner');
    mech.heat = 9;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };
    mech.equipment.other = { tsm: true };

    const engine = createTestEngine({
      units: { 'tsm-jenner': mech }
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(9);
  });
});

// =========================================================================
// WATER SINKS — doubled dissipation for leg-mounted sinks
// =========================================================================

describe('Water sinks integration (leg heat sink dissipation bonus)', () => {
  function setupWaterMech(heatLevel, terrainType, legSlots = {}) {
    const mech = createTestUnit('atlas-as7d', 0, 'water-mech');
    mech.heat = heatLevel;
    mech.heatSinks = { count: 10, damaged: 0, type: 'single' };
    mech.position = { hexKey: '7,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'water-mech': mech }
    });

    const mapHexes = engine.stateManager.getState().map.hexes;
    mapHexes.set('7,7', {
      hexKey: '7,7',
      terrainType,
      level: 0,
      getHeight() { return 0; },
      modifiers: {}
    });

    mech.criticalSlots = {
      leftLeg: (legSlots.leftLeg || []).map(status => ({ item: 'heat_sink', status })),
      rightLeg: (legSlots.rightLeg || []).map(status => ({ item: 'heat_sink', status }))
    };

    return { engine, mech };
  }

  it('water_depth1 doubles leg sink dissipation: 10 base + 3 leg = 13 total', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: ['ok', 'ok'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(17);
  });

  it('water_depth2 doubles leg sink dissipation: 10 base + 3 leg = 13 total', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth2', {
      leftLeg: ['ok', 'ok'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(17);
  });

  it('no water bonus on clear terrain', () => {
    const { engine, mech } = setupWaterMech(30, 'clear', {
      leftLeg: ['ok', 'ok'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(20);
  });

  it('no water bonus on light_woods terrain', () => {
    const { engine, mech } = setupWaterMech(30, 'light_woods', {
      leftLeg: ['ok'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(20);
  });

  it('no water bonus when unit has no criticalSlots', () => {
    const { engine, mech } = setupWaterMech(25, 'water_depth1');
    delete mech.criticalSlots;

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(15);
  });

  it('damaged leg sinks do not provide water bonus', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: ['ok', 'crit'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(18);
  });

  it('all damaged leg sinks: no bonus, base 10 dissipation', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: ['crit'],
      rightLeg: ['crit']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(20);
  });

  it('water bonus stacks with double heat sinks correctly', () => {
    const { engine, mech } = setupWaterMech(40, 'water_depth1', {
      leftLeg: ['ok', 'ok'],
      rightLeg: ['ok']
    });
    mech.heatSinks = { count: 10, damaged: 0, type: 'double' };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(17);
  });

  it('Jenner in water: 10 base + leg sinks doubled', () => {
    const { engine, mech } = setupWaterMech(25, 'water_depth1', {
      leftLeg: ['ok'],
      rightLeg: ['ok']
    });
    mech.heatSinks = { count: 10, damaged: 0, type: 'single' };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(13);
  });

  it('no sinks in legs: water has no bonus effect', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: [],
      rightLeg: []
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(20);
  });
});

// =========================================================================
// COMBINED HEAT SCENARIOS
// =========================================================================

describe('Combined heat scale scenarios', () => {
  it('TSM mech in water with high heat: bonuses stack correctly', () => {
    const mech = createTestUnit('atlas-as7d', 0, 'combined-mech');
    // Heat 20 with 10 sinks + 3 leg water bonus = 13 dissipation = heat 7 after
    // Heat 7: no MP penalty, TSM 9+ not activated, ammo 4+ target NOT checked (< 19)
    // To test heat 20 effect with TSM + water: use 0 sinks
    mech.heat = 20;
    mech.equipment.other = { tsm: true };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.equipment.ammo = { lrm15: { shots: 10 } };

    const engine = createTestEngine({
      units: { 'combined-mech': mech }
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(4));

    expect(mech.currentMP).toBe(2);
    expect(mech.equipment.ammo.lrm15.shots).toBe(10);
  });

  it('firing weapons accumulates heat, then heat phase dissipates', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    engine.diceRoller = makeDiceRoller(8);
    advanceToPhase(engine, 'weapon_attack');

    const medLaser = createWeaponDef('med_laser');
    const ppc = createWeaponDef('ppc');
    const largeLaser = createWeaponDef('large_laser');

    engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'atlas-0',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(atlas.heat).toBe(3);
  });

  it('shutdown mech applies -4 target modifier for attackers', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
    atlas.position = { hexKey: '5,7', facing: 0 };
    jenner.position = { hexKey: '7,7', facing: 3 };
    jenner.shutdown = true;

    const engine = createTestEngine({
      units: { 'atlas-0': atlas, 'jenner-1': jenner }
    });

    engine.diceRoller = makeDiceRoller(8);
    advanceToPhase(engine, 'weapon_attack');

    const medLaser = createWeaponDef('med_laser');
    const result = engine.processAction(0, {
      type: 'fire',
      attackerId: 'atlas-0',
      targetId: 'jenner-1',
      weapon: medLaser,
      weaponLocation: 'rightArm'
    });

    expect(result.hit).toBe(true);
    expect(result.targetNumber).toBe(2);
    expect(result.modifiers).toContain('Target shutdown: -4');
  });

  it('heat modifier adds to TN during weapon attack phase', () => {
    // getHeatModifier: <5=0, <10=+1, <15=+2, <20=+3, >=20=+4
    const heatTests = [
      [0, 0],
      [4, 0],
      [5, 1],
      [9, 1],
      [10, 2],
      [14, 2],
      [15, 3],
      [19, 3],
      [20, 4],
      [24, 4],
    ];

    for (const [heat, expectedMod] of heatTests) {
      const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
      const jenner = createTestUnit('jenner-jr7d', 1, 'jenner-1');
      atlas.position = { hexKey: '5,7', facing: 0 };
      atlas.heat = heat;
      jenner.position = { hexKey: '7,7', facing: 3 };

      const engine = createTestEngine({
        units: { 'atlas-0': atlas, 'jenner-1': jenner }
      });

      engine.diceRoller = makeDiceRoller(8);
      advanceToPhase(engine, 'weapon_attack');

      const medLaser = createWeaponDef('med_laser');
      const result = engine.processAction(0, {
        type: 'fire',
        attackerId: 'atlas-0',
        targetId: 'jenner-1',
        weapon: medLaser,
        weaponLocation: 'rightArm'
      });

      const baseTN = 4 + expectedMod;
      expect(result.targetNumber, `heat=${heat}`).toBe(baseTN);
      if (expectedMod > 0) {
        expect(result.modifiers, `heat=${heat}`).toContain(`Attacker heat: +${expectedMod}`);
      }
    }
  });

  it('heat dissipates correctly through full heat phase for Atlas (20 sinks)', () => {
    const atlas = createTestUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 };
    atlas.heat = 42;

    const engine = createTestEngine({
      units: { 'atlas-0': atlas }
    });

    engine.diceRoller = makeDiceRoller(4);
    advanceToPhase(engine, 'heat');

    expect(atlas.heat).toBe(22);
    expect(atlas.shutdown).toBe(true);
  });

  it('heat dissipates correctly through full heat phase for Jenner (10 sinks)', () => {
    const jenner = createTestUnit('jenner-jr7d', 0, 'jenner-0');
    jenner.position = { hexKey: '7,7', facing: 0 };
    jenner.heat = 25;

    const engine = createTestEngine({
      units: { 'jenner-0': jenner }
    });

    engine.diceRoller = makeDiceRoller(12);
    advanceToPhase(engine, 'heat');

    expect(jenner.heat).toBe(15);
  });
});
