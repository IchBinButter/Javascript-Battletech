/**
 * WarriorData - the MechWarrior block of the record sheet.
 *
 * The consciousness numbers are not restated here: they come from
 * `consciousnessNumber(hits)` in PhaseManager, the same reader the engine uses
 * for Consciousness Rolls (p58). The six hit boxes are the printed damage
 * track; the sixth hit kills the warrior.
 */

import { consciousnessNumber, FATAL_PILOT_DAMAGE } from '../../engine/PhaseManager.js';
import { el, numberOrZero, recordSection } from './dom.js';

const HIT_BOXES = 6;

function consciousnessTable() {
  const rows = [];
  for (let hits = 1; hits <= FATAL_PILOT_DAMAGE; hits++) {
    const target = consciousnessNumber(hits);
    rows.push(`${hits}:${target === null ? 'dead' : target}`);
  }
  return rows.join(' · ');
}

/**
 * @param {object} unit
 * @param {object} [options]
 * @param {boolean} [options.compact=false]
 * @returns {HTMLElement}
 */
export function WarriorData(unit, options = {}) {
  const { compact = false } = options;
  const pilot = unit.pilot || {};
  const gunnery = pilot.gunnery === undefined || pilot.gunnery === null ? '—' : pilot.gunnery;
  const piloting = pilot.piloting === undefined || pilot.piloting === null ? '—' : pilot.piloting;
  const hits = Math.min(HIT_BOXES, numberOrZero(pilot.hits));
  const target = consciousnessNumber(hits);

  const section = recordSection('MechWarrior', `record-warrior${compact ? ' compact' : ''}`);
  section.dataset.hits = String(hits);

  const name = el('div', { className: 'warrior-line' });
  name.appendChild(el('span', { className: 'warrior-label', text: 'Name' }));
  name.appendChild(el('span', {
    className: 'warrior-name',
    text: pilot.name || '—',
    title: pilot.name ? null : 'not modelled yet'
  }));
  if (pilot.conscious === false || pilot.dead) {
    name.appendChild(el('span', {
      className: `warrior-status${pilot.dead ? ' dead' : ''}`,
      text: pilot.dead ? 'DEAD' : 'UNCONSCIOUS'
    }));
  }
  section.appendChild(name);

  const skills = el('div', { className: 'warrior-line warrior-skills' });
  skills.appendChild(el('span', { className: 'warrior-label', text: 'Gunnery' }));
  skills.appendChild(el('span', { className: 'warrior-gunnery', text: String(gunnery) }));
  skills.appendChild(el('span', { className: 'warrior-label', text: 'Piloting' }));
  skills.appendChild(el('span', { className: 'warrior-piloting', text: String(piloting) }));
  section.appendChild(skills);

  const hitRow = el('div', { className: 'warrior-line warrior-hits' });
  hitRow.appendChild(el('span', { className: 'warrior-label', text: 'Hits taken' }));
  const boxes = el('div', { className: 'warrior-hit-boxes' });
  for (let index = 1; index <= HIT_BOXES; index++) {
    const taken = index <= hits;
    boxes.appendChild(el('span', {
      className: `warrior-hit${taken ? ' taken' : ''}${index === FATAL_PILOT_DAMAGE ? ' fatal' : ''}`,
      text: String(index),
      dataset: { hit: String(index), taken: taken ? 'true' : 'false' },
      title: taken ? `Hit ${index} taken` : `Hit ${index} available`
    }));
  }
  hitRow.appendChild(boxes);
  section.appendChild(hitRow);

  const consciousness = el('div', { className: 'warrior-line warrior-consciousness' });
  consciousness.appendChild(el('span', { className: 'warrior-label', text: 'Consciousness' }));
  consciousness.appendChild(el('span', {
    className: 'warrior-consciousness-current',
    text: target === null ? 'dead' : target === 0 ? '—' : String(target),
    dataset: { target: target === null ? 'dead' : String(target) }
  }));
  consciousness.appendChild(el('span', {
    className: 'warrior-consciousness-table',
    text: consciousnessTable()
  }));
  section.appendChild(consciousness);

  return section;
}
