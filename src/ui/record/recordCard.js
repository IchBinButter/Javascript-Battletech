/**
 * RecordCard - the record-sheet blocks inside the 320 px unit sidebar.
 *
 * The two humanoid diagrams sit side by side at half width so armour and
 * internal structure are visible together without scrolling; each diagram
 * already prints its own current/max numbers, so there is no separate A/I box.
 */

import { el, recordSection } from './dom.js';
import { ArmorDiagram } from './armorDiagram.js';
import { InternalStructureDiagram } from './internalStructureDiagram.js';
import { WeaponsTable } from './weaponsTable.js';
import { HeatScale } from './heatScale.js';
import { WarriorData } from './warriorData.js';

/**
 * @param {object} unit
 * @param {object} [options] - forwarded to the blocks (weapon data, eligibility)
 * @returns {HTMLElement}
 */
export function RecordCard(unit, options = {}) {
  const card = el('div', { className: 'record-card' });

  const diagrams = el('div', { className: 'record-diagrams' });
  diagrams.appendChild(ArmorDiagram(unit, { compact: true, showKey: false }));
  diagrams.appendChild(InternalStructureDiagram(unit, { compact: true, showKey: false }));
  card.appendChild(diagrams);
  const weaponsSection = recordSection('Weapons', 'record-weapons-block');
  weaponsSection.appendChild(WeaponsTable(unit, {
    compact: true,
    getWeaponData: options.getWeaponData,
    getEligibility: options.getEligibility,
    unitEligibility: options.unitEligibility
  }));
  card.appendChild(weaponsSection);
  card.appendChild(HeatScale(unit, { compact: true }));
  card.appendChild(WarriorData(unit, { compact: true }));

  return card;
}
