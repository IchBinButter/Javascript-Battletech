import { describe, it, expect } from 'vitest';
import { HeatManager } from '../../../src/rules/heat/HeatManager.js';

function makeUnit(overrides = {}) {
  return {
    heat: 0,
    movement: { walk: 4, run: 6, jump: 3 },
    currentMP: 4,
    shutdown: false,
    heatSinks: { count: 10, damaged: 0, type: 'single' },
    position: { hexKey: '4,4', facing: 0 },
    _externalHeat: 0,
    _movementModifier: 0,
    criticalSlots: null,
    getHeatDissipation() {
      const type = this.heatSinks.type;
      const sinkCount = Math.max(0, this.heatSinks.count - this.heatSinks.damaged);
      return type === 'double' ? sinkCount * 2 : sinkCount;
    },
    equipment: {
      ammo: {},
      other: {}
    },
    ...overrides
  };
}

function makeGameState(hexEntries = {}) {
  const hexes = new Map();
  for (const [key, data] of Object.entries(hexEntries)) {
    hexes.set(key, {
      hexKey: key,
      terrainType: data.terrainType || 'clear',
      level: data.level || 0,
      ...data
    });
  }
  return { map: { hexes } };
}

function makeDiceRoller(fixedRoll = 7) {
  return {
    roll2d6() { return fixedRoll; },
    roll1d6() { return Math.ceil(fixedRoll / 2); },
    next() { return 0.5; }
  };
}

