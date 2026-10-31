/**
 * @vitest-environment jsdom
 *
 * The record-sheet building blocks, checked against the units' own record-sheet
 * numbers (never against hard-coded 47/15/8 in the implementation).
 */

import { describe, it, expect } from 'vitest';
import {
  ArmorDiagram,
  InternalStructureDiagram,
  WeaponsTable,
  HeatScale,
  CritTables,
  WarriorData
} from '../../../src/ui/record/index.js';
import { Unit } from '../../../src/models/Unit.js';
import heatScaleData from '../../../src/data/heatScale.json' with { type: 'json' };
import { createRecordUnit, weaponsLookup } from './recordTestUtils.js';

const LOCATIONS = [
  'head', 'centerTorso', 'leftTorso', 'rightTorso',
  'leftArm', 'rightArm', 'leftLeg', 'rightLeg'
];
const TORSOS = ['centerTorso', 'leftTorso', 'rightTorso'];
const getWeaponData = (type) => weaponsLookup[type] || null;

function pips(root, location, face = 'front') {
  return root.querySelectorAll(`[data-location="${location}"] [data-face="${face}"] .pip`);
}

function rearPips(root, location) {
  return root.querySelectorAll(
    `.record-rear-strip [data-location="${location}"] .pip`
  );
}

describe('ArmorDiagram', () => {
  it('draws one pip per armour point for Atlas, Locust and Thunderbolt', () => {
    for (const mechId of ['atlas-as7d', 'locust-lct1v', 'thunderbolt-tdr5s']) {
      const unit = createRecordUnit(mechId);
      const diagram = ArmorDiagram(unit);

      for (const location of LOCATIONS) {
        expect(
          pips(diagram, location).length,
          `${mechId} ${location} front armour`
        ).toBe(unit.getMaxArmor(location));
      }
      for (const location of TORSOS) {
        expect(
          rearPips(diagram, location).length,
          `${mechId} ${location} rear armour`
        ).toBe(unit.getMaxArmor(location, true));
      }
    }
  });

  it('uses the printed sheet values rather than a hard-coded diagram', () => {
    const atlas = ArmorDiagram(createRecordUnit('atlas-as7d'));
    expect(pips(atlas, 'centerTorso').length).toBe(47);
    expect(pips(atlas, 'head').length).toBe(9);

    const locust = ArmorDiagram(createRecordUnit('locust-lct1v'));
    expect(pips(locust, 'head').length).toBe(8);
    expect(pips(locust, 'centerTorso').length).toBe(12);
    expect(rearPips(locust, 'centerTorso').length).toBe(4);

    const thunderbolt = ArmorDiagram(createRecordUnit('thunderbolt-tdr5s'));
    expect(pips(thunderbolt, 'centerTorso').length).toBe(28);
  });

  it('labels every location with its current/max numbers', () => {
    const unit = createRecordUnit('atlas-as7d');
    const diagram = ArmorDiagram(unit);
    const labels = [...diagram.querySelectorAll('.location-label')].map(node => node.textContent);
    expect(labels).toContain('HD 9/9');
    expect(labels).toContain('CT 47/47');
    expect(labels).toContain('LA 34/34');

    // The printed sheet's full location names (and the rear torso values).
    const key = diagram.querySelector('.record-diagram-key').textContent;
    expect(key).toContain('Head 9/9');
    expect(key).toContain('Center Torso 47/47 (R 14/14)');
    expect(key).toContain('Right Leg 41/41');
  });

  it('empties the right pips when armour is damaged', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.applyDamage('centerTorso', 7);

    const diagram = ArmorDiagram(unit);
    const front = [...pips(diagram, 'centerTorso')];
    expect(front.filter(pip => pip.dataset.status === 'filled')).toHaveLength(40);
    expect(front.filter(pip => pip.dataset.status === 'empty')).toHaveLength(7);
    // Unhit locations keep every pip.
    expect([...pips(diagram, 'head')].every(pip => pip.dataset.status === 'filled')).toBe(true);
  });

  it('empties rear pips for rear damage and leaves the front alone', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.applyDamage('leftTorso', 3, true);

    const diagram = ArmorDiagram(unit, { rear: true });
    const rear = [...rearPips(diagram, 'leftTorso')];
    expect(rear.filter(pip => pip.dataset.status === 'filled')).toHaveLength(7);
    expect(rear.filter(pip => pip.dataset.status === 'empty')).toHaveLength(3);
    expect([...pips(diagram, 'leftTorso')].every(pip => pip.dataset.status === 'filled'))
      .toBe(true);
  });

  it('shows the rear strip behind a toggle', () => {
    const unit = createRecordUnit('atlas-as7d');
    const off = ArmorDiagram(unit, { rear: false });
    expect(off.querySelector('.record-rear-strip').hidden).toBe(true);
    expect(off.dataset.face).toBe('front');

    const on = ArmorDiagram(unit, { rear: true });
    expect(on.querySelector('.record-rear-strip').hidden).toBe(false);
    expect(on.dataset.face).toBe('rear');
  });

  it('toggles itself when no callback is supplied', () => {
    const diagram = ArmorDiagram(createRecordUnit('atlas-as7d'), { rear: false });
    const toggle = diagram.querySelector('.record-rear-toggle');
    toggle.click();

    expect(diagram.classList.contains('show-rear')).toBe(true);
    expect(diagram.querySelector('.record-rear-strip').hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks a destroyed location', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.internalStructure.leftArm = 0;
    const diagram = ArmorDiagram(unit);

    const location = diagram.querySelector('.record-location[data-location="leftArm"]');
    expect(location.classList.contains('destroyed')).toBe(true);
    expect(location.textContent).toContain('DESTROYED');
  });
});

