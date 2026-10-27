#!/usr/bin/env node
// Toronto 2026 live vote tracker server.
// Fetches the City of Toronto unofficial results feeds server-side (CORS is blocked in the
// browser), with conditional requests. The City republishes about every 60 s. Once a file is
// fresh, the next fetch is 1 s after the following publication. Until the file changes, or a
// publication is missed, the server checks every 20 s. Keeps a disk-backed history of
// snapshots for the time-series charts and serves the static frontend.
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildDemoState } = require('./lib/demo');
const { normalize } = require('./lib/normalize');

const PORT = Number(process.env.PORT || 8026);
const HOST = process.env.HOST || '127.0.0.1'; // loopback only: the public reaches it through the tunnel
// City spec: unofficialresult.json is republished about every 60 seconds. seq is that publication time.
const PERIOD_MS = 60_000;
const LAG_MS = 1_000;       // ask 1 second after the publication we are waiting for
const CATCHUP_MS = 20_000;  // stale file, or a publication that did not arrive: look again in 20 s
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEAFLET_DIR = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
// Browser builds of Motion (spring animation, the engine Fluid Functionalism uses) and D3 (scales, line shapes)
const VENDOR = { motion: path.join(__dirname, 'node_modules', 'motion', 'dist'), d3: path.join(__dirname, 'node_modules', 'd3', 'dist') };

const FEEDS = {
  all: 'https://mediaresults.toronto.ca/results/unofficialresult.json',
  ward: 'https://mediaresults.toronto.ca/results/unofficialresult-wardbyward.json',
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');

// ---------- feed cache ----------
const cache = {
  all: null, ward: null,            // parsed JSON
  meta: { all: {}, ward: {} },       // etag, lastModified, seq, fetchedAt, status
  lastCheckAt: null,                 // last time we asked the City (ms)
  lastChangeAt: null,                // last time content changed (ms)
  error: null,                       // { at, message }
  state: null,                       // normalized live state (without history)
};
let history = [];
const HISTORY_MAX = 2000; // ~33 h of once-a-minute changes; older snapshots are dropped from memory and disk
const FEED_MAX_BYTES = 20 * 1024 * 1024; // the City's ward-by-ward feed is ~1 MB; refuse anything absurd

function log(...a) { console.log(new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', hour12: false }), 'ET |', ...a); }

function loadPersisted() {
  try {
    const saved = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
    cache.all = saved.all; cache.ward = saved.ward; cache.meta = saved.meta || cache.meta;
    cache.lastCheckAt = saved.lastCheckAt || null; cache.lastChangeAt = saved.lastChangeAt || null;
    log('loaded cached feed from disk, seq', cache.all && cache.all.seq);
  } catch { /* first run */ }
  try {
    history = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    if (history.length > HISTORY_MAX) { history = history.slice(-HISTORY_MAX); rewriteHistory(); }
    log('loaded', history.length, 'history snapshots');
  } catch { history = []; }
  rebuild();
}

function rewriteHistory() {
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, history.map((h) => JSON.stringify(h)).join('\n') + (history.length ? '\n' : ''));
  fs.renameSync(tmp, HISTORY_FILE);
}

function persistLatest() {
  const tmp = LATEST_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ all: cache.all, ward: cache.ward, meta: cache.meta, lastCheckAt: cache.lastCheckAt, lastChangeAt: cache.lastChangeAt }));
  fs.renameSync(tmp, LATEST_FILE);
}

