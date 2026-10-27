/**
 * HeatScale - the single source of truth for heat level effects.
 *
 * Reads src/data/heatScale.json (record-sheet scale) and folds its cumulative
 * steps into the effects that apply at a given heat level. Every consumer
 * (heat phase, movement, to-hit calculation, UI) goes through this module so
 * the table exists in exactly one place.
 */

import heatScale from '../../data/heatScale.json' with { type: 'json' };

const FIELDS = ['movementPenalty', 'toHitModifier', 'shutdownAvoid', 'ammoExplosionAvoid', 'autoShutdown'];

/**
 * Effects active at a given heat level.
 * @param {number} heat
 * @returns {{
 *   level: number,
 *   movementPenalty: number,
 *   toHitModifier: number,
 *   shutdownAvoid: number|null,
 *   ammoExplosionAvoid: number|null,
 *   autoShutdown: boolean
 * }}
 */
export function getHeatEffects(heat) {
  const level = Number.isFinite(heat) ? Math.max(0, Math.floor(heat)) : 0;

  const effects = {
    level,
    movementPenalty: 0,
    toHitModifier: 0,
    shutdownAvoid: null,
    ammoExplosionAvoid: null,
    autoShutdown: false
  };

  for (const step of heatScale.steps) {
    if (level < step.heat) break;
    for (const field of FIELDS) {
      if (step[field] !== undefined) effects[field] = step[field];
    }
  }

  return effects;
}

/**
 * Human-readable effect descriptions for the dice log.
 * @param {number} heat
 * @returns {string[]}
 */
export function describeHeatEffects(heat) {
  const effects = getHeatEffects(heat);
  const parts = [];

  if (effects.toHitModifier > 0) {
    parts.push(`+${effects.toHitModifier} TN to weapons fire`);
  }
  if (effects.movementPenalty > 0) {
    parts.push(`-${effects.movementPenalty} Walk MP`);
  }
  if (effects.shutdownAvoid !== null) {
    parts.push(`Shutdown check: avoid on ${effects.shutdownAvoid}+`);
  }
  if (effects.ammoExplosionAvoid !== null) {
    parts.push(`Ammo explosion check: avoid on ${effects.ammoExplosionAvoid}+`);
  }
  if (effects.autoShutdown) {
    parts.push('Automatic shutdown');
  }

  return parts;
}