describe('InternalStructureDiagram', () => {
  it('draws one pip per point of printed internal structure', () => {
    for (const mechId of ['atlas-as7d', 'locust-lct1v', 'thunderbolt-tdr5s']) {
      const unit = createRecordUnit(mechId);
      const diagram = InternalStructureDiagram(unit);

      for (const location of LOCATIONS) {
        expect(
          diagram.querySelectorAll(`[data-location="${location}"] .pip`).length,
          `${mechId} ${location} internal`
        ).toBe(unit.getMaxInternal(location));
      }
    }
  });

  it('keeps the printed maximum after internal damage', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.applyDamage('rightArm', 38); // 34 armour + 4 internal

    const diagram = InternalStructureDiagram(unit);
    const rightArm = [...diagram.querySelectorAll('[data-location="rightArm"] .pip')];
    expect(rightArm).toHaveLength(17);
    expect(rightArm.filter(pip => pip.dataset.status === 'empty')).toHaveLength(4);
    expect(rightArm.filter(pip => pip.dataset.status === 'filled')).toHaveLength(13);
  });

  it('shows the five-tonne Locust values (head 3, CT 6, leg 4)', () => {
    const unit = createRecordUnit('locust-lct1v');
    const diagram = InternalStructureDiagram(unit);

    expect(diagram.querySelectorAll('[data-location="head"] .pip')).toHaveLength(3);
    expect(diagram.querySelectorAll('[data-location="centerTorso"] .pip')).toHaveLength(6);
    expect(diagram.querySelectorAll('[data-location="leftLeg"] .pip')).toHaveLength(4);
  });
});

