/**
 * WeaponsTable - the record-sheet weapons inventory.
 *
 * Rows carry the printed columns (Qty | Type | Loc | Ht | Dmg | Min | Sht | Med
 * | Lng | Ammo) and one fire checkbox per MOUNTED weapon instance, using the
 * same `data-type`/`data-location`/`data-ammo`/`data-weapon-index` contract as
 * the existing picker in UIController. That keeps the firing rules in one
 * place: the caller injects `getEligibility`, which is UIController's existing
 * `_getWeaponEligibility`; this module only formats the row and reflects the
 * verdict. It never decides whether a shot is legal.
 */

import { el, numberOrZero } from './dom.js';
import { longLocation, shortLocation } from './locations.js';

/** The ten printed columns, in sheet order. */
export const WEAPON_COLUMNS = Object.freeze([
  'Qty', 'Type', 'Loc', 'Ht', 'Dmg', 'Min', 'Sht', 'Med', 'Lng', 'Ammo'
]);

function usesAmmo(weaponData) {
  if (!weaponData) return false;
  if (typeof weaponData.usesAmmo === 'function') return Boolean(weaponData.usesAmmo());
  return numberOrZero(weaponData.ammoPerShot) > 0;
}

function feedingAmmo(unit, weapon, weaponData) {
  const bins = (unit.equipment && unit.equipment.ammo) || {};
  if (weapon.ammoBin) {
    const bin = bins[weapon.ammoBin];
    return bin ? Number(bin.shots) || 0 : 0;
  }
  if (!usesAmmo(weaponData)) return null;
  return Object.values(bins)
    .filter(bin => bin && (!bin.type || bin.type === weaponData.id))
    .reduce((total, bin) => total + (Number(bin.shots) || 0), 0);
}

function displayDamage(weaponData) {
  if (!weaponData) return '—';
  if (weaponData.cluster) return `${weaponData.damage}/Msl`;
  return weaponData.damage === undefined || weaponData.damage === null
    ? '—'
    : String(weaponData.damage);
}

function displayName(weapon, weaponData) {
  if (weaponData && weaponData.name) {
    if (weaponData.mount === 'rear' && !/rear/i.test(weaponData.name)) {
      return `${weaponData.name} (R)`;
    }
    return weaponData.name;
  }
  return weapon.type || 'Unknown';
}

function ammoCell(unit, weapon, weaponData) {
  const shots = feedingAmmo(unit, weapon, weaponData);
  if (shots === null) return '—';
  const binName = weapon.ammoBin || (weaponData && weaponData.id) || 'ammo';
  return { text: String(shots), title: `${shots} shot${shots === 1 ? '' : 's'} (${binName})` };
}

/**
 * @param {object} unit
 * @param {object} [options]
 * @param {(type: string) => object|null} [options.getWeaponData]
 * @param {(weapon: object, weaponData: object, index: number) => {eligible: boolean, reason: string|null}} [options.getEligibility]
 * @param {{eligible: boolean, reason: string|null}} [options.unitEligibility]
 * @param {boolean} [options.compact=false]
 * @returns {HTMLElement} scroll wrapper containing the table
 */
