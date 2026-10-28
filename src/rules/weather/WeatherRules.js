/**
 * Weather and planetary conditions (BMM p62-63, Attack Modifiers Table p138).
 *
 * All modifiers come from the manual's tables; nothing here invents values.
 * Illumination (searchlights) is not modelled yet, so night modifiers always
 * apply when the night condition is set.
 */

/** Weapon-type groups used by the weather table. */
const MISSILE_TYPES = new Set(['M', 'SRM', 'LRM', 'MRM', 'ATM']);
const BALLISTIC_TYPES = new Set(['DB']);
const ENERGY_TYPES = new Set(['DE']);
const PULSE_TYPES = new Set(['P']);

const isMissile = (type) => MISSILE_TYPES.has(type);
const isBallistic = (type) => BALLISTIC_TYPES.has(type);
const isEnergy = (type) => ENERGY_TYPES.has(type);
const isPulse = (type) => PULSE_TYPES.has(type);

/** Fill in the weather fields the rules read. */
export function normalizeWeather(weather = {}) {
  return {
    light: weather.light || 'daylight',          // daylight | dusk | full_moon | moonless
    precipitation: weather.precipitation || 'none', // none | rain | heavy_rain | torrential | snow | heavy_snow
    fog: weather.fog || 'none',                  // none | light | heavy
    wind: weather.wind || 'none',                // none | moderate | strong | storm
    temperature: Number.isFinite(weather.temperature) ? weather.temperature : 20,
    windDirection: Number.isFinite(weather.windDirection) ? weather.windDirection : 1
  };
}

/**
 * Target-number modifier for a weapon attack (p138 table).
 * @param {object} weather
 * @param {string} weaponType - DE, DB, M/SRM/LRM, P
 * @param {object} target - used for the heat-based night reduction
 * @returns {{ modifier: number, reasons: string[] }}
 */
export function attackModifier(weather, weaponType, target = null) {
  const w = normalizeWeather(weather);
  const reasons = [];
  let modifier = 0;

  const targetHeat = (target && target.heat) || 0;

  // Fog: heavy fog only affects pulse and direct-fire energy.
  if (w.fog === 'heavy' && (isPulse(weaponType) || isEnergy(weaponType))) {
    modifier += 1;
    reasons.push('Heavy fog: +1');
  }

  // Light conditions.
  if (w.light === 'dusk') {
    // +1 unless the target's heat scale is at 25 or more.
    if (targetHeat < 25) {
      modifier += 1;
      reasons.push('Dusk/dawn: +1');
    }
  } else if (w.light === 'full_moon') {
    const reduced = Math.max(0, 2 - Math.floor(targetHeat / 20));
    if (reduced > 0) {
      modifier += reduced;
      reasons.push(`Full moon night: +${reduced}`);
    }
  } else if (w.light === 'moonless') {
    const reduced = Math.max(0, 3 - Math.floor(targetHeat / 15));
    if (reduced > 0) {
      modifier += reduced;
      reasons.push(`Moonless night: +${reduced}`);
    }
  }

  // Precipitation.
  if (w.precipitation === 'rain' || w.precipitation === 'heavy_rain') {
    modifier += 1;
    reasons.push('Rain: +1');
  } else if (w.precipitation === 'torrential') {
    modifier += 2;
    reasons.push('Torrential downpour: +2');
  } else if (w.precipitation === 'snow' || w.precipitation === 'heavy_snow') {
    modifier += 1;
    reasons.push('Snowfall: +1');
  }

  // Wind.
  if (w.wind === 'moderate' && isMissile(weaponType)) {
    modifier += 1;
    reasons.push('Moderate gale (missile): +1');
  } else if (w.wind === 'strong') {
    if (isMissile(weaponType)) { modifier += 2; reasons.push('Strong gale (missile): +2'); }
    else if (isBallistic(weaponType)) { modifier += 1; reasons.push('Strong gale (ballistic): +1'); }
  } else if (w.wind === 'storm') {
    if (isMissile(weaponType)) { modifier += 3; reasons.push('Storm (missile): +3'); }
    else if (isBallistic(weaponType)) { modifier += 2; reasons.push('Storm (ballistic): +2'); }
  }

  return { modifier, reasons };
}

/** Physical attack modifier from weather: moonless night +1. */
export function physicalAttackModifier(weather) {
  const w = normalizeWeather(weather);
  return w.light === 'moonless' ? { modifier: 1, reasons: ['Moonless night: +1'] } : { modifier: 0, reasons: [] };
}

/** Extra MP per hex from fog and darkness (Movement Costs Table, p136). */
export function movementModifier(weather) {
  const w = normalizeWeather(weather);
  let modifier = 0;
  if (w.fog === 'light') modifier += 1;
  if (w.fog === 'heavy') modifier += 2;
  if (w.light === 'full_moon') modifier += 1;
  if (w.light === 'moonless') modifier += 2;
  return modifier;
}

/** PSR modifier from rain (p62): heavy rain +1, torrential +2. */
export function psrModifier(weather) {
  const w = normalizeWeather(weather);
  if (w.precipitation === 'heavy_rain') return 1;
  if (w.precipitation === 'torrential') return 2;
  return 0;
}

/**
 * Heat gained or lost per turn from extreme temperatures (p62): +1 per 10C
 * above 50, -1 per 10C below -30.
 */
export function heatPerTurn(weather) {
  const w = normalizeWeather(weather);
  if (w.temperature > 50) return Math.ceil((w.temperature - 50) / 10);
  if (w.temperature < -30) return -Math.ceil((-30 - w.temperature) / 10);
  return 0;
}