describe('WeaponsTable', () => {
  it('lists every mounted weapon with heat, damage, ranges and ammo', () => {
    const unit = createRecordUnit('atlas-as7d');
    const table = WeaponsTable(unit, { getWeaponData });

    const rows = [...table.querySelectorAll('.record-weapon-row')];
    expect(rows).toHaveLength(unit.getAllWeapons().length);
    expect(rows).toHaveLength(7);

    const ac20 = rows.find(row => row.dataset.type === 'ac20');
    const cell = (row, column) => row.querySelector(`[data-col="${column}"]`).textContent;
    expect(cell(ac20, 'type')).toContain('AC/20');
    expect(cell(ac20, 'loc')).toBe('RT');
    expect(cell(ac20, 'ht')).toBe('7');
    expect(cell(ac20, 'dmg')).toBe('20');
    expect(cell(ac20, 'min')).toBe('—'); // AC/20 has no minimum range
    expect(cell(ac20, 'sht')).toBe('3');
    expect(cell(ac20, 'med')).toBe('6');
    expect(cell(ac20, 'lng')).toBe('9');
    expect(cell(ac20, 'ammo')).toBe('5');

    const laser = rows.find(row => row.dataset.type === 'med_laser');
    expect(cell(laser, 'type')).toContain('Medium Laser');
    expect(cell(laser, 'ht')).toBe('3');
    expect(cell(laser, 'dmg')).toBe('5');
    expect(cell(laser, 'min')).toBe('—');
    expect(cell(laser, 'ammo')).toBe('—');

    const lrm = rows.find(row => row.dataset.type === 'lrm20');
    expect(cell(lrm, 'min')).toBe('6');
    expect(cell(lrm, 'sht')).toBe('7');
    expect(cell(lrm, 'med')).toBe('14');
    expect(cell(lrm, 'lng')).toBe('21');

    // Every mounted instance has its own row and fire checkbox index.
    expect(rows.map(row => row.dataset.weaponIndex)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    const checks = [...table.querySelectorAll('.record-weapon-check')];
    expect(checks).toHaveLength(7);
    expect(checks.map(check => check.dataset.weaponIndex)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });

  it('reflects the eligibility verdict it is given without re-deriving rules', () => {
    const unit = createRecordUnit('atlas-as7d');
    const table = WeaponsTable(unit, {
      getWeaponData,
      unitEligibility: { eligible: true, reason: null },
      getEligibility: (weapon, weaponData, index) => (index === 1
        ? { eligible: false, reason: 'already fired' }
        : { eligible: true, reason: null })
    });

    const checks = [...table.querySelectorAll('.record-weapon-check')];
    expect(checks[0].disabled).toBe(false);
    expect(checks[1].disabled).toBe(true);
    expect(table.querySelector('.record-weapon-row-disabled .record-weapon-reason').textContent)
      .toBe('already fired');
  });

  it('shows a "weapon phase" notice while the table is inspection-only', () => {
    const unit = createRecordUnit('atlas-as7d');
    const table = WeaponsTable(unit, {
      getWeaponData,
      unitEligibility: { eligible: false, reason: 'weapon phase' },
      getEligibility: () => ({ eligible: false, reason: null })
    });

    expect(table.querySelector('.record-weapons-notice').textContent)
      .toContain('weapon phase');
    expect([...table.querySelectorAll('.record-weapon-check')].every(check => check.disabled))
      .toBe(true);
  });
});

describe('HeatScale', () => {
  it('puts the marker at the current heat and marks the current step', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.heat = 12;

    const scale = HeatScale(unit);
    const marker = scale.querySelector('.heat-marker');
    expect(marker.dataset.heat).toBe('12');

    const current = scale.querySelector('.heat-step.current');
    expect(current.dataset.heat).toBe('10');
    expect(scale.querySelectorAll('.heat-step').length).toBe(heatScaleData.steps.length);
  });

  it('shows the avoid targets active at the current heat', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.heat = 19;

    const scale = HeatScale(unit);
    expect(scale.querySelector('.heat-avoid-shutdown').textContent).toContain('6+');
    expect(scale.querySelector('.heat-avoid-ammo').textContent).toContain('4+');

    unit.heat = 12;
    const cooler = HeatScale(unit);
    expect(cooler.querySelector('.heat-avoid-shutdown').textContent).toContain('—');
    expect(cooler.querySelector('.heat-avoid-ammo').textContent).toContain('—');
    expect(cooler.querySelector('.heat-effects').textContent).toContain('-2 Walk MP');
  });

  it('lists each printed step with its effect text', () => {
    const scale = HeatScale(createRecordUnit('atlas-as7d'));
    const steps = [...scale.querySelectorAll('.heat-step')];
    expect(steps[0].dataset.heat).toBe('5');
    expect(steps[0].textContent).toContain('-1 Walk MP');
    const shutdown = steps.find(step => step.dataset.heat === '14');
    expect(shutdown.textContent).toContain('Shutdown: avoid on 4+');
    const ammo = steps.find(step => step.dataset.heat === '19');
    expect(ammo.textContent).toContain('Ammo explosion: avoid on 4+');
  });
});

