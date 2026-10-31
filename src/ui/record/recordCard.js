/**
 * RecordCard - presentation A: the record-sheet blocks that replace the old
 * health-bar list inside the 320 px unit sidebar.
 *
 * The two humanoid diagrams sit side by side at half width so armour and
 * internal structure are visible together without scrolling; the location key
 * is omitted here because the A/I strip below carries the same numbers.
 */

import { el, recordSection } from './dom.js';
import { LOCATIONS, shortLocation } from './locations.js';
import { ArmorDiagram } from './armorDiagram.js';
import { InternalStructureDiagram } from './internalStructureDiagram.js';
import { WeaponsTable } from './weaponsTable.js';
import { HeatScale } from './heatScale.js';
import { WarriorData } from './warriorData.js';
import { armorValue, maxArmorValue, internalValue, maxInternalValue } from './unitValues.js';

/**
 * The old per-location A: / I: text, kept in the card next to the diagrams so
 * no information the health-bar list used to show disappears.
 */
function armorInternalStrip(unit) {
  const section = recordSection('Armour / Internal', 'record-ai');
  const grid = el('div', { className: 'record-ai-grid' });
  for (const info of LOCATIONS) {
    const armor = armorValue(unit, info.key);
    const armorMax = maxArmorValue(unit, info.key);
    const internal = internalValue(unit, info.key);
    const internalMax = maxInternalValue(unit, info.key);
    grid.appendChild(el('span', {
      className: 'record-ai-entry',
      dataset: { location: info.key },
      text: `${shortLocation(info.key)} A:${armor}/${armorMax} I:${internal}/${internalMax}`
    }));
  }
  section.appendChild(grid);
  return section;
}

/**
 * @param {object} unit
 * @param {object} [options] - forwarded to the blocks (weapon data, eligibility,
 *   rear-armour state and toggle callback)
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
  card.appendChild(armorInternalStrip(unit));

  return card;
}
