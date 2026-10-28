/**
 * Import/export robustness: malformed input must not crash the pipeline, and
 * unknown items must still export with a readable name.
 */

import { describe, it, expect } from 'vitest';
import { parseMTF } from '../../src/import/mtfParser.js';
import { parseMUL } from '../../src/import/mulParser.js';
import { mechDefToMTF } from '../../src/export/mtfExporter.js';

const minimalDef = (extra = {}) => ({
  name: 'Test Mech TM-1',
  tonnage: 30,
  movement: { walk: 4, run: 6, jump: 0 },
  armor: {},
  criticalSlots: {},
  equipment: { weapons: [], ammo: {}, other: {} },
  heatSinks: { count: 10, type: 'single' },
  engine: { type: 'standard', rating: 120 },
  gyro: { type: 'standard' },
  ...extra
});

describe('MTF parser robustness', () => {
  it('returns a default record for empty input instead of throwing', () => {
    const parsed = parseMTF('');
    expect(parsed.mass).toBe(0);
    expect(parsed.chassis).toBe('');
    expect(parsed.heatSinks.count).toBe(10);
  });

  it('survives text that is not an MTF at all', () => {
    const parsed = parseMTF('complete junk\nmore junk\n\t<%%>');
    expect(parsed).toBeTypeOf('object');
    expect(parsed.config).toBe('Biped');
  });
});

describe('MUL parser robustness', () => {
  it('returns no units for HTML masquerading as a MUL', () => {
    expect(parseMUL('<html><body>not a mul</body></html>')).toEqual([]);
  });

  it('returns no units for empty input', () => {
    expect(parseMUL('')).toEqual([]);
  });
});

describe('MTF exporter edge cases', () => {
  it('exports a minimal record without armour or critical slots', () => {
    const mtf = mechDefToMTF(minimalDef());

    expect(mtf).toContain('Version:1.0');
    expect(mtf).toContain('Chassis:Test Mech');
    expect(mtf).toContain('Model:TM-1');
    expect(mtf).toContain('Mass:30');
    expect(mtf).toContain('Engine:120 Fusion Engine');
  });

  it('gives an unknown critical item a readable name', () => {
    const mtf = mechDefToMTF(minimalDef({
      criticalSlots: { head: [{ slot: 1, item: 'mystery_widget', status: 'ok' }] }
    }));

    expect(mtf).toContain('Mystery Widget');
  });

  it('marks empty slots as -Empty-', () => {
    const mtf = mechDefToMTF(minimalDef({
      criticalSlots: { head: [{ slot: 1, item: 'empty', status: 'ok' }] }
    }));

    expect(mtf).toContain('-Empty-');
  });
});
