/**
 * EventBus - Pub/sub event system for decoupled communication.
 */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this._listeners.has(event)) return;
    const listeners = this._listeners.get(event);
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  }

  emit(event, data = {}) {
    if (!this._listeners.has(event)) return;
    for (const cb of this._listeners.get(event)) {
      try {
        cb(data);
      } catch (err) {
        console.error(`EventBus: error in "${event}" listener:`, err);
      }
    }
  }

  removeAllListeners() {
    this._listeners.clear();
  }

  removeAll() {
    this._listeners.clear();
  }

  destroy() {
    this._listeners.clear();
    this._listeners = null;
  }
}
