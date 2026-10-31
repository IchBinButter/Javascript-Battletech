/**
 * Internal structure diagram: the same humanoid outline as the armour sheet,
 * with one circle per point of internal structure.
 *
 * The maximum comes from `unit.getMaxInternal` (the printed record-sheet
 * value), not from the live structure, so a location that has already taken
 * damage still shows how many circles it started with.
 */

import { createHumanoidDiagram } from './humanoid.js';

/**
 * @param {object} unit
 * @param {object} [options]
 * @param {boolean} [options.compact=false] - compact layout for the sidebar card
 * @returns {HTMLElement}
 */
export function InternalStructureDiagram(unit, options = {}) {
  return createHumanoidDiagram(unit, { ...options, variant: 'internal' });
}
