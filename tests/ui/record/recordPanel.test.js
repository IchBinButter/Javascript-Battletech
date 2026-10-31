/**
 * @vitest-environment jsdom
 *
 * The inline record card in the 320 px sidebar and the full record-sheet
 * overlay (open/close, Escape, live selection and damage). The old classic
 * health-bar presentation has been removed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { UIController } from '../../../src/ui/UIController.js';
import {
  resetDOM,
  createRecordEngine,
  createRecordRenderer,
  createRecordUnit,
  addUnit
} from './recordTestUtils.js';

describe('record card in the unit panel', () => {
  let ui;
  let engine;
  let atlas;

  beforeEach(() => {
    resetDOM();
    atlas = createRecordUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    engine = createRecordEngine({ 'atlas-0': atlas });
    ui = new UIController();
    ui.init(engine, createRecordRenderer());
  });

  it('shows the record card as the only inline presentation', () => {
    ui.updateUnitPanel(atlas);

    expect(document.querySelector('#unit-details .record-card')).not.toBeNull();
    expect(document.querySelectorAll('#unit-details .armor-bar')).toHaveLength(0);
    expect(document.getElementById('btn-view-classic')).toBeNull();
    expect(document.getElementById('btn-view-record')).toBeNull();
  });

  it('keeps the card when the selection changes', () => {
    const locust = addUnit(engine, createRecordUnit('locust-lct1v', 0, 'locust-0'));

    ui.updateUnitPanel(locust);

    expect(document.querySelector('#unit-details .record-card')).not.toBeNull();
    expect(document.getElementById('unit-details').textContent).toContain('Locust LCT-1V');
  });

  it('always renders the rear-armour strip in the card (no toggle)', () => {
    ui.updateUnitPanel(atlas);
    const strip = document.querySelector('#unit-details .record-rear-strip');
    expect(strip).not.toBeNull();
    expect(strip.hidden).toBe(false);
    expect(document.querySelector('#unit-details .record-rear-toggle')).toBeNull();

    const rearCenter = strip.querySelector('[data-location="centerTorso"]');
    expect(rearCenter.querySelectorAll('.pip').length).toBe(atlas.getMaxArmor('centerTorso', true));
  });

  it('shows armour and internal structure side by side in the card', () => {
    ui.updateUnitPanel(atlas);

    const diagrams = document.querySelector('#unit-details .record-diagrams');
    expect(diagrams).not.toBeNull();
    expect(diagrams.children).toHaveLength(2);
    expect(diagrams.children[0].dataset.diagram).toBe('armor');
    expect(diagrams.children[1].dataset.diagram).toBe('internal');
    // The compact card hides the long location key; the A/I strip carries it.
    expect(diagrams.querySelector('.record-diagram-key')).toBeNull();
  });

  it('keeps the heat-effects table collapsed but available', () => {
    ui.updateUnitPanel(atlas);

    const details = document.querySelector('#unit-details .heat-effects-details');
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary').textContent).toContain('Heat effects');
    expect(details.querySelectorAll('.heat-steps tbody tr').length).toBeGreaterThan(10);
  });

  it('keeps the card inside the 320 px sidebar (scroll containers, no fixed width)', () => {
    ui.updateUnitPanel(atlas);

    expect(document.querySelector('#unit-details .record-weapons-scroll')).not.toBeNull();
    expect(document.querySelector('#unit-details .heat-steps-scroll')).not.toBeNull();

    const css = fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
    expect(css).toMatch(/\.record-weapons-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.record-card\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.record-sheet-grid\s*\{[^}]*grid-template-columns/);
  });

  it('keeps non-tactical metadata out of the map-mode header', () => {
    ui.updateUnitPanel(atlas);

    expect(document.querySelectorAll('#unit-details .record-meta-item')).toHaveLength(0);
    const text = document.querySelector('#unit-details .record-unit-header').textContent;
    expect(text).not.toContain('BV:');
    expect(text).not.toContain('Role:');
    expect(text).not.toContain('Tech Base:');
    expect(text).not.toContain('Rules Level:');
  });

  it('refreshes the pips when the selected unit is damaged', () => {
    ui.updateUnitPanel(atlas);
    atlas.applyDamage('centerTorso', 5);

    engine.eventBus.emit('damageApplied', {
      targetId: atlas.id,
      damage: 5,
      location: 'centerTorso',
      result: { criticalHits: [] }
    });

    const empties = document.querySelectorAll(
      '#unit-details .record-armor [data-location="centerTorso"] [data-face="front"] .pip[data-status="empty"]'
    );
    expect(empties).toHaveLength(5);
  });

  it('drives firing from the record-sheet weapon rows', () => {
    engine.state.phase = 'weapon_attack';
    const target = addUnit(engine, createRecordUnit('locust-lct1v', 1, 'enemy-1'));
    ui.updateUnitPanel(atlas);
    ui._pendingTarget = target.id;

    const row = document.querySelector('#unit-details .record-weapon-row[data-type="ac20"]');
    const checkbox = row.querySelector('.record-weapon-check');
    expect(checkbox.disabled).toBe(false);
    checkbox.checked = true;

    const processAction = vi.fn(() => ({
      success: true,
      fired: 1,
      rejected: 0,
      shots: [{ success: true }]
    }));
    engine.processAction = processAction;

    document.getElementById('btn-fire').click();

    expect(processAction).toHaveBeenCalledTimes(1);
    const [, action] = processAction.mock.calls[0];
    expect(action.type).toBe('fireWeapons');
    expect(action.attackerId).toBe(atlas.id);
    expect(action.targetId).toBe(target.id);
    expect(action.shots).toHaveLength(1);
    expect(action.shots[0].weapon.id).toBe('ac20');
    expect(action.shots[0].weaponIndex).toBe(0);
  });

  it('declares each mounted instance when two identical rows are checked', () => {
    engine.state.phase = 'weapon_attack';
    const target = addUnit(engine, createRecordUnit('locust-lct1v', 1, 'enemy-1'));
    ui.updateUnitPanel(atlas);
    ui._pendingTarget = target.id;

    const lasers = [...document.querySelectorAll(
      '#unit-details .record-weapon-row[data-type="med_laser"] .record-weapon-check'
    )];
    expect(lasers).toHaveLength(2);
    lasers.forEach(box => { box.checked = true; });

    const processAction = vi.fn(() => ({
      success: true,
      fired: 2,
      rejected: 0,
      shots: [{ success: true }, { success: true }]
    }));
    engine.processAction = processAction;

    document.getElementById('btn-fire').click();

    const [, action] = processAction.mock.calls[0];
    expect(action.shots.map(shot => shot.weapon.id)).toEqual(['med_laser', 'med_laser']);
    expect(action.shots.map(shot => shot.weaponIndex)).toEqual([1, 2]);
  });

  it('refreshes armour pips after a physical attack resolves (card and overlay)', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();

    const empty = (rootSelector) => [...document.querySelectorAll(
      `${rootSelector} .record-armor [data-location="centerTorso"] [data-face="front"] .pip`
    )].filter(pip => pip.dataset.status === 'empty').length;

    atlas.applyDamage('centerTorso', 7);
    // Nothing has re-rendered yet: the DOM still shows the pre-attack sheet.
    expect(empty('#unit-details')).toBe(0);
    expect(empty('#record-sheet-body')).toBe(0);

    // The engine reports a resolved punch/kick/charge/DFA.
    engine.eventBus.emit('physicalAttackResolved', {
      attackerId: 'attacker-1',
      targetId: atlas.id,
      result: { type: 'punch', hit: true, hitLocations: [] }
    });

    expect(empty('#unit-details')).toBe(7);
    expect(empty('#record-sheet-body')).toBe(7);
  });
});

describe('full record-sheet overlay', () => {
  let ui;
  let engine;
  let atlas;
  let locust;

  beforeEach(() => {
    resetDOM();
    atlas = createRecordUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 3 };
    locust = createRecordUnit('locust-lct1v', 0, 'locust-0');
    locust.position = { hexKey: '6,7', facing: 3 };
    engine = createRecordEngine({ 'atlas-0': atlas, 'locust-0': locust });
    ui = new UIController();
    ui.init(engine, createRecordRenderer());
  });

  it('opens from the Record Sheet button and closes with its button', () => {
    const overlay = document.getElementById('record-overlay');
    const openButton = document.getElementById('btn-record-sheet');
    expect(openButton.disabled).toBe(true);

    ui.updateUnitPanel(atlas);
    expect(openButton.disabled).toBe(false);

    openButton.click();
    expect(ui.recordOverlayOpen).toBe(true);
    expect(overlay.style.display).toBe('flex');
    expect(document.getElementById('record-sheet-title').textContent).toContain('Atlas');

    const body = document.getElementById('record-sheet-body');
    expect(body.querySelector('.record-sheet-grid')).not.toBeNull();
    expect(body.querySelector('.record-armor')).not.toBeNull();
    expect(body.querySelector('.record-internal')).not.toBeNull();
    expect(body.querySelector('.record-heat')).not.toBeNull();
    expect(body.querySelector('.record-warrior')).not.toBeNull();
    expect(body.querySelector('.record-crits')).not.toBeNull();
    expect(body.querySelectorAll('.record-weapon-row')).toHaveLength(7);

    document.getElementById('btn-close-record').click();
    expect(ui.recordOverlayOpen).toBe(false);
    expect(overlay.style.display).toBe('none');
    // The hidden DOM cannot keep rows that a later Fire click could pick up.
    expect(document.querySelectorAll('#record-sheet-body .record-weapon-check')).toHaveLength(0);
  });

  it('closes on Escape', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();
    expect(document.getElementById('record-overlay').style.display).toBe('flex');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(ui.recordOverlayOpen).toBe(false);
    expect(document.getElementById('record-overlay').style.display).toBe('none');
    expect(document.querySelectorAll('#record-sheet-body .record-weapon-check')).toHaveLength(0);
  });

  it('follows the selected unit while it is open', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();
    expect(document.getElementById('record-sheet-body').textContent).toContain('Atlas AS7-D');

    ui.updateUnitPanel(locust);

    const body = document.getElementById('record-sheet-body');
    expect(body.textContent).toContain('Locust LCT-1V');
    expect(body.textContent).not.toContain('Atlas AS7-D');
    const headPips = body.querySelectorAll(
      '.record-armor [data-location="head"] [data-face="front"] .pip'
    );
    expect(headPips).toHaveLength(locust.getMaxArmor('head'));
    expect(headPips).toHaveLength(8);
  });

  it('closes when the unit is deselected', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();

    ui.updateUnitPanel(null);

    expect(ui.recordOverlayOpen).toBe(false);
    expect(document.getElementById('record-overlay').style.display).toBe('none');
  });

  it('refreshes live when the shown unit takes damage', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();

    atlas.applyDamage('leftLeg', 45); // 41 armour + 4 internal
    engine.eventBus.emit('damageApplied', {
      targetId: atlas.id,
      damage: 45,
      location: 'leftLeg',
      result: { criticalHits: [] }
    });

    const body = document.getElementById('record-sheet-body');
    const legPips = [...body.querySelectorAll(
      '.record-armor [data-location="leftLeg"] [data-face="front"] .pip'
    )];
    expect(legPips).toHaveLength(41);
    expect(legPips.every(pip => pip.dataset.status === 'empty')).toBe(true);

    const internalPips = [...body.querySelectorAll('.record-internal [data-location="leftLeg"] .pip')];
    expect(internalPips.filter(pip => pip.dataset.status === 'empty')).toHaveLength(4);
  });

  it('shows the record-sheet header with "—" placeholders for unmodelled metadata', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();

    const body = document.getElementById('record-sheet-body');
    const values = [...body.querySelectorAll('.mech-meta-item dd')];
    expect(values).toHaveLength(4);
    for (const value of values) {
      expect(value.textContent).toBe('—');
      expect(value.getAttribute('title')).toBe('not modelled yet');
    }
    expect(body.textContent).toContain('Walk 3 / Run 5 / Jump 0');
    expect(body.textContent).toContain('G4/P5');
  });

  it('always renders the rear-armour strip inside the overlay', () => {
    ui.updateUnitPanel(atlas);
    ui.openRecordSheet();

    const body = document.getElementById('record-sheet-body');
    const strip = body.querySelector('.record-rear-strip');
    expect(strip).not.toBeNull();
    expect(strip.hidden).toBe(false);
    expect(body.querySelector('.record-rear-toggle')).toBeNull();
    expect(strip.querySelectorAll('[data-location="centerTorso"] .pip')).toHaveLength(14);
  });
});

/**
 * t5: setting `_pendingTarget` changes arc/range/LOS eligibility without a
 * phase or selection change. The record card and the classic picker must both
 * be rebuilt from the same `_getWeaponEligibility` answer, or the two panels
 * disagree while the user compares them.
 */