export function WeaponsTable(unit, options = {}) {
  const {
    getWeaponData = () => null,
    getEligibility = null,
    unitEligibility = { eligible: true, reason: null },
    compact = false
  } = options;

  const mounted = typeof unit.getAllWeapons === 'function'
    ? unit.getAllWeapons()
    : ((unit.equipment && unit.equipment.weapons) || []);

  const wrapper = el('div', { className: 'record-weapons-scroll' });

  if (unitEligibility && !unitEligibility.eligible && unitEligibility.reason) {
    wrapper.appendChild(el('p', {
      className: 'record-weapons-notice',
      text: `Firing disabled: ${unitEligibility.reason}`
    }));
  }

  const table = el('table', {
    className: `record-weapons${compact ? ' compact' : ''}`
  });

  const head = el('thead');
  const headerRow = el('tr');
  for (const column of WEAPON_COLUMNS) {
    headerRow.appendChild(el('th', {
      text: column,
      attrs: { scope: 'col' },
      dataset: { col: column.toLowerCase() }
    }));
  }
  head.appendChild(headerRow);
  table.appendChild(head);

  const body = el('tbody');

  if (mounted.length === 0) {
    const emptyRow = el('tr', { className: 'record-weapon-empty' });
    const cell = el('td', { text: 'No weapons mounted', attrs: { colspan: String(WEAPON_COLUMNS.length) } });
    emptyRow.appendChild(cell);
    body.appendChild(emptyRow);
  }

  mounted.forEach((weapon, weaponIndex) => {
    const weaponData = getWeaponData(weapon.type) || null;
    const eligibility = weaponData && typeof getEligibility === 'function'
      ? getEligibility(weapon, weaponData, weaponIndex)
      : {
        eligible: Boolean(weaponData) && Boolean(unitEligibility && unitEligibility.eligible),
        reason: weaponData
          ? (unitEligibility ? unitEligibility.reason : null)
          : 'no weapon data'
      };
    const reason = eligibility && eligibility.reason ? eligibility.reason : null;

    const row = el('tr', {
      className: `record-weapon-row${eligibility && eligibility.eligible ? '' : ' record-weapon-row-disabled'}`,
      dataset: {
        type: weapon.type || '',
        location: weapon.location || '',
        weaponIndex: String(weaponIndex)
      },
      title: reason ? `${displayName(weapon, weaponData)}: ${reason}` : displayName(weapon, weaponData)
    });
    row.dataset.eligible = String(Boolean(eligibility && eligibility.eligible));

    // Qty: one per mounted instance, with that instance's own fire checkbox so
    // "one attack per weapon per turn" still keys off the mount.
    const qtyCell = el('td', { className: 'record-weapon-qty', dataset: { col: 'qty' } });
    const label = el('label', {
      className: 'record-weapon-check-label',
      title: reason
        ? `${displayName(weapon, weaponData)}: ${reason}`
        : `Fire ${displayName(weapon, weaponData)}`
    });
    const checkbox = el('input', {
      className: 'record-weapon-check',
      attrs: {
        type: 'checkbox',
        'aria-label': `Fire ${displayName(weapon, weaponData)} from ${longLocation(weapon.location)}`
      }
    });
    checkbox.dataset.type = weapon.type || '';
    checkbox.dataset.location = weapon.location || '';
    checkbox.dataset.ammo = weapon.ammoBin || '';
    checkbox.dataset.weaponIndex = String(weaponIndex);
    checkbox.disabled = !(eligibility && eligibility.eligible);
    label.appendChild(checkbox);
    label.appendChild(el('span', { className: 'record-weapon-qty-value', text: '1' }));
    qtyCell.appendChild(label);
    row.appendChild(qtyCell);

    const typeCell = el('td', {
      className: 'record-weapon-type',
      text: displayName(weapon, weaponData),
      dataset: { col: 'type' }
    });
    if (reason) {
      typeCell.appendChild(el('span', {
        className: 'record-weapon-reason',
        text: reason,
        attrs: { 'aria-label': `cannot fire: ${reason}` }
      }));
    }
    row.appendChild(typeCell);

    row.appendChild(el('td', {
      text: shortLocation(weapon.location),
      title: longLocation(weapon.location),
      dataset: { col: 'loc' },
      className: 'record-weapon-loc'
    }));

    const ammo = ammoCell(unit, weapon, weaponData);
    const cells = [
      ['ht', weaponData && weaponData.heat !== undefined ? String(weaponData.heat) : '—'],
      ['dmg', displayDamage(weaponData)],
      ['min', weaponData && numberOrZero(weaponData.minRange) > 0 ? String(weaponData.minRange) : '—'],
      ['sht', weaponData ? String(weaponData.shortRange) : '—'],
      ['med', weaponData ? String(weaponData.mediumRange) : '—'],
      ['lng', weaponData ? String(weaponData.longRange) : '—']
    ];
    for (const [column, text] of cells) {
      row.appendChild(el('td', { text, dataset: { col: column } }));
    }
    row.appendChild(el('td', {
      text: typeof ammo === 'string' ? ammo : ammo.text,
      title: typeof ammo === 'string' ? null : ammo.title,
      dataset: { col: 'ammo' }
    }));

    body.appendChild(row);
  });

  table.appendChild(body);
  wrapper.appendChild(table);
  return wrapper;
}
