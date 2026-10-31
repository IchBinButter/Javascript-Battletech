/**
 * Record-sheet location table.
 *
 * One entry per 'Mech hit location in the order printed on the sheet, together
 * with the short code used inside the humanoid diagram and the number of
 * critical slots the location has (p6: 12 in arms/torsos, 6 in head/legs).
 * Every component that needs to walk the eight locations reads this table, so
 * the ordering and the slot counts exist exactly once.
 */

export const LOCATIONS = Object.freeze([
  { key: 'head', label: 'Head', short: 'HD', critSlots: 6 },
  { key: 'centerTorso', label: 'Center Torso', short: 'CT', critSlots: 12 },
  { key: 'leftTorso', label: 'Left Torso', short: 'LT', critSlots: 12 },
  { key: 'rightTorso', label: 'Right Torso', short: 'RT', critSlots: 12 },
  { key: 'leftArm', label: 'Left Arm', short: 'LA', critSlots: 12 },
  { key: 'rightArm', label: 'Right Arm', short: 'RA', critSlots: 12 },
  { key: 'leftLeg', label: 'Left Leg', short: 'LL', critSlots: 6 },
  { key: 'rightLeg', label: 'Right Leg', short: 'RL', critSlots: 6 }
]);

export const LOCATION_KEYS = Object.freeze(LOCATIONS.map(location => location.key));

/** Torso locations carry rear armour on the record sheet. */
export const TORSO_KEYS = Object.freeze(['centerTorso', 'leftTorso', 'rightTorso']);

const BY_KEY = new Map(LOCATIONS.map(location => [location.key, location]));

/** Location info for a key (falls back to the raw key). */
export function locationInfo(key) {
  return BY_KEY.get(key) || { key, label: key, short: String(key || '?').slice(0, 2).toUpperCase(), critSlots: 0 };
}

/** Short code (HD, CT, LT, ...). */
export function shortLocation(key) {
  return locationInfo(key).short;
}

/** Display label (Head, Center Torso, ...). */
export function longLocation(key) {
  return locationInfo(key).label;
}

/**
 * Pip-region geometry inside the 200 x 246 humanoid SVG viewBox. Each region
 * holds the label and the point circles for that location.
 */
export const DIAGRAM_REGIONS = Object.freeze({
  head: { x: 78, y: 4, w: 44, h: 42 },
  centerTorso: { x: 74, y: 48, w: 52, h: 88 },
  leftTorso: { x: 44, y: 50, w: 28, h: 82 },
  rightTorso: { x: 128, y: 50, w: 28, h: 82 },
  leftArm: { x: 6, y: 54, w: 34, h: 86 },
  rightArm: { x: 160, y: 54, w: 34, h: 86 },
  leftLeg: { x: 66, y: 140, w: 32, h: 100 },
  rightLeg: { x: 102, y: 140, w: 32, h: 100 }
});
