/**
 * A recording CanvasRenderingContext2D stand-in.
 *
 * jsdom has no canvas implementation, so a render test cannot look at pixels.
 * Instead this records every call and property assignment, which is enough to
 * assert that the renderer drew the right things in the right order.
 */

export function createRecordingContext() {
  const calls = [];
  const state = {};

  const special = {
    measureText: () => ({ width: 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: () => ({ data: [] }),
    setTransform: () => {},
    isPointInPath: () => false
  };

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'state') return state;
      if (prop === 'reset') return () => { calls.length = 0; };
      if (prop === 'methods') return () => calls.filter(c => c.method).map(c => c.method);
      if (prop === 'texts') return () => calls.filter(c => c.method === 'fillText').map(c => c.args[0]);
      if (prop === 'styles') return () => calls.filter(c => c.set).map(c => `${c.set}=${c.value}`);
      if (special[prop]) return special[prop];
      return (...args) => { calls.push({ method: prop, args }); };
    },
    set(_target, prop, value) {
      state[prop] = value;
      calls.push({ set: prop, value });
      return true;
    }
  });
}

/** A canvas object good enough for MapRenderer, backed by a recording context. */
export function createRecordingCanvas(width = 800, height = 600) {
  const ctx = createRecordingContext();
  return {
    width,
    height,
    ctx,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height })
  };
}
