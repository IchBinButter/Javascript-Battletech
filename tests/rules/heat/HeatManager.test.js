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
      expect(manager.calculateHeatGeneration(unit, weapons, 'run')).toBe(7); // 5 + 2
    });

    it('adds 0 heat for walking', () => {
      const unit = makeUnit();
      const weapons = [{ heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'walk')).toBe(5);
    });

    it('adds 3 heat per hex jumped (minimum 3)', () => {
      const unit = makeUnit();
      const weapons = [];
      expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 0)).toBe(3); // min 3
      expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 2)).toBe(6); // 2*3
      expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 5)).toBe(15); // 5*3
    });

    it('adds external heat', () => {
      const unit = makeUnit({ _externalHeat: 4 });
      const weapons = [{ heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'stationary')).toBe(9);
    });

    it('combines weapon + movement + external heat', () => {
      const unit = makeUnit({ _externalHeat: 2 });
      const weapons = [{ heat: 10 }, { heat: 5 }];
      expect(manager.calculateHeatGeneration(unit, weapons, 'run')).toBe(19); // 15 + 2 + 2
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
      // No leg sinks in criticalSlots
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(10); // Only base 10, no leg sink bonus
    });

    it('accounts for damaged heat sinks', () => {
      const unit = makeUnit({ heat: 20, heatSinks: { count: 10, damaged: 3, type: 'single' } });
      const gs = makeGameState({ '4,4': {} });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(7); // 10 - 3
      expect(unit.heat).toBe(13);
    });

    it('double heat sinks dissipate 2 per sink', () => {
      const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'double' } });
      const gs = makeGameState({ '4,4': {} });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(20); // 10 * 2
    });
  });

  describe('applyHeatEffects', () => {
    it('no effects below heat 5', () => {
      const unit = makeUnit({ heat: 4 });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toHaveLength(0);
      expect(result.shutdownCheck).toBe(false);
      expect(result.ammoExplosionCheck).toBe(false);
    });

    it('+1 TN at heat 5-9', () => {
      const unit = makeUnit({ heat: 7, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+1 TN to weapons fire');
    });

    it('+2 TN and -1 MP at heat 10-14', () => {
      const unit = makeUnit({ heat: 12, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+2 TN to weapons fire');
      expect(result.effects).toContain('-1 Walk MP');
      expect(unit.currentMP).toBe(3); // 4 - 1
    });

    it('+3 TN and -2 MP at heat 15-19', () => {
      const unit = makeUnit({ heat: 17, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+3 TN to weapons fire');
      expect(result.effects).toContain('-2 Walk MP');
      expect(unit.currentMP).toBe(2); // 4 - 2
      expect(result.ammoExplosionCheck).toBe(false); // Ammo explosion only at 24+
    });

    it('+4 TN, -3 MP, shutdown check at heat 20-23', () => {
      const unit = makeUnit({ heat: 22, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+4 TN to weapons fire');
      expect(result.effects).toContain('-3 Walk MP');
      expect(unit.currentMP).toBe(1); // 4 - 3
      expect(result.shutdownCheck).toBe(true);
      expect(result.ammoExplosionCheck).toBe(false); // Ammo explosion only at 24+
    });

    it('shutdown check and ammo explosion at heat 24+', () => {
      const unit = makeUnit({ heat: 25, movement: { walk: 4 } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(result.effects).toContain('+4 TN to weapons fire');
      expect(result.effects).toContain('-3 Walk MP');
      expect(result.shutdownCheck).toBe(true); // Roll 4+ to avoid shutdown
      expect(result.ammoExplosionCheck).toBe(true); // Roll 8+ for ammo explosion
    });

    it('MP does not go below 0', () => {
      const unit = makeUnit({ heat: 22, movement: { walk: 2 } });
      manager.applyHeatEffects(unit, makeDiceRoller());
      expect(unit.currentMP).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkShutdown', () => {
    it('does not check shutdown below heat 20', () => {
      const unit = makeUnit({ heat: 15 });
      const result = manager.checkShutdown(unit, makeDiceRoller(7));
      expect(result.shutdown).toBe(false);
      expect(result.target).toBe(0);
    });

    it('shuts down on roll < 4 at heat 20+', () => {
      const unit = makeUnit({ heat: 22 });
      const result = manager.checkShutdown(unit, makeDiceRoller(3));
      expect(result.shutdown).toBe(true); // Roll < 4 = shutdown
      expect(result.target).toBe(4);
      expect(unit.shutdown).toBe(true);
    });

    it('does not shut down on roll >= 4 at heat 20+', () => {
      const unit = makeUnit({ heat: 22 });
      const result = manager.checkShutdown(unit, makeDiceRoller(4));
      expect(result.shutdown).toBe(false); // Roll >= 4 = avoid shutdown
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
      const unit = makeUnit({ heat: 16, heatSinks: { count: 10, damaged: 0, type: 'single' } });
      unit.id = 'u1';

      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1: unit };

      const results = manager.resolveHeatPhase(gs, makeDiceRoller(3));
      // Dissipation: 16 - 10 = 6 heat remaining
      // At heat 6: +1 TN effect
      expect(results[0].heat).toBe(6);
      expect(results[0].dissipation).toBe(10);
    });
  });
});