describe('CritTables', () => {
  it('prints 12 slots for a torso and 6 for a leg', () => {
    const crits = CritTables(createRecordUnit('atlas-as7d'), { getWeaponData });

    const slots = (location) => crits.querySelectorAll(
      `.crit-location[data-location="${location}"] .crit-slot`
    );
    expect(slots('centerTorso')).toHaveLength(12);
    expect(slots('leftArm')).toHaveLength(12);
    expect(slots('head')).toHaveLength(6);
    expect(slots('leftLeg')).toHaveLength(6);
    expect(crits.querySelectorAll('.crit-location')).toHaveLength(8);
  });

  it('labels actuators and marks destroyed slots with a strike-through', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.criticalSlots.centerTorso[0].status = 'destroyed';
    unit.criticalSlots.leftLeg[2].status = 'destroyed';

    const crits = CritTables(unit, { getWeaponData });
    const torsoSlot = crits.querySelector(
      '.crit-location[data-location="centerTorso"] .crit-slot[data-slot="1"]'
    );
    expect(torsoSlot.classList.contains('destroyed')).toBe(true);
    expect(torsoSlot.querySelector('s').textContent).toBe('Engine');

    const leg = crits.querySelector('.crit-location[data-location="leftLeg"]');
    expect(leg.textContent).toContain('Hip');
    expect(leg.textContent).toContain('Upper Leg Actuator');
    expect(leg.textContent).toContain('Foot Actuator');
    expect(leg.querySelectorAll('.crit-slot.destroyed')).toHaveLength(1);
  });

  it('shows ammunition bins with the shots left in them', () => {
    const unit = createRecordUnit('atlas-as7d');
    const crits = CritTables(unit, { getWeaponData });

    const centerTorso = crits.querySelector('.crit-location[data-location="centerTorso"]');
    expect(centerTorso.textContent).toContain('SRM-6 Ammo (15)');
    expect(centerTorso.textContent).toContain('AC/20 Ammo (5)');
  });

  it('marks a location with no internal structure as destroyed', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.internalStructure.leftTorso = 0;
    const crits = CritTables(unit, { getWeaponData });

    const location = crits.querySelector('.crit-location[data-location="leftTorso"]');
    expect(location.classList.contains('destroyed')).toBe(true);
    expect(location.textContent).toContain('DESTROYED');
  });
});

describe('WarriorData', () => {
  it('shows gunnery, piloting, the six-hit track and consciousness numbers', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.pilot.gunnery = 3;
    unit.pilot.piloting = 4;

    const warrior = WarriorData(unit);
    expect(warrior.querySelector('.warrior-gunnery').textContent).toBe('3');
    expect(warrior.querySelector('.warrior-piloting').textContent).toBe('4');
    expect(warrior.querySelectorAll('.warrior-hit')).toHaveLength(6);
    expect(warrior.querySelectorAll('.warrior-hit.taken')).toHaveLength(0);
    expect(warrior.querySelector('.warrior-consciousness-table').textContent)
      .toBe('1:3 · 2:5 · 3:7 · 4:10 · 5:11 · 6:dead');
    expect(warrior.querySelector('.warrior-consciousness-current').textContent).toBe('—');
  });

  it('fills the hit boxes and raises the consciousness number as hits are taken', () => {
    const unit = createRecordUnit('atlas-as7d');
    unit.applyPilotDamage(2);

    const warrior = WarriorData(unit);
    expect(warrior.querySelectorAll('.warrior-hit.taken')).toHaveLength(2);
    expect(warrior.querySelector('.warrior-consciousness-current').dataset.target).toBe('5');

    unit.applyPilotDamage(4); // sixth hit: dead
    const dead = WarriorData(unit);
    expect(dead.querySelectorAll('.warrior-hit.taken')).toHaveLength(6);
    expect(dead.querySelector('.warrior-consciousness-current').dataset.target).toBe('dead');
    expect(dead.textContent).toContain('DEAD');
  });
});

describe('Unit.getMaxInternal (record-sheet maximum)', () => {
  it('keeps the printed maximum after damage and round-trips through JSON', () => {
    const unit = createRecordUnit('atlas-as7d');
    expect(unit.getMaxInternal('centerTorso')).toBe(31);

    unit.applyDamage('centerTorso', 57); // 47 armour + 10 internal
    expect(unit.getInternal('centerTorso')).toBe(21);
    expect(unit.getMaxInternal('centerTorso')).toBe(31);

    const json = unit.toJSON();
    expect(json._initialInternalStructure.centerTorso).toBe(31);

    const restored = Unit.fromJSON(json);
    expect(restored.getInternal('centerTorso')).toBe(21);
    expect(restored.getMaxInternal('centerTorso')).toBe(31);
  });

  it('falls back to the live structure for a save made before the snapshot existed', () => {
    const unit = createRecordUnit('locust-lct1v');
    unit.applyDamage('centerTorso', 14); // 12 armour + 2 internal

    const oldSave = unit.toJSON();
    delete oldSave._initialInternalStructure;
    const restored = Unit.fromJSON(oldSave);

    expect(restored.getMaxInternal('centerTorso')).toBe(restored.getInternal('centerTorso'));
    expect(restored.getInternal('centerTorso')).toBe(4);
  });
});
