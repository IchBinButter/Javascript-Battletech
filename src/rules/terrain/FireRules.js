/**
 * Fire and smoke (BMM pp63-64).
 *
 * Fire Table (p63):
 *   Plasma / Inferno      automatic
 *   Flamer                4+
 *   Direct-Fire Energy    7+  (pulse included)
 *   Missile or Ballistic  9+
 * Environment: woods +0, jungle +1, light building -2, medium -1,
 *   heavy +0, hardened +1. Temperature: -1 per 10C above 30, +1 per 10C
 *   below -30.
 */

import { getNeighborInDirection } from '../../hex/HexMath.js';

const ENVIRONMENT = {
  light_woods: 0,
  heavy_woods: 0,
  jungle: 1,
  light_building: -2,
  medium_building: -1,
  heavy_building: 0,
  hardened_building: 1
};

const BUILDING_ENVIRONMENT = { light: -2, medium: -1, heavy: 0, hardened: 1 };

/** Heavy and hardened buildings cannot catch fire this way (p64). */
export function canBurn(hex) {
  if (!hex) return false;
  if (hex.building) return hex.building.type === 'light' || hex.building.type === 'medium';
  return hex.terrainType === 'light_woods' || hex.terrainType === 'heavy_woods';
}

/** Environment modifier for the fire roll, or null when the hex cannot burn. */
export function environmentModifier(hex) {
  if (!canBurn(hex)) return null;
  if (hex.building) return BUILDING_ENVIRONMENT[hex.building.type] ?? 0;
  return ENVIRONMENT[hex.terrainType] ?? 0;
}

function weaponCategory(weapon) {
  const id = String((weapon && weapon.id) || '').toLowerCase();
  if (id.includes('plasma') || id.includes('inferno')) return 'automatic';
  if (id.includes('flamer')) return 'flamer';
  if (weapon && (weapon.type === 'DE' || weapon.type === 'P')) return 'energy';
  return 'other';
}

export function temperatureModifier(temperature = 20) {
  if (temperature > 30) return -Math.floor((temperature - 30) / 10);
  if (temperature < -30) return Math.ceil((-30 - temperature) / 10);
  return 0;
}

/**
 * Target number to start a fire with this weapon in this hex.
 * @returns {number|null} null when the hex cannot burn; 0 means automatic
 */
export function fireTargetNumber(weapon, hex, temperature = 20) {
  if (!canBurn(hex)) return null;

  const category = weaponCategory(weapon);
  if (category === 'automatic') return 0;

  let tn = category === 'flamer' ? 4 : category === 'energy' ? 7 : 9;
  tn += environmentModifier(hex);
  tn += temperatureModifier(temperature);

  return Math.max(2, tn);
}

/** Resolve one ignition roll. */
export function attemptIgnition(weapon, hex, roll, temperature = 20) {
  const targetNumber = fireTargetNumber(weapon, hex, temperature);
  if (targetNumber === null) return { ignited: false, targetNumber: null };
  if (targetNumber === 0) return { ignited: true, targetNumber: 0, roll };
  return { ignited: roll >= targetNumber, targetNumber, roll };
}

/** A fire spreads downwind on a 12 (p64); a gale or storm spreads two hexes. */
export function spreadsOnRoll(roll) {
  return roll === 12;
}

export function spreadDistance(wind = 'none') {
  return wind === 'moderate' || wind === 'strong' || wind === 'storm' ? 2 : 1;
}

/** The hexes a fire would spread into, in order downwind. */
export function downwindHexes(hexKey, windDirection, distance = 1) {
  const hexes = [];
  let current = hexKey;
  for (let step = 0; step < distance; step++) {
    current = getNeighborInDirection(current, windDirection);
    hexes.push(current);
  }
  return hexes;
}

/** A burning building hex loses 2 CF every End Phase (p64). */
export const BUILDING_FIRE_CF_LOSS = 2;

/**
 * Heat a 'Mech gains from fire in one turn (p50, "Fire"): "During the Heat
 * Phase, a 'Mech in a burning hex absorbs an additional 5 Heat Points. A 'Mech
 * also absorbs 2 Heat Points for each burning hex it moved through during the
 * Movement Phase." Fire causes heat in BattleTech, not armour damage.
 */
export const FIRE_HEAT_STANDING = 5;
export const FIRE_HEAT_MOVED_THROUGH = 2;

/**
 * p50, "Outside Heat Sources": fire, plasma and weather "are cumulative, to a
 * maximum of 15 heat points in a single turn".
 */
export const OUTSIDE_HEAT_CAP = 15;

/**
 * Heat a 'Mech gains from fire this turn (p50).
 * @param {{standingInFire?: boolean, burningHexesMovedThrough?: number}} [fire]
 * @returns {number} heat points to add in the Heat Phase
 */
export function fireHeat({ standingInFire = false, burningHexesMovedThrough = 0 } = {}) {
  const moved = Math.max(0, Math.floor(Number.isFinite(burningHexesMovedThrough)
    ? burningHexesMovedThrough
    : 0));
  return (standingInFire ? FIRE_HEAT_STANDING : 0) + moved * FIRE_HEAT_MOVED_THROUGH;
}

/**
 * Cap cumulative outside heat at the p50 maximum of 15 per turn. Negative
 * values (cold weather cooling the 'Mech) pass through uncapped.
 */
export function capOutsideHeat(heat) {
  if (!Number.isFinite(heat)) return 0;
  return heat > OUTSIDE_HEAT_CAP ? OUTSIDE_HEAT_CAP : heat;
}
