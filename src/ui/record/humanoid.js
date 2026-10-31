/**
 * Shared humanoid diagram for the armour and internal-structure record blocks.
 *
 * Both diagrams are the same physical picture: a blocky humanoid 'Mech outline
 * with one circle per point of damage it can take in each location. Only the
 * numbers differ:
 *
 *  - armour: `unit.getArmor(loc[, rear])` / `unit.getMaxArmor(loc[, rear])`,
 *    front pips on the silhouette plus a rear-torso strip behind a toggle;
 *  - internal structure: `unit.getInternal(loc)` / `unit.getMaxInternal(loc)`.
 *
 * Everything is inline SVG built from plain DOM. No layout measurement is
 * done, so the diagrams render identically in jsdom and scale with CSS
 * (`width: 100%`) down to the 320 px sidebar.
 */

import { el, svgEl } from './dom.js';
import {
  LOCATIONS,
  DIAGRAM_REGIONS,
  TORSO_KEYS,
  locationInfo,
  shortLocation
} from './locations.js';
import {
  armorValue,
  maxArmorValue,
  internalValue,
  maxInternalValue,
  isLocationDestroyed
} from './unitValues.js';

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 246;
const PIP_ROWS_PER_ROW = 5;

/* ------------------------------------------------------------------ *
 * Pip layouts
 * ------------------------------------------------------------------ */

/**
 * The circles for one location/face, laid out in the classic rows of five
 * inside `region`. Filled circles are points still available; empty circles
 * are points already lost (damage empties pips from the end of the row order).
 */
function createRegionPips({ max, current, face, location, region, pipClass }) {
  const group = svgEl('g', {
    className: `pips face-${face}`,
    dataset: { face },
    attrs: { 'data-pip-count': String(max) }
  });

  if (max <= 0) return group;

  const rows = Math.ceil(max / PIP_ROWS_PER_ROW);
  const spacing = Math.max(
    2.2,
    Math.min(6.5, (region.w - 6) / PIP_ROWS_PER_ROW, (region.h - 20) / rows)
  );
  const radius = Math.max(1.1, spacing * 0.32);

  for (let index = 0; index < max; index++) {
    const row = Math.floor(index / PIP_ROWS_PER_ROW);
    const column = index % PIP_ROWS_PER_ROW;
    const leftInRow = Math.min(PIP_ROWS_PER_ROW, max - row * PIP_ROWS_PER_ROW);
    const rowWidth = (leftInRow - 1) * spacing;
    const cx = region.x + region.w / 2 - rowWidth / 2 + column * spacing;
    const cy = region.y + 16 + row * spacing;
    const filled = index < current;

    group.appendChild(svgEl('circle', {
      className: `pip ${pipClass} ${filled ? 'filled' : 'empty'}`,
      attrs: {
        cx: cx.toFixed(2),
        cy: cy.toFixed(2),
        r: radius.toFixed(2),
        'data-status': filled ? 'filled' : 'empty',
        'data-index': String(index),
        'data-location': location
      }
    }));
  }

  return group;
}

