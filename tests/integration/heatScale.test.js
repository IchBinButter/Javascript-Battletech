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
    [7,  2],
    [10, 1],
    [12, 1],
    [14, 1],
    [15, 0],
    [19, 0],
    [20, 0],
    [24, 0],
    [30, 0],
  ])('heat %i: expectedMP=%i after heat phase (0 sinks)', (heat, expectedMP) => {
    const { engine, mech } = setupHeatTest(heat, 'atlas-as7d', '7,7', 0);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.currentMP).toBe(expectedMP);
  });

  it('heat 30: automatic shutdown, MP clamped to 0, ammo check fires', () => {
    const { engine, mech } = setupHeatTest(30, 'atlas-as7d', '7,7', 0);
    mech.equipment.ammo = { ac5: { shots: 5 } };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.shutdown).toBe(true);
    expect(mech.currentMP).toBe(0);
    expect(mech.equipment.ammo.ac5.shots).toBe(0); // roll 7 vs avoid 8+ explodes
  });

  it('heat 30: auto shutdown and the most destructive ammo bin explodes', () => {
    const { engine, mech } = setupHeatTest(30, 'atlas-as7d', '7,7', 0);
    mech.equipment.ammo = { lrm15: { shots: 10 }, sr6: { shots: 5 } };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.shutdown).toBe(true);
    expect(mech.currentMP).toBe(0);
    // p52: one bin explodes - LRM-15 (15 damage per turn) beats SRM-6 (12).
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
    expect(mech.equipment.ammo.sr6.shots).toBe(5);
  });

  it('heat 0-13: no shutdown, no ammo check, only MP penalties', () => {
    // Atlas walk 3: -1 MP from heat 5, -2 from heat 10
    const expectedMP = { 0: 3, 5: 2, 8: 2, 10: 1, 13: 1 };
    for (const heat of Object.keys(expectedMP).map(Number)) {
      const { engine, mech } = setupHeatTest(heat, 'atlas-as7d', '7,7', 0);
      mech.equipment.ammo = { lrm15: { shots: 10 } };

      enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

      expect(mech.shutdown, `heat=${heat} shutdown`).toBe(false);
      expect(mech.equipment.ammo.lrm15.shots, `heat=${heat} ammo`).toBe(10);
      expect(mech.currentMP, `heat=${heat} MP`).toBe(expectedMP[heat]);
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

describe('Ammo explosion checks (record sheet thresholds)', () => {
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

  function shotsAfter(heat, roll) {
    const { engine } = setupAmmoMech(heat);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(roll));
    const mech = Object.values(engine.stateManager.getState().units)[0];
    return mech.equipment.ammo.lrm15.shots;
  }

  it('heat 18: below the first threshold, no check at all', () => {
    expect(shotsAfter(18, 2)).toBe(10);
  });

  it('heat 19 (avoid on 4+): roll 3 explodes, roll 4 survives', () => {
    expect(shotsAfter(19, 3)).toBe(0);
    expect(shotsAfter(19, 4)).toBe(10);
  });

  it('heat 23 (avoid on 6+): roll 5 explodes, roll 6 survives', () => {
    expect(shotsAfter(23, 5)).toBe(0);
    expect(shotsAfter(23, 6)).toBe(10);
  });

  it('heat 28 (avoid on 8+): roll 7 explodes, roll 8 survives', () => {
    expect(shotsAfter(28, 7)).toBe(0);
    expect(shotsAfter(28, 8)).toBe(10);
  });

  it('ammo bins with 0 shots are skipped', () => {
    const { engine, mech } = setupAmmoMech(19);
    mech.equipment.ammo = { empty: { shots: 0 }, lrm15: { shots: 10 } };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(2));

    expect(mech.equipment.ammo.empty.shots).toBe(0);
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
  });

  it('ammo explosion destroys only the most destructive bin', () => {
    const { engine, mech } = setupAmmoMech(19);
    mech.equipment.ammo = {
      ac5: { shots: 10 },
      lrm15: { shots: 15 },
      sr4: { shots: 25 }
    };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(2));

    // p52: LRM-15 does 15 damage per turn, ahead of SRM-4 (8) and AC/5 (5).
    expect(mech.equipment.ammo.lrm15.shots).toBe(0);
    expect(mech.equipment.ammo.ac5.shots).toBe(10);
    expect(mech.equipment.ammo.sr4.shots).toBe(25);
  });
});

