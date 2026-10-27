/**
 * General utility functions.
 */

/** Parse hex key "col,row" into { col, row } */
export function parseHexKey(key) {
  const [col, row] = key.split(',').map(Number);
  return { col, row };
}

/** Create hex key from col, row */
export function hexKey(col, row) {
  return `${col},${row}`;
}

/** Deep clone an object, preserving Maps, class instances, and functions */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Map) {
    const clonedMap = new Map();
    for (const [key, value] of obj) {
      clonedMap.set(deepClone(key), deepClone(value));
    }
    return clonedMap;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }

  if (typeof obj === 'function') {
    return obj;
  }

  const proto = Object.getPrototypeOf(obj);
  const clone = Object.create(proto);

  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }

  return clone;
}

/**
 * Simple EventEmitter mixin.
 * Usage: Object.assign(myObj, EventEmitter);
 */
export const EventEmitter = {
  _listeners: null,

  _ensureListeners() {
    if (!this._listeners) this._listeners = {};
  },

  on(event, callback) {
    this._ensureListeners();
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  off(event, callback) {
    this._ensureListeners();
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  emit(event, data) {
    this._ensureListeners();
    if (!this._listeners[event]) return;
    for (const cb of this._listeners[event]) {
      cb(data);
    }
  }
};

/** Clamp a value between min and max */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Calculate internal structure armor values for a given mech mass */
export function getInternalStructure(mass) {
  const t = mass;
  return {
    head: 3,
    centerTorso: t,
    leftTorso: Math.ceil(t * 0.21),
    rightTorso: Math.ceil(t * 0.21),
    leftArm: Math.ceil(t * 0.17),
    rightArm: Math.ceil(t * 0.17),
    leftLeg: Math.ceil(t * 0.21),
    rightLeg: Math.ceil(t * 0.21)
  };
}
