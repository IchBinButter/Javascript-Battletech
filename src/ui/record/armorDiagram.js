/**
 * Armour diagram: the humanoid record-sheet picture with one circle per armour
 * point, front in place and the rear torso points on a toggleable strip.
 *
 * All counts come from the unit itself (`getArmor`/`getMaxArmor`), so a 100-ton
 * Atlas (47 on the centre torso), a Locust (12) and a Thunderbolt (28) each
 * draw their own sheet without any hard-coded totals.
 */

import { createHumanoidDiagram } from './humanoid.js';

/**
 * @param {object} unit
 * @param {object} [options]
 * @param {boolean} [options.rear=false] - show the rear torso strip
 * @param {boolean} [options.compact=false] - compact layout for the sidebar card
 * @param {(rear: boolean) => void} [options.onToggleRear] - receives the toggle state
 * @returns {HTMLElement}
 */
export function ArmorDiagram(unit, options = {}) {
  return createHumanoidDiagram(unit, { ...options, variant: 'armor' });
}