describe('target-aware weapon eligibility sync', () => {
  let ui;
  let engine;
  let atlas;
  let target;

  /** Disabled state of every record-card row, in mounted-weapon order. */
  function recordStates() {
    return [...document.querySelectorAll('#unit-details .record-weapon-check')]
      .map(box => box.disabled);
  }

  /** Disabled state of every classic-picker row, in mounted-weapon order. */
  function pickerStates() {
    return [...document.querySelectorAll('#weapon-list .weapon-check')]
      .map(box => box.disabled);
  }

  function recordBox(type) {
    return document.querySelector(
      `#unit-details .record-weapon-row[data-type="${type}"] .record-weapon-check`
    );
  }

  function pickerBox(type) {
    return document.querySelector(`#weapon-list .weapon-check[data-type="${type}"]`);
  }

  beforeEach(() => {
    resetDOM();
    atlas = createRecordUnit('atlas-as7d', 0, 'atlas-0');
    atlas.position = { hexKey: '5,7', facing: 0 }; // facing N
    target = createRecordUnit('locust-lct1v', 1, 'enemy-1');
    target.position = { hexKey: '5,8', facing: 3 }; // due south = rear arc

    engine = createRecordEngine({ 'atlas-0': atlas, 'enemy-1': target });
    engine.state.phase = 'weapon_attack';
    ui = new UIController();
    ui.init(engine, createRecordRenderer());

    ui.updateUnitPanel(atlas);
    ui.weaponFireMode = true;
    ui._showWeaponPanel();
  });

  it('disables a front-arc weapon in both views for a rear-arc target', () => {
    ui._pendingTarget = target.id;
    ui.refreshWeaponViews();

    // The AC/20 is torso-mounted front: it cannot bear into the rear arc.
    expect(recordBox('ac20').disabled).toBe(true);
    expect(pickerBox('ac20').disabled).toBe(true);
    expect(document.querySelector(
      '#unit-details .record-weapon-row[data-type="ac20"] .record-weapon-reason'
    ).textContent).toBe('out of arc');

    // The rear-mounted medium lasers can, so they stay legal in both views.
    const recordRear = [...document.querySelectorAll(
      '#unit-details .record-weapon-row[data-type="med_laser_rear"] .record-weapon-check'
    )];
    const pickerRear = [...document.querySelectorAll(
      '#weapon-list .weapon-check[data-type="med_laser_rear"]'
    )];
    expect(recordRear).toHaveLength(2);
    expect(pickerRear).toHaveLength(2);
    expect(recordRear.every(box => !box.disabled)).toBe(true);
    expect(pickerRear.every(box => !box.disabled)).toBe(true);

    // And the two views agree row-for-row, not just on those two examples.
    expect(recordStates()).toEqual(pickerStates());
  });

  it('re-enables both views when the target is cleared', () => {
    ui._pendingTarget = target.id;
    ui.refreshWeaponViews();
    expect(recordBox('ac20').disabled).toBe(true);

    ui._pendingTarget = null;
    ui.refreshWeaponViews();

    expect(recordBox('ac20').disabled).toBe(false);
    expect(pickerBox('ac20').disabled).toBe(false);
    expect(recordStates().every(disabled => disabled === false)).toBe(true);
    expect(pickerStates().every(disabled => disabled === false)).toBe(true);
  });

  it('cancelling weapon fire clears the target before the card is re-rendered', () => {
    ui._pendingTarget = target.id;
    ui.refreshWeaponViews();
    expect(recordBox('ac20').disabled).toBe(true);

    ui._startWeaponFire(); // toggle off

    expect(ui.weaponFireMode).toBe(false);
    expect(ui._pendingTarget).toBeNull();
    expect(document.getElementById('weapon-panel').style.display).toBe('none');
    expect(recordBox('ac20').disabled).toBe(false);
  });

  it('clears a stale target before rendering a newly selected unit', () => {
    const second = addUnit(engine, createRecordUnit('thunderbolt-tdr5s', 0, 'thunderbolt-0'));
    second.position = { hexKey: '6,7', facing: 0 };
    ui._pendingTarget = target.id;

    ui.updateUnitPanel(second);

    expect(ui._pendingTarget).toBeNull();
    expect(recordStates().every(disabled => disabled === false)).toBe(true);
    expect(document.getElementById('unit-details').textContent).toContain('Thunderbolt');
  });
});

