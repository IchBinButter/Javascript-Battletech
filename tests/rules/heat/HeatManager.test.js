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
    getHeatDissipation() {
      const type = this.heatSinks.type;
      const sinkCount = Math.max(0, this.heatSinks.count - this.heatSinks.damaged);
      return type === 'double' ? sinkCount * 2 : sinkCount;
    },
    equipment: {
      ammo: {}
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
      const weapons = [
        { heat: 5 },
        { heat: 3 },
        { heat: 8 }
      ];
      expect(manager.calculateHeatGeneration(unit, weapons, 'stationary')).toBe(16);
    });

    it('adds 2 heat for running', () => {
      const unit = makeUnit();
      const weapons = [{ heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'run')).toBe(7);
    });

    it('adds 0 heat for walking', () => {
      const unit = makeUnit();
      const weapons = [{ heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'walk')).toBe(5);
    });

    it('adds 3 heat per hex jumped (minimum 3)', () => {
      const unit = makeUnit();
      const weapons = [];
      expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 0)).toBe(3);
      expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 2)).toBe(6);
      expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 5)).toBe(15);
    });

    it('adds external heat', () => {
      const unit = makeUnit({ _externalHeat: 4 });
      const weapons = [{ heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'stationary')).toBe(9);
    });

    it('combines weapon + movement + external heat', () => {
      const unit = makeUnit({ _externalHeat: 2 });
      const weapons = [{ heat: 10 }, { heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'run')).toBe(19);
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
      expect(dissipated).toBe(13);
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
      expect(unit.heat).toBe(13);
    });

    it('double heat sinks dissipate 2 per sink', () => {
      const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'double' } });
      const gs = makeGameState({ '4,4': {} });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(20);
    });
  });

  describe('applyHeatEffects — BMM full heat scale', () => {
    function expectEffects(heat, expectedEffects, overrides = {}) {
      const unit = makeUnit({ heat, movement: { walk: 4, run: 6, jump: 3 }, ...overrides });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      return { unit, result, expectedEffects };
    }

    it('heat 0-13: no effects', () => {
      for (const heat of [0, 5, 10, 13]) {
        const unit = makeUnit({ heat, movement: { walk: 4 } });
        const result = manager.applyHeatEffects(unit, makeDiceRoller());
        expect(result.effects, `heat ${heat}`).toHaveLength(0);
        expect(result.shutdownCheck, `heat ${heat}`).toBe(false);
        expect(result.ammoExplosionCheck, `heat ${heat}`).toBe(false);
        expect(unit.currentMP, `heat ${heat}`).toBe(4);
      }
    });

    it('heat 14: +1 TN, no MP penalty', () => {
      const unit = makeUnit({ heat: 14, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+1 TN to weapons fire');
      expect(result.effects).toHaveLength(1);
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(false);
      expect(unit.currentMP).toBe(4);
    });

    it('heat 15: +2 TN, no MP penalty', () => {
      const unit = makeUnit({ heat: 15, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+2 TN to weapons fire');
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(false);
      expect(unit.currentMP).toBe(4);
    });

    it('heat 16: +3 TN, no MP penalty', () => {
      const unit = makeUnit({ heat: 16, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+3 TN to weapons fire');
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(false);
      expect(unit.currentMP).toBe(4);
    });

    it('heat 17: +4 TN, no MP penalty', () => {
      const unit = makeUnit({ heat: 17, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+4 TN to weapons fire');
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(false);
      expect(unit.currentMP).toBe(4);
    });

    it('heat 18: +5 TN, -1 Walk MP', () => {
      const unit = makeUnit({ heat: 18, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+5 TN to weapons fire');
      expect(result.effects).toContain('-1 Walk MP');
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(false);
      expect(unit.currentMP).toBe(3);
    });

    it('heat 19: +6 TN, -2 Walk MP, ammo(4+)', () => {
      const unit = makeUnit({ heat: 19, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+6 TN to weapons fire');
      expect(result.effects).toContain('-2 Walk MP');
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(true);
      expect(result.ammoTarget).toBe(4);
      expect(unit.currentMP).toBe(2);
    });

    it('heat 20: +7 TN, -3 Walk MP, shutdown(4+), ammo(6+)', () => {
      const unit = makeUnit({ heat: 20, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+7 TN to weapons fire');
      expect(result.effects).toContain('-3 Walk MP');
      expect(result.shutdownCheck).toBe(true);
      expect(result.shutdownTarget).toBe(4);
      expect(result.ammoExplosionCheck).toBe(true);
      expect(result.ammoTarget).toBe(6);
      expect(unit.currentMP).toBe(1);
    });

    it('heat 21: +8 TN, -4 Walk MP, shutdown(6+), ammo(8+)', () => {
      const unit = makeUnit({ heat: 21, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+8 TN to weapons fire');
      expect(result.effects).toContain('-4 Walk MP');
      expect(result.shutdownCheck).toBe(true);
      expect(result.shutdownTarget).toBe(6);
      expect(result.ammoExplosionCheck).toBe(true);
      expect(result.ammoTarget).toBe(8);
      expect(unit.currentMP).toBe(0);
    });

    it('heat 22: +9 TN, -5 Walk MP, shutdown(8+), ammo(10+)', () => {
      const unit = makeUnit({ heat: 22, movement: { walk: 6 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+9 TN to weapons fire');
      expect(result.effects).toContain('-5 Walk MP');
      expect(result.shutdownCheck).toBe(true);
      expect(result.shutdownTarget).toBe(8);
      expect(result.ammoExplosionCheck).toBe(true);
      expect(result.ammoTarget).toBe(10);
      expect(unit.currentMP).toBe(1);
    });

    it('heat 23: +10 TN, -6 Walk MP, shutdown(10+), ammo(12+)', () => {
      const unit = makeUnit({ heat: 23, movement: { walk: 6 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+10 TN to weapons fire');
      expect(result.effects).toContain('-6 Walk MP');
      expect(result.shutdownCheck).toBe(true);
      expect(result.shutdownTarget).toBe(10);
      expect(result.ammoExplosionCheck).toBe(true);
      expect(result.ammoTarget).toBe(12);
      expect(unit.currentMP).toBe(0);
    });

    it('heat 24+: auto shutdown, auto ammo', () => {
      const unit = makeUnit({ heat: 25, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.shutdownCheck).toBe(true);
      expect(result.shutdownTarget).toBe('auto');
      expect(result.ammoExplosionCheck).toBe(true);
      expect(result.ammoTarget).toBe('auto');
      expect(unit.currentMP).toBe(0);
    });

    it('MP does not go below 0 (heat 20+ on slow mech)', () => {
      const unit = makeUnit({ heat: 20, movement: { walk: 2 } });
      manager.applyHeatEffects(unit, makeDiceRoller());
      expect(unit.currentMP).toBe(0);
    });

    it('TSM grants +2 walk MP at 9+ heat', () => {
      const unit = makeUnit({ heat: 12, movement: { walk: 4 } });
      unit.equipment.other = { tsm: true };
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(unit.currentMP).toBe(6); // 4 base + 2 TSM, no MP reduction at heat 12
    });

    it('TSM +2 is offset by MP penalties at high heat', () => {
      const unit = makeUnit({ heat: 20, movement: { walk: 4 } });
      unit.equipment.other = { tsm: true };
      manager.applyHeatEffects(unit, makeDiceRoller());
      expect(unit.currentMP).toBe(3); // 4 - 3 MP reduction + 2 TSM
    });

    it('TSM does not activate below heat 9', () => {
      const unit = makeUnit({ heat: 8, movement: { walk: 4 } });
      unit.equipment.other = { tsm: true };
      manager.applyHeatEffects(unit, makeDiceRoller());
      expect(unit.currentMP).toBe(4);
    });

    it('heat effects are applied at the exact BMM threshold values', () => {
      const expectations = [
        [13, 0, 0, 4],
        [14, 0, 0, 4],
        [15, 0, 0, 4],
        [16, 0, 0, 4],
        [17, 0, 0, 4],
        [18, 1, 0, 3],
        [19, 2, 0, 2],
        [20, 3, 4, 1],
        [21, 4, 6, 0],
        [22, 5, 8, -1], // currentMP clamped to 0
        [23, 6, 10, -2], // currentMP clamped to 0
      ];
      for (const [heat, expectedMpLoss, expectedShutdownTarget, expectedRawMP] of expectations) {
        const unit = makeUnit({ heat, movement: { walk: 4 } });
        manager.applyHeatEffects(unit, makeDiceRoller());
        const actualMP = Math.max(0, 4 - expectedMpLoss);
        expect(unit.currentMP, `heat=${heat} MP`).toBe(actualMP);
        if (expectedShutdownTarget > 0) {
          expect(manager.applyHeatEffects(makeUnit({ heat, movement: { walk: 4 } }), makeDiceRoller()).shutdownTarget, `heat=${heat} shutdownTarget`).toBe(expectedShutdownTarget);
        }
      }
    });
  });

  describe('checkShutdown', () => {
    it('returns false with target 0 when no shutdownTarget provided', () => {
      const unit = makeUnit({ heat: 22 });
      const result = manager.checkShutdown(unit, makeDiceRoller(7));
      expect(result.shutdown).toBe(false);
      expect(result.target).toBe(0);
    });

    it('auto shutdown at heat 24+', () => {
      const unit = makeUnit({ heat: 25 });
      const result = manager.checkShutdown(unit, makeDiceRoller(7), 'auto');
      expect(result.shutdown).toBe(true);
      expect(result.target).toBe('auto');
      expect(unit.shutdown).toBe(true);
    });

    it('shutdown on roll < target (heat 20: target 4, roll 3)', () => {
      const unit = makeUnit({ heat: 20 });
      const result = manager.checkShutdown(unit, makeDiceRoller(3), 4);
      expect(result.shutdown).toBe(true);
      expect(result.target).toBe(4);
      expect(unit.shutdown).toBe(true);
    });

    it('no shutdown on roll >= target (heat 20: target 4, roll 4)', () => {
      const unit = makeUnit({ heat: 20 });
      const result = manager.checkShutdown(unit, makeDiceRoller(4), 4);
      expect(result.shutdown).toBe(false);
    });

    it('shutdown on roll < target (heat 21: target 6, roll 5)', () => {
      const unit = makeUnit({ heat: 21 });
      const result = manager.checkShutdown(unit, makeDiceRoller(5), 6);
      expect(result.shutdown).toBe(true);
    });

    it('no shutdown on roll >= target (heat 21: target 6, roll 6)', () => {
      const unit = makeUnit({ heat: 21 });
      const result = manager.checkShutdown(unit, makeDiceRoller(6), 6);
      expect(result.shutdown).toBe(false);
    });

    it('shutdown on roll < target (heat 22: target 8, roll 7)', () => {
      const unit = makeUnit({ heat: 22 });
      const result = manager.checkShutdown(unit, makeDiceRoller(7), 8);
      expect(result.shutdown).toBe(true);
    });

    it('no shutdown on roll >= target (heat 22: target 8, roll 8)', () => {
      const unit = makeUnit({ heat: 22 });
      const result = manager.checkShutdown(unit, makeDiceRoller(8), 8);
      expect(result.shutdown).toBe(false);
    });

    it('shutdown on roll < target (heat 23: target 10, roll 9)', () => {
      const unit = makeUnit({ heat: 23 });
      const result = manager.checkShutdown(unit, makeDiceRoller(9), 10);
      expect(result.shutdown).toBe(true);
    });

    it('no shutdown on roll >= target (heat 23: target 10, roll 10)', () => {
      const unit = makeUnit({ heat: 23 });
      const result = manager.checkShutdown(unit, makeDiceRoller(10), 10);
      expect(result.shutdown).toBe(false);
    });
  });

  describe('resolveHeatPhase', () => {
    it('processes all units in game state', () => {
      const unit1 = makeUnit({ heat: 15 });
      unit1.id = 'unit1';
      const unit2 = makeUnit({ heat: 8 });
      unit2.id = 'unit2';

      const gs = makeGameState({
        '4,4': {},
        '6,6': {}
      });
      gs.units = { unit1, unit2 };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(3));
      expect(results).toHaveLength(2);
      expect(results[0].unitId).toBe('unit1');
      expect(results[1].unitId).toBe('unit2');
    });

    it('applies dissipation then effects', () => {
      const unit = makeUnit({ heat: 28, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(3));
      expect(results[0].heat).toBe(18);
      expect(results[0].dissipation).toBe(10);
    });

    it('auto shutdown at heat 24+', () => {
      const unit = makeUnit({ heat: 25, heatSinks: { count: 0, damaged: 0, type: 'single' } });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(7));
      const effects = results[0].effects;
      expect(effects).toContain('Unit AUTO SHUTDOWN');
      expect(unit.shutdown).toBe(true);
    });

    it('auto ammo explosion at heat 24+', () => {
      const unit = makeUnit({ heat: 25, heatSinks: { count: 0, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { ac5: { shots: 10 } };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(7));
      const effects = results[0].effects;
      expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('auto'))).toBe(true);
    });

    it('ammo explosion check at heat 20 (target 6+)', () => {
      const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';
      unit.equipment.ammo = { lrm15: { shots: 15 } };

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(2));
      expect(results[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);

      const unit2 = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit2.id = 'u2';
      unit2.equipment.ammo = { lrm15: { shots: 15 } };
      const gs2 = makeGameState({ '4,4': {} });
      gs2.units = { u2: unit2 };
      const results2 = manager.resolveHeatPhase(gs2, makeDiceRoller(10));
      expect(results2[0].effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('10'))).toBe(true);
    });
  });
});