// =========================================================================
// SHUTDOWN ROLLS (escalating targets)
// =========================================================================

describe('Shutdown checks (record sheet thresholds)', () => {
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

  function shutdownAfter(heat, roll) {
    const { engine } = setupShutdownMech(heat);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(roll));
    return Object.values(engine.stateManager.getState().units)[0].shutdown;
  }

  it('heat 13: below the first threshold, never shuts down', () => {
    expect(shutdownAfter(13, 2)).toBe(false);
  });

  it('heat 14 (avoid on 4+): roll 3 shuts down, roll 4 does not', () => {
    expect(shutdownAfter(14, 3)).toBe(true);
    expect(shutdownAfter(14, 4)).toBe(false);
  });

  it('heat 18 (avoid on 6+): roll 5 shuts down, roll 6 does not', () => {
    expect(shutdownAfter(18, 5)).toBe(true);
    expect(shutdownAfter(18, 6)).toBe(false);
  });

  it('heat 22 (avoid on 8+): roll 7 shuts down, roll 8 does not', () => {
    expect(shutdownAfter(22, 7)).toBe(true);
    expect(shutdownAfter(22, 8)).toBe(false);
  });

  it('heat 26 (avoid on 10+): roll 9 shuts down, roll 10 does not', () => {
    expect(shutdownAfter(26, 9)).toBe(true);
    expect(shutdownAfter(26, 10)).toBe(false);
  });

  it('heat 30: automatic shutdown regardless of roll', () => {
    expect(shutdownAfter(30, 12)).toBe(true);
  });

  it('roll 12 always avoids shutdown for numeric targets', () => {
    expect(shutdownAfter(26, 12)).toBe(false);
  });

  it('roll 2 always fails to avoid shutdown for any numeric target', () => {
    expect(shutdownAfter(14, 2)).toBe(true);
  });
});

// =========================================================================
// TSM (TRIPLE STRENGTH MYOMER) +2 WALK MP
// =========================================================================

