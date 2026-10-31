/**
 * Structured logging with a bounded in-memory history.
 *
 * Until now the only game log was `ui.log`, which writes dice-log rows into the
 * DOM, plus a couple of console calls. Nothing carried the engine context
 * (turn, phase, action payload), nothing survived a reload, and there was no
 * way to hand a live bug report back to a developer. This module keeps the
 * last N structured entries in memory, lets sinks subscribe to new ones, and
 * exports the history as text or JSON.
 *
 * Deliberate constraints:
 * - `debug`/`info` never reach the console (they only feed the ring buffer);
 *   `warn`/`error` are mirrored to the console so a real failure is visible.
 * - Payloads are reduced to a bounded, JSON-safe summary at record time, so a
 *   class instance or a circular structure cannot bloat the buffer or break an
 *   export, and later mutation of the live object cannot rewrite history.
 * - The Logger class itself stays passive: no timers and no network. The
 *   optional dev-server stream lives in attachGameLogging(): it probes once per
 *   game, throttles batches, and a failure disables the stream - never play.
 */

export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
export const DEFAULT_CAPACITY = 2000;
export const DEFAULT_LEVEL = 'debug';

// Dev-server log streaming (tools/dev-server.cjs). The endpoint can be
// overridden with `window.BT_LOG_ENDPOINT`; nothing here touches the network
// until attachGameLogging() probes it at game start.
export const DEFAULT_LOG_ENDPOINT = '/api/log';
export const LOG_FLUSH_INTERVAL_MS = 1000;
export const LOG_FLUSH_BATCH_SIZE = 50;
export const LOG_PROBE_TIMEOUT_MS = 1500;

const LEVEL_RANK = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

// Bounds for a payload summary. Live engine payloads carry Unit/Hex class
// instances and deeply nested damage results; the log keeps the shape that
// explains a bug, not a second copy of the game state.
const MAX_DEPTH = 4;
const MAX_OBJECT_KEYS = 40;
const MAX_ARRAY_ITEMS = 40;
const MAX_STRING_LENGTH = 500;

/**
 * Engine events the live game mirrors into the log.
 *
 * The list is the observable side of a game: what the player asked the engine
 * to do (`actionProcessed`), where the turn/phase/queue moved, and every rules
 * result that changes the board. `supportStrike*` is both events the engine
 * emits for a scheduled/resolved Battlefield Support strike.
 */
export const GAME_EVENTS = Object.freeze([
  'actionProcessed',
  'phaseChanged',
  'queueAdvanced',
  'unitMoved',
  'damageApplied',
  'unitAttacked',
  'unitFell',
  'unitDestroyed',
  'fireStarted',
  'buildingDamaged',
  'minefieldTriggered',
  'supportStrikeScheduled',
  'supportStrikeResolved'
]);

/**
 * Normalise a log-stream endpoint: default `/api/log`, no trailing slash, so
 * `${endpoint}/status` and the POST target are predictable.
 *
 * @param {*} endpoint
 * @returns {string}
 */
export function normalizeLogEndpoint(endpoint) {
  const raw = typeof endpoint === 'string' ? endpoint.trim() : '';
  const value = raw === '' ? DEFAULT_LOG_ENDPOINT : raw;
  return value.replace(/\/+$/, '') || DEFAULT_LOG_ENDPOINT;
}

/**
 * Validate and normalise a level name.
 *
 * @param {string} level
 * @returns {'debug'|'info'|'warn'|'error'}
 * @throws {TypeError} when the name is not one of LOG_LEVELS
 */
export function normalizeLevel(level) {
  const normalized = typeof level === 'string' ? level.toLowerCase() : '';
  if (!Object.prototype.hasOwnProperty.call(LEVEL_RANK, normalized)) {
    throw new TypeError(`Unknown log level: ${level}`);
  }
  return normalized;
}

/**
 * A bounded, JSON-safe snapshot of a payload.
 *
 * Class instances become plain objects, Maps/Sets become objects/arrays,
 * Errors keep name+message, long strings and big collections are truncated,
 * and circular references are marked instead of recursing forever.
 *
 * @param {*} value
 * @returns {*} plain data safe for JSON.stringify
 */
export function summarizeData(value) {
  return summarizeValue(value, 0, new WeakSet());
}