/** A free-standing pip block used by the rear-torso strip. */
function createPipBlock({ max, current, location, pipClass }) {
  const rows = Math.max(1, Math.ceil(max / PIP_ROWS_PER_ROW));
  const spacing = 7;
  const width = PIP_ROWS_PER_ROW * spacing;
  const height = rows * spacing;
  const block = svgEl('svg', {
    className: `pip-block ${pipClass}`,
    attrs: {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${max} ${pipClass === 'internal-pip' ? 'internal structure' : 'armour'} points`
    }
  });

  for (let index = 0; index < max; index++) {
    const row = Math.floor(index / PIP_ROWS_PER_ROW);
    const column = index % PIP_ROWS_PER_ROW;
    const leftInRow = Math.min(PIP_ROWS_PER_ROW, max - row * PIP_ROWS_PER_ROW);
    const offset = (PIP_ROWS_PER_ROW - leftInRow) * spacing / 2;
    const filled = index < current;
    block.appendChild(svgEl('circle', {
      className: `pip ${pipClass} ${filled ? 'filled' : 'empty'}`,
      attrs: {
        cx: (offset + column * spacing + spacing / 2).toFixed(2),
        cy: (row * spacing + spacing / 2).toFixed(2),
        r: '2.4',
        'data-status': filled ? 'filled' : 'empty',
        'data-index': String(index),
        'data-location': location
      }
    }));
  }

  return block;
}

/* ------------------------------------------------------------------ *
 * Silhouette
 * ------------------------------------------------------------------ */

function createSilhouette() {
  const group = svgEl('g', { className: 'silhouette' });
  const shapes = [
    { x: 78, y: 4, w: 44, h: 42, rx: 9 },     // head
    { x: 66, y: 44, w: 68, h: 96, rx: 7 },    // torso (centre + sides)
    { x: 62, y: 126, w: 76, h: 26, rx: 5 },   // hips
    { x: 8, y: 52, w: 32, h: 90, rx: 9 },     // left arm
    { x: 160, y: 52, w: 32, h: 90, rx: 9 },   // right arm
    { x: 64, y: 140, w: 34, h: 102, rx: 7 },  // left leg
    { x: 102, y: 140, w: 34, h: 102, rx: 7 }  // right leg
  ];
  for (const shape of shapes) {
    group.appendChild(svgEl('rect', {
      attrs: {
        x: shape.x,
        y: shape.y,
        width: shape.w,
        height: shape.h,
        rx: shape.rx
      }
    }));
  }
  return group;
}

/* ------------------------------------------------------------------ *
 * Location key
 * ------------------------------------------------------------------ */

/**
 * Full location names with their numbers, because the SVG regions are only
 * wide enough for short codes. This is the "Head (8)", "Center Torso (47)"
 * labelling of the printed sheet, in the 320 px column.
 */
function createDiagramKey(unit, isArmor) {
  const key = el('div', {
    className: 'record-diagram-key',
    attrs: { 'aria-label': isArmor ? 'Armour by location' : 'Internal structure by location' }
  });
  for (const info of LOCATIONS) {
    const current = isArmor ? armorValue(unit, info.key, false) : internalValue(unit, info.key);
    const max = isArmor
      ? maxArmorValue(unit, info.key, false)
      : maxInternalValue(unit, info.key);
    let text = `${info.label} ${current}/${max}`;
    if (isArmor && TORSO_KEYS.includes(info.key)) {
      text += ` (R ${armorValue(unit, info.key, true)}/${maxArmorValue(unit, info.key, true)})`;
    }
    key.appendChild(el('span', {
      className: 'record-key-entry',
      text,
      title: `${locationInfo(info.key).label}: ${current} of ${max}`,
      dataset: { location: info.key }
    }));
  }
  return key;
}

/* ------------------------------------------------------------------ *
 * Rear-torso strip (armour only)
 * ------------------------------------------------------------------ */

function createRearStrip(unit, rear) {
  const strip = el('div', {
    className: 'record-rear-strip',
    attrs: { 'aria-label': 'Rear torso armour' }
  });
  strip.hidden = !rear;

  for (const location of TORSO_KEYS) {
    const current = armorValue(unit, location, true);
    const max = maxArmorValue(unit, location, true);
    const block = el('div', {
      className: 'rear-location',
      dataset: { location, face: 'rear' },
      attrs: { 'data-pip-count': String(max) }
    });
    block.appendChild(el('span', {
      className: 'rear-label',
      text: `${shortLocation(location)} R ${current}/${max}`
    }));
    block.appendChild(createPipBlock({ max, current, location, pipClass: 'armor-pip' }));
    strip.appendChild(block);
  }

  return strip;
}

/* ------------------------------------------------------------------ *
 * Public factory
 * ------------------------------------------------------------------ */

/**
 * Build the humanoid record diagram.
 *
 * @param {object} unit - real Unit (or a plain fixture with the same accessors)
 * @param {object} [options]
 * @param {'armor'|'internal'} [options.variant]
 * @param {boolean} [options.rear] - show the rear-torso strip (armour only)
 * @param {boolean} [options.compact] - extra class for the 320 px card
 * @param {(rear: boolean) => void} [options.onToggleRear] - called with the
 *   next state when the toggle is pressed. Without it the component toggles
 *   itself (handy in isolation).
 * @returns {HTMLElement}
 */
export function createHumanoidDiagram(unit, options = {}) {
  const {
    variant = 'armor',
    rear = false,
    compact = false,
    onToggleRear = null
  } = options;
  const isArmor = variant === 'armor';
  const pipClass = isArmor ? 'armor-pip' : 'internal-pip';

  const root = el('div', {
    className: [
      'record-section',
      'record-diagram',
      isArmor ? 'record-armor' : 'record-internal',
      compact ? 'compact' : '',
      isArmor && rear ? 'show-rear' : ''
    ].filter(Boolean).join(' '),
    dataset: {
      diagram: isArmor ? 'armor' : 'internal',
      face: isArmor && rear ? 'rear' : 'front'
    }
  });

  const header = el('div', { className: 'record-diagram-header' });
  header.appendChild(el('span', {
    className: 'record-diagram-title',
    text: isArmor ? 'Armour' : 'Internal Structure'
  }));

  let toggle = null;
  if (isArmor) {
    toggle = el('button', {
      className: 'record-rear-toggle',
      text: rear ? 'Rear armour: on' : 'Rear armour: off',
      attrs: {
        type: 'button',
        'data-record-action': 'toggle-rear',
        'aria-pressed': String(Boolean(rear))
      },
      title: 'Toggle the rear torso armour strip'
    });
    toggle.addEventListener('click', () => {
      const next = !root.classList.contains('show-rear');
      if (typeof onToggleRear === 'function') {
        onToggleRear(next);
        return;
      }
      root.classList.toggle('show-rear', next);
      root.dataset.face = next ? 'rear' : 'front';
      toggle.setAttribute('aria-pressed', String(next));
      toggle.textContent = next ? 'Rear armour: on' : 'Rear armour: off';
      const strip = root.querySelector('.record-rear-strip');
      if (strip) strip.hidden = !next;
    });
    header.appendChild(toggle);
  }
  root.appendChild(header);

  const svg = svgEl('svg', {
    className: 'record-diagram-svg',
    attrs: {
      viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
      role: 'img',
      'aria-label': isArmor ? "'Mech armour diagram" : "'Mech internal structure diagram"
    }
  });
  svg.appendChild(createSilhouette());

  for (const info of LOCATIONS) {
    const region = DIAGRAM_REGIONS[info.key];
    const destroyed = isLocationDestroyed(unit, info.key);
    const current = isArmor ? armorValue(unit, info.key, false) : internalValue(unit, info.key);
    const max = isArmor
      ? maxArmorValue(unit, info.key, false)
      : maxInternalValue(unit, info.key);

    const group = svgEl('g', {
      className: `record-location${destroyed ? ' destroyed' : ''}`,
      dataset: { location: info.key, destroyed: destroyed ? 'true' : 'false' },
      attrs: {
        'data-location': info.key,
        'data-current': String(current),
        'data-max': String(max)
      }
    });
    group.appendChild(svgEl('title', {
      text: `${info.label}: ${current}/${max}${destroyed ? ' (destroyed)' : ''}`
    }));
    group.appendChild(svgEl('text', {
      className: 'location-label',
      text: `${shortLocation(info.key)} ${current}/${max}`,
      attrs: {
        x: (region.x + region.w / 2).toFixed(2),
        y: (region.y + 9).toFixed(2),
        'text-anchor': 'middle'
      }
    }));
    group.appendChild(createRegionPips({
      max,
      current,
      face: isArmor ? 'front' : 'internal',
      location: info.key,
      region,
      pipClass
    }));

    if (destroyed) {
      group.appendChild(svgEl('text', {
        className: 'location-destroyed',
        text: 'DESTROYED',
        attrs: {
          x: (region.x + region.w / 2).toFixed(2),
          y: (region.y + region.h - 2).toFixed(2),
          'text-anchor': 'middle'
        }
      }));
    }

    svg.appendChild(group);
  }

  root.appendChild(svg);
  root.appendChild(createDiagramKey(unit, isArmor));
  if (isArmor) root.appendChild(createRearStrip(unit, rear));

  return root;
}
