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

const manager = new HeatManager();

// ─── Heat Generation ──────────────────────────────────────────────────────────

describe('calculateHeatGeneration', () => {
  it('returns 0 for no weapons fired and stationary movement', () => {
    const unit = makeUnit();
    expect(manager.calculateHeatGeneration(unit, [], 'stationary')).toBe(0);
  });

  it('sums heat from all fired weapons', () => {
    const unit = makeUnit();
    const weapons = [{ heat: 5 }, { heat: 3 }, { heat: 8 }];
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

  it('adds 0 heat for stationary', () => {
    const unit = makeUnit();
    const weapons = [{ heat: 5 }];
    expect(manager.calculateHeatGeneration(unit, weapons, 'stationary')).toBe(5);
  });

  it('adds 3 heat per hex jumped, minimum 3 (0 hex jump still costs 3)', () => {
    const unit = makeUnit();
    const weapons = [];
    expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 0)).toBe(3);
    expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 1)).toBe(3);
    expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 2)).toBe(6);
    expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 5)).toBe(15);
    expect(manager.calculateHeatGeneration(unit, weapons, 'jump', 7)).toBe(21);
  });

  it('adds external heat sources (fire, plasma, etc.)', () => {
    const unit = makeUnit({ _externalHeat: 4 });
    const weapons = [{ heat: 5 }];
    expect(manager.calculateHeatGeneration(unit, weapons, 'stationary')).toBe(9);
  });

  it('combines weapon heat, movement heat, and external heat', () => {
    const unit = makeUnit({ _externalHeat: 2 });
    const weapons = [{ heat: 10 }, { heat: 5 }];
    expect(manager.calculateHeatGeneration(unit, weapons, 'run')).toBe(19);
  });
});

// ─── Heat Dissipation ─────────────────────────────────────────────────────────