async function readCapped(res, max, key) {
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > max) throw new Error(`${key} feed too large`); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchFeed(key) {
  const m = cache.meta[key] || {};
  const headers = { 'User-Agent': 'toronto-vote-tracker/1.0 (personal; 1/min once the file is publishing, 20s until it changes)', Accept: 'application/json' };
  if (m.etag && cache[key]) headers['If-None-Match'] = m.etag;
  if (m.lastModified && cache[key]) headers['If-Modified-Since'] = m.lastModified;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(FEEDS[key], { headers, signal: ctrl.signal });
    if (res.status === 304) return { changed: false, status: 304 };
    if (!res.ok) throw new Error(`${key} feed HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') || 0) > FEED_MAX_BYTES) throw new Error(`${key} feed too large`);
    const text = await readCapped(res, FEED_MAX_BYTES, key);
    const json = JSON.parse(text);
    const changed = !cache[key] || String(json.seq) !== String(cache[key].seq);
    cache[key] = json;
    cache.meta[key] = { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), seq: String(json.seq), fetchedAt: Date.now(), status: res.status };
    return { changed, status: res.status };
  } finally { clearTimeout(timer); }
}

let polling = false;
let nextCheckAt = null;
let pollTimer = null;
// Fresh file: next publication is one period after seq, and we read it a second later.
// Stale file (the pre-election copy, or a minute that never arrived): check every 20 s
// so the first new seq is caught quickly, then lock onto that timestamp.
function scheduleDelay(now) {
  if (cache.error) return CATCHUP_MS;
  const published = publishedAt();
  if (!published) return CATCHUP_MS;
  const age = now - published;
  if (age >= PERIOD_MS) return CATCHUP_MS;
  // age < 60s, so publishedAt + 60s + 1s is still ahead (at least 1s). Never skip that publication.
  return Math.max(1500, published + PERIOD_MS + LAG_MS - now);
}
async function poll() {
  if (polling) return; // never two City fetches at once
  polling = true;
  try {
    const [a, w] = [await fetchFeed('all'), await fetchFeed('ward')];
    cache.lastCheckAt = Date.now();
    cache.error = null;
    if (a.changed || w.changed) {
      cache.lastChangeAt = Date.now();
      rebuild();
      recordSnapshot();
      log(`feed changed (all ${a.status}, ward ${w.status}) seq ${cache.all.seq}; mayor polls ${cache.state.mayor.pollsReceived}/${cache.state.mayor.polls}`);
    } else {
      rebuild();
    }
    persistLatest();
  } catch (e) {
    // Only a short, path-free message reaches visitors (the API and /healthz show it).
    const raw = String(e && e.message || e);
    const message = e && e.name === 'AbortError' ? 'City feed timed out' : /^(all|ward) feed /.test(raw) ? raw.slice(0, 80) : e instanceof SyntaxError ? 'City feed was not valid JSON' : 'City feed unreachable';
    cache.error = { at: Date.now(), message };
    log('poll error:', raw);
  } finally { polling = false; }
}

function rebuild() {
  if (!cache.all) { cache.state = null; return; }
  cache.state = normalize(cache.all, cache.ward, { publishedAt: publishedAt() });
}

function publishedAt() {
  // seq is documented as derived from the generation timestamp (epoch ms in practice).
  const seq = Number(cache.all && cache.all.seq);
  if (seq > 1.6e12 && seq < 2.2e12) return seq;
  const lm = cache.meta.all && cache.meta.all.lastModified;
  return lm ? Date.parse(lm) : null;
}

function recordSnapshot() {
  const s = cache.state; if (!s) return;
  const snap = {
    t: s.publishedAt || Date.now(),
    fetchedAt: Date.now(),
    seq: String(cache.all.seq),
    pollsReceived: s.mayor.pollsReceived, polls: s.mayor.polls, votes: s.mayor.votesReceived,
    c: Object.fromEntries(s.mayor.candidates.filter((c) => c.votes > 0).map((c) => [c.name, c.votes])),
  };
  const last = history[history.length - 1];
  if (last && last.votes === snap.votes && last.pollsReceived === snap.pollsReceived && JSON.stringify(last.c) === JSON.stringify(snap.c)) return; // same numbers, new seq
  history.push(snap);
  if (history.length > HISTORY_MAX) { history = history.slice(-Math.floor(HISTORY_MAX * 0.9)); rewriteHistory(); }
  else fs.appendFileSync(HISTORY_FILE, JSON.stringify(snap) + '\n');
}

function liveState() {
  return {
    mode: 'live',
    sample: false,
    now: Date.now(),
    lastCheckAt: cache.lastCheckAt,
    lastChangeAt: cache.lastChangeAt,
    nextCheckAt,
    pollMs: nextCheckAt ? Math.max(0, nextCheckAt - Date.now()) : CATCHUP_MS,
    error: cache.error,
    source: FEEDS,
    ...(cache.state || { mayor: null, wards: [], publishedAt: null }),
    history: history.filter((h) => h.votes > 0),
  };
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.geojson': 'application/geo+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // No inline scripts or eval anywhere; styles only from /styles.css and leaflet.css (JS sets element.style via CSSOM, which CSP allows).
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://server.arcgisonline.com; connect-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

// ---------- optional private-link gate (ACCESS_KEY env) ----------
// With ACCESS_KEY set, every route except /healthz needs ?key=<key> once (which sets a cookie and
// redirects the key out of the URL) or that cookie. Anything else gets the same plain 404 as a
// missing file, so the page gives no hint it exists.
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const GATE = ACCESS_KEY.length >= 24;
if (ACCESS_KEY && !GATE) { console.error('ACCESS_KEY too short (need >= 24 chars); refusing to start'); process.exit(1); }
const COOKIE = 'tk';
const TOKEN = GATE ? crypto.createHmac('sha256', ACCESS_KEY).update('tracker-access-v1').digest('base64url') : '';
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hasCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE && safeEq(part.slice(i + 1).trim(), TOKEN)) return true;
  }
  return false;
}
// Shared caches (the tunnel, proxies) must never hand gated content to someone without the cookie.
const cc = (v) => (GATE ? v.replace(/^public\b/, 'private') : v);
const gzCache = new Map(); // etag -> gzipped body, for repeated API responses
function send(req, res, status, body, type, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 1024;
  let out = buf;
  if (gz) {
    const key = extra.ETag;
    out = (key && gzCache.get(key)) || zlib.gzipSync(buf);
    if (key) { gzCache.set(key, out); if (gzCache.size > 64) gzCache.delete(gzCache.keys().next().value); }
  }
  if (extra['Cache-Control']) extra = { ...extra, 'Cache-Control': cc(extra['Cache-Control']) };
  res.writeHead(status, { ...SECURITY, 'Content-Type': type, 'Content-Length': out.length, ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}), ...extra });
  res.end(req.method === 'HEAD' ? undefined : out);
}

// Only these files are ever served. Everything else (data/, fixtures/, server code, node_modules,
// directories, dotfiles, traversal attempts) is a 404. No directory listing exists.
const ALLOW = new Map();
function allowDir(prefix, dir, filter = () => true) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    // lstat: a symlink (e.g. public/x.js -> ../.access_key) is never followed or served
    if (f.startsWith('.') || !fs.lstatSync(full).isFile() || !filter(f)) continue;
    ALLOW.set(prefix + f, full);
  }
}
allowDir('/', PUBLIC_DIR, (f) => TYPES[path.extname(f)]);
ALLOW.set('/vendor/motion/motion.js', path.join(VENDOR.motion, 'motion.js'));
ALLOW.set('/vendor/d3/d3.min.js', path.join(VENDOR.d3, 'd3.min.js'));
ALLOW.set('/vendor/leaflet/leaflet.js', path.join(LEAFLET_DIR, 'leaflet.js'));
ALLOW.set('/vendor/leaflet/leaflet.css', path.join(LEAFLET_DIR, 'leaflet.css'));
allowDir('/vendor/leaflet/images/', path.join(LEAFLET_DIR, 'images'), (f) => f.endsWith('.png'));
// Sonner toasts: prebuilt, self-hosted bundle (see tools/toaster/)
allowDir('/vendor/sonner/', path.join(PUBLIC_DIR, 'vendor', 'sonner'), (f) => f === 'toaster.js' || f === 'sonner.css');

const fileCache = new Map(); // url -> { buf, gz, etag, mtime }
function serveFile(req, res, urlPath) {
  const p = ALLOW.get(urlPath);
  if (!p) return send(req, res, 404, 'Not found', 'text/plain', { 'Cache-Control': 'no-store' });
  fs.lstat(p, (err, st) => {
    if (err || !st.isFile()) return notFound(req, res);
    let c = fileCache.get(urlPath);
    if (!c || c.mtime !== st.mtimeMs) {
      let buf;
      try { buf = fs.readFileSync(p); } catch { return notFound(req, res); }
      c = { buf, mtime: st.mtimeMs, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"' };
      fileCache.set(urlPath, c);
    }
    const vendor = urlPath.startsWith('/vendor/') || urlPath === '/wards.geojson';
    const headers = { ETag: c.etag, 'Cache-Control': vendor ? 'public, max-age=3600' : 'public, max-age=0, must-revalidate' };
    if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, { ...SECURITY, ...headers, 'Cache-Control': cc(headers['Cache-Control']) }); return res.end(); }
    send(req, res, 200, c.buf, TYPES[path.extname(p)] || 'application/octet-stream', headers);
  });
}

// Demo needs only the ballot structure; the bundled zeroed fixtures stand in if the City feed hasn't loaded.
const FIXTURES = {
  all: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'unofficialresult.json'), 'utf8')),
  ward: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'unofficialresult-wardbyward.json'), 'utf8')),
};

// Live API body is rebuilt only when the cache changes (after a City poll), so any number of viewers
// costs one JSON.stringify per minute and never triggers a City fetch. Viewers only read the cache.
let liveMemo = { key: null, body: null, etag: null };
function liveBody() {
  const key = `${cache.lastCheckAt}|${cache.lastChangeAt}|${cache.error && cache.error.at}|${history.length}`;
  if (liveMemo.key !== key) {
    const { now, ...st } = liveState();
    const body = JSON.stringify(st);
    liveMemo = { key, body, etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"' };
  }
  return liveMemo;
}
// The sample data is rebuilt at most once a second per variant (p is rounded to 0.01, so at most
// ~100 variants), so the demo can't be used to burn CPU: viewers share one body per second.
const demoMemo = new Map();
function demoBody(p, live) {
  const key = `${p}|${live}|${Math.floor(Date.now() / 1000)}|${cache.all && cache.all.seq}`;
  let m = demoMemo.get(key);
  if (!m) {
    const { now, ...st } = buildDemoState(cache.all || FIXTURES.all, cache.ward || FIXTURES.ward, { progress: p, live });
    const body = JSON.stringify(st);
    m = { body, etag: '"d' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"' };
    demoMemo.set(key, m);
    if (demoMemo.size > 128) demoMemo.delete(demoMemo.keys().next().value);
  }
  return m;
}
function sendJSON(req, res, body, etag, cacheControl) {
  const headers = { 'Cache-Control': cacheControl, ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...SECURITY, ...headers, 'Cache-Control': cc(cacheControl) }); return res.end(); }
  send(req, res, 200, body, 'application/json; charset=utf-8', headers);
}

const notFound = (req, res) => send(req, res, 404, 'Not found', 'text/plain', { 'Cache-Control': 'no-store' });
function handle(req, res) {
  const getish = req.method === 'GET' || req.method === 'HEAD';
  // Gated: an unauthenticated request of any kind gets the plain 404 (no 405/414 that would hint a server is here).
  if (GATE && !(getish && req.url.length <= 2048) && !hasCookie(req)) return notFound(req, res);
  if (!getish) return send(req, res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });
  if (req.url.length > 2048) return send(req, res, 414, 'URI too long', 'text/plain');
  // GET/HEAD never carry a body here; refuse one instead of reading it
  if (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) { res.setHeader('Connection', 'close'); return send(req, res, 413, 'Body not allowed', 'text/plain'); }
  if (req.url.charCodeAt(0) !== 47) return notFound(req, res); // origin-form only ("/..."), no absolute or "*" targets
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    if (GATE) return send(req, res, 200, 'ok', 'text/plain', { 'Cache-Control': 'no-store' });
    return send(req, res, 200, JSON.stringify({ ok: true, lastCheckAt: cache.lastCheckAt, error: cache.error ? cache.error.message : null }), 'application/json', { 'Cache-Control': 'no-store' });
  }
  if (GATE) {
    if (url.searchParams.has('key')) {
      if (!safeEq(url.searchParams.get('key'), ACCESS_KEY)) return notFound(req, res);
      url.searchParams.delete('key');
      const qs = url.searchParams.toString();
      res.writeHead(303, { ...SECURITY, Location: '/' + url.pathname.replace(/^\/+/, '') + (qs ? '?' + qs : ''), 'Cache-Control': 'no-store', 'Content-Length': 0,
        'Set-Cookie': `${COOKIE}=${TOKEN}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax` });
      return res.end();
    }
    if (!hasCookie(req)) return notFound(req, res);
  }
  if (url.pathname === '/api/state') {
    if (url.searchParams.get('demo') === '1') {
      const raw = url.searchParams.has('p') ? Number(url.searchParams.get('p')) : null;
      const p = raw == null ? null : Number.isFinite(raw) ? Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100 : 0.5;
      const live = p == null && url.searchParams.get('live') === '1';
      const { body, etag } = demoBody(p, live);
      // simulated-live steps every 4 s; the cycling demo every 15 s
      return sendJSON(req, res, body, etag, live ? 'public, max-age=2' : 'public, max-age=10');
    }
    const m = liveBody();
    // Short shared cache. The page asks again just after nextCheckAt, so a long cache would hide a new file.
    return sendJSON(req, res, m.body, m.etag, 'public, max-age=2');
  }
  serveFile(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
}

// Limits: 8 KB of headers, 10 s to send them (slowloris), 15 s per request, 5 s idle keep-alive,
// at most 1,000 open sockets. Nothing here reads a request body.
const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000, connectionsCheckingInterval: 2000 }, (req, res) => {
  try { handle(req, res); } catch (e) {
    log('request error:', e && e.message);
    if (!res.headersSent) send(req, res, 500, 'Server error', 'text/plain', { 'Cache-Control': 'no-store' });
  }
});
server.maxConnections = 1000;
server.timeout = 30000; // idle socket timeout
server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); else socket.destroy(); });
server.on('connect', (req, socket) => socket.destroy()); // no CONNECT proxying
// IP logic: none. X-Forwarded-For / CF-Connecting-IP are never read, so a visitor can't spoof anything with them.
process.on('uncaughtException', (e) => log('uncaught:', e && e.stack || e)); // to the local log only, never to a visitor

function armPoll(delay) {
  clearTimeout(pollTimer);
  nextCheckAt = Date.now() + delay;
  pollTimer = setTimeout(async () => {
    await poll();
    const wait = scheduleDelay(Date.now());
    log(`next City check in ${Math.round(wait / 1000)}s`);
    armPoll(wait);
  }, delay);
}

loadPersisted();
armPoll(0);
if (!/^(127\.|::1$|localhost$)/.test(HOST)) log(`warning: HOST=${HOST} exposes the server beyond this computer. Use HOST=127.0.0.1 with a tunnel.`);
server.listen(PORT, HOST, () => {
  log(`Toronto vote tracker on http://localhost:${PORT}  (demo: http://localhost:${PORT}/?demo=1)  City feed: 1s after each 60s publication, or every 20s until the file changes${GATE ? '; private-link gate ON' : ''}`);
});