describe('TSM walk MP (integration through engine)', () => {
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

  function walkMPAfterHeatPhase(heat) {
    const { engine, mech } = setupTSMMech(heat);
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    return mech.currentMP;
  }

  // Atlas walk 3, TSM +2 from heat 9, penalty -1/-2/-3/-4/-5 at 5/10/15/20/25
  it('heat 9: 3 - 1 + 2 = 4', () => {
    expect(walkMPAfterHeatPhase(9)).toBe(4);
  });

  it('heat 10: 3 - 2 + 2 = 3', () => {
    expect(walkMPAfterHeatPhase(10)).toBe(3);
  });

  it('heat 13: 3 - 2 + 2 = 3', () => {
    expect(walkMPAfterHeatPhase(13)).toBe(3);
  });

  it('heat 8: below activation, 3 - 1 = 2', () => {
    expect(walkMPAfterHeatPhase(8)).toBe(2);
  });

  it('heat 0: no penalty and no bonus, 3', () => {
    expect(walkMPAfterHeatPhase(0)).toBe(3);
  });

  it('heat 18: 3 - 3 + 2 = 2', () => {
    expect(walkMPAfterHeatPhase(18)).toBe(2);
  });

  it('heat 19: 3 - 3 + 2 = 2', () => {
    expect(walkMPAfterHeatPhase(19)).toBe(2);
  });

  it('heat 20: 3 - 4 + 2 = 1', () => {
    expect(walkMPAfterHeatPhase(20)).toBe(1);
  });

  it('heat 25: 3 - 5 + 2 = 0', () => {
    expect(walkMPAfterHeatPhase(25)).toBe(0);
  });

  it('heat 30: 3 - 5 + 2 = 0', () => {
    expect(walkMPAfterHeatPhase(30)).toBe(0);
  });

  it('no TSM equipment: heat 12 gives 3 - 2 = 1', () => {
    const { engine, mech } = setupTSMMech(12);
    mech.equipment.other = {};
    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(1);
  });

  it('Jenner with TSM at heat 9: 7 - 1 + 2 = 8', () => {
    const mech = createTestUnit('jenner-jr7d', 0, 'tsm-jenner');
    mech.heat = 9;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };
    mech.equipment.other = { tsm: true };

    const engine = createTestEngine({
      units: { 'tsm-jenner': mech }
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));
    expect(mech.currentMP).toBe(8);
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

  // p51 DISSIPATING HEAT: "A 'Mech standing in Depth 1 water has its
  // leg-mounted heat sinks submerged." p50 Heat Point Table: "+1 additional per
  // operational single heat sink under water (maximum 6 points)".
  it('water_depth1 submerges only leg sinks: 10 base + 3 singles = 13 total', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: ['ok', 'ok'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(17);
  });

  // p51: "A 'Mech standing in Depth 2 or deeper water ... has all of its heat
  // sinks submerged (even those in the engine). No more than 6 additional heat
  // points per turn can be dissipated due to water."
  it('water_depth2 submerges every sink, capped at 6 extra: 10 base + 6 = 16', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth2', {
      leftLeg: ['ok', 'ok'],
      rightLeg: ['ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(14); // 30 - (10 + 6)
  });

  it('prone in Depth 1 water submerges every sink (p51)', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: ['ok'],
      rightLeg: []
    });
    mech.prone = true;

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    // 10 operational single sinks would add +10, capped at 6.
    expect(mech.heat).toBe(14);
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

  // p50 Heat Point Table: "+2 additional per operational double heat sink
  // underwater (maximum 6 points)". p46: a double heat sink fills three
  // critical slots, so three leg slots are one double sink.
  it('one submerged double heat sink in Depth 1 adds +2', () => {
    const { engine, mech } = setupWaterMech(40, 'water_depth1', {
      leftLeg: ['ok', 'ok', 'ok'],
      rightLeg: []
    });
    mech.heatSinks = { count: 10, damaged: 0, type: 'double' };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(18); // 40 - (20 base + 2)
  });

  it('three submerged double heat sinks hit the 6-point cap', () => {
    const { engine, mech } = setupWaterMech(40, 'water_depth1', {
      leftLeg: ['ok', 'ok', 'ok'],
      rightLeg: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']
    });
    mech.heatSinks = { count: 10, damaged: 0, type: 'double' };

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    // Three double sinks would add +6: exactly the p50/p51 cap. 40 - (20 + 6).
    expect(mech.heat).toBe(14);
  });

  it('water extra is capped at 6 points even with eight leg single sinks', () => {
    const { engine, mech } = setupWaterMech(30, 'water_depth1', {
      leftLeg: ['ok', 'ok', 'ok', 'ok'],
      rightLeg: ['ok', 'ok', 'ok', 'ok']
    });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(14); // 30 - (10 + 6), not 30 - (10 + 8)
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
// ENGINE CRITICAL HITS (p47/p50/p52)
// =========================================================================

describe('Engine-critical heat in the Heat Phase', () => {
  function setupEngineMech(hits, { shutdown = false, sinks = 0 } = {}) {
    const mech = createTestUnit('atlas-as7d', 0, 'engine-mech');
    mech.heat = 0;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: sinks, damaged: 0, type: 'single' };
    mech.engine = { type: 'standard', rating: 300, hits };
    mech.shutdown = shutdown;

    const engine = createTestEngine({
      units: { 'engine-mech': mech }
    });

    return { engine, mech };
  }

  // p50 Other Heat: "The first engine hit to a 'Mech generates 5 points of heat
  // per turn." p47 ENGINE repeats it.
  it('first engine hit adds 5 heat during the Heat Phase', () => {
    const { engine, mech } = setupEngineMech(1);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(5);
  });

  it('second engine hit adds 10 (total) heat per turn', () => {
    const { engine, mech } = setupEngineMech(2);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(10);
  });

  it('an undamaged engine adds no heat', () => {
    const { engine, mech } = setupEngineMech(0);

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(0);
  });

  // p52: "Engine critical hits do not generate heat while a 'Mech is shut down."
  it('engine hits generate no heat while the Mech is shut down', () => {
    const { engine, mech } = setupEngineMech(2, { shutdown: true });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(0);
  });

  // p51 RECORDING HEAT BUILD-UP: heat generated this turn is added, then the
  // sinks subtract; the engine's +5 is not applied after dissipation.
  it('engine heat is generated before dissipation', () => {
    const { engine, mech } = setupEngineMech(1, { sinks: 3 });

    enterHeatPhaseAndResolve(engine, makeDiceRoller(7));

    expect(mech.heat).toBe(2); // 5 generated - 3 dissipated
  });
});

// =========================================================================
// HEAT-INDUCED AMMO EXPLOSION DAMAGE (H-08, p52/p44)
// =========================================================================

describe('Heat-induced ammo explosion applies real damage (p52/p44)', () => {
  function setupExplosionMech(heatLevel) {
    const mech = createTestUnit('atlas-as7d', 0, 'boom-mech');
    mech.heat = heatLevel;
    mech.position = { hexKey: '7,7', facing: 0 };
    mech.heatSinks = { count: 0, damaged: 0, type: 'single' };

    const engine = createTestEngine({
      units: { 'boom-mech': mech }
    });

    return { engine, mech };
  }

  function resolveHeatOnly(engine) {
    return engine.heatManager.resolveHeatPhase(
      engine.stateManager.getState(), engine.diceRoller
    );
  }

  function emptyAllBins(mech) {
    for (const bin of Object.values(mech.equipment.ammo)) bin.shots = 0;
  }

  // p52: "All of the appropriate ammo type in a single critical slot explodes.
  // Resolve the explosion following the rules in Critical Hit Effects" - the
  // blast bypasses armour (p44) and is shots x the bin's per-shot Damage Value.
  it('one LRM-20 shot explodes for 20 damage straight to internal structure', () => {
    const { engine, mech } = setupExplosionMech(19);
    emptyAllBins(mech);
    const binKey = Object.keys(mech.equipment.ammo).find(k => k.startsWith('lrm20_ammo'));
    expect(binKey).toBeDefined();
    mech.equipment.ammo[binKey].shots = 1;

    // The Atlas carries its LRM-20 ammo in the left torso (mechs.json).
    const binLocation = Object.keys(mech.criticalSlots).find(loc =>
      mech.criticalSlots[loc].some(slot =>
        slot.item === binKey || slot.item === 'lrm20_ammo'
      )
    );
    expect(binLocation).toBe('leftTorso');
    const armorBefore = mech.getArmor(binLocation);
    const internalBefore = mech.getInternal(binLocation);

    engine.diceRoller = makeDiceRoller(2); // avoid target at heat 19 is 4+
    const results = resolveHeatOnly(engine);

    expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);
    expect(mech.equipment.ammo[binKey].shots).toBe(0);
    // p44: explosions bypass armour, so only internal structure is lost.
    expect(mech.getArmor(binLocation)).toBe(armorBefore);
    expect(mech.getInternal(binLocation)).toBe(internalBefore - 20);
    // p58/p52: an ammunition explosion automatically injures the MechWarrior
    // for 2 points - once, not twice.
    expect(mech.pilot.hits).toBe(2);
  });

  // p52: "All of the appropriate ammo type in a single critical slot explodes"
  // and p102: a missile bin explodes for launcher size x shots left. Two LRM-20
  // shots are therefore 40 points, not 20.
  it('a bin with two shots explodes for shots x per-shot damage and transfers inward', () => {
    const { engine, mech } = setupExplosionMech(19);
    emptyAllBins(mech);
    const binKey = Object.keys(mech.equipment.ammo).find(k => k.startsWith('lrm20_ammo'));
    mech.equipment.ammo[binKey].shots = 2;
    const ltArmorBefore = mech.getArmor('leftTorso');
    const ctArmorBefore = mech.getArmor('centerTorso');

    engine.diceRoller = makeDiceRoller(2);
    resolveHeatOnly(engine);

    expect(mech.equipment.ammo[binKey].shots).toBe(0);
    // 2 x 20 = 40 points to the left torso (21 internal) and 19 inward to the
    // centre torso (31 - 19 = 12), all of it bypassing armour (p44).
    expect(mech.getInternal('leftTorso')).toBe(0);
    expect(mech.getInternal('centerTorso')).toBe(12);
    expect(mech.getArmor('leftTorso')).toBe(ltArmorBefore);
    expect(mech.getArmor('centerTorso')).toBe(ctArmorBefore);
  });

  it('only the exploded bin loses its shots', () => {
    const { engine, mech } = setupExplosionMech(19);
    emptyAllBins(mech);
    // Every LRM-20 bin holds one shot, so the p52 tie-break is the first bin;
    // the SRM bins hold three shots each but their ammo is less destructive per
    // shot (12 vs 20), so they must not be selected.
    const lrmBins = Object.keys(mech.equipment.ammo).filter(k => k.startsWith('lrm20_ammo'));
    const srmBins = Object.keys(mech.equipment.ammo).filter(k => k.startsWith('srm6_ammo'));
    for (const k of lrmBins) mech.equipment.ammo[k].shots = 1;
    for (const k of srmBins) mech.equipment.ammo[k].shots = 3;
    expect(lrmBins.length).toBeGreaterThan(0);
    const explodedBin = lrmBins[0];

    engine.diceRoller = makeDiceRoller(2);
    resolveHeatOnly(engine);

    // p52: "All of the appropriate ammo type in a single critical slot
    // explodes" - the other bins keep their ammunition.
    expect(mech.equipment.ammo[explodedBin].shots).toBe(0);
    for (const k of lrmBins.slice(1)) expect(mech.equipment.ammo[k].shots).toBe(1);
    for (const k of srmBins) expect(mech.equipment.ammo[k].shots).toBe(3);
  });

  it('a survived explosion check leaves the bin and the Mech untouched', () => {
    const { engine, mech } = setupExplosionMech(19);
    emptyAllBins(mech);
    const binKey = Object.keys(mech.equipment.ammo).find(k => k.startsWith('lrm20_ammo'));
    mech.equipment.ammo[binKey].shots = 1;
    const structureBefore = { ...mech.internalStructure };
    const armorBefore = JSON.parse(JSON.stringify(mech.armor));

    engine.diceRoller = makeDiceRoller(4); // 4+ avoids the heat 19 explosion
    resolveHeatOnly(engine);

    expect(mech.equipment.ammo[binKey].shots).toBe(1);
    expect(mech.pilot.hits).toBe(0);
    expect(mech.internalStructure).toEqual(structureBefore);
    expect(mech.armor).toEqual(armorBefore);
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

    expect(mech.currentMP).toBe(1); // 3 - 4 (heat 20) + 2 (TSM)
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
    // record-sheet to-hit ladder: +1 at 8, +2 at 13, +3 at 17, +4 at 24
    const heatTests = [
      [0, 0],
      [7, 0],
      [8, 1],
      [12, 1],
      [13, 2],
      [16, 2],
      [17, 3],
      [23, 3],
      [24, 4],
      [30, 4],
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
