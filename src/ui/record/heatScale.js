/**
 * HeatScale - the printed heat scale with this 'Mech's marker on it.
 *
 * The steps come from src/data/heatScale.json through the same
 * `getHeatEffects`/`describeHeatEffects` readers the rules use, so the sheet
 * and the engine cannot disagree about when a modifier starts. Avoid targets
 * (shutdown / ammunition explosion) are shown as "avoid on N+".
 */

import heatScaleData from '../../data/heatScale.json' with { type: 'json' };
import { getHeatEffects, describeHeatEffects } from '../../rules/heat/HeatScale.js';
import { el, recordSection } from './dom.js';
import { heatSinkInfo } from './unitValues.js';

const SCALE_MAX = 30;

function effectText(step) {
  const parts = [];
  if (step.movementPenalty) parts.push(`-${step.movementPenalty} Walk MP`);
  if (step.toHitModifier) parts.push(`+${step.toHitModifier} weapon TN`);
  if (step.shutdownAvoid !== undefined) parts.push(`Shutdown: avoid on ${step.shutdownAvoid}+`);
  if (step.ammoExplosionAvoid !== undefined) parts.push(`Ammo explosion: avoid on ${step.ammoExplosionAvoid}+`);
  if (step.autoShutdown) parts.push('Automatic shutdown');
  return parts.join(' · ');
}

/**
 * @param {object} unit
 * @param {object} [options]
 * @param {boolean} [options.compact=false]
 * @returns {HTMLElement}
 */
export function HeatScale(unit, options = {}) {
  const { compact = false } = options;
  const rawHeat = Number(unit.heat);
  const heat = Number.isFinite(rawHeat) ? Math.max(0, Math.floor(rawHeat)) : 0;
  const effects = getHeatEffects(heat);
  const effectList = describeHeatEffects(heat);
  const markerStep = [...heatScaleData.steps].reverse().find(step => step.heat <= heat) || null;

  const section = recordSection('Heat Scale', `record-heat${compact ? ' compact' : ''}`);
  section.dataset.heat = String(heat);

  // Current heat, dissipation and the cumulative effect summary.
  const summary = el('div', { className: 'record-heat-summary' });
  summary.appendChild(el('span', {
    className: 'heat-current',
    text: `Heat ${heat}`,
    dataset: { heat: String(heat) }
  }));
  summary.appendChild(el('span', {
    className: 'heat-dissipation',
    text: `Dissipation ${heatSinkInfo(unit).dissipation}`
  }));
  const effectsLine = el('span', {
    className: 'heat-effects',
    text: effectList.length ? effectList.join(', ') : 'No heat effects'
  });
  summary.appendChild(effectsLine);
  section.appendChild(summary);

  // 30-segment scale with the current marker on top.
  const track = el('div', {
    className: 'record-heat-track',
    attrs: { role: 'img', 'aria-label': `Heat ${heat} of ${SCALE_MAX}` }
  });
  for (let index = 0; index < SCALE_MAX; index++) {
    track.appendChild(el('span', {
      className: `record-heat-segment${index < heat ? ' filled' : ''}${
        index < 5 ? ' safe' : index < 10 ? ' warn' : index < 15 ? ' danger' : ' critical'}`,
      dataset: { heat: String(index) },
      title: `Heat ${index}`
    }));
  }
  const marker = el('span', {
    className: 'heat-marker',
    text: String(heat),
    dataset: { heat: String(heat) },
    attrs: { 'aria-hidden': 'true' }
  });
  marker.style.left = `${Math.min(100, (Math.min(heat, SCALE_MAX) / SCALE_MAX) * 100)}%`;
  track.appendChild(marker);
  section.appendChild(track);

  // Avoid targets at the current heat (p52).
  const avoid = el('div', { className: 'heat-avoid' });
  avoid.appendChild(el('span', {
    className: 'heat-avoid-shutdown',
    text: `Shutdown avoid: ${effects.shutdownAvoid === null ? '—' : `${effects.shutdownAvoid}+`}`
  }));
  avoid.appendChild(el('span', {
    className: 'heat-avoid-ammo',
    text: `Ammo avoid: ${effects.ammoExplosionAvoid === null ? '—' : `${effects.ammoExplosionAvoid}+`}`
  }));
  section.appendChild(avoid);

  // The full printed table, minimised behind a summary so it stays available
  // for a quick lookup without taking up the card. `current` marks the highest
  // step that applies.
  const details = el('details', { className: 'heat-effects-details' });
  details.appendChild(el('summary', { text: 'Heat effects' }));
  const scroll = el('div', { className: 'heat-steps-scroll' });
  const table = el('table', { className: 'heat-steps' });
  const head = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', { text: 'Heat', attrs: { scope: 'col' } }));
  headRow.appendChild(el('th', { text: 'Effect', attrs: { scope: 'col' } }));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = el('tbody');
  for (const step of heatScaleData.steps) {
    const isCurrent = Boolean(markerStep && markerStep.heat === step.heat);
    const isActive = step.heat <= heat;
    const row = el('tr', {
      className: `heat-step${isCurrent ? ' current' : ''}${isActive ? ' active' : ''}`,
      dataset: { heat: String(step.heat) }
    });
    row.appendChild(el('td', { className: 'heat-step-value', text: String(step.heat) }));
    row.appendChild(el('td', { className: 'heat-step-effect', text: effectText(step) }));
    body.appendChild(row);
  }
  table.appendChild(body);
  scroll.appendChild(table);
  details.appendChild(scroll);
  section.appendChild(details);

  return section;
}
