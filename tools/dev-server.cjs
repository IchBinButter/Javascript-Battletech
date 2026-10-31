'use strict';

/**
 * Development static server + debug-log sink.
 *
 * `node tools/dev-server.cjs` serves the workspace on http://127.0.0.1:8123
 * (the same job as the old untracked `_serve.cjs`) and adds one dev-only API:
 *
 *   GET  /api/log/status  -> { ok: true }
 *   POST /api/log         -> { gameId, sessionId?, lines: string[] } appends
 *                            each line to logs/<sessionId>.txt (the client sends
 *                            `<gameId>-<session timestamp>` so separate games do
 *                            not share a file), creating logs/ on first write
 *
 * The browser cannot write a file by itself; while the game is served by this
 * server the client streams its structured debug log here so a live bug leaves
 * a real `logs/*.txt` artefact. On any other host the endpoint is absent, the
 * client's probe fails and the in-memory log + Ctrl+Shift+L download remains
 * the fallback.
 *
 * Security/robustness notes:
 * - `gameId` is sanitised to [A-Za-z0-9._-]; path separators and `..` are
 *   rejected outright, and the resolved path is re-checked to stay in logs/.
 * - Each file is capped (default 20 MB) so a runaway client cannot fill the
 *   disk; requests past the cap are answered with 413.
 * - Request bodies are bounded as well (one client batch is ~50 short lines).
 * - `appendLog()` is exported and pure enough to unit test; importing this
 *   module never starts a listener (`require.main` guard).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 8123;
const LOG_DIR_NAME = 'logs';
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
});

/**
 * Turn a client-supplied game id into a safe file name stem.
 *
 * Allowed characters are [A-Za-z0-9._-]; anything else is replaced with `_`
 * (a game id such as `game 1:debug` becomes `game_1_debug`). Values containing
 * a path separator or `..` are refused instead of sanitised: they are attempts
 * to address a different directory, not a file name.
 *
 * @param {*} gameId
 * @returns {string|null} safe stem, or null when the id is unusable
 */
function sanitizeGameId(gameId) {
  if (typeof gameId !== 'string') return null;
  const raw = gameId.trim();
  if (raw === '') return null;
  if (raw.includes('..') || raw.includes('/') || raw.includes('\\')) return null;

  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_');
  if (safe === '' || safe === '.' || safe === '..') return null;
  return safe;
}

/**
 * Append `lines` to `logs/<id>.txt` under `rootDir` (`<id>` is the sanitised
 * session id, or the game id for older clients).
 *
 * The `logs/` directory is created on the first write. Every line gets one
 * trailing newline; the previous contents are kept. Newlines inside a line are
 * folded to ` | ` so each entry stays on one physical line. A write that would
 * grow the file past the cap is refused with status 413 and the file is
 * untouched.
 *
 * @param {string} gameId - client session/game id (sanitised before use)
 * @param {string[]} lines - log lines to append
 * @param {string} [rootDir] - project root that owns `logs/`
 * @param {{maxBytes?: number}} [options] - cap override (used by tests)
 * @returns {{ok: true, file: string, appended: number, bytes: number, limit: number}
 *         | {ok: false, status: number, error: string, file?: string, bytes?: number, limit?: number}}
 */
function appendLog(gameId, lines, rootDir = PROJECT_ROOT, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_LOG_BYTES;

  const safeId = sanitizeGameId(gameId);
  if (!safeId) {
    return { ok: false, status: 400, error: 'invalid gameId' };
  }
  if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string')) {
    return { ok: false, status: 400, error: 'lines must be an array of strings' };
  }

  // One physical line per entry: dice-log messages contain newlines.
  const cleanLines = lines.map(line => line.replace(/\r\n|\r|\n/g, ' | '));

  const logDir = path.resolve(rootDir, LOG_DIR_NAME);
  const file = path.join(logDir, `${safeId}.txt`);

  // Belt and braces: a sanitised id cannot escape logs/, but never write a
  // path we did not just prove is inside the log directory.
  if (path.dirname(file) !== logDir) {
    return { ok: false, status: 400, error: 'invalid gameId' };
  }

  let existingBytes = 0;
  try {
    existingBytes = fs.statSync(file).size;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const payload = cleanLines.length === 0 ? '' : `${cleanLines.join('\n')}\n`;
  const payloadBytes = Buffer.byteLength(payload, 'utf8');
  if (existingBytes + payloadBytes > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `log file would exceed the ${maxBytes}-byte cap`,
      file,
      bytes: existingBytes,
      limit: maxBytes
    };
  }

  if (payloadBytes > 0) {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(file, payload, 'utf8');
  }

  return { ok: true, file, appended: lines.length, bytes: existingBytes + payloadBytes, limit: maxBytes };
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/** Read a request body, discarding it once it grows past `limit`. */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ tooLarge, body: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', reject);
  });
}

/**
 * Handle the log API. Returns true when the request was an API request (the
 * caller then must not fall through to the static file server).
 */
async function handleLogApi(req, res, rootDir) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;

  if (pathname !== '/api/log' && pathname !== '/api/log/status') return false;

  if (pathname === '/api/log/status') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJSON(res, 405, { ok: false, error: 'method not allowed' });
      return true;
    }
    sendJSON(res, 200, { ok: true });
    return true;
  }

  if (req.method !== 'POST') {
    sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    return true;
  }

  try {
    const { tooLarge, body } = await readBody(req);
    if (tooLarge) {
      sendJSON(res, 413, { ok: false, error: 'request body too large' });
      return true;
    }

    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (_) {
      sendJSON(res, 400, { ok: false, error: 'invalid JSON body' });
      return true;
    }

    const result = appendLog(payload.sessionId ?? payload.gameId, payload.lines ?? [], rootDir);
    if (!result.ok) {
      sendJSON(res, result.status || 400, { ok: false, error: result.error, limit: result.limit });
      return true;
    }
    sendJSON(res, 200, {
      ok: true,
      file: path.relative(path.resolve(rootDir), result.file),
      appended: result.appended,
      bytes: result.bytes,
      limit: result.limit
    });
    return true;
  } catch (error) {
    sendJSON(res, 500, { ok: false, error: error.message });
    return true;
  }
}

function serveStatic(req, res, rootDir) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_) {
    res.writeHead(400);
    res.end('bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  if (pathname.includes('\0')) {
    res.writeHead(400);
    res.end('bad request');
    return;
  }

  const root = path.resolve(rootDir);
  const file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

/** Create the HTTP server without listening (used by tests and startServer). */
function createServer(rootDir = PROJECT_ROOT) {
  return http.createServer((req, res) => {
    handleLogApi(req, res, rootDir)
      .then((handled) => {
        if (!handled) serveStatic(req, res, rootDir);
      })
      .catch((error) => {
        sendJSON(res, 500, { ok: false, error: error.message });
      });
  });
}

/** Start the dev server. */
function startServer({ port = DEFAULT_PORT, host = '127.0.0.1', rootDir = PROJECT_ROOT } = {}) {
  const server = createServer(rootDir);
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`port ${port} is already in use - stop the other dev server first`);
    } else {
      console.error(`dev server failed: ${error && error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`serving ${path.resolve(rootDir)} on http://${host}:${port}`);
    console.log(`debug log: http://${host}:${port}/api/log -> ${LOG_DIR_NAME}/<gameId>.txt`);
  });
  return server;
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_PORT,
  LOG_DIR_NAME,
  MAX_LOG_BYTES,
  MAX_BODY_BYTES,
  appendLog,
  sanitizeGameId,
  createServer,
  startServer
};

if (require.main === module) {
  startServer();
}