describe('HeatManager', () => {
  const manager = new HeatManager();

  describe('calculateHeatGeneration', () => {
    it('returns 0 for no weapons and stationary', () => {
      const unit = makeUnit();
      expect(manager.calculateHeatGeneration(unit, [], 'stationary')).toBe(0);
    });

    it('sums weapon heat', () => {
      const unit = makeUnit();
      const heat = manager.calculateHeatGeneration(unit, [{ heat: 3 }, { heat: 8 }], 'stationary');
      expect(heat).toBe(11);
    });

    it('adds 2 heat for running', () => {
      const unit = makeUnit();
      expect(manager.calculateHeatGeneration(unit, [], 'run')).toBe(2);
    });

    it('adds 1 heat for walking', () => {
      const unit = makeUnit();
      expect(manager.calculateHeatGeneration(unit, [], 'walk')).toBe(1);
    });

    it('adds 1 heat per hex jumped (minimum 3)', () => {
      const unit = makeUnit();
      expect(manager.calculateHeatGeneration(unit, [], 'jump', 2)).toBe(3);
      expect(manager.calculateHeatGeneration(unit, [], 'jump', 4)).toBe(4);
      expect(manager.calculateHeatGeneration(unit, [], 'jump', 6)).toBe(6);
    });

    it('adds external heat', () => {
      const unit = makeUnit();
      unit._externalHeat = 5;
      expect(manager.calculateHeatGeneration(unit, [], 'stationary')).toBe(5);
    });

    it('combines weapon + movement + external heat', () => {
      const unit = makeUnit();
      unit._externalHeat = 2;
      const heat = manager.calculateHeatGeneration(unit, [{ heat: 3 }], 'run');
      expect(heat).toBe(7);
    });

    // p50: engine critical hits add 5/10 heat per turn - and p52 excludes a
    // shut-down 'Mech. calculateHeatGeneration is dead code, but it must not
    // disagree with the live Heat Phase (which uses engineHeatPerTurn).
    it('adds engine-critical heat unless shut down', () => {
      const damaged = makeUnit({ engine: { hits: 1 } });
      expect(manager.calculateHeatGeneration(damaged, [], 'stationary')).toBe(5);

      const shutDown = makeUnit({ engine: { hits: 2 }, shutdown: true });
      expect(manager.calculateHeatGeneration(shutDown, [], 'stationary')).toBe(0);
    });
  });

  describe('applyHeatDissipation', () => {
    it('dissipates heat equal to heat sink count', () => {
      const unit = makeUnit({ heat: 20 });
      const gs = makeGameState({ '4,4': {} });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(10);
      expect(unit.heat).toBe(10);
    });

    it('does not reduce below 0', () => {
      const unit = makeUnit({ heat: 5 });
      const gs = makeGameState({ '4,4': {} });
      manager.applyHeatDissipation(unit, gs);
      expect(unit.heat).toBe(0);
    });

    it('doubles leg-mounted sink dissipation in water', () => {
      const unit = makeUnit({ heat: 30 });
      unit.criticalSlots = {
        leftLeg: [{ item: 'heat_sink', status: 'ok' }, { item: 'heat_sink', status: 'ok' }],
        rightLeg: [{ item: 'heat_sink', status: 'ok' }]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(13); // 10 base + 3 leg sinks
      expect(unit.heat).toBe(17);
    });

    it('does not double non-leg sinks in water', () => {
      const unit = makeUnit({ heat: 30 });
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(10);
    });

    it('accounts for damaged heat sinks', () => {
      const unit = makeUnit({ heat: 20, heatSinks: { count: 10, damaged: 3, type: 'single' } });
      const gs = makeGameState({ '4,4': {} });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(7);
    });

    it('double heat sinks dissipate 2 per sink', () => {
      const unit = makeUnit({ heat: 20, heatSinks: { count: 5, damaged: 0, type: 'double' } });
      const gs = makeGameState({ '4,4': {} });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(10);
    });
  });

  describe('waterCoolingBonus (p50/p51)', () => {
    // p51 DISSIPATING HEAT: "A 'Mech standing in Depth 1 water has its
    // leg-mounted heat sinks submerged." p50: "+1 additional per operational
    // single heat sink under water (maximum 6 points)."
    it('adds +1 for each operational single heat sink in the legs', () => {
      const unit = makeUnit();
      unit.criticalSlots = {
        leftLeg: [{ item: 'heat_sink', status: 'ok' }, { item: 'heat_sink', status: 'ok' }],
        rightLeg: [{ item: 'heat_sink', status: 'ok' }]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(3);
    });

    // p50: "+2 additional per operational double heat sink underwater
    // (maximum 6 points)". p46: a double heat sink fills three critical slots.
    it('adds +2 for an operational double heat sink (three slots)', () => {
      const unit = makeUnit({ heatSinks: { count: 10, damaged: 0, type: 'double' } });
      unit.criticalSlots = {
        leftLeg: [
          { item: 'heat_sink', status: 'ok' },
          { item: 'heat_sink', status: 'ok' },
          { item: 'heat_sink', status: 'ok' }
        ],
        rightLeg: []
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(2);
    });

    it('caps the water bonus at 6 points', () => {
      const unit = makeUnit();
      unit.criticalSlots = {
        leftLeg: Array.from({ length: 4 }, () => ({ item: 'heat_sink', status: 'ok' })),
        rightLeg: Array.from({ length: 4 }, () => ({ item: 'heat_sink', status: 'ok' }))
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(6);
    });

    // p51: "A 'Mech standing in Depth 2 or deeper water or prone in Depth 1 or
    // deeper water has all of its heat sinks submerged (even those in the
    // engine)." Ten single sinks would be +10, capped at 6.
    it('Depth 2 submerges every heat sink, capped at 6', () => {
      const unit = makeUnit();
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth2' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(6);
    });

    it('prone in Depth 1 submerges every heat sink', () => {
      const unit = makeUnit({ prone: true });
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(6);
    });

    it('does not count sinks in other locations in Depth 1', () => {
      const unit = makeUnit();
      unit.criticalSlots = {
        leftLeg: [],
        rightLeg: [],
        centerTorso: [{ item: 'heat_sink', status: 'ok' }]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(0);
    });

    it('does not count damaged leg sinks', () => {
      const unit = makeUnit();
      unit.criticalSlots = {
        leftLeg: [{ item: 'heat_sink', status: 'ok' }, { item: 'heat_sink', status: 'crit' }],
        rightLeg: [{ item: 'heat_sink', status: 'ok' }]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(2);
    });

    it('is 0 on dry land', () => {
      const unit = makeUnit();
      unit.criticalSlots = {
        leftLeg: [{ item: 'heat_sink', status: 'ok' }],
        rightLeg: []
      };
      const gs = makeGameState({ '4,4': { terrainType: 'clear' } });
      expect(manager.waterCoolingBonus(unit, gs)).toBe(0);
    });
  });

  describe('engineHeatPerTurn (p47/p50/p52)', () => {
    it('is 0 for an undamaged engine', () => {
      expect(manager.engineHeatPerTurn(makeUnit({ engine: { hits: 0 } }))).toBe(0);
    });

    // p50: "The first engine hit to a 'Mech generates 5 points of heat per turn.
    // The second hit raises this to 10 (total) points of heat per turn."
    it('is +5 for the first engine hit and +10 for the second', () => {
      expect(manager.engineHeatPerTurn(makeUnit({ engine: { hits: 1 } }))).toBe(5);
      expect(manager.engineHeatPerTurn(makeUnit({ engine: { hits: 2 } }))).toBe(10);
    });

    it('stays at +10 for a third hit (the Mech is destroyed at three, p47)', () => {
      expect(manager.engineHeatPerTurn(makeUnit({ engine: { hits: 3 } }))).toBe(10);
    });

    // p52: "Engine critical hits do not generate heat while a 'Mech is shut down."
    it('is 0 while the Mech is shut down', () => {
      expect(manager.engineHeatPerTurn(makeUnit({ engine: { hits: 2 }, shutdown: true }))).toBe(0);
    });
  });

describe('applyHeatEffects - record sheet scale', () => {
    // heat, to-hit, movement penalty, shutdown avoid, ammo avoid, auto shutdown
    const cases = [
      [0, 0, 0, null, null, false],
      [4, 0, 0, null, null, false],
      [5, 0, 1, null, null, false],
      [7, 0, 1, null, null, false],
      [8, 1, 1, null, null, false],
      [10, 1, 2, null, null, false],
      [12, 1, 2, null, null, false],
      [13, 2, 2, null, null, false],
      [14, 2, 2, 4, null, false],
      [15, 2, 3, 4, null, false],
      [17, 3, 3, 4, null, false],
      [18, 3, 3, 6, null, false],
      [19, 3, 3, 6, 4, false],
      [20, 3, 4, 6, 4, false],
      [22, 3, 4, 8, 4, false],
      [23, 3, 4, 8, 6, false],
      [24, 4, 4, 8, 6, false],
      [25, 4, 5, 8, 6, false],
      [26, 4, 5, 10, 6, false],
      [28, 4, 5, 10, 8, false],
      [30, 4, 5, 10, 8, true]
    ];

    it.each(cases)(
      'heat %i: TN +%i, -%i MP, shutdown avoid %s, ammo avoid %s, auto %s',
      (heat, tn, mp, shutdownAvoid, ammoAvoid, auto) => {
        const unit = makeUnit({ heat, movement: { walk: 4 } });
        const result = manager.applyHeatEffects(unit);

        expect(result.shutdownTarget).toBe(shutdownAvoid);
        expect(result.ammoTarget).toBe(ammoAvoid);
        expect(result.autoShutdown).toBe(auto);
        expect(result.shutdownCheck).toBe(shutdownAvoid !== null);
        expect(result.ammoExplosionCheck).toBe(ammoAvoid !== null);

        const text = result.effects.join(' | ');
        if (tn > 0) expect(text).toContain(`+${tn} TN to weapons fire`);
        else expect(text).not.toContain('TN to weapons fire');
        if (mp > 0) expect(text).toContain(`-${mp} Walk MP`);
        else expect(text).not.toContain('Walk MP');
      }
    );

    it('does not write unit.currentMP - MP is derived', () => {
      const unit = makeUnit({ heat: 20, currentMP: 4 });
      manager.applyHeatEffects(unit);
      expect(unit.currentMP).toBe(4);
    });

    it('resets _movementModifier to 0 before applying effects', () => {
      const unit = makeUnit({ heat: 0, _movementModifier: 5 });
      manager.applyHeatEffects(unit);
      expect(unit._movementModifier).toBe(0);
    });
  });

  describe('checkShutdown', () => {
    it('returns no shutdown when target is falsy', () => {
      const unit = makeUnit();
      const result = manager.checkShutdown(unit, makeDiceRoller(7), null);
      expect(result.shutdown).toBe(false);
      expect(result.target).toBe(0);
    });

    it('shuts down on roll below target', () => {
      const unit = makeUnit();
      const result = manager.checkShutdown(unit, makeDiceRoller(3), 4);
      expect(result.shutdown).toBe(true);
      expect(unit.shutdown).toBe(true);
    });

    it('does not shut down on roll at or above target', () => {
      const unit = makeUnit();
      const result = manager.checkShutdown(unit, makeDiceRoller(4), 4);
      expect(result.shutdown).toBe(false);
    });
  });

  describe('resolveHeatPhase', () => {
    it('processes all units in the game state', () => {
      const unit1 = makeUnit({ heat: 15 });
      unit1.id = 'unit1';
      const unit2 = makeUnit({ heat: 8 });
      unit2.id = 'unit2';

      const gs = makeGameState({ '4,4': {}, '6,6': {} });
      gs.units = { unit1, unit2 };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(3));
      expect(results).toHaveLength(2);
      expect(results[0].unitId).toBe('unit1');
      expect(results[1].unitId).toBe('unit2');
    });

    it('applies dissipation before evaluating heat effects', () => {
      const unit = makeUnit({ heat: 28, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(3));
      expect(results[0].heat).toBe(18);
      expect(results[0].dissipation).toBe(10);
    });

    it('shutdown check at heat 20+ uses roll and adds message', () => {
      const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(2));
      expect(results[0].effects.some(e => e.includes('SHUTDOWN'))).toBe(true);
      expect(unit.shutdown).toBe(true);
    });

    it('avoids shutdown at heat 20 on roll 6+', () => {
      const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(6));
      expect(results[0].effects.some(e => e.includes('SHUTDOWN'))).toBe(false);
      expect(unit.shutdown).toBe(false);
    });

    it('ammo explosion at heat 24 triggers below the 6+ avoid target', () => {
      const unit = makeUnit({ heat: 34, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { lrm15: { shots: 15 } };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(5));
      expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);
      expect(unit.equipment.ammo.lrm15.shots).toBe(0);
    });

    it('avoids ammo explosion at heat 24 on roll 6+', () => {
      const unit = makeUnit({ heat: 34, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { lrm15: { shots: 15 } };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(6));
      expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
      expect(unit.equipment.ammo.lrm15.shots).toBe(15);
    });

    it('no ammo explosion check below heat 19', () => {
      const unit = makeUnit({ heat: 28, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { lrm15: { shots: 15 } };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(2));
      expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
      expect(unit.equipment.ammo.lrm15.shots).toBe(15);
    });

    it('skips ammo bins with 0 shots', () => {
      const unit = makeUnit({ heat: 34, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { empty: { shots: 0 }, lrm15: { shots: 15 } };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(5));
      const effects = results[0].effects;
      expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('empty'))).toBe(false);
      expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('lrm15'))).toBe(true);
      expect(unit.equipment.ammo.lrm15.shots).toBe(0);
    });

    // H-02: the live Heat Phase generates the engine's 5/10 heat points. The
    // dead calculateHeatGeneration is not on the pipeline, so the amount must be
    // applied here (p50/p51), before dissipation.
    it('applies engine-critical heat in the live Heat Phase path', () => {
      const unit = makeUnit({
        heat: 0,
        engine: { hits: 1 },
        heatSinks: { count: 3, damaged: 0, type: 'single' }
      });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(7));

      expect(results[0].engineHeat).toBe(5);
      expect(results[0].heat).toBe(2); // 5 generated - 3 dissipated
      expect(results[0].effects).toContain('Engine critical: +5 heat');
    });

    // p52: "Engine critical hits do not generate heat while a 'Mech is shut down."
    it('does not apply engine heat while shut down', () => {
      const unit = makeUnit({
        heat: 0,
        shutdown: true,
        engine: { hits: 2 },
        heatSinks: { count: 0, damaged: 0, type: 'single' }
      });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(7));

      expect(results[0].engineHeat).toBe(0);
      expect(unit.heat).toBe(0);
    });

    // H-08: the heat-phase explosion must call the shared DamageResolver for
    // ONE bin instead of zeroing bins and adding 2 pilot hits inline.
    it('calls DamageResolver.resolveAmmoExplosion for the one exploding bin', () => {
      const unit = makeUnit({ heat: 34, heatSinks: { count: 0, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { lrm15: { type: 'lrm15', shots: 10 } };

      const calls = [];
      const mockResolver = {
        resolveAmmoExplosion(explodingUnit, binName, dice) {
          calls.push({ unit: explodingUnit, binName, dice });
          explodingUnit.equipment.ammo[binName].shots = 0;
          return true;
        }
      };
      const withResolver = new HeatManager(mockResolver);

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };
      const dice = makeDiceRoller(5);

      const results = withResolver.resolveHeatPhase(gs, dice);

      expect(calls).toHaveLength(1);
      expect(calls[0].unit).toBe(unit);
      expect(calls[0].binName).toBe('lrm15');
      expect(calls[0].dice).toBe(dice);
      expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION in lrm15'))).toBe(true);
    });

    it('applies real explosion damage through the default DamageResolver', () => {
      const unit = makeUnit({
        heat: 34,
        heatSinks: { count: 0, damaged: 0, type: 'single' },
        criticalSlots: { leftTorso: [{ slot: 6, item: 'lrm20_ammo', status: 'ok' }] },
        internalStructure: { leftTorso: 21 },
        pilot: { hits: 0 }
      });
      unit.id = 'u1';
      // `location` is what the shared resolver uses for roster/imported bins;
      // older data locates the bin by its critical-slot item, which this
      // fixture also carries, so either lookup finds the left torso.
      unit.equipment.ammo = {
        lrm20_ammo: { type: 'lrm20', shots: 1, explosive: true, location: 'leftTorso', slot: 6 }
      };
      unit.applyPilotDamage = function (points = 1) {
        this.pilot.hits = Math.min(6, (this.pilot.hits || 0) + points);
        return this.pilot.hits;
      };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(5));

      // One LRM-20 shot is 20 points (p102: launcher size per shot) straight to
      // internal structure (p44: explosions bypass armour).
      expect(unit.equipment.ammo.lrm20_ammo.shots).toBe(0);
      expect(unit.internalStructure.leftTorso).toBe(1);
      // p52/p58: the explosion injures the MechWarrior for 2 points, once.
      expect(unit.pilot.hits).toBe(2);
      expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION in lrm20_ammo'))).toBe(true);
    });
  });
});
