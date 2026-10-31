/**
 * CritTables - the eight critical-hit locations from the record sheet.
 *
 * Head and legs print six slots; arms and torsos print twelve (p6). Torsos and
 * arms are shown as two blocks of six because that is how the determining
 * critical-hits procedure addresses them (p46): first 1D6 picks a block. A
 * destroyed slot is struck through and a location with no internal structure
 * left is marked destroyed. Ammunition slots show the shots left in that bin.
 */

import { el, numberOrZero, recordSection } from './dom.js';
import { LOCATIONS } from './locations.js';

/** Names of every non-weapon item that appears in the roster's critical slots. */
const ITEM_LABELS = Object.freeze({
  life_support: 'Life Support',
  sensors: 'Sensors',
  cockpit: 'Cockpit',
  engine: 'Engine',
  gyro: 'Gyro',
  heat_sink: 'Heat Sink',
  jump_jet: 'Jump Jet',
  shoulder: 'Shoulder',
  upper_arm_actuator: 'Upper Arm Actuator',
  lower_arm_actuator: 'Lower Arm Actuator',
  hand_actuator: 'Hand Actuator',
  hip: 'Hip',
  upper_leg_actuator: 'Upper Leg Actuator',
  lower_leg_actuator: 'Lower Leg Actuator',
  foot_actuator: 'Foot Actuator',
  empty: '—'
});

function prettify(id) {
  if (!id) return '—';
  return String(id)
    .replace(/#\d+$/, '')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function weaponName(type, getWeaponData) {
  const data = getWeaponData ? getWeaponData(type) : null;
  return data && data.name ? data.name : prettify(type);
}

function binForSlot(unit, location, slotNumber) {
  const bins = (unit.equipment && unit.equipment.ammo) || {};
  for (const [key, bin] of Object.entries(bins)) {
    if (!bin) continue;
    if (bin.location === location && Number(bin.slot) === Number(slotNumber)) {
      return { key, bin };
    }
  }
  return null;
}

function itemLabel(item, unit, location, slotNumber, getWeaponData) {
  if (!item || item === 'empty') return '—';

  if (/_ammo(#\d+)?$/.test(item)) {
    const weaponType = item.replace(/_ammo(#\d+)?$/, '');
    const name = `${weaponName(weaponType, getWeaponData)} Ammo`;
    const found = binForSlot(unit, location, slotNumber);
    if (found) return `${name} (${numberOrZero(found.bin.shots)})`;
    return name;
  }

  if (ITEM_LABELS[item]) return ITEM_LABELS[item];
  return weaponName(item, getWeaponData);
}

function slotRecords(unit, location) {
  const slots = unit.criticalSlots && Array.isArray(unit.criticalSlots[location])
    ? unit.criticalSlots[location]
    : [];
  const byNumber = new Map();
  slots.forEach((record, index) => {
    if (!record) return;
    const number = Number(record.slot);
    byNumber.set(Number.isFinite(number) ? number : index + 1, record);
  });
  return byNumber;
}

function createSlot({ unit, location, number, record, getWeaponData }) {
  const item = record ? record.item : 'empty';
  const destroyed = Boolean(record && record.status === 'destroyed');
  const slot = el('li', {
    className: `crit-slot${destroyed ? ' destroyed' : ''}`,
    dataset: { slot: String(number) },
    title: `${location} slot ${number}: ${itemLabel(item, unit, location, number, getWeaponData)}${
      destroyed ? ' (destroyed)' : ''
    }`
  });
  slot.appendChild(el('span', { className: 'crit-number', text: String(number) }));
  const itemNode = el('span', { className: 'crit-item' });
  if (destroyed) {
    itemNode.appendChild(el('s', {
      text: itemLabel(item, unit, location, number, getWeaponData)
    }));
  } else {
    itemNode.textContent = itemLabel(item, unit, location, number, getWeaponData);
  }
  slot.appendChild(itemNode);
  return slot;
}

/**
 * @param {object} unit
 * @param {object} [options]
 * @param {(type: string) => object|null} [options.getWeaponData]
 * @param {boolean} [options.compact=false]
 * @returns {HTMLElement}
 */
export function CritTables(unit, options = {}) {
  const { getWeaponData = () => null, compact = false } = options;
  const section = recordSection('Critical Hit Tables', `record-crits${compact ? ' compact' : ''}`);
  const grid = el('div', { className: 'crit-grid' });

  for (const info of LOCATIONS) {
    const destroyedLocation = typeof unit.getInternal === 'function'
      ? numberOrZero(unit.getInternal(info.key)) <= 0
      : numberOrZero(unit.internalStructure && unit.internalStructure[info.key]) <= 0;
    const records = slotRecords(unit, info.key);

    const block = el('div', {
      className: `crit-location${destroyedLocation ? ' destroyed' : ''}`,
      dataset: {
        location: info.key,
        slots: String(info.critSlots),
        destroyed: destroyedLocation ? 'true' : 'false'
      }
    });
    const heading = el('h5', { className: 'crit-location-title' });
    heading.appendChild(el('span', { className: 'crit-location-name', text: info.label }));
    heading.appendChild(el('span', {
      className: 'crit-location-count',
      text: ` (${info.critSlots})`
    }));
    if (destroyedLocation) {
      heading.appendChild(el('span', { className: 'crit-location-destroyed', text: ' DESTROYED' }));
    }
    block.appendChild(heading);

    // Twelve-slot locations are two blocks of six, like the printed sheet.
    const columns = el('div', {
      className: `crit-columns${info.critSlots === 12 ? ' two-blocks' : ''}`
    });
    const blockCount = info.critSlots === 12 ? 2 : 1;
    const perBlock = info.critSlots / blockCount;
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
      const list = el('ol', { className: 'crit-slots' });
      for (let offset = 0; offset < perBlock; offset++) {
        const number = blockIndex * perBlock + offset + 1;
        list.appendChild(createSlot({
          unit,
          location: info.key,
          number,
          record: records.get(number) || null,
          getWeaponData
        }));
      }
      columns.appendChild(list);
    }
    block.appendChild(columns);
    grid.appendChild(block);
  }

  section.appendChild(grid);
  return section;
}
