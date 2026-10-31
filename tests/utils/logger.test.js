/**
 * Unit and wiring tests for the structured debug log (src/utils/logger.js).
 *
 * The app records into a bounded ring buffer and exports it after a live bug.
 * These tests pin the four things the export depends on: entry shape/level
 * filtering, the ring-buffer trim, the text/JSON export header (game id, turn,
 * phase), and the game wiring (engine events, dice-log mirroring, global error
 * capture, complete teardown so a second game does not duplicate listeners).
 *
 * The second half covers the optional dev-server stream: probe success flushes
 * batches to /api/log, a failed probe/POST disables only the stream, dispose
 * flushes the remainder via sendBeacon, and the server-side appendLog() writer
 * (tools/dev-server.cjs) sanitises ids and enforces its size cap.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Logger,
  LOG_LEVELS,
  DEFAULT_CAPACITY,
  DEFAULT_LOG_ENDPOINT,
  GAME_EVENTS,
  attachGameLogging,
  normalizeLevel,
  normalizeLogEndpoint,
  summarizeData,
  summarizeEvent
} from '../../src/utils/logger.js';
import { EventBus } from '../../src/engine/EventBus.js';
import {
  appendLog,
  createServer,
  sanitizeGameId,
  LOG_DIR_NAME,
  MAX_LOG_BYTES
} from '../../tools/dev-server.cjs';

const FIXED_NOW = Date.UTC(2026, 9, 31, 5, 0, 0); // 2026-10-31T05:00:00.000Z
const fixedClock = () => FIXED_NOW;

/** Console stand-in: keeps warn/error assertions quiet and observable. */
function createConsoleSink() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createLogger(options = {}) {
  return new Logger({
    consoleSink: createConsoleSink(),
    now: fixedClock,
    ...options
  });
}

describe('Logger recording', () => {
  it('records the structured entry shape with level, category and payload', () => {
    const logger = createLogger();
    const entry = logger.info('game', 'game started', { gameId: 'game-7', units: 4 });

    expect(entry).toEqual({
      ts: '2026-10-31T05:00:00.000Z',
      level: 'info',
      category: 'game',
      message: 'game started',
      data: { gameId: 'game-7', units: 4 }
    });
    expect(Object.keys(entry).sort()).toEqual(['category', 'data', 'level', 'message', 'ts']);
    expect(logger.size).toBe(1);
    expect(logger.entries).toEqual([entry]);
  });

  it('exposes debug/info/warn/error helpers and records each level', () => {
    const logger = createLogger();
    logger.debug('test', 'd');
    logger.info('test', 'i');
    logger.warn('test', 'w');
    logger.error('test', 'e');

    expect(logger.entries.map(entry => entry.level)).toEqual(LOG_LEVELS);
    expect(logger.entries.map(entry => entry.message)).toEqual(['d', 'i', 'w', 'e']);
    // Missing payloads are normalised to null so every entry has all five keys.
    expect(logger.entries[0].data).toBeNull();
  });

  it('does not spam the console: only warn/error are mirrored', () => {
    const consoleSink = createConsoleSink();
    const logger = new Logger({ consoleSink, now: fixedClock });

    logger.debug('engine', 'phaseChanged', { phase: 'movement' });
    logger.info('ui', 'BattleMechs deployed');
    expect(consoleSink.log).not.toHaveBeenCalled();
    expect(consoleSink.warn).not.toHaveBeenCalled();
    expect(consoleSink.error).not.toHaveBeenCalled();

    logger.warn('game', 'fallback used');
    logger.error('window', 'uncaught error', { message: 'boom' });
    expect(consoleSink.warn).toHaveBeenCalledTimes(1);
    expect(consoleSink.warn.mock.calls[0][0]).toContain('fallback used');
    expect(consoleSink.error).toHaveBeenCalledTimes(1);
    expect(consoleSink.error.mock.calls[0][0]).toContain('uncaught error');
  });

  it('snapshots payload data instead of keeping a live reference', () => {
    const logger = createLogger();
    const payload = { count: 1, nested: { hexKey: '4,4' } };
    logger.info('game', 'deployed', payload);

    payload.count = 2;
    payload.nested.hexKey = '9,9';

    expect(logger.entries[0].data).toEqual({ count: 1, nested: { hexKey: '4,4' } });
  });

  it('summarises circular and class-like payloads into JSON-safe data', () => {
    const logger = createLogger();
    const circular = { name: 'loop' };
    circular.self = circular;

    expect(() => logger.info('test', 'circular', circular)).not.toThrow();
    expect(logger.entries[0].data).toEqual({ name: 'loop', self: '[Circular]' });

    logger.info('test', 'collections', {
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      error: new Error('bad'),
      nested: { deep: { value: true } }
    });
    expect(logger.entries[1].data).toMatchObject({
      map: { a: 1 },
      set: [1, 2],
      error: { name: 'Error', message: 'bad' },
      nested: { deep: { value: true } }
    });

    expect(() => logger.toJSON()).not.toThrow();
  });

  it('truncates oversized payloads so one event cannot bloat the buffer', () => {
    const summary = summarizeData({
      long: 'x'.repeat(600),
      many: Array.from({ length: 60 }, (_, i) => i)
    });
    expect(summary.long.length).toBeLessThanOrEqual(501);
    expect(summary.many).toHaveLength(41); // 40 values + a "â€¦ more" marker
    expect(summary.many[40]).toContain('more');
  });
});