describe('applyHeatDissipation', () => {
  it('dissipates heat equal to the number of functional single heat sinks', () => {
    const unit = makeUnit({ heat: 20 });
    const gs = makeGameState({ '4,4': {} });
    const dissipated = manager.applyHeatDissipation(unit, gs);
    expect(dissipated).toBe(10);
    expect(unit.heat).toBe(10);
  });

  it('never reduces heat below 0', () => {
    const unit = makeUnit({ heat: 5 });
    const gs = makeGameState({ '4,4': {} });
    manager.applyHeatDissipation(unit, gs);
    expect(unit.heat).toBe(0);
  });

  it('accounts for damaged heat sinks', () => {
    const unit = makeUnit({ heat: 20, heatSinks: { count: 10, damaged: 3, type: 'single' } });
    const gs = makeGameState({ '4,4': {} });
    const dissipated = manager.applyHeatDissipation(unit, gs);
    expect(dissipated).toBe(7);
    expect(unit.heat).toBe(13);
  });

  it('double heat sinks dissipate 2 heat per sink', () => {
    const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'double' } });
    const gs = makeGameState({ '4,4': {} });
    const dissipated = manager.applyHeatDissipation(unit, gs);
    expect(dissipated).toBe(20);
  });

  it('damaged double heat sinks reduce dissipation by 2 each', () => {
    const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 2, type: 'double' } });
    const gs = makeGameState({ '4,4': {} });
    const dissipated = manager.applyHeatDissipation(unit, gs);
    expect(dissipated).toBe(16);
  });

  describe('water leg sink bonus', () => {
    it('doubles dissipation from operational leg-mounted heat sinks in water_depth1', () => {
      const unit = makeUnit({ heat: 30 });
      unit.criticalSlots = {
        leftLeg: [
          { item: 'heat_sink', status: 'ok' },
          { item: 'heat_sink', status: 'ok' }
        ],
        rightLeg: [
          { item: 'heat_sink', status: 'ok' }
        ]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(13);
      expect(unit.heat).toBe(17);
    });

    it('doubles dissipation from operational leg-mounted heat sinks in water_depth2', () => {
      const unit = makeUnit({ heat: 30 });
      unit.criticalSlots = {
        leftLeg: [{ item: 'heat_sink', status: 'ok' }, { item: 'heat_sink', status: 'ok' }],
        rightLeg: [{ item: 'heat_sink', status: 'ok' }]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth2' } });
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

    it('does not grant water bonus when standing on clear terrain', () => {
      const unit = makeUnit({ heat: 30 });
      unit.criticalSlots = {
        leftLeg: [{ item: 'heat_sink', status: 'ok' }],
        rightLeg: [{ item: 'heat_sink', status: 'ok' }]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'clear' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(10);
    });

    it('only counts operational (status "ok") leg heat sinks', () => {
      const unit = makeUnit({ heat: 30 });
      unit.criticalSlots = {
        leftLeg: [
          { item: 'heat_sink', status: 'ok' },
          { item: 'heat_sink', status: 'crit' }
        ],
        rightLeg: [
          { item: 'heat_sink', status: 'ok' }
        ]
      };
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(12);
    });

    it('returns base dissipation when unit has no criticalSlots', () => {
      const unit = makeUnit({ heat: 20 });
      const gs = makeGameState({ '4,4': { terrainType: 'water_depth1' } });
      const dissipated = manager.applyHeatDissipation(unit, gs);
      expect(dissipated).toBe(10);
    });
  });
});

// ─── Heat Effects — BMM Full 20+ Threshold Scale ──────────────────────────────

describe('applyHeatEffects', () => {
  it('resets _movementModifier to 0 before applying effects', () => {
    const unit = makeUnit({ heat: 0, _movementModifier: 5 });
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit._movementModifier).toBe(0);
  });

  // ── Heat 0-13: No effects ──────────────────────────────────────────────────

  describe('heat 0-13: no penalties', () => {
    [0, 5, 8, 10, 13].forEach((heat) => {
      it(`heat ${heat} produces no effects, no shutdown/ammo checks, full MP`, () => {
        const unit = makeUnit({ heat, movement: { walk: 4 } });
        const result = manager.applyHeatEffects(unit, makeDiceRoller());
        expect(result.effects).toHaveLength(0);
        expect(result.shutdownCheck).toBe(false);
        expect(result.ammoExplosionCheck).toBe(false);
        expect(unit.currentMP).toBe(4);
      });
    });
  });

  // ── Heat 14: +1 TN ─────────────────────────────────────────────────────────

  it('heat 14: +1 TN to weapons fire, no MP penalty', () => {
    const unit = makeUnit({ heat: 14, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.effects).toContain('+1 TN to weapons fire');
    expect(result.effects).toHaveLength(1);
    expect(result.shutdownCheck).toBe(false);
    expect(result.ammoExplosionCheck).toBe(false);
    expect(result.shutdownTarget).toBeNull();
    expect(result.ammoTarget).toBeNull();
    expect(unit.currentMP).toBe(4);
  });

  // ── Heat 15: +2 TN ─────────────────────────────────────────────────────────

  it('heat 15: +2 TN to weapons fire, no MP penalty', () => {
    const unit = makeUnit({ heat: 15, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.effects).toContain('+2 TN to weapons fire');
    expect(result.effects).toHaveLength(1);
    expect(result.shutdownCheck).toBe(false);
    expect(result.ammoExplosionCheck).toBe(false);
    expect(unit.currentMP).toBe(4);
  });

  // ── Heat 16: +3 TN ─────────────────────────────────────────────────────────

  it('heat 16: +3 TN to weapons fire, no MP penalty', () => {
    const unit = makeUnit({ heat: 16, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.effects).toContain('+3 TN to weapons fire');
    expect(result.effects).toHaveLength(1);
    expect(result.shutdownCheck).toBe(false);
    expect(result.ammoExplosionCheck).toBe(false);
    expect(unit.currentMP).toBe(4);
  });

  // ── Heat 17: +4 TN ─────────────────────────────────────────────────────────

  it('heat 17: +4 TN to weapons fire, no MP penalty', () => {
    const unit = makeUnit({ heat: 17, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.effects).toContain('+4 TN to weapons fire');
    expect(result.effects).toHaveLength(1);
    expect(result.shutdownCheck).toBe(false);
    expect(result.ammoExplosionCheck).toBe(false);
    expect(unit.currentMP).toBe(4);
  });

  // ── Heat 18: +5 TN, -1 Walk MP ─────────────────────────────────────────────

  it('heat 18: +5 TN to weapons fire, -1 Walk MP', () => {
    const unit = makeUnit({ heat: 18, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.effects).toContain('+5 TN to weapons fire');
    expect(result.effects).toContain('-1 Walk MP');
    expect(result.shutdownCheck).toBe(false);
    expect(result.ammoExplosionCheck).toBe(false);
    expect(unit.currentMP).toBe(3);
  });

  // ── Heat 19: +6 TN, -2 Walk MP, ammo explosion (4+) ───────────────────────

  it('heat 19: +6 TN to weapons fire, -2 Walk MP, ammo explosion check (4+)', () => {
    const unit = makeUnit({ heat: 19, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.effects).toContain('+6 TN to weapons fire');
    expect(result.effects).toContain('-2 Walk MP');
    expect(result.shutdownCheck).toBe(false);
    expect(result.ammoExplosionCheck).toBe(true);
    expect(result.ammoTarget).toBe(4);
    expect(unit.currentMP).toBe(2);
  });

  // ── Heat 20: +7 TN, -3 Walk MP, shutdown (4+), ammo (6+) ──────────────────

  it('heat 20: +7 TN to weapons fire, -3 Walk MP, shutdown check (4+), ammo check (6+)', () => {
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

  // ── Heat 21: +8 TN, -4 Walk MP, shutdown (6+), ammo (8+) ──────────────────

  it('heat 21: +8 TN to weapons fire, -4 Walk MP, shutdown check (6+), ammo check (8+)', () => {
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

  // ── Heat 22: +9 TN, -5 Walk MP, shutdown (8+), ammo (10+) ─────────────────

  it('heat 22: +9 TN to weapons fire, -5 Walk MP, shutdown check (8+), ammo check (10+)', () => {
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

  // ── Heat 23: +10 TN, -6 Walk MP, shutdown (10+), ammo (12+) ───────────────

  it('heat 23: +10 TN to weapons fire, -6 Walk MP, shutdown check (10+), ammo check (12+)', () => {
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

  // ── Heat 24+: auto shutdown, auto ammo ─────────────────────────────────────

  it('heat 24+: auto shutdown, auto ammo explosion, movement crippled to 0', () => {
    const unit = makeUnit({ heat: 25, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.shutdownCheck).toBe(true);
    expect(result.shutdownTarget).toBe('auto');
    expect(result.ammoExplosionCheck).toBe(true);
    expect(result.ammoTarget).toBe('auto');
    expect(unit.currentMP).toBe(0);
  });

  it('heat 24 (exact): auto shutdown, auto ammo explosion', () => {
    const unit = makeUnit({ heat: 24, movement: { walk: 4 } });
    const result = manager.applyHeatEffects(unit, makeDiceRoller());
    expect(result.shutdownCheck).toBe(true);
    expect(result.shutdownTarget).toBe('auto');
    expect(result.ammoExplosionCheck).toBe(true);
    expect(result.ammoTarget).toBe('auto');
    expect(unit.currentMP).toBe(0);
  });

  // ── Parameterized full heat scale table ────────────────────────────────────

  it('applies correct escalating thresholds for every heat level 14-24+', () => {
    const thresholds = [
      // [heat, tnMod, mpLoss, shutdownTarget, ammoTarget]
      [14, '+1 TN to weapons fire', 0, null, null],
      [15, '+2 TN to weapons fire', 0, null, null],
      [16, '+3 TN to weapons fire', 0, null, null],
      [17, '+4 TN to weapons fire', 0, null, null],
      [18, '+5 TN to weapons fire', 1, null, null],
      [19, '+6 TN to weapons fire', 2, null, 4],
      [20, '+7 TN to weapons fire', 3, 4,    6],
      [21, '+8 TN to weapons fire', 4, 6,    8],
      [22, '+9 TN to weapons fire', 5, 8,    10],
      [23, '+10 TN to weapons fire', 6, 10,  12],
      [24, null, 999, 'auto', 'auto'],
      [30, null, 999, 'auto', 'auto'],
    ];

    for (const [heat, tnEffect, mpLoss, shutdownTarget, ammoTarget] of thresholds) {
      const walk = (heat === 22 || heat === 23) ? 6 : 4;
      const unit = makeUnit({ heat, movement: { walk } });
      const result = manager.applyHeatEffects(unit, makeDiceRoller());
      const expectedRaw = walk - mpLoss;
      const expectedMP = Math.max(0, expectedRaw);

      if (tnEffect) {
        expect(result.effects).toContain(tnEffect);
      }
      expect(result.shutdownCheck, `heat=${heat} shutdownCheck`).toBe(shutdownTarget !== null);
      expect(result.shutdownTarget, `heat=${heat} shutdownTarget`).toBe(shutdownTarget);
      expect(result.ammoExplosionCheck, `heat=${heat} ammoCheck`).toBe(ammoTarget !== null);
      expect(result.ammoTarget, `heat=${heat} ammoTarget`).toBe(ammoTarget);
      expect(unit.currentMP, `heat=${heat} currentMP`).toBe(expectedMP);
    }
  });

  it('currentMP is never negative even at high heat on slow mechs', () => {
    const unit = makeUnit({ heat: 20, movement: { walk: 2 } });
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(0);
  });

  it('warm mech with high walk MP still has remaining movement at heat 18', () => {
    const unit = makeUnit({ heat: 18, movement: { walk: 8 } });
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(7);
  });
});

// ─── TSM (Triple Strength Myomer) ────────────────────────────────────────────

describe('TSM +2 walk MP', () => {
  it('grants +2 walk MP at exactly 9 heat', () => {
    const unit = makeUnit({ heat: 9, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(6);
  });

  it('grants +2 walk MP at heat 10 (above activation threshold)', () => {
    const unit = makeUnit({ heat: 10, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(6);
  });

  it('grants +2 walk MP at heat 13 (no MP reduction range)', () => {
    const unit = makeUnit({ heat: 13, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(6);
  });

  it('offsets MP penalties at high heat (heat 18: 4 - 1 + 2 = 5)', () => {
    const unit = makeUnit({ heat: 18, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(5);
  });

  it('offsets MP penalties at heat 20 (4 - 3 + 2 = 3)', () => {
    const unit = makeUnit({ heat: 20, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(3);
  });

  it('offsets MP penalties at heat 22 (6 - 5 + 2 = 3)', () => {
    const unit = makeUnit({ heat: 22, movement: { walk: 6 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(3);
  });

  it('at heat 24+ TSM cannot overcome MP floor of 0', () => {
    const unit = makeUnit({ heat: 25, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(0);
  });

  it('does not activate at heat 8 (below threshold)', () => {
    const unit = makeUnit({ heat: 8, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(4);
  });

  it('does not activate at heat 0', () => {
    const unit = makeUnit({ heat: 0, movement: { walk: 4 } });
    unit.equipment.other = { tsm: true };
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(4);
  });

  it('has no effect when unit lacks TSM', () => {
    const unit = makeUnit({ heat: 12, movement: { walk: 4 } });
    manager.applyHeatEffects(unit, makeDiceRoller());
    expect(unit.currentMP).toBe(4);
  });
});

// ─── Shutdown — Escalating Rolls ─────────────────────────────────────────────

describe('checkShutdown', () => {
  it('returns no shutdown when shutdownTarget is falsy (null/undefined/0)', () => {
    const unit = makeUnit({ heat: 22 });
    const result = manager.checkShutdown(unit, makeDiceRoller(7));
    expect(result.shutdown).toBe(false);
    expect(result.target).toBe(0);
  });

  it('auto shutdown (target "auto") immediately shuts down the unit', () => {
    const unit = makeUnit({ heat: 25 });
    const result = manager.checkShutdown(unit, makeDiceRoller(7), 'auto');
    expect(result.shutdown).toBe(true);
    expect(result.target).toBe('auto');
    expect(unit.shutdown).toBe(true);
  });

  // ── Heat 20: shutdown target 4+ ───────────────────────────────────────────

  it('heat 20 (target 4+): roll 3 < 4 → shutdown', () => {
    const unit = makeUnit({ heat: 20 });
    const result = manager.checkShutdown(unit, makeDiceRoller(3), 4);
    expect(result.shutdown).toBe(true);
    expect(result.target).toBe(4);
    expect(unit.shutdown).toBe(true);
  });

  it('heat 20 (target 4+): roll 4 >= 4 → no shutdown', () => {
    const unit = makeUnit({ heat: 20 });
    const result = manager.checkShutdown(unit, makeDiceRoller(4), 4);
    expect(result.shutdown).toBe(false);
  });

  it('heat 20 (target 4+): roll 12 >= 4 → no shutdown', () => {
    const unit = makeUnit({ heat: 20 });
    const result = manager.checkShutdown(unit, makeDiceRoller(12), 4);
    expect(result.shutdown).toBe(false);
  });

  // ── Heat 21: shutdown target 6+ ───────────────────────────────────────────

  it('heat 21 (target 6+): roll 5 < 6 → shutdown', () => {
    const unit = makeUnit({ heat: 21 });
    const result = manager.checkShutdown(unit, makeDiceRoller(5), 6);
    expect(result.shutdown).toBe(true);
  });

  it('heat 21 (target 6+): roll 6 >= 6 → no shutdown', () => {
    const unit = makeUnit({ heat: 21 });
    const result = manager.checkShutdown(unit, makeDiceRoller(6), 6);
    expect(result.shutdown).toBe(false);
  });

  // ── Heat 22: shutdown target 8+ ───────────────────────────────────────────

  it('heat 22 (target 8+): roll 7 < 8 → shutdown', () => {
    const unit = makeUnit({ heat: 22 });
    const result = manager.checkShutdown(unit, makeDiceRoller(7), 8);
    expect(result.shutdown).toBe(true);
  });

  it('heat 22 (target 8+): roll 8 >= 8 → no shutdown', () => {
    const unit = makeUnit({ heat: 22 });
    const result = manager.checkShutdown(unit, makeDiceRoller(8), 8);
    expect(result.shutdown).toBe(false);
  });

  // ── Heat 23: shutdown target 10+ ──────────────────────────────────────────

  it('heat 23 (target 10+): roll 9 < 10 → shutdown', () => {
    const unit = makeUnit({ heat: 23 });
    const result = manager.checkShutdown(unit, makeDiceRoller(9), 10);
    expect(result.shutdown).toBe(true);
  });

  it('heat 23 (target 10+): roll 10 >= 10 → no shutdown', () => {
    const unit = makeUnit({ heat: 23 });
    const result = manager.checkShutdown(unit, makeDiceRoller(10), 10);
    expect(result.shutdown).toBe(false);
  });

  it('heat 23 (target 10+): roll 11 >= 10 → no shutdown', () => {
    const unit = makeUnit({ heat: 23 });
    const result = manager.checkShutdown(unit, makeDiceRoller(11), 10);
    expect(result.shutdown).toBe(false);
  });

  // ── Parameterized escalating shutdown thresholds ───────────────────────────

  it('shutdown target escalates correctly: 4→6→8→10→auto', () => {
    const thresholds = [
      [20, 4],
      [21, 6],
      [22, 8],
      [23, 10],
    ];

    for (const [heat, target] of thresholds) {
      const unit = makeUnit({ heat, movement: { walk: 4 } });
      const effects = manager.applyHeatEffects(unit, makeDiceRoller());
      expect(effects.shutdownCheck, `heat=${heat}`).toBe(true);
      expect(effects.shutdownTarget, `heat=${heat}`).toBe(target);
    }

    const unit24 = makeUnit({ heat: 24, movement: { walk: 4 } });
    const effects24 = manager.applyHeatEffects(unit24, makeDiceRoller());
    expect(effects24.shutdownTarget).toBe('auto');
  });
});

// ─── Heat Phase Resolution ───────────────────────────────────────────────────

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

  it('auto shutdown at heat 24+', () => {
    const unit = makeUnit({ heat: 25, heatSinks: { count: 0, damaged: 0, type: 'single' } });
    unit.id = 'u1';

    const gs = makeGameState({ '4,4': {} });
    gs.units = { u1: unit };

    const results = manager.resolveHeatPhase(gs, makeDiceRoller(7));
    expect(results[0].effects).toContain('Unit AUTO SHUTDOWN');
    expect(unit.shutdown).toBe(true);
  });

  it('auto ammo explosion at heat 24+ drains all ammo bins', () => {
    const unit = makeUnit({ heat: 25, heatSinks: { count: 0, damaged: 0, type: 'single' } });
    unit.id = 'u1';
    unit.equipment.ammo = { ac5: { shots: 10 }, lrm15: { shots: 15 } };

    const gs = makeGameState({ '4,4': {} });
    gs.units = { u1: unit };

    const results = manager.resolveHeatPhase(gs, makeDiceRoller(7));
    const effects = results[0].effects;
    expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('ac5') && e.includes('auto'))).toBe(true);
    expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('lrm15') && e.includes('auto'))).toBe(true);
    expect(unit.equipment.ammo.ac5.shots).toBe(0);
    expect(unit.equipment.ammo.lrm15.shots).toBe(0);
  });

  // ── Escalating ammo explosion checks ───────────────────────────────────────

  describe('escalating ammo explosion rolls', () => {
    function setupAmmoUnit(heat, sinkCount = 10) {
      const unit = makeUnit({ heat, heatSinks: { count: sinkCount, damaged: 0, type: 'single' } });
      unit.id = 'u-ammo';
      unit.equipment.ammo = { lrm15: { shots: 15 } };
      return unit;
    }

    it('heat 19 (ammo target 4+): roll 4 triggers explosion, roll 3 does not', () => {
      const gs = makeGameState({ '4,4': {} });

      const u1 = setupAmmoUnit(29);
      gs.units = { u1 };
      const r1 = manager.resolveHeatPhase(gs, makeDiceRoller(4));
      expect(r1[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);

      const u2 = setupAmmoUnit(29);
      const gs2 = makeGameState({ '4,4': {} });
      gs2.units = { u2 };
      const r2 = manager.resolveHeatPhase(gs2, makeDiceRoller(3));
      expect(r2[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
    });

    it('heat 20 (ammo target 6+): roll 6 triggers explosion, roll 5 does not', () => {
      const u1 = setupAmmoUnit(30);
      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1 };
      const r1 = manager.resolveHeatPhase(gs, makeDiceRoller(6));
      expect(r1[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);

      const u2 = setupAmmoUnit(30);
      const gs2 = makeGameState({ '4,4': {} });
      gs2.units = { u2 };
      const r2 = manager.resolveHeatPhase(gs2, makeDiceRoller(5));
      expect(r2[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
    });

    it('heat 21 (ammo target 8+): roll 8 triggers explosion, roll 7 does not', () => {
      const u1 = setupAmmoUnit(31);
      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1 };
      const r1 = manager.resolveHeatPhase(gs, makeDiceRoller(8));
      expect(r1[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);

      const u2 = setupAmmoUnit(31);
      const gs2 = makeGameState({ '4,4': {} });
      gs2.units = { u2 };
      const r2 = manager.resolveHeatPhase(gs2, makeDiceRoller(7));
      expect(r2[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
    });

    it('heat 22 (ammo target 10+): roll 10 triggers explosion, roll 9 does not', () => {
      const u1 = setupAmmoUnit(32);
      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1 };
      const r1 = manager.resolveHeatPhase(gs, makeDiceRoller(10));
      expect(r1[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);

      const u2 = setupAmmoUnit(32);
      const gs2 = makeGameState({ '4,4': {} });
      gs2.units = { u2 };
      const r2 = manager.resolveHeatPhase(gs2, makeDiceRoller(9));
      expect(r2[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
    });

    it('heat 23 (ammo target 12+): roll 12 triggers explosion, roll 11 does not', () => {
      const u1 = setupAmmoUnit(33);
      const gs = makeGameState({ '4,4': {} });
      gs.units = { u1 };
      const r1 = manager.resolveHeatPhase(gs, makeDiceRoller(12));
      expect(r1[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(true);

      const u2 = setupAmmoUnit(33);
      const gs2 = makeGameState({ '4,4': {} });
      gs2.units = { u2 };
      const r2 = manager.resolveHeatPhase(gs2, makeDiceRoller(11));
      expect(r2[0].effects.some(e => e.includes('AMMO EXPLOSION'))).toBe(false);
    });
  });

  it('ammo explosion drains shots to 0', () => {
    const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
    unit.id = 'u1';
    unit.equipment.ammo = { lrm15: { shots: 15 } };

    const gs = makeGameState({ '4,4': {} });
    gs.units = { u1: unit };

    manager.resolveHeatPhase(gs, makeDiceRoller(10));
    expect(unit.equipment.ammo.lrm15.shots).toBe(0);
  });

  it('skips ammo bins with 0 shots', () => {
    const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
    unit.id = 'u1';
    unit.equipment.ammo = { empty: { shots: 0 }, lrm15: { shots: 15 } };

    const gs = makeGameState({ '4,4': {} });
    gs.units = { u1: unit };

    const results = manager.resolveHeatPhase(gs, makeDiceRoller(10));
    const effects = results[0].effects;
    expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('empty'))).toBe(false);
    expect(effects.some(e => e.includes('AMMO EXPLOSION') && e.includes('lrm15'))).toBe(true);
    expect(unit.equipment.ammo.empty.shots).toBe(0);
    expect(unit.equipment.ammo.lrm15.shots).toBe(0);
  });

  it('non-auto shutdown in resolveHeatPhase uses roll and adds message', () => {
    const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
    unit.id = 'u1';

    const gs = makeGameState({ '4,4': {} });
    gs.units = { u1: unit };

    const results = manager.resolveHeatPhase(gs, makeDiceRoller(2));
    expect(results[0].effects.some(e => e.includes('SHUTDOWN') && !e.includes('AUTO'))).toBe(true);
    expect(unit.shutdown).toBe(true);
  });

  it('shutdown in resolveHeatPhase adds shutdown message to effects', () => {
    const unit = makeUnit({ heat: 30, heatSinks: { count: 10, damaged: 0, type: 'single' } });
    unit.id = 'u1';

    const gs = makeGameState({ '4,4': {} });
    gs.units = { u1: unit };

    const results = manager.resolveHeatPhase(gs, makeDiceRoller(2));
    expect(results[0].effects.some(e => e.includes('SHUTDOWN'))).toBe(true);
  });
});