function summarizeValue(value, depth, seen) {
  if (value === null || value === undefined) return null;

  const type = typeof value;
  if (type === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return value.toString();
  if (type === 'symbol') return value.toString();
  if (type === 'function') return '[Function]';

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map(item => summarizeValue(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) {
        out.push(`… ${value.length - MAX_ARRAY_ITEMS} more`);
      }
      return out;
    }

    if (value instanceof Map) {
      const out = {};
      let count = 0;
      for (const [key, item] of value) {
        if (count >= MAX_OBJECT_KEYS) {
          out._truncatedKeys = value.size - MAX_OBJECT_KEYS;
          break;
        }
        out[String(key)] = summarizeValue(item, depth + 1, seen);
        count++;
      }
      return out;
    }

    if (value instanceof Set) {
      return summarizeValue([...value].slice(0, MAX_ARRAY_ITEMS), depth + 1, seen);
    }

    const out = {};
    const keys = Object.keys(value);
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      out[key] = summarizeValue(value[key], depth + 1, seen);
    }
    if (keys.length > MAX_OBJECT_KEYS) {
      out._truncatedKeys = keys.length - MAX_OBJECT_KEYS;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * The payload summary recorded for one engine event.
 *
 * Picks the fields that explain a bug (who, what, where, result) instead of
 * serialising a whole Unit or damage result. Unknown events fall back to a
 * bounded plain-data dump so nothing is silently lost.
 *
 * @param {string} event
 * @param {object} [payload]
 * @returns {object} plain data
 */
export function summarizeEvent(event, payload) {
  const data = payload || {};

  switch (event) {
    case 'actionProcessed': {
      const action = data.action || {};
      const result = data.result || {};
      const summary = {
        playerId: data.playerId ?? null,
        action: action.type ?? null,
        unitId: action.unitId ?? action.attackerId ?? null,
        targetId: action.targetId ?? null,
        success: result.success !== false
      };
      if (result.error) summary.error = result.error;
      if (result.nextPhase) summary.nextPhase = result.nextPhase;
      if (Array.isArray(action.path)) summary.pathLength = action.path.length;
      return summary;
    }
    case 'phaseChanged':
      return { phase: data.phase ?? null, turn: data.turn ?? null };
    case 'queueAdvanced':
      return { unitId: data.unitId ?? null, playerId: data.playerId ?? null };
    case 'unitMoved':
      return {
        unitId: data.unitId ?? null,
        hexKey: data.hexKey ?? null,
        facing: data.facing ?? null
      };
    case 'damageApplied':
      return {
        attackerId: data.attackerId ?? null,
        targetId: data.targetId ?? null,
        location: data.location ?? null,
        damage: data.damage ?? null,
        criticalHits: data.result && Array.isArray(data.result.criticalHits)
          ? data.result.criticalHits.length
          : 0
      };
    case 'unitAttacked':
      return {
        attackerId: data.attackerId ?? null,
        targetId: data.targetId ?? null,
        hit: Boolean(data.result && data.result.hit),
        roll: data.result ? data.result.roll ?? null : null,
        targetNumber: data.result ? data.result.targetNumber ?? null : null
      };
    case 'unitFell':
      return { unitId: data.unitId ?? null, fell: Boolean(data.fall) };
    case 'unitDestroyed':
      return { unitId: data.unitId ?? null };
    case 'fireStarted':
      return { hexKey: data.hexKey ?? null };
    case 'buildingDamaged':
      return {
        hexKey: data.hexKey ?? null,
        damage: data.damage ?? null,
        currentCF: data.currentCF ?? null
      };
    case 'minefieldTriggered':
      return {
        unitId: data.unitId ?? null,
        hexKey: data.hexKey ?? null,
        triggered: Boolean(data.triggered),
        roll: data.roll ?? null,
        hits: Array.isArray(data.hits) ? data.hits.length : 0
      };
    case 'supportStrikeScheduled':
      return {
        type: data.type ?? null,
        hexKey: data.hexKey ?? null,
        turn: data.turn ?? null,
        owner: data.owner ?? null
      };
    case 'supportStrikeResolved':
      return {
        type: data.type ?? null,
        hexKey: data.hexKey ?? null,
        turn: data.turn ?? null,
        roll: data.roll ?? null,
        targetNumber: data.targetNumber ?? null,
        success: Boolean(data.success),
        scatteredTo: data.scatter ? data.scatter.hexKey ?? null : null,
        hits: Array.isArray(data.hits) ? data.hits.length : 0
      };
    default:
      return summarizeData(data);
  }
}

/** One log line: `[ts] LEVEL category message {data}`. */
function formatEntry(entry) {
  const level = entry.level.toUpperCase().padEnd(5);
  const data = entry.data === null || entry.data === undefined
    ? ''
    : ` ${safeJSON(entry.data)}`;
  return `[${entry.ts}] ${level} ${entry.category} ${entry.message}${data}`;
}

/** JSON.stringify that cannot throw on already-summarised data. */
function safeJSON(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 'null' : json;
  } catch (_) {
    return '[unserializable]';
  }
}

/**
 * Level-filtered structured logger with a fixed-size ring buffer and sinks.
 *
 * ```js
 * const logger = new Logger({ level: 'debug', capacity: 2000 });
 * const stop = logger.subscribe(entry => mirror(entry));
 * logger.info('game', 'game started', { gameId: 'game-1' });
 * stop();
 * const text = logger.toText();
 * ```
 */
export class Logger {
  /**
   * @param {object} [options]
   * @param {number} [options.capacity] - ring-buffer size in entries
   * @param {'debug'|'info'|'warn'|'error'} [options.level] - minimum level recorded
   * @param {object|null} [options.consoleSink] - console-like object for warn/error
   * @param {() => number} [options.now] - clock injection for deterministic tests
   */
  constructor(options = {}) {
    const {
      capacity = DEFAULT_CAPACITY,
      level = DEFAULT_LEVEL,
      consoleSink = typeof console !== 'undefined' ? console : null,
      now = () => Date.now()
    } = options;

    const size = Number.isFinite(capacity) ? Math.floor(capacity) : DEFAULT_CAPACITY;
    this._capacity = Math.max(1, size);
    this._level = normalizeLevel(level);
    this._consoleSink = consoleSink || null;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._entries = [];
    this._sinks = new Set();
    this._context = {};
  }

  /** Minimum level recorded into the buffer. */
  get level() {
    return this._level;
  }

  /** Ring-buffer size in entries. */
  get capacity() {
    return this._capacity;
  }

  /** Number of entries currently buffered. */
  get size() {
    return this._entries.length;
  }

  /** Number of subscribed sinks. */
  get sinkCount() {
    return this._sinks.size;
  }

  /** A copy of the buffered entries, oldest first. */
  get entries() {
    return this._entries.map(entry => ({ ...entry }));
  }

  /**
   * Is a level at or above the current filter?
   * @param {'debug'|'info'|'warn'|'error'} level
   */
  isEnabled(level) {
    return LEVEL_RANK[normalizeLevel(level)] >= LEVEL_RANK[this._level];
  }

  /**
   * Raise or lower the recording threshold. Entries already buffered stay.
   * @param {'debug'|'info'|'warn'|'error'} level
   */
  setLevel(level) {
    this._level = normalizeLevel(level);
    return this._level;
  }

  /**
   * Update the export header's game context (`{gameId, turn, phase}`).
   * @param {object} patch - shallow-merged into the context
   * @returns {object} the new context
   */
  setContext(patch = {}) {
    if (patch && typeof patch === 'object') Object.assign(this._context, patch);
    return this.getContext();
  }

  /** @returns {object} a copy of the export header context */
  getContext() {
    return { ...this._context };
  }

  /**
   * Record one entry. Entries below the level filter are dropped before they
   * touch the buffer, so a raised threshold also frees ring-buffer space.
   *
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} category - subsystem that produced the entry
   * @param {string} message - short human-readable description
   * @param {*} [data] - payload summary (bounded plain data is stored)
   * @returns {object|null} the entry, or null when filtered out
   */
  log(level, category, message, data = null) {
    const normalized = normalizeLevel(level);
    if (!this.isEnabled(normalized)) return null;

    const entry = {
      ts: new Date(this._now()).toISOString(),
      level: normalized,
      category: String(category || 'app'),
      message: String(message ?? ''),
      data: data === undefined ? null : summarizeData(data)
    };

    this._entries.push(entry);
    if (this._entries.length > this._capacity) {
      this._entries.splice(0, this._entries.length - this._capacity);
    }

    this._notify(entry);
    this._mirror(entry);
    return entry;
  }

  debug(category, message, data) {
    return this.log('debug', category, message, data);
  }

  info(category, message, data) {
    return this.log('info', category, message, data);
  }

  warn(category, message, data) {
    return this.log('warn', category, message, data);
  }

  error(category, message, data) {
    return this.log('error', category, message, data);
  }

  /**
   * Follow new entries (a "sink"): called for every accepted entry.
   *
   * @param {(entry: object) => void} sink
   * @returns {() => void} unsubscribe function
   */
  subscribe(sink) {
    if (typeof sink !== 'function') {
      throw new TypeError('Logger.subscribe expects a function');
    }
    this._sinks.add(sink);
    return () => { this._sinks.delete(sink); };
  }

  /**
   * Remove a previously subscribed sink.
   * @param {(entry: object) => void} sink
   * @returns {boolean} true when the sink was subscribed
   */
  unsubscribe(sink) {
    return this._sinks.delete(sink);
  }

  /** Drop every buffered entry. The level, context and sinks are kept. */
  clear() {
    this._entries.length = 0;
  }

  /**
   * Export the log as plain JSON: `{app, version, exportedAt, context, entries}`.
   * The context carries the game id/turn/phase that the entries belong to.
   */
  toJSON() {
    return {
      app: 'battletech-tabletop-simulator',
      version: 1,
      exportedAt: new Date(this._now()).toISOString(),
      context: this.getContext(),
      capacity: this._capacity,
      level: this._level,
      entries: this.entries
    };
  }

  /**
   * Export the log as a human-readable, copy-pasteable text block. The header
   * names the game (id, turn, phase) the entries were recorded in.
   */
  toText() {
    const context = this._context;
    const lines = [
      'BattleTech Tabletop Simulator debug log',
      `exported: ${new Date(this._now()).toISOString()}`,
      `game: ${context.gameId ?? '(none)'}`,
      `turn: ${context.turn ?? '-'}`,
      `phase: ${context.phase ?? '-'}`,
      `level: ${this._level}  entries: ${this._entries.length}/${this._capacity}`,
      ''
    ];
    if (this._entries.length === 0) {
      lines.push('(no entries recorded)');
    } else {
      for (const entry of this._entries) lines.push(formatEntry(entry));
    }
    return `${lines.join('\n')}\n`;
  }

  /** Deliver an entry to every sink; a broken sink must not stop the game. */
  _notify(entry) {
    for (const sink of [...this._sinks]) {
      try {
        sink(entry);
      } catch (_) {
        // A debugging sink is never allowed to break the code being debugged.
      }
    }
  }

  /** Warnings and errors still reach the console; debug/info stay quiet. */
  _mirror(entry) {
    if (!this._consoleSink) return;
    const method = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : null;
    if (!method || typeof this._consoleSink[method] !== 'function') return;
    this._consoleSink[method](`[${entry.category}] ${entry.message}`, entry.data ?? '');
  }
}

/**
 * Mirror a running game into a logger.
 *
 * Subscribes to the engine event bus (every event in `events`), refreshes the
 * export header on phase changes, mirrors `ui.log` dice-log lines into the same
 * ring buffer, records uncaught errors / unhandled rejections while the game is
 * running, and - when the page is served by `tools/dev-server.cjs` - streams
 * the log to `logs/<gameId>-<session timestamp>.txt` through `POST /api/log`
 * (one file per game, so reloading does not append to the previous game's log).
 *
 * main.js calls this from `startGame` and `dispose()`s it from `teardownGame`,
 * so listeners exist exactly once per game. `dispose()` is idempotent: after it
 * runs, even a stale handler reference cannot add entries.
 *
 * The stream probe is asynchronous and best-effort: attachGameLogging returns
 * immediately, a missing server only costs one fallback log line, and a failed
 * POST disables streaming after one warning. The endpoint comes from
 * `window.BT_LOG_ENDPOINT` (or the `logEndpoint` option) and no network call
 * happens before the game starts.
 *
 * @param {object} options
 * @param {Logger} options.logger
 * @param {object} options.engine - GameEngine (eventBus, stateManager, gameId)
 * @param {object|null} [options.ui] - UIController whose `log()` should be mirrored
 * @param {string[]} [options.events] - engine events to record
 * @param {object|null} [options.windowRef] - window-like object for global errors and BT_LOG_ENDPOINT
 * @param {*} [options.fetchRef] - fetch override; `null` disables log streaming
 * @param {string|null} [options.logEndpoint] - endpoint override for the log stream
 * @param {object|null} [options.navigatorRef] - navigator-like object for sendBeacon
 * @param {number} [options.flushIntervalMs] - background flush interval (default 1 s)
 * @param {number} [options.flushBatchSize] - immediate flush threshold (default 50 lines)
 * @param {number} [options.probeTimeoutMs] - status probe timeout (default 1.5 s)
 * @returns {{gameId: string|null, refreshContext: () => object, dispose: () => void}}
 */
export function attachGameLogging({
  logger,
  engine,
  ui = null,
  events = GAME_EVENTS,
  windowRef = typeof window !== 'undefined' ? window : null,
  fetchRef,
  logEndpoint = null,
  navigatorRef = null,
  flushIntervalMs = LOG_FLUSH_INTERVAL_MS,
  flushBatchSize = LOG_FLUSH_BATCH_SIZE,
  probeTimeoutMs = LOG_PROBE_TIMEOUT_MS
} = {}) {
  if (!logger || typeof logger.log !== 'function') {
    throw new TypeError('attachGameLogging needs a Logger');
  }
  if (!engine || !engine.eventBus || typeof engine.eventBus.on !== 'function') {
    throw new TypeError('attachGameLogging needs an engine with an eventBus');
  }

  const bus = engine.eventBus;
  const eventNames = Array.isArray(events) ? events : GAME_EVENTS;
  const subscriptions = [];
  const windowHandlers = [];
  let disposed = false;
  let uiLogRestore = null;

  const currentState = () => (
    engine.stateManager && typeof engine.stateManager.getState === 'function'
      ? engine.stateManager.getState()
      : {}
  );

  /** Keep the export header in step with the game the entries belong to. */
  const refreshContext = () => {
    const state = currentState() || {};
    return logger.setContext({
      gameId: engine.gameId ?? null,
      turn: state.turn ?? null,
      phase: state.phase ?? null
    });
  };

  refreshContext();

  for (const eventName of eventNames) {
    const handler = (payload) => {
      if (disposed) return;
      logger.debug('engine', eventName, summarizeEvent(eventName, payload));
      if (eventName === 'phaseChanged') refreshContext();
    };
    bus.on(eventName, handler);
    subscriptions.push({ eventName, handler });
  }

  // Dice-log lines are what the player saw; keep them next to the engine trail.
  if (ui && typeof ui.log === 'function') {
    const originalLog = ui.log;
    const mirroredLog = function mirroredLog(message, className = 'info') {
      if (!disposed) logger.debug('ui', String(message), { className });
      return originalLog.call(this, message, className);
    };
    ui.log = mirroredLog;
    uiLogRestore = () => {
      if (ui.log === mirroredLog) ui.log = originalLog;
    };
  }

  // Only while a game is running: a menu-time error is not a game bug.
  if (windowRef && typeof windowRef.addEventListener === 'function') {
    const onError = (event) => {
      if (disposed) return;
      const error = event && event.error;
      logger.error('window', 'uncaught error', {
        message: event && event.message,
        filename: event && event.filename,
        lineno: event && event.lineno,
        colno: event && event.colno,
        stack: error && error.stack ? error.stack : undefined
      });
    };
    const onRejection = (event) => {
      if (disposed) return;
      const reason = event && event.reason;
      logger.error('window', 'unhandled promise rejection', {
        message: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined
      });
    };
    windowRef.addEventListener('error', onError);
    windowRef.addEventListener('unhandledrejection', onRejection);
    windowHandlers.push(['error', onError], ['unhandledrejection', onRejection]);
  }

  // ---- Optional dev-server streaming (tools/dev-server.cjs) ----
  //
  // A browser cannot write a log file; when the page is served by the local
  // dev server the structured log is POSTed there and appended to
  // logs/<gameId>.txt. The endpoint is probed once per game; gameplay never
  // waits on it, and any failure falls back to the in-memory log and the
  // Ctrl+Shift+L download. Override the endpoint with window.BT_LOG_ENDPOINT.
  const resolvedEndpoint = normalizeLogEndpoint(
    logEndpoint || (windowRef && windowRef.BT_LOG_ENDPOINT) || DEFAULT_LOG_ENDPOINT
  );
  const resolvedFlushInterval = Number.isFinite(flushIntervalMs) && flushIntervalMs > 0
    ? flushIntervalMs
    : LOG_FLUSH_INTERVAL_MS;
  const resolvedBatchSize = Number.isFinite(flushBatchSize) && flushBatchSize > 0
    ? Math.floor(flushBatchSize)
    : LOG_FLUSH_BATCH_SIZE;
  const resolvedProbeTimeout = Number.isFinite(probeTimeoutMs) && probeTimeoutMs > 0
    ? probeTimeoutMs
    : LOG_PROBE_TIMEOUT_MS;

  let resolvedFetch = null;
  if (fetchRef !== undefined) {
    resolvedFetch = typeof fetchRef === 'function' ? fetchRef : null;
  } else if (windowRef && typeof windowRef.fetch === 'function') {
    resolvedFetch = (...args) => windowRef.fetch(...args);
  } else if (typeof fetch === 'function') {
    resolvedFetch = (...args) => fetch(...args);
  }

  const resolvedNavigator = navigatorRef
    || (windowRef && windowRef.navigator)
    || (typeof navigator !== 'undefined' ? navigator : null);

  let streamState = 'disabled'; // 'probing' | 'streaming' | 'disabled'
  let pendingLines = [];

  // One file per session: the engine gameId repeats on every page load, so a
  // timestamp keeps separate games apart. The server sanitises it again.
  const sessionStartedAt = (() => {
    try {
      return new Date(typeof logger._now === 'function' ? logger._now() : Date.now());
    } catch (_) {
      return new Date();
    }
  })();
  const sessionId = `${engine.gameId ?? 'game'}-${sessionStartedAt.toISOString().replace(/[-:.]/g, '').replace('Z', '')}`;

  // One physical line per entry: dice-log messages contain newlines.
  const toWireLines = (lines) => lines.map(line => String(line).replace(/\r\n|\r|\n/g, ' | '));
  let streamUnsubscribe = null;
  let streamInterval = null;
  let probeTimer = null;
  let postInFlight = false;
  let streamListeners = [];

  /** Best-effort synchronous flush used by dispose() and beforeunload. */
  const sendBeaconPayload = (body) => {
    const sendBeacon = resolvedNavigator && typeof resolvedNavigator.sendBeacon === 'function'
      ? resolvedNavigator.sendBeacon.bind(resolvedNavigator)
      : null;
    if (!sendBeacon) return false;
    try {
      // text/plain keeps the beacon a "simple" request, so an endpoint override
      // on another host cannot be blocked by a CORS preflight (the dev server
      // parses the JSON body regardless of content type).
      const payload = typeof Blob === 'function'
        ? new Blob([body], { type: 'text/plain;charset=UTF-8' })
        : body;
      return sendBeacon(resolvedEndpoint, payload) === true;
    } catch (_) {
      return false;
    }
  };

  const clearStreamResources = () => {
    if (probeTimer !== null) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    if (streamInterval !== null) {
      clearInterval(streamInterval);
      streamInterval = null;
    }
    for (const [type, handler] of streamListeners) {
      if (windowRef && typeof windowRef.removeEventListener === 'function') {
        windowRef.removeEventListener(type, handler);
      }
    }
    streamListeners = [];
    if (streamUnsubscribe) {
      streamUnsubscribe();
      streamUnsubscribe = null;
    }
  };

  /**
   * Stop streaming. A probe that never reached the server is informational; a
   * stream that breaks mid-game is one warning. Either way the ring buffer and
   * the download export keep working.
   */
  const disableStream = (reason, { silent = false, failedLines = 0 } = {}) => {
    if (streamState === 'disabled') return;
    const wasStreaming = streamState === 'streaming';
    streamState = 'disabled';
    clearStreamResources();
    const droppedLines = pendingLines.length + failedLines;
    pendingLines = [];
    if (silent) return;
    if (wasStreaming) {
      logger.warn('stream', 'log streaming disabled', {
        endpoint: resolvedEndpoint,
        reason,
        droppedLines
      });
    } else {
      logger.info('stream', `log streaming unavailable (${reason}); using in-memory log and Ctrl+Shift+L download`);
    }
  };

  /**
   * Send the buffered lines. `beacon` flushes synchronously via sendBeacon for
   * dispose()/beforeunload and falls back to a keepalive fetch.
   */
  const flushStream = async ({ beacon = false } = {}) => {
    if (streamState !== 'streaming' || pendingLines.length === 0) return false;
    if (postInFlight && !beacon) return false;

    const lines = pendingLines;
    pendingLines = [];
    const body = JSON.stringify({
      gameId: engine.gameId ?? null,
      sessionId,
      lines: toWireLines(lines)
    });

    if (beacon && sendBeaconPayload(body)) return true;

    postInFlight = true;
    try {
      const response = await resolvedFetch(resolvedEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      });
      if (response && response.ok === false) {
        throw new Error(`POST ${resolvedEndpoint} failed with status ${response.status}`);
      }
      return true;
    } catch (error) {
      disableStream(error && error.message ? error.message : 'POST failed', {
        failedLines: lines.length
      });
      return false;
    } finally {
      postInFlight = false;
    }
  };

  const onBeforeUnload = () => {
    void flushStream({ beacon: true });
  };

  const startStreaming = () => {
    if (streamState !== 'probing' || disposed) return;
    streamState = 'streaming';
    logger.info('stream', `debug log streaming to ${resolvedEndpoint}`, {
      gameId: engine.gameId ?? null
    });

    // Backfill entries recorded before the probe answered (startGame request,
    // deployments, the zero-unit fallback) so the file is the whole game log,
    // not just what happened after the server said hello. main.js clears the
    // logger per game, so these are this game's entries.
    pendingLines = logger.entries.map(formatEntry);

    streamInterval = setInterval(() => { void flushStream(); }, resolvedFlushInterval);
    if (windowRef && typeof windowRef.addEventListener === 'function') {
      windowRef.addEventListener('beforeunload', onBeforeUnload);
      streamListeners.push(['beforeunload', onBeforeUnload]);
    }
    if (pendingLines.length > 0) void flushStream();
  };

  const probeStream = async () => {
    let settled = false;
    const finish = (apply) => {
      if (settled) return;
      settled = true;
      if (probeTimer !== null) {
        clearTimeout(probeTimer);
        probeTimer = null;
      }
      apply();
    };

    probeTimer = setTimeout(() => {
      finish(() => disableStream('probe timed out'));
    }, resolvedProbeTimeout);

    try {
      // Deliberately no AbortSignal: the page and its fetch can come from
      // different realms (jsdom tests use Node's fetch), where a foreign
      // AbortSignal is rejected. A timer race is realm-independent, and a
      // status request that resolves after we gave up is harmless.
      const response = await resolvedFetch(`${resolvedEndpoint}/status`, {
        method: 'GET',
        cache: 'no-store'
      });
      if (disposed) return;
      if (response && response.ok === false) {
        throw new Error(`status ${response.status ?? 'not ok'}`);
      }
      const payload = response && typeof response.json === 'function'
        ? await response.json()
        : null;
      if (disposed) return;
      if (!payload || payload.ok !== true) {
        throw new Error('log endpoint unavailable');
      }
      finish(startStreaming);
    } catch (error) {
      if (disposed) return;
      finish(() => disableStream(error && error.message ? error.message : 'log endpoint unavailable'));
    }
  };

  if (resolvedFetch) {
    streamState = 'probing';
    // Subscribe before the probe resolves so the game-start entries are not
    // lost when the server does answer.
    streamUnsubscribe = logger.subscribe((entry) => {
      if (streamState === 'disabled') return;
      pendingLines.push(formatEntry(entry));
      if (streamState === 'streaming' && pendingLines.length >= resolvedBatchSize) {
        void flushStream();
      }
    });
    void probeStream();
  } else {
    logger.info('stream', 'log streaming unavailable (no fetch); using in-memory log and Ctrl+Shift+L download');
  }

  return {
    gameId: engine.gameId ?? null,
    refreshContext,

    /** Remove every subscription, flush the stream and restore ui.log. Idempotent. */
    dispose() {
      if (disposed) return;
      disposed = true;

      // Flush what is still buffered while the page can still send it.
      if (streamState === 'streaming') {
        void flushStream({ beacon: true });
      }
      disableStream('game ended', { silent: true });

      for (const { eventName, handler } of subscriptions) {
        bus.off(eventName, handler);
      }
      subscriptions.length = 0;

      if (windowRef && typeof windowRef.removeEventListener === 'function') {
        for (const [type, handler] of windowHandlers) {
          windowRef.removeEventListener(type, handler);
        }
      }
      windowHandlers.length = 0;

      if (uiLogRestore) {
        uiLogRestore();
        uiLogRestore = null;
      }
    }
  };
}
