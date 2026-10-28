/**
 * Design quirks (BMM p82-95): the data table and the pure accessors that the
 * attack resolver, the PSR calculator and the heat manager consult.
 *
 * Each rule is tested in isolation so a modifier cannot silently ride on
 * another quirk's test.
 */

import { describe, it, expect } from 'vitest';
import {
  getQuirkTable,
  getQuirkDefinition,
  getUnitQuirks,
  resolveQuirkEntry,
  getActiveQuirks,
  getQuirk,
  hasQuirk,
  quirkTargetModifier,
  quirkPSRModifier,
  quirkHeatModifier
} from '../../../src/rules/quirks/Quirks.js';

const RULE_KINDS = ['target', 'psr', 'heat'];

const REQUIRED_IDS = [
  'poor_targeting_short',
  'poor_targeting_medium',
  'poor_targeting_long',
  'sensor_ghosts',
  'inaccurate_weapon',
  'cramped_cockpit',
  'hard_to_pilot',
  'unbalanced',
  'poor_cooling_jacket'
];

function makeUnit(quirks = []) {
  return { id: 'test_unit', quirks };
}

// ---------------------------------------------------------------------------
// The data table
// ---------------------------------------------------------------------------

describe('quirks.json', () => {
  const table = getQuirkTable();

  it('contains every implemented quirk', () => {
    const ids = table.map(quirk => quirk.id);
    expect(ids).toEqual(expect.arrayContaining(REQUIRED_IDS));
  });

  it('has no duplicate ids', () => {
    const ids = table.map(quirk => quirk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every quirk a name, type, cost, page and description', () => {
    for (const quirk of table) {
      expect(quirk.name, quirk.id).toBeTruthy();
      expect(quirk.type, quirk.id).toBe('negative');
      expect(typeof quirk.cost === 'number' || quirk.cost === 'variable', quirk.id).toBe(true);
      expect(quirk.page, quirk.id).toBeGreaterThan(0);
      expect(quirk.description, quirk.id).toBeTruthy();
    }
  });

  it('has numeric costs except for the variable-cost quirks', () => {
    for (const quirk of table) {
      if (quirk.id === 'inaccurate_weapon') {
        expect(quirk.cost).toBe('variable');
      } else {
        expect(typeof quirk.cost, quirk.id).toBe('number');
        expect(quirk.cost, quirk.id).toBeGreaterThan(0);
      }
    }
  });

  it('uses a known rule kind for each quirk', () => {
    for (const quirk of table) {
      expect(RULE_KINDS, quirk.id).toContain(quirk.rule);
    }
  });

  it('files Poor Targeting by bracket and Sensor Ghosts on all attacks', () => {
    const brackets = {};
    for (const quirk of table.filter(q => q.id.startsWith('poor_targeting'))) {
      expect(quirk.rule).toBe('target');
      expect(quirk.scope).toBe('rangeBracket');
      expect(quirk.modifier).toBe(1);
      brackets[quirk.rangeBracket] = true;
    }
    expect(Object.keys(brackets).sort()).toEqual(['long', 'medium', 'short']);

    const ghosts = getQuirkDefinition('sensor_ghosts');
    expect(ghosts.rule).toBe('target');
    expect(ghosts.scope).toBe('all');
    expect(ghosts.modifier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

describe('quirk accessors', () => {
  it('finds a string entry by id', () => {
    const unit = makeUnit(['cramped_cockpit', 'hard_to_pilot']);
    expect(hasQuirk(unit, 'cramped_cockpit')).toBe(true);
    expect(hasQuirk(unit, 'hard_to_pilot')).toBe(true);
    expect(hasQuirk(unit, 'sensor_ghosts')).toBe(false);
  });

  it('returns null for a quirk the unit does not have', () => {
    expect(getQuirk(makeUnit(), 'cramped_cockpit')).toBeNull();
  });

  it('merges the per-Mech weapon parameter into the definition', () => {
    const unit = makeUnit([{ id: 'poor_cooling_jacket', weapon: 'ac20' }]);
    const quirk = getQuirk(unit, 'poor_cooling_jacket');

    expect(quirk.id).toBe('poor_cooling_jacket');
    expect(quirk.name).toBe('Poor Cooling Jacket');
    expect(quirk.rule).toBe('heat');
    expect(quirk.weapon).toBe('ac20');
  });

  it('treats unknown ids as inert', () => {
    const unit = makeUnit(['not_a_real_quirk']);
    expect(hasQuirk(unit, 'not_a_real_quirk')).toBe(false);
    expect(getQuirk(unit, 'not_a_real_quirk')).toBeNull();
    expect(getActiveQuirks(unit)).toEqual([]);
    expect(quirkTargetModifier(unit, { rangeBracket: 'long' }).modifier).toBe(0);
    expect(quirkPSRModifier(unit, { triggers: [] }).modifier).toBe(0);
    expect(quirkHeatModifier(unit, 'ac20')).toBe(0);
  });

  it('tolerates a unit without a quirks array', () => {
    expect(getUnitQuirks({})).toEqual([]);
    expect(getUnitQuirks(null)).toEqual([]);
    expect(getActiveQuirks({})).toEqual([]);
    expect(quirkTargetModifier({}, {}).modifier).toBe(0);
    expect(quirkPSRModifier({}, {}).modifier).toBe(0);
    expect(quirkHeatModifier({}, 'ac20')).toBe(0);
  });

  it('resolves a single entry against the table', () => {
    expect(resolveQuirkEntry('sensor_ghosts')).toMatchObject({
      id: 'sensor_ghosts',
      rule: 'target'
    });
    expect(resolveQuirkEntry({ id: 'unbalanced' })).toMatchObject({
      id: 'unbalanced',
      rule: 'psr'
    });
    expect(resolveQuirkEntry('bogus')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Target Number modifiers
// ---------------------------------------------------------------------------

describe('quirkTargetModifier', () => {
  describe('Poor Targeting', () => {
    it.each([
      ['poor_targeting_short', 'short'],
      ['poor_targeting_medium', 'medium'],
      ['poor_targeting_long', 'long']
    ])('%s adds +1 only in its own bracket', (id, bracket) => {
      const unit = makeUnit([id]);

      expect(quirkTargetModifier(unit, { rangeBracket: bracket }).modifier).toBe(1);

      for (const other of ['short', 'medium', 'long'].filter(b => b !== bracket)) {
        expect(quirkTargetModifier(unit, { rangeBracket: other }).modifier).toBe(0);
      }
    });

    it('states the reason for the Target Number breakdown', () => {
      const unit = makeUnit(['poor_targeting_long']);
      expect(quirkTargetModifier(unit, { rangeBracket: 'long' }).reasons)
        .toEqual(['Poor Targeting (Long): +1']);
    });

    it('does not bite when the bracket is unknown', () => {
      const unit = makeUnit(['poor_targeting_short']);
      expect(quirkTargetModifier(unit, {}).modifier).toBe(0);
    });
  });

  describe('Sensor Ghosts', () => {
    it('adds +1 to every ranged attack, whatever the bracket', () => {
      const unit = makeUnit(['sensor_ghosts']);
      for (const rangeBracket of ['short', 'medium', 'long', undefined]) {
        expect(quirkTargetModifier(unit, { rangeBracket }).modifier).toBe(1);
      }
    });

    it('names itself in the reasons', () => {
      const unit = makeUnit(['sensor_ghosts']);
      expect(quirkTargetModifier(unit, { rangeBracket: 'medium' }).reasons)
        .toEqual(['Sensor Ghosts: +1']);
    });
  });

  describe('Inaccurate Weapon', () => {
    const unit = makeUnit([{ id: 'inaccurate_weapon', weapon: 'ac20' }]);

    it('adds +1 to the named weapon', () => {
      expect(quirkTargetModifier(unit, { weapon: 'ac20' }).modifier).toBe(1);
      expect(quirkTargetModifier(unit, { weapon: { id: 'ac20' } }).modifier).toBe(1);
      expect(quirkTargetModifier(unit, { weapon: { type: 'ac20' } }).modifier).toBe(1);
    });

    it('leaves other weapons alone', () => {
      expect(quirkTargetModifier(unit, { weapon: 'ppc' }).modifier).toBe(0);
      expect(quirkTargetModifier(unit, { weapon: { id: 'lrm20' } }).modifier).toBe(0);
    });

    it('names the weapon in the reason', () => {
      expect(quirkTargetModifier(unit, { weapon: 'ac20' }).reasons)
        .toEqual(['Inaccurate Weapon (ac20): +1']);
    });

    it('is inert when the entry names no weapon', () => {
      // requiresWeapon (p87): an entry missing its weapon is a data error, not
      // a licence to add +1 to every weapon the Mech carries.
      const unscoped = makeUnit(['inaccurate_weapon']);
      expect(quirkTargetModifier(unscoped, { weapon: 'ac20' }).modifier).toBe(0);
      expect(quirkTargetModifier(unscoped, { weapon: 'ppc' }).modifier).toBe(0);
    });

    it('is inert when no firing weapon is supplied', () => {
      expect(quirkTargetModifier(unit, {}).modifier).toBe(0);
      expect(quirkTargetModifier(unit, { rangeBracket: 'medium' }).modifier).toBe(0);
    });
  });

  it('stacks independent quirks', () => {
    const unit = makeUnit(['sensor_ghosts', 'poor_targeting_long']);
    const result = quirkTargetModifier(unit, { rangeBracket: 'long' });
    expect(result.modifier).toBe(2);
    expect(result.reasons).toEqual([
      'Sensor Ghosts: +1',
      'Poor Targeting (Long): +1'
    ]);
  });

  it('is zero for a clean unit', () => {
    expect(quirkTargetModifier(makeUnit(), { rangeBracket: 'short' }))
      .toEqual({ modifier: 0, reasons: [] });
  });

  it('ignores quirks that are not ranged modifiers', () => {
    const unit = makeUnit(['cramped_cockpit', 'unbalanced', 'poor_cooling_jacket']);
    expect(quirkTargetModifier(unit, { rangeBracket: 'short', weapon: 'ac20' }).modifier).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Piloting Skill Roll modifiers
// ---------------------------------------------------------------------------

describe('quirkPSRModifier', () => {
  it('Cramped Cockpit adds +1 to any PSR', () => {
    const unit = makeUnit(['cramped_cockpit']);
    expect(quirkPSRModifier(unit, { triggers: [{ trigger: 'Gyro Damage', baseModifier: 3 }] }))
      .toEqual({ modifier: 1, reasons: ['Cramped Cockpit: +1'] });
  });

  it('Hard to Pilot adds +1 to any PSR', () => {
    const unit = makeUnit(['hard_to_pilot']);
    expect(quirkPSRModifier(unit, { triggers: [{ trigger: 'Kicked', baseModifier: 0 }] }).modifier).toBe(1);
  });

  it('stacks Cramped Cockpit and Hard to Pilot', () => {
    const unit = makeUnit(['cramped_cockpit', 'hard_to_pilot']);
    const result = quirkPSRModifier(unit, { triggers: [] });
    expect(result.modifier).toBe(2);
    expect(result.reasons).toEqual(['Cramped Cockpit: +1', 'Hard to Pilot: +1']);
  });

  describe('Unbalanced', () => {
    const unit = makeUnit(['unbalanced']);

    it('adds +1 when a hex entry forces the PSR', () => {
      expect(quirkPSRModifier(unit, {
        triggers: [{ trigger: 'Heavy Woods', baseModifier: 2 }]
      }).modifier).toBe(1);

      expect(quirkPSRModifier(unit, {
        triggers: [{ trigger: 'Entering medium building', baseModifier: 1 }]
      }).modifier).toBe(1);

      expect(quirkPSRModifier(unit, {
        triggers: [{ trigger: 'Ice: +3', baseModifier: 3 }]
      }).modifier).toBe(1);

      expect(quirkPSRModifier(unit, {
        triggers: [{ trigger: 'Entered Water', baseModifier: -1 }]
      }).modifier).toBe(1);
    });

    it('does not add to PSRs that are not hex entries', () => {
      for (const trigger of ['Kicked', '20+ Damage Received', 'Gyro Damage',
        'Weather Conditions', 'Standing Up', 'Skidding', 'Rapid Turn (Running)']) {
        expect(quirkPSRModifier(unit, { triggers: [{ trigger, baseModifier: 1 }] }).modifier,
          trigger).toBe(0);
      }
    });

    it('does not add to a PSR with no triggers', () => {
      expect(quirkPSRModifier(unit, { triggers: [] }).modifier).toBe(0);
    });

    it('honours an explicit enteringHex flag', () => {
      expect(quirkPSRModifier(unit, { triggers: [], enteringHex: true }).modifier).toBe(1);
      expect(quirkPSRModifier(unit, {
        triggers: [{ trigger: 'Heavy Woods', baseModifier: 2 }], enteringHex: false
      }).modifier).toBe(0);
    });

    it('reads the movement context when one is supplied', () => {
      expect(quirkPSRModifier(unit, { movement: { enteredWater: true } }).modifier).toBe(1);
      expect(quirkPSRModifier(unit, { movement: { type: 'walk' } }).modifier).toBe(0);
    });
  });

  it('is zero for a clean unit', () => {
    expect(quirkPSRModifier(makeUnit(), { triggers: [{ trigger: 'Heavy Woods' }] }))
      .toEqual({ modifier: 0, reasons: [] });
  });

  it('ignores quirks that are not PSR modifiers', () => {
    const unit = makeUnit(['sensor_ghosts', 'poor_targeting_short', 'poor_cooling_jacket']);
    expect(quirkPSRModifier(unit, { triggers: [{ trigger: 'Heavy Woods' }] }).modifier).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Heat modifiers
// ---------------------------------------------------------------------------

describe('quirkHeatModifier', () => {
  const unit = makeUnit([{ id: 'poor_cooling_jacket', weapon: 'ac20' }]);

  it('adds 1 heat to the named weapon', () => {
    expect(quirkHeatModifier(unit, 'ac20')).toBe(1);
    expect(quirkHeatModifier(unit, { id: 'ac20' })).toBe(1);
    expect(quirkHeatModifier(unit, { type: 'ac20' })).toBe(1);
  });

  it('leaves other weapons alone', () => {
    expect(quirkHeatModifier(unit, 'ppc')).toBe(0);
    expect(quirkHeatModifier(unit, { id: 'lrm20' })).toBe(0);
  });

  it('is inert when the entry names no weapon', () => {
    // requiresWeapon (p88): a Poor Cooling Jacket without its weapon would
    // otherwise make every shot a point hotter.
    const unscoped = makeUnit(['poor_cooling_jacket']);
    expect(quirkHeatModifier(unscoped, 'ac20')).toBe(0);
    expect(quirkHeatModifier(unscoped, 'ppc')).toBe(0);
  });

  it('is zero for a clean unit or other quirks', () => {
    expect(quirkHeatModifier(makeUnit(), 'ac20')).toBe(0);
    expect(quirkHeatModifier(makeUnit(['cramped_cockpit']), 'ac20')).toBe(0);
  });

  it('is zero when no weapon is supplied', () => {
    expect(quirkHeatModifier(unit, null)).toBe(0);
    expect(quirkHeatModifier(unit, undefined)).toBe(0);
    expect(quirkHeatModifier(makeUnit(['poor_cooling_jacket']), null)).toBe(0);
  });
});
