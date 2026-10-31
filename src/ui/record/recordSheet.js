/**
 * RecordSheet - presentation B: the near-full-screen overlay laid out like the
 * physical BattleMech record sheet.
 *
 *   left column   'Mech data + weapons inventory
 *   right column  armour + internal diagrams, heat scale, MechWarrior
 *   below         the full critical-hit tables
 *
 * The overlay shell lives in index.html; this module fills its body. It owns no
 * state, so re-rendering on selection/damage is just a fresh call.
 */

import { describeHeatEffects } from '../../rules/heat/HeatScale.js';
import { el, recordSection } from './dom.js';
import { ArmorDiagram } from './armorDiagram.js';
import { InternalStructureDiagram } from './internalStructureDiagram.js';
import { WeaponsTable } from './weaponsTable.js';
import { HeatScale } from './heatScale.js';
import { CritTables } from './critTables.js';
import { WarriorData } from './warriorData.js';
import { movementValues, currentMP, heatSinkInfo } from './unitValues.js';

/**
 * The four record-sheet header fields the roster does not model yet. They are
 * rendered as an honest em dash instead of an invented value.
 */
const MISSING_META = Object.freeze([
  ['BV', 'not modelled yet'],
  ['Role', 'not modelled yet'],
  ['Tech Base', 'not modelled yet'],
  ['Rules Level', 'not modelled yet']
]);

function metaLine() {
  const list = el('dl', { className: 'mech-meta' });
  for (const [label, reason] of MISSING_META) {
    const item = el('div', { className: 'mech-meta-item' });
    item.appendChild(el('dt', { text: label }));
    item.appendChild(el('dd', { text: '—', title: reason }));
    list.appendChild(item);
  }
  return list;
}

/** Read-only 'Mech data block shared by the overlay's left column. */
export function MechDataPanel(unit, options = {}) {
  const pilot = unit.pilot || {};
  const movement = movementValues(unit);
  const sinks = heatSinkInfo(unit);
  const engine = unit.engine || {};
  const gyro = unit.gyro || {};
  const facing = unit.position && unit.position.facing !== undefined ? unit.position.facing : '—';
  const effects = describeHeatEffects(Number(unit.heat) || 0);

  const section = recordSection("'Mech Data", 'record-mech-data');
  const title = el('div', { className: 'mech-name' });
  title.appendChild(el('strong', { text: unit.name || 'Unknown' }));
  title.appendChild(el('span', { className: 'mech-tonnage', text: `${unit.tonnage ?? '—'} t` }));
  section.appendChild(title);
  section.appendChild(metaLine());

  const stats = el('div', { className: 'mech-stats' });
  const engineRating = engine.rating !== undefined ? ` ${engine.rating}` : '';
  const rows = [
    ['Movement', `Walk ${movement.walk} / Run ${movement.run} / Jump ${movement.jump}`],
    ['Current MP', String(currentMP(unit))],
    ['Heat', `${Number(unit.heat) || 0} / ${sinks.dissipation} dissipation`],
    ['Heat Sinks', `${sinks.count} (${sinks.type})`],
    ['Engine', `${engine.type || '—'}${engineRating} (${engine.hits ?? 0} hits)`],
    ['Gyro', `${gyro.type || '—'} (${gyro.hits ?? 0} hits)`],
    ['Pilot', `G${pilot.gunnery ?? '—'}/P${pilot.piloting ?? '—'}`],
    ['Facing', String(facing)]
  ];
  for (const [label, value] of rows) {
    const row = el('div', { className: 'mech-stat' });
    row.appendChild(el('span', { className: 'mech-stat-label', text: label }));
    row.appendChild(el('span', { className: 'mech-stat-value', text: value }));
    stats.appendChild(row);
  }
  section.appendChild(stats);

  if (effects.length) {
    section.appendChild(el('p', {
      className: 'mech-heat-effects',
      text: `Heat effects: ${effects.join(', ')}`
    }));
  }
  if (unit.prone) section.appendChild(el('p', { className: 'mech-flag', text: 'PRONE' }));
  if (unit.shutdown) section.appendChild(el('p', { className: 'mech-flag', text: 'SHUTDOWN' }));

  return section;
}

/**
 * Build the overlay sheet body.
 *
 * @param {object} unit
 * @param {object} [options] - weapon data, eligibility, rear-armour state and
 *   the rear toggle callback (same options the card takes)
 * @returns {HTMLElement}
 */
export function RecordSheet(unit, options = {}) {
  const root = el('div', { className: 'record-sheet-grid' });

  const left = el('div', { className: 'sheet-column sheet-left' });
  left.appendChild(MechDataPanel(unit));
  const weaponsSection = recordSection('Weapons & Ammunition', 'record-weapons-block');
  weaponsSection.appendChild(WeaponsTable(unit, {
    getWeaponData: options.getWeaponData,
    getEligibility: options.getEligibility,
    unitEligibility: options.unitEligibility
  }));
  left.appendChild(weaponsSection);
  root.appendChild(left);

  const right = el('div', { className: 'sheet-column sheet-right' });
  right.appendChild(ArmorDiagram(unit, {
    rear: Boolean(options.rear),
    onToggleRear: options.onToggleRear
  }));
  right.appendChild(InternalStructureDiagram(unit));
  right.appendChild(HeatScale(unit));
  right.appendChild(WarriorData(unit));
  root.appendChild(right);

  const crits = el('div', { className: 'sheet-crits-column' });
  crits.appendChild(CritTables(unit, { getWeaponData: options.getWeaponData }));
  root.appendChild(crits);

  return root;
}
