/**
 * Residual fixes from the compliance sweep (review round 2 leftovers):
 * unconscious PSRs, engine/gyro criticals, the MTF heat-sink header, swamp
 * cost and the invented heat-29 row.
 */

import { describe, it, expect } from 'vitest';
import { PSRCalculator } from '../../src/rules/movement/PSRCalculator.js';
import { DamageResolver } from '../../src/rules/combat/DamageResolver.js';
import { MovementCalculator } from '../../src/rules/movement/MovementCalculator.js';
import { Hex } from '../../src/models/Hex.js';
import { mechDefToMTF } from '../../src/export/mtfExporter.js';
import { createTestUnit, makeDiceRoller } from '../helpers/testUtils.js';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };
import heatScale from '../../src/data/heatScale.json' with { type: 'json' };

describe('unconscious pilot (p54/p58)', () => {
  it('auto-fails every Piloting Skill Roll', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas');
    unit.pilot.conscious = false;

    const result = new PSRCalculator().makePSR(unit, makeDiceRoller(12), [{ trigger: 'Test', baseModifier: 0 }]);

    expect(result.passed).toBe(false);
    expect(result.targetNumber).toBe(999);
    expect(result.details).toContain('unconscious');
  });

  it('still rolls normally for a conscious pilot', () => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas');
    const result = new PSRCalculator().makePSR(unit, makeDiceRoller(12), [{ trigger: 'Test', baseModifier: 0 }]);
    expect(result.passed).toBe(true);
    expect(result.targetNumber).toBe(5);
  });
});

describe('engine and gyro criticals', () => {
  const withSlots = (item, hits) => {
    const unit = createTestUnit('atlas-as7d', 0, 'atlas');
    unit.criticalSlots.centerTorso = [{ slot: 1, item, status: 'ok' }];
    if (item === 'engine') unit.engine.hits = hits;
    if (item === 'gyro') unit.gyro.hits = hits;
    return unit;
  };

  it('the third engine critical destroys the Mech (p47)', () => {
    const unit = withSlots('engine', 2);
    new DamageResolver().applyCriticalHit(unit, 'centerTorso', makeDiceRoller(8));

    expect(unit.engine.hits).toBe(3);
    expect(unit.destroyed).toBe(true);
  });

  it('the second gyro critical puts the Mech on the ground (p48)', () => {
    const unit = withSlots('gyro', 1);
    new DamageResolver().applyCriticalHit(unit, 'centerTorso', makeDiceRoller(8));

    expect(unit.gyro.hits).toBe(2);
    expect(unit.prone).toBe(true);
  });
});

describe('MTF heat sink header (p50)', () => {
  it('writes the total sink count, not only the ones in critical slots', () => {
    const atlas = mechsData.mechs.find(m => m.id === 'atlas-as7d');
    const mtf = mechDefToMTF(atlas);

    expect(mtf).toContain('Heat Sinks:20 Single');
  });
});

describe('swamp cost (p136)', () => {
  it('costs 2 MP: one to enter plus the +1 swamp modification', () => {
    const calculator = new MovementCalculator();
    const from = new Hex('5,5', { terrainType: 'clear' });
    const to = new Hex('5,6', { terrainType: 'swamp' });

    expect(calculator.calculateMPCost(from, to, {}, 'walk')).toBe(2);
  });
});

describe('heat scale rows (p50/p52)', () => {
  it('has no invented heat-29 step', () => {
    const heats = heatScale.steps.map(s => s.heat);
    expect(heats).not.toContain(29);
    // The real steps either side remain.
    expect(heats).toContain(28);
    expect(heats).toContain(30);
  });
});
