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
  });
});