describe('Logger level filtering', () => {
  it('drops entries below the threshold and honours setLevel', () => {
    const logger = createLogger({ level: 'warn' });

    expect(logger.debug('test', 'debug')).toBeNull();
    expect(logger.info('test', 'info')).toBeNull();
    expect(logger.warn('test', 'warn')).not.toBeNull();
    expect(logger.error('test', 'error')).not.toBeNull();
    expect(logger.entries.map(entry => entry.level)).toEqual(['warn', 'error']);

    logger.setLevel('debug');
    expect(logger.info('test', 'after')).not.toBeNull();
    expect(logger.size).toBe(3);
  });

  it('reports whether a level is enabled and rejects unknown levels', () => {
    const logger = createLogger({ level: 'info' });
    expect(logger.isEnabled('debug')).toBe(false);
    expect(logger.isEnabled('info')).toBe(true);
    expect(logger.isEnabled('error')).toBe(true);
    expect(() => logger.setLevel('verbose')).toThrow(TypeError);
    expect(() => normalizeLevel('verbose')).toThrow(TypeError);
    expect(normalizeLevel('WARN')).toBe('warn');
    expect(() => logger.log('nope', 'test', 'x')).toThrow(TypeError);
  });

  it('filtered entries never reach sinks', () => {
    const logger = createLogger({ level: 'error' });
    const sink = vi.fn();
    logger.subscribe(sink);

    logger.debug('test', 'debug');
    logger.info('test', 'info');
    expect(sink).not.toHaveBeenCalled();

    logger.error('test', 'error');
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

describe('Logger ring buffer', () => {
  it('defaults to a 2000-entry buffer', () => {
    expect(createLogger().capacity).toBe(DEFAULT_CAPACITY);
    expect(DEFAULT_CAPACITY).toBe(2000);
  });

  it('keeps only the newest entries once capacity is reached', () => {
    const logger = createLogger({ capacity: 3 });
    for (let i = 0; i < 5; i++) logger.info('game', `entry ${i}`);

    expect(logger.size).toBe(3);
    expect(logger.capacity).toBe(3);
    expect(logger.entries.map(entry => entry.message)).toEqual(['entry 2', 'entry 3', 'entry 4']);
  });

  it('clear() empties the buffer without touching level, context or sinks', () => {
    const logger = createLogger({ level: 'warn' });
    logger.setContext({ gameId: 'game-7' });
    const sink = vi.fn();
    logger.subscribe(sink);
    logger.warn('test', 'one');

    logger.clear();
    expect(logger.size).toBe(0);
    expect(logger.entries).toEqual([]);
    expect(logger.level).toBe('warn');
    expect(logger.getContext()).toEqual({ gameId: 'game-7' });

    logger.warn('test', 'two');
    expect(logger.size).toBe(1);
    expect(sink).toHaveBeenCalledTimes(2);
  });
});

describe('Logger sinks', () => {
  it('subscribe() returns an unsubscribe function and unsubscribe() reports the state', () => {
    const logger = createLogger();
    const sink = vi.fn();

    const stop = logger.subscribe(sink);
    expect(logger.sinkCount).toBe(1);
    logger.info('test', 'one');
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({ level: 'info', message: 'one' });

    stop();
    expect(logger.sinkCount).toBe(0);
    logger.info('test', 'two');
    expect(sink).toHaveBeenCalledTimes(1);

    logger.subscribe(sink);
    expect(logger.unsubscribe(sink)).toBe(true);
    expect(logger.unsubscribe(sink)).toBe(false);
  });

  it('a throwing sink cannot break the code being debugged', () => {
    const logger = createLogger();
    logger.subscribe(() => { throw new Error('sink exploded'); });
    const second = vi.fn();
    logger.subscribe(second);

    expect(() => logger.info('test', 'still recorded')).not.toThrow();
    expect(logger.size).toBe(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('Logger export', () => {
  it('toText() carries the game id, turn and phase in its header', () => {
    const logger = createLogger();
    logger.setContext({ gameId: 'game-7', turn: 2, phase: 'movement' });
    logger.info('game', 'game started', { units: 4 });
    logger.info('engine', 'phaseChanged', { phase: 'movement', turn: 2 });

    const text = logger.toText();
    expect(text).toContain('BattleTech Tabletop Simulator debug log');
    expect(text).toContain('game: game-7');
    expect(text).toContain('turn: 2');
    expect(text).toContain('phase: movement');
    expect(text).toContain('game started');
    expect(text).toContain('phaseChanged');
    expect(text).toContain('{"phase":"movement","turn":2}');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('toText() says so when nothing was recorded', () => {
    const logger = createLogger();
    expect(logger.toText()).toContain('(no entries recorded)');
    expect(logger.toText()).toContain('game: (none)');
  });

  it('toJSON() exports the context and the entries (and stringifies cleanly)', () => {
    const logger = createLogger();
    logger.setContext({ gameId: 'game-7', turn: 3, phase: 'heat' });
    logger.warn('engine', 'heat check', { roll: 9 });

    const json = logger.toJSON();
    expect(json).toMatchObject({
      app: 'battletech-tabletop-simulator',
      version: 1,
      context: { gameId: 'game-7', turn: 3, phase: 'heat' },
      level: 'debug',
      capacity: DEFAULT_CAPACITY
    });
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0]).toMatchObject({ level: 'warn', category: 'engine', message: 'heat check' });

    const roundTripped = JSON.parse(JSON.stringify(logger));
    expect(roundTripped.context.gameId).toBe('game-7');
    expect(roundTripped.entries[0].data).toEqual({ roll: 9 });
  });

  it('getContext() returns a copy, so callers cannot mutate the header', () => {
    const logger = createLogger();
    logger.setContext({ gameId: 'game-7' });
    const context = logger.getContext();
    context.gameId = 'other';
    expect(logger.getContext().gameId).toBe('game-7');
  });
});

// ---- Game wiring (what main.js attaches on startGame / disposes on teardown) ----

const EVENT_PAYLOADS = {
  actionProcessed: {
    playerId: 0,
    action: { type: 'move', unitId: 'unit-1', path: ['2,2', '3,2'] },
    result: { success: true }
  },
  phaseChanged: { phase: 'movement', turn: 2 },
  queueAdvanced: { unitId: 'unit-2', playerId: 1 },
  unitMoved: { unitId: 'unit-1', hexKey: '3,2', facing: 2 },
  damageApplied: {
    attackerId: 'unit-1',
    targetId: 'unit-2',
    location: 'centerTorso',
    damage: 5,
    result: { criticalHits: [] }
  },
  unitAttacked: {
    attackerId: 'unit-1',
    targetId: 'unit-2',
    result: { hit: true, roll: 7, targetNumber: 5 }
  },
  unitFell: { unitId: 'unit-2', fall: true },
  unitDestroyed: { unitId: 'unit-2' },
  fireStarted: { hexKey: '4,4' },
  buildingDamaged: { hexKey: '5,5', damage: 10, currentCF: 20 },
  minefieldTriggered: {
    unitId: 'unit-1',
    hexKey: '6,6',
    triggered: true,
    roll: 8,
    hits: [{ location: 'leftLeg', damage: 5 }]
  },
  supportStrikeScheduled: { type: 'light_strike', hexKey: '7,7', turn: 3, owner: 0 },
  supportStrikeResolved: {
    type: 'light_strike',
    hexKey: '7,7',
    turn: 3,
    roll: 9,
    targetNumber: 7,
    success: true,
    scatter: null,
    hits: [{}, {}]
  }
};

function createGameHarness({ logger = createLogger(), attach = {} } = {}) {
  const bus = new EventBus();
  const state = { turn: 1, phase: 'initiative', currentPlayer: 0, units: {} };
  const engine = {
    gameId: 'game-42',
    eventBus: bus,
    stateManager: { getState: () => state }
  };

  const diceLog = [];
  const ui = {
    log(message, className = 'info') {
      diceLog.push({ message, className });
    }
  };
  const originalUiLog = ui.log;

  const windowRef = attach.windowRef || {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    navigator: { sendBeacon: vi.fn(() => true) }
  };
  const wiring = attachGameLogging({
    logger,
    engine,
    ui,
    events: GAME_EVENTS,
    // Unit tests never touch the network unless they opt in with a fetch mock.
    fetchRef: null,
    windowRef,
    ...attach
  });

  return { logger, bus, state, engine, ui, diceLog, originalUiLog, windowRef, wiring };
}

/** How many callbacks the bus still holds (EventBus keeps empty event arrays). */
function listenerCount(bus) {
  return [...bus._listeners.values()].reduce((sum, listeners) => sum + listeners.length, 0);
}

describe('attachGameLogging', () => {
  it('records every configured engine event with a payload summary', () => {
    const harness = createGameHarness();

    for (const eventName of GAME_EVENTS) {
      harness.state.phase = EVENT_PAYLOADS[eventName].phase || harness.state.phase;
      harness.bus.emit(eventName, EVENT_PAYLOADS[eventName]);
    }

    const engineEntries = harness.logger.entries.filter(entry => entry.category === 'engine');
    expect(engineEntries.map(entry => entry.message)).toEqual([...GAME_EVENTS]);
    expect(engineEntries.every(entry => entry.level === 'debug')).toBe(true);

    const byMessage = new Map(engineEntries.map(entry => [entry.message, entry.data]));
    expect(byMessage.get('phaseChanged')).toEqual({ phase: 'movement', turn: 2 });
    expect(byMessage.get('queueAdvanced')).toEqual({ unitId: 'unit-2', playerId: 1 });
    expect(byMessage.get('unitMoved')).toEqual({ unitId: 'unit-1', hexKey: '3,2', facing: 2 });
    expect(byMessage.get('unitDestroyed')).toEqual({ unitId: 'unit-2' });
    expect(byMessage.get('fireStarted')).toEqual({ hexKey: '4,4' });
    expect(byMessage.get('buildingDamaged')).toEqual({ hexKey: '5,5', damage: 10, currentCF: 20 });
    expect(byMessage.get('minefieldTriggered')).toMatchObject({ unitId: 'unit-1', hits: 1 });
    expect(byMessage.get('supportStrikeScheduled')).toMatchObject({ type: 'light_strike', owner: 0 });
    expect(byMessage.get('supportStrikeResolved')).toMatchObject({ success: true, hits: 2 });
    expect(byMessage.get('actionProcessed')).toMatchObject({
      playerId: 0,
      action: 'move',
      unitId: 'unit-1',
      success: true,
      pathLength: 2
    });
    expect(byMessage.get('damageApplied')).toMatchObject({
      targetId: 'unit-2',
      location: 'centerTorso',
      damage: 5
    });
    expect(byMessage.get('unitAttacked')).toMatchObject({ hit: true, roll: 7 });
    expect(byMessage.get('unitFell')).toEqual({ unitId: 'unit-2', fell: true });
  });

  it('keeps the export header in step with the game id, turn and phase', () => {
    const harness = createGameHarness();
    expect(harness.logger.getContext()).toEqual({
      gameId: 'game-42',
      turn: 1,
      phase: 'initiative'
    });

    harness.state.turn = 2;
    harness.state.phase = 'movement';
    harness.bus.emit('phaseChanged', { phase: 'movement', turn: 2 });
    expect(harness.logger.getContext()).toEqual({
      gameId: 'game-42',
      turn: 2,
      phase: 'movement'
    });

    const text = harness.logger.toText();
    expect(text).toContain('game: game-42');
    expect(text).toContain('turn: 2');
    expect(text).toContain('phase: movement');
  });

  it('mirrors ui.log dice-log lines into the ring buffer and still writes them', () => {
    const harness = createGameHarness();
    harness.ui.log('Move pending to 3,2 (2 MP). Click Confirm Move.');
    harness.ui.log('Cannot reach that hex', 'miss');

    expect(harness.diceLog).toEqual([
      { message: 'Move pending to 3,2 (2 MP). Click Confirm Move.', className: 'info' },
      { message: 'Cannot reach that hex', className: 'miss' }
    ]);

    const uiEntries = harness.logger.entries.filter(entry => entry.category === 'ui');
    expect(uiEntries).toHaveLength(2);
    expect(uiEntries[0].message).toContain('Move pending');
    expect(uiEntries[0].data).toEqual({ className: 'info' });
    expect(uiEntries[1].data).toEqual({ className: 'miss' });
  });

  it('captures uncaught errors and unhandled rejections while a game is running', () => {
    const harness = createGameHarness();
    const listeners = new Map(harness.windowRef.addEventListener.mock.calls);
    expect([...listeners.keys()].sort()).toEqual(['error', 'unhandledrejection']);

    const error = new Error('boom');
    listeners.get('error')({
      message: 'boom',
      error,
      filename: 'main.js',
      lineno: 10,
      colno: 2
    });
    listeners.get('unhandledrejection')({ reason: new Error('nope') });

    const windowEntries = harness.logger.entries.filter(entry => entry.category === 'window');
    expect(windowEntries).toHaveLength(2);
    expect(windowEntries[0]).toMatchObject({
      level: 'error',
      message: 'uncaught error',
      data: { message: 'boom', filename: 'main.js', lineno: 10, colno: 2 }
    });
    expect(windowEntries[0].data.stack).toContain('boom');
    expect(windowEntries[1]).toMatchObject({
      level: 'error',
      message: 'unhandled promise rejection',
      data: { message: 'nope' }
    });
  });

  it('dispose() removes engine subscriptions, window handlers and the ui.log wrapper', () => {
    const harness = createGameHarness();
    harness.bus.emit('phaseChanged', { phase: 'movement', turn: 2 });
    const listeners = new Map(harness.windowRef.addEventListener.mock.calls);
    const errorHandler = listeners.get('error');
    const rejectionHandler = listeners.get('unhandledrejection');
    const sizeBeforeDispose = harness.logger.size;

    harness.wiring.dispose();

    // Engine subscriptions are really gone (not merely ignored by a flag).
    expect(listenerCount(harness.bus)).toBe(0);
    harness.bus.emit('phaseChanged', { phase: 'heat', turn: 2 });
    harness.bus.emit('actionProcessed', EVENT_PAYLOADS.actionProcessed);
    expect(harness.logger.size).toBe(sizeBeforeDispose);

    // A stale global-error reference cannot record either.
    errorHandler({ message: 'late boom' });
    rejectionHandler({ reason: new Error('late nope') });
    expect(harness.logger.size).toBe(sizeBeforeDispose);

    // The listeners and the UI patch were removed with the exact references.
    expect(harness.windowRef.removeEventListener)
      .toHaveBeenCalledWith('error', errorHandler);
    expect(harness.windowRef.removeEventListener)
      .toHaveBeenCalledWith('unhandledrejection', rejectionHandler);
    expect(harness.ui.log).toBe(harness.originalUiLog);
    expect(harness.logger.sinkCount).toBe(0);
  });

  it('dispose() is idempotent and a second game does not duplicate listeners', () => {
    const logger = createLogger();
    const first = createGameHarness({ logger });
    first.bus.emit('phaseChanged', { phase: 'movement', turn: 2 });
    first.wiring.dispose();
    first.wiring.dispose();

    // A second game: same logger, new engine. One event must produce one entry.
    const second = createGameHarness({ logger });
    logger.clear();
    second.bus.emit('phaseChanged', { phase: 'initiative', turn: 3 });

    const phaseEntries = logger.entries.filter(entry => entry.message === 'phaseChanged');
    expect(phaseEntries).toHaveLength(1);
    expect(listenerCount(second.bus)).toBe(GAME_EVENTS.length);
    second.wiring.dispose();
  });

  it('requires a logger and an engine with an event bus', () => {
    expect(() => attachGameLogging({ engine: { eventBus: new EventBus() } })).toThrow(TypeError);
    expect(() => attachGameLogging({ logger: createLogger(), engine: {} })).toThrow(TypeError);
  });

  it('summarizeEvent falls back to a bounded plain dump for unknown events', () => {
    const data = summarizeEvent('somethingNew', { hexKey: '1,1', count: 2 });
    expect(data).toEqual({ hexKey: '1,1', count: 2 });
  });
});

// ---- Dev-server log streaming (client side) ----

function createStreamFetch({ statusOk = true, postOk = true } = {}) {
  return vi.fn(async (url) => {
    if (String(url).endsWith('/status')) {
      return statusOk
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: false, status: 404, json: async () => ({ ok: false }) };
    }
    if (!postOk) return { ok: false, status: 500 };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
}

const statusCalls = (fetchMock) => fetchMock.mock.calls
  .filter(([url]) => String(url).endsWith('/status'));
const postCalls = (fetchMock) => fetchMock.mock.calls
  .filter(([, options]) => options && options.method === 'POST');

describe('dev-server log streaming', () => {
  it('normalises the endpoint and defaults to /api/log', () => {
    expect(DEFAULT_LOG_ENDPOINT).toBe('/api/log');
    expect(normalizeLogEndpoint()).toBe('/api/log');
    expect(normalizeLogEndpoint('')).toBe('/api/log');
    expect(normalizeLogEndpoint('http://host:1/api/log/')).toBe('http://host:1/api/log');
  });

  it('backfills entries recorded before the probe answered', async () => {
    vi.useFakeTimers();
    try {
      const logger = createLogger();
      logger.info('game', 'created before attach');

      const fetchMock = createStreamFetch();
      const harness = createGameHarness({
        logger,
        attach: {
          fetchRef: fetchMock,
          logEndpoint: 'http://logs.test/api/log',
          flushBatchSize: 50,
          probeTimeoutMs: 100
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(postCalls(fetchMock)).toHaveLength(1);
      const body = JSON.parse(postCalls(fetchMock)[0][1].body);
      const lines = body.lines.join('\n');
      expect(lines).toContain('created before attach');
      expect(lines).toContain('debug log streaming to http://logs.test/api/log');
      harness.wiring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a probe that never answers times out without blocking the game', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(() => new Promise(() => {}));
      const harness = createGameHarness({
        attach: {
          fetchRef: fetchMock,
          logEndpoint: 'http://logs.test/api/log',
          probeTimeoutMs: 100
        }
      });

      // attachGameLogging returned synchronously; gameplay is not waiting.
      harness.logger.info('game', 'still playable');
      expect(harness.logger.entries.some(entry => entry.message === 'still playable')).toBe(true);
      await vi.advanceTimersByTimeAsync(100);

      const streamEntries = harness.logger.entries.filter(entry => entry.category === 'stream');
      expect(streamEntries).toHaveLength(1);
      expect(streamEntries[0].message).toContain('probe timed out');
      expect(harness.logger.sinkCount).toBe(0);
      harness.wiring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('probe success flushes lines in batches and on the throttle', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = createStreamFetch();
      const harness = createGameHarness({
        attach: {
          fetchRef: fetchMock,
          logEndpoint: 'http://logs.test/api/log/',
          flushBatchSize: 2,
          flushIntervalMs: 1000,
          probeTimeoutMs: 100
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(statusCalls(fetchMock)).toHaveLength(1);
      expect(statusCalls(fetchMock)[0][0]).toBe('http://logs.test/api/log/status');

      // The "streaming to ..." info line is buffered before the first flush.
      expect(postCalls(fetchMock)).toHaveLength(1);
      let body = JSON.parse(postCalls(fetchMock)[0][1].body);
      expect(body.gameId).toBe('game-42');
      // One file per session: the engine game id repeats on every page load.
      expect(body.sessionId.startsWith('game-42-')).toBe(true);
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toContain('debug log streaming to http://logs.test/api/log');

      // Two more entries reach the batch threshold: flushed immediately.
      harness.logger.info('game', 'one');
      harness.logger.info('game', 'two');
      await vi.advanceTimersByTimeAsync(0);
      expect(postCalls(fetchMock)).toHaveLength(2);
      body = JSON.parse(postCalls(fetchMock)[1][1].body);
      expect(body.lines).toHaveLength(2);
      expect(body.lines.join('\n')).toContain('one');
      expect(body.lines.join('\n')).toContain('two');

      // A lone entry waits for the 1 s throttle.
      harness.logger.info('game', 'three');
      expect(postCalls(fetchMock)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(postCalls(fetchMock)).toHaveLength(3);
      body = JSON.parse(postCalls(fetchMock)[2][1].body);
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toContain('three');

      harness.wiring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose flushes the remaining lines via navigator.sendBeacon', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = createStreamFetch();
      const sendBeacon = vi.fn(() => true);
      const windowRef = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        navigator: { sendBeacon }
      };
      const harness = createGameHarness({
        attach: {
          fetchRef: fetchMock,
          windowRef,
          logEndpoint: 'http://logs.test/api/log',
          flushBatchSize: 50,
          flushIntervalMs: 5000,
          probeTimeoutMs: 100
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      const postsBefore = postCalls(fetchMock).length;
      expect(postsBefore).toBe(1);

      harness.logger.info('game', 'pending at teardown');
      harness.wiring.dispose();

      expect(sendBeacon).toHaveBeenCalledTimes(1);
      expect(sendBeacon.mock.calls[0][0]).toBe('http://logs.test/api/log');
      const payload = JSON.parse(await sendBeacon.mock.calls[0][1].text());
      expect(payload.gameId).toBe('game-42');
      expect(payload.sessionId.startsWith('game-42-')).toBe(true);
      expect(payload.lines).toHaveLength(1);
      expect(payload.lines[0]).toContain('pending at teardown');
      // The beacon replaced the fetch flush for those lines.
      expect(postCalls(fetchMock)).toHaveLength(postsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probe failure disables the stream and keeps the in-memory log', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => { throw new Error('connection refused'); });
      const harness = createGameHarness({
        attach: {
          fetchRef: fetchMock,
          logEndpoint: 'http://logs.test/api/log',
          probeTimeoutMs: 50
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('http://logs.test/api/log/status');

      const streamEntries = harness.logger.entries.filter(entry => entry.category === 'stream');
      expect(streamEntries).toHaveLength(1);
      expect(streamEntries[0].level).toBe('info');
      expect(streamEntries[0].message).toContain('log streaming unavailable');
      expect(harness.logger.sinkCount).toBe(0);

      // Recording continues; sending does not (and never retries).
      harness.logger.info('game', 'still in memory');
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(harness.logger.entries.some(entry => entry.message === 'still in memory')).toBe(true);
      harness.wiring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed flush records one warning and stops streaming', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = createStreamFetch({ postOk: false });
      const harness = createGameHarness({
        attach: {
          fetchRef: fetchMock,
          logEndpoint: 'http://logs.test/api/log',
          flushBatchSize: 2,
          flushIntervalMs: 1000
        }
      });

      await vi.advanceTimersByTimeAsync(0);

      // The initial "streaming to ..." flush failed and disabled the sink.
      const warnings = harness.logger.entries.filter(entry => entry.level === 'warn');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].category).toBe('stream');
      expect(warnings[0].message).toBe('log streaming disabled');
      expect(warnings[0].data.reason).toContain('500');
      expect(harness.logger.sinkCount).toBe(0);

      harness.logger.info('game', 'after failure');
      await vi.advanceTimersByTimeAsync(5000);
      expect(postCalls(fetchMock)).toHaveLength(1);
      harness.wiring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the endpoint override from window.BT_LOG_ENDPOINT', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = createStreamFetch();
      const windowRef = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        BT_LOG_ENDPOINT: 'http://other.host:9000/custom/log/',
        navigator: { sendBeacon: vi.fn(() => true) }
      };
      const harness = createGameHarness({ attach: { fetchRef: fetchMock, windowRef } });

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock.mock.calls[0][0]).toBe('http://other.host:9000/custom/log/status');
      harness.wiring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- Dev-server log writer (tools/dev-server.cjs) ----

describe('dev-server appendLog', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-log-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates logs/ and appends every line with a newline', () => {
    const result = appendLog('game-1', ['first line', 'second line'], tmpRoot);
    expect(result.ok).toBe(true);
    expect(result.file).toBe(path.join(tmpRoot, LOG_DIR_NAME, 'game-1.txt'));
    expect(result.appended).toBe(2);
    expect(fs.readFileSync(result.file, 'utf8')).toBe('first line\nsecond line\n');

    const again = appendLog('game-1', ['third'], tmpRoot);
    expect(again.ok).toBe(true);
    expect(fs.readFileSync(result.file, 'utf8')).toBe('first line\nsecond line\nthird\n');
  });

  it('sanitises the game id and refuses path traversal', () => {
    expect(sanitizeGameId('game 1:debug')).toBe('game_1_debug');
    expect(sanitizeGameId('../escape')).toBeNull();
    expect(sanitizeGameId('..\\escape')).toBeNull();
    expect(sanitizeGameId('/abs/path')).toBeNull();
    expect(sanitizeGameId('')).toBeNull();
    expect(sanitizeGameId(null)).toBeNull();

    const traversal = appendLog('../escape', ['pwned'], tmpRoot);
    expect(traversal).toMatchObject({ ok: false, status: 400 });
    expect(fs.existsSync(path.join(tmpRoot, LOG_DIR_NAME))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, '..', 'escape.txt'))).toBe(false);

    const sanitised = appendLog('game 1:debug', ['ok'], tmpRoot);
    expect(sanitised.ok).toBe(true);
    expect(path.basename(sanitised.file)).toBe('game_1_debug.txt');
    expect(fs.readFileSync(sanitised.file, 'utf8')).toBe('ok\n');
  });

  it('keeps one physical line per entry by folding embedded newlines', () => {
    const result = appendLog('session-1', ['first\nsecond', 'third\r\nfourth'], tmpRoot);
    expect(result.ok).toBe(true);

    const contents = fs.readFileSync(result.file, 'utf8');
    expect(contents).toBe('first | second\nthird | fourth\n');
    expect(contents.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('refuses a write that would pass the per-file size cap with 413', () => {
    expect(MAX_LOG_BYTES).toBe(20 * 1024 * 1024);

    const file = appendLog('cap', ['1234'], tmpRoot, { maxBytes: 8 });
    expect(file.ok).toBe(true);
    expect(file.bytes).toBe(5);

    const over = appendLog('cap', ['1234'], tmpRoot, { maxBytes: 8 });
    expect(over).toMatchObject({ ok: false, status: 413, limit: 8 });

    // The refused batch did not touch the file.
    expect(fs.readFileSync(file.file, 'utf8')).toBe('1234\n');
  });

  it('validates the payload', () => {
    expect(appendLog(null, ['x'], tmpRoot)).toMatchObject({ ok: false, status: 400 });
    expect(appendLog('game-1', 'nope', tmpRoot)).toMatchObject({ ok: false, status: 400 });
    expect(appendLog('game-1', [42], tmpRoot)).toMatchObject({ ok: false, status: 400 });
    expect(fs.existsSync(path.join(tmpRoot, LOG_DIR_NAME))).toBe(false);
  });

  it('serves the log API and the static files over HTTP', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'index.html'), '<h1>dev server</h1>');

    const server = createServer(tmpRoot);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      const status = await fetch(`${base}/api/log/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ ok: true });

      const post = await fetch(`${base}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: 'game http:1', lines: ['one', 'two'] })
      });
      expect(post.status).toBe(200);
      expect(await post.json()).toMatchObject({ ok: true, appended: 2 });
      expect(fs.readFileSync(path.join(tmpRoot, LOG_DIR_NAME, 'game_http_1.txt'), 'utf8'))
        .toBe('one\ntwo\n');

      const traversal = await fetch(`${base}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: '../escape', lines: ['pwned'] })
      });
      expect(traversal.status).toBe(400);

      const badJson = await fetch(`${base}/api/log`, { method: 'POST', body: 'not json' });
      expect(badJson.status).toBe(400);

      const wrongMethod = await fetch(`${base}/api/log`);
      expect(wrongMethod.status).toBe(405);

      // Per-file cap surfaces as 413 through the handler, not just appendLog().
      fs.writeFileSync(path.join(tmpRoot, LOG_DIR_NAME, 'big.txt'), Buffer.alloc(MAX_LOG_BYTES));
      const capped = await fetch(`${base}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: 'big', lines: ['one more'] })
      });
      expect(capped.status).toBe(413);

      // The static server still serves the app and refuses path traversal.
      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('dev server');
      const escape = await fetch(`${base}/..%2f..%2fpackage.json`);
      expect(escape.status).toBe(404);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