/**
 * R-1: checked rows in the closed record-sheet overlay used to survive in the
 * hidden DOM and were picked up by the next Fire Selected. The overlay body is
 * now cleared on close/selection change/destruction, and the declaration query
 * is scoped to the visible surface, so hidden rows can never fire.
 */
describe('hidden record-sheet overlay rows cannot fire', () => {
  let ui;
  let engine;
  let atlasA;
  let atlasB;
  let enemy;

  function armTargeting(unit) {
    ui.updateUnitPanel(unit);
    ui.weaponFireMode = true;
    ui._pendingTarget = enemy.id;
    ui.refreshWeaponViews();
  }

  function firstEnabledOverlayRow() {
    return [...document.querySelectorAll('#record-sheet-body .record-weapon-check')]
      .find(box => !box.disabled);
  }

  beforeEach(() => {
    resetDOM();
    // Two identical chassis: the stale overlay row is a legal mount on either,
    // which is exactly what made the unintended shot possible.
    atlasA = createRecordUnit('atlas-as7d', 0, 'atlas-0');
    atlasA.position = { hexKey: '5,7', facing: 0 };
    atlasB = createRecordUnit('atlas-as7d', 0, 'atlas-1');
    atlasB.position = { hexKey: '5,9', facing: 0 }; // enemy at 5,8 is in front
    enemy = createRecordUnit('locust-lct1v', 1, 'enemy-1');
    enemy.position = { hexKey: '5,8', facing: 3 };

    engine = createRecordEngine({
      'atlas-0': atlasA,
      'atlas-1': atlasB,
      'enemy-1': enemy
    });
    engine.state.phase = 'weapon_attack';
    ui = new UIController();
    ui.init(engine, createRecordRenderer());
  });

  it('clears the closed overlay body and ignores any stale checked row', () => {
    armTargeting(atlasA);
    ui.openRecordSheet();
    const overlayBox = firstEnabledOverlayRow();
    expect(overlayBox).not.toBeNull();
    overlayBox.checked = true;

    ui.closeRecordSheet();
    expect(document.querySelectorAll('#record-sheet-body .record-weapon-check')).toHaveLength(0);

    // Switch to the identical second chassis and re-arm against the same enemy.
    ui.updateUnitPanel(atlasB);
    ui._pendingTarget = enemy.id;
    ui.refreshWeaponViews();

    // Defence in depth: even if a foreign checked row is forced into the
    // hidden body, the declaration is scoped to visible surfaces.
    const stale = document.createElement('input');
    stale.type = 'checkbox';
    stale.className = 'record-weapon-check';
    stale.checked = true;
    stale.dataset.type = 'ac20';
    stale.dataset.location = 'rightTorso';
    stale.dataset.ammo = 'ac20_ammo';
    stale.dataset.weaponIndex = '0';
    document.getElementById('record-sheet-body').appendChild(stale);

    const processAction = vi.fn(() => ({
      success: true,
      fired: 1,
      rejected: 0,
      shots: [{ success: true }]
    }));
    engine.processAction = processAction;

    document.getElementById('btn-fire').click();
    expect(processAction).not.toHaveBeenCalled();
    expect(ui.diceLog.textContent).toContain('Select weapons to fire');

    // A row on the visible card still fires - and only for the new unit.
    const visible = document.querySelector(
      '#unit-details .record-weapon-row[data-type="ac20"] .record-weapon-check'
    );
    expect(visible.disabled).toBe(false);
    visible.checked = true;
    document.getElementById('btn-fire').click();

    expect(processAction).toHaveBeenCalledTimes(1);
    const [, action] = processAction.mock.calls[0];
    expect(action.attackerId).toBe(atlasB.id);
    expect(action.shots).toHaveLength(1);
    expect(action.shots[0].weapon.id).toBe('ac20');
    expect(action.shots[0].weaponIndex).toBe(0);
  });

  it('re-renders the open overlay for a new selection without stale ticks', () => {
    armTargeting(atlasA);
    ui.openRecordSheet();
    const overlayBox = firstEnabledOverlayRow();
    expect(overlayBox).not.toBeNull();
    overlayBox.checked = true;

    ui.updateUnitPanel(atlasB);

    expect(document.querySelectorAll('#record-sheet-body .record-weapon-row')).toHaveLength(7);
    expect(document.querySelectorAll('#record-sheet-body .record-weapon-check:checked'))
      .toHaveLength(0);
  });

  it('clears overlay inputs when the shown unit is destroyed', () => {
    armTargeting(atlasA);
    ui.openRecordSheet();
    const overlayBox = firstEnabledOverlayRow();
    expect(overlayBox).not.toBeNull();
    overlayBox.checked = true;

    atlasA.internalStructure.centerTorso = 0;
    engine.eventBus.emit('unitDestroyed', { unitId: atlasA.id });

    expect(document.querySelectorAll('#record-sheet-body .record-weapon-check:checked'))
      .toHaveLength(0);
  });

  it('ignores checked rows left in a hidden classic picker as well', () => {
    armTargeting(atlasB);
    const pickerBox = document.querySelector('#weapon-list .weapon-check[data-type="ac20"]');
    expect(pickerBox).not.toBeNull();
    pickerBox.checked = true;

    ui._startWeaponFire(); // hides the picker; the checked DOM row stays behind
    expect(document.getElementById('weapon-panel').style.display).toBe('none');
    ui._pendingTarget = enemy.id;
    ui.refreshWeaponViews();

    const processAction = vi.fn(() => ({
      success: true,
      fired: 1,
      rejected: 0,
      shots: [{ success: true }]
    }));
    engine.processAction = processAction;
    document.getElementById('btn-fire').click();

    expect(processAction).not.toHaveBeenCalled();
  });
});
