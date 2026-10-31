/**
 * Read-only unit accessors shared by the record-sheet components.
 *
 * Real Units answer with their own getters; the fallbacks only exist so a
 * minimal test fixture (a plain object) still renders instead of throwing.
 * Nothing here computes rules - maxima come from the unit, never from a table
 * copied into the UI.
 */

import { numberOrZero } from './dom.js';

/** Current armour points in a location (front by default). */
export function armorValue(unit, location, rear = false) {
  if (unit && typeof unit.getArmor === 'function') return numberOrZero(unit.getArmor(location, rear));
  const record = unit && unit.armor && unit.armor[location];
  if (!record) return 0;
  return numberOrZero(rear ? record.rear : record.front);
}

/** Maximum armour points in a location (front by default). */
export function maxArmorValue(unit, location, rear = false) {
  if (unit && typeof unit.getMaxArmor === 'function') {
    return numberOrZero(unit.getMaxArmor(location, rear));
  }
  return armorValue(unit, location, rear);
}

/** Current internal structure points in a location. */
export function internalValue(unit, location) {
  if (unit && typeof unit.getInternal === 'function') return numberOrZero(unit.getInternal(location));
  return numberOrZero(unit && unit.internalStructure && unit.internalStructure[location]);
}

/** Printed (maximum) internal structure points in a location. */
export function maxInternalValue(unit, location) {
  if (unit && typeof unit.getMaxInternal === 'function') {
    return numberOrZero(unit.getMaxInternal(location));
  }
  if (unit && unit._initialInternalStructure && unit._initialInternalStructure[location] !== undefined) {
    return numberOrZero(unit._initialInternalStructure[location]);
  }
  return internalValue(unit, location);
}

/** A location is destroyed when its internal structure reaches zero. */
export function isLocationDestroyed(unit, location) {
  return internalValue(unit, location) <= 0;
}

/** Walk / run / jump values from a unit, defaulting to zero. */
export function movementValues(unit) {
  const movement = (unit && unit.movement) || {};
  return {
    walk: numberOrZero(movement.walk),
    run: numberOrZero(movement.run),
    jump: numberOrZero(movement.jump)
  };
}

/** Current MP, falling back to walk MP for plain-object fixtures. */
export function currentMP(unit) {
  if (unit && typeof unit.currentMP === 'number') return unit.currentMP;
  return movementValues(unit).walk;
}

/** Heat-sink count/type/dissipation from the unit. */
export function heatSinkInfo(unit) {
  const sinks = (unit && unit.heatSinks) || {};
  const count = numberOrZero(sinks.count);
  const damaged = numberOrZero(sinks.damaged);
  const type = sinks.type || 'single';
  const perSink = type === 'double' ? 2 : 1;
  const dissipation = typeof unit?.getHeatDissipation === 'function'
    ? numberOrZero(unit.getHeatDissipation())
    : Math.max(0, count - damaged) * perSink;
  return { count, type, damaged, dissipation };
}
