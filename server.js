#!/usr/bin/env node
/* ============================================================
   THREE CHORDS DOT DEV — the backline
   Zero dependencies. One file. Plug it in and play.

   node server.js            -> http://localhost:8080
   PORT=3000 DATA_DIR=/var/lib/3chords node server.js

   Env:
     PORT          port to listen on (default 8080)
     HOST          interface to bind (default 0.0.0.0)
     DATA_DIR      where db.json lives (default ./data)
     ADMIN_TOKEN   enables moderation endpoints (Authorization: Bearer <token>)
     TRUST_PROXY   set to 1 behind a reverse proxy so X-Forwarded-For is used
     HIDE_AFTER    reports needed to auto-hide a post (default 3)
     PUBLIC_ORIGIN e.g. https://3chords.dev — origin allowed to write
                   (default: whatever Host header the request carries)
   ============================================================ */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const HIDE_AFTER = Number(process.env.HIDE_AFTER) || 3;
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
const MAX_POSTS = Number(process.env.MAX_POSTS) || 3000;       // newest community posts kept
const MAX_SIGNATURES = Number(process.env.MAX_SIGNATURES) || 20000;

const FLAVORS = ['FIELD NOTE', 'HOT TAKE', 'CONFESSION', 'RIFF', 'TUTORIAL', 'COMPLAINT', 'FLYER', 'ZINE'];
const LIMITS = { title: 80, body: 600, by: 24, handle: 24, contact: 120 };
const MAX_BODY_BYTES = 8 * 1024;

/* ---------- storage ---------------------------------------- */

const SEED_POSTS = require('./data-seed.json');

let db = null;
let saveTimer = null;
let saving = Promise.resolve();

function freshDb() {
  const now = Date.now();
  return {
    version: 1,
    salt: crypto.randomBytes(16).toString('hex'),
    posts: SEED_POSTS.map((p, i) => ({
      id: 'house' + (i + 1),
      title: p.title,
      body: p.body,
      by: 'the house',
      flavor: p.flavor,
      house: true,
      createdAt: now - (i + 1) * 36e5 * 7,
      rocks: 0,
      rockers: [],
      reports: [],
      hidden: false,
      tokenHash: null,
    })),
    signatures: [],
  };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // never silently clobber a corrupt db — park it and start fresh
      const parked = DB_FILE + '.corrupt-' + Date.now();
      fs.renameSync(DB_FILE, parked);
      console.error(`db.json unreadable (${err.message}); moved to ${parked}`);
    }
    db = freshDb();
    writeDbSync();
  }
}

let tmpSeq = 0;
const tmpName = () => `${DB_FILE}.${process.pid}.${++tmpSeq}.tmp`;

function writeDbSync() {
  const tmp = tmpName();
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

// throttle, not debounce: a steady stream of writes must still reach disk
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saving = saving.then(async () => {
      const tmp = tmpName();
      await fsp.writeFile(tmp, JSON.stringify(db));
      await fsp.rename(tmp, DB_FILE);
    }).catch(err => console.error('save failed:', err));
  }, 150);
}

// final synchronous write; callers that can wait should `await saving` first
function flushSync() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (db) writeDbSync();
}
async function flush() {
  await saving;
  flushSync();
}

/* ---------- helpers ---------------------------------------- */

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ipHash = (ip) => sha(db.salt + '|' + ip).slice(0, 24);
const newId = () => crypto.randomBytes(6).toString('base64url');

// The rightmost X-Forwarded-For entry is the one OUR proxy appended; anything
// to its left was supplied by the client and can't be trusted.
function clientIp(req) {
  let ip = req.socket.remoteAddress || 'unknown';
  if (TRUST_PROXY) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) ip = hops[hops.length - 1];
  }
  ip = ip.replace(/^::ffff:/, '');
  // one IPv6 user usually controls a whole /64: treat it as one visitor
  if (ip.includes(':')) {
    const full = ip.split('%')[0];
    const [head, tail = ''] = full.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = full.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
    ip = groups.slice(0, 4).join(':') + '::/64';
  }
  return ip;
}

// collapse whitespace runs, strip control chars, trim, cap length
function clean(value, max, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.replace(/\r\n?/g, '\n');
  s = s.normalize('NFKC');
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g, '');
  s = multiline ? s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ') : s.replace(/\s+/g, ' ');
  s = s.trim();
  return [...s].slice(0, max).join('');
}

function publicPost(p, viewerHash) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    by: p.by,
    flavor: p.flavor,
    house: !!p.house,
    createdAt: p.createdAt,
    rocks: p.rocks,
    rocked: viewerHash ? p.rockers.includes(viewerHash) : false,
  };
}

/* ---------- rate limiting ---------------------------------- */

const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  if (buckets.size > 100_000) buckets.clear(); // memory guard under a flood
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref();

/* ---------- http plumbing ---------------------------------- */

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; " +
    "script-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

function send(res, status, body, headers = {}) {
  const isJson = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...headers,
  });
  res.end(payload);
}
const fail = (res, status, error) => send(res, status, { error });

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!type.includes('application/json')) return reject(Object.assign(new Error('expected application/json'), { status: 415 }));
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', c => {
      if (over) return; // keep draining so the 413 can actually be delivered
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error('too loud — body too large'), { status: 413, close: true }));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      let v;
      try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch { return reject(Object.assign(new Error('malformed JSON'), { status: 400 })); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(Object.assign(new Error('expected a JSON object'), { status: 400 }));
      resolve(v);
    });
    req.on('error', reject);
  });
}

// cross-site writes are refused: browsers always send Origin on POST/DELETE
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, server-to-server, tests
  if (PUBLIC_ORIGIN) return origin === PUBLIC_ORIGIN;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const ADMIN_HASH = ADMIN_TOKEN ? Buffer.from(sha('Bearer ' + ADMIN_TOKEN)) : null;
const isAdmin = (req) =>
  !!ADMIN_HASH && crypto.timingSafeEqual(Buffer.from(sha(String(req.headers.authorization || ''))), ADMIN_HASH);

/* ---------- api routes ------------------------------------- */

async function api(req, res, url) {
  const ip = clientIp(req);
  const viewer = ipHash(ip);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) return fail(res, 403, 'cross-origin write refused');

  // GET /api/health
  if (parts[1] === 'health' && method === 'GET') {
    return send(res, 200, { ok: true, version: process.env.APP_VERSION || 'dev', posts: db.posts.filter(p => !p.hidden).length, signatures: db.signatures.length });
  }

  // /api/posts
  if (parts[1] === 'posts' && parts.length === 2) {
    if (method === 'GET') {
      const flavor = url.searchParams.get('flavor');
      let posts = db.posts.filter(p => !p.hidden);
      if (flavor && FLAVORS.includes(flavor)) posts = posts.filter(p => p.flavor === flavor);
      posts = posts.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
      return send(res, 200, { posts: posts.map(p => publicPost(p, viewer)), flavors: FLAVORS });
    }
    if (method === 'POST') {
      const data = await readJson(req);
      if (data.website) return send(res, 201, { post: null }); // honeypot: pretend it worked
      if (limited('post:' + viewer, 5, 10 * 60_000)) return fail(res, 429, 'Easy, tiger. 5 posts per 10 minutes. Go outside, come back.');
      if (limited('post:global', 300, 10 * 60_000)) return fail(res, 503, 'The wall is packed right now. Try again in a few minutes.');
      const title = clean(data.title, LIMITS.title).toUpperCase();
      const body = clean(data.body, LIMITS.body, { multiline: true });
      const by = clean(String(data.by || '').replace(/^[~@\s]+/, ''), LIMITS.by);
      const flavor = FLAVORS.includes(data.flavor) ? data.flavor : 'FIELD NOTE';
      if (title.length < 3) return fail(res, 400, 'Title needs at least 3 characters. Shout louder.');
      if (body.length < 3) return fail(res, 400, 'Say something. Anything. At least 3 characters.');
      if (!by) return fail(res, 400, 'Every zine has a byline. Add a handle.');
      if (/^the house$/i.test(by)) return fail(res, 400, 'Nice try. Pick your own handle.');
      const dupe = db.posts.find(p => p.title === title && p.body === body && Date.now() - p.createdAt < 864e5);
      if (dupe) return fail(res, 409, 'That one is already on the wall.');
      const token = crypto.randomBytes(18).toString('base64url');
      const post = {
        id: newId(), title, body, by, flavor, house: false,
        createdAt: Date.now(), rocks: 0, rockers: [], reports: [], hidden: false,
        tokenHash: sha(token), authorHash: viewer,
      };
      db.posts.push(post);
      const community = db.posts.filter(p => !p.house);
      if (community.length > MAX_POSTS) {
        const drop = new Set(community.sort((a, b) => a.createdAt - b.createdAt).slice(0, community.length - MAX_POSTS));
        db.posts = db.posts.filter(p => !drop.has(p));
      }
      scheduleSave();
      return send(res, 201, { post: publicPost(post, viewer), deleteToken: token });
    }
    return fail(res, 405, 'method not allowed');
  }

  // /api/posts/:id[/rock|/report]
  if (parts[1] === 'posts' && parts[2]) {
    const post = db.posts.find(p => p.id === parts[2]);
    if (!post || (post.hidden && !isAdmin(req))) return fail(res, 404, 'No such post. Torn down, maybe.');
    const action = parts[3];

    if (!action && method === 'GET') return send(res, 200, { post: publicPost(post, viewer) });

    if (!action && method === 'DELETE') {
      const token = req.headers['x-delete-token'];
      const owner = token && post.tokenHash && crypto.timingSafeEqual(Buffer.from(sha(String(token))), Buffer.from(post.tokenHash));
      if (!owner && !isAdmin(req)) return fail(res, 403, "That's not your poster to tear down.");
      db.posts = db.posts.filter(p => p !== post);
      scheduleSave();
      res.writeHead(204, SECURITY_HEADERS);
      return res.end();
    }

    if (action === 'rock' && method === 'POST') {
      if (limited('rock:' + viewer, 120, 10 * 60_000)) return fail(res, 429, 'Your devil horns need a rest.');
      const i = post.rockers.indexOf(viewer);
      if (i === -1) post.rockers.push(viewer); else post.rockers.splice(i, 1);
      post.rocks = post.rockers.length;
      scheduleSave();
      return send(res, 200, { rocks: post.rocks, rocked: i === -1 });
    }

    if (action === 'report' && method === 'POST') {
      if (limited('report:' + viewer, 20, 60 * 60_000)) return fail(res, 429, 'Too many reports. Thanks for caring, though.');
      if (!post.reports.includes(viewer)) post.reports.push(viewer);
      if (post.reports.length >= HIDE_AFTER && !post.house) post.hidden = true;
      scheduleSave();
      return send(res, 200, { ok: true });
    }

    if (action === 'restore' && method === 'POST' && isAdmin(req)) {
      post.hidden = false; post.reports = [];
      scheduleSave();
      return send(res, 200, { post: publicPost(post) });
    }
    return fail(res, 405, 'method not allowed');
  }

  // /api/signatures
  if (parts[1] === 'signatures' && parts.length === 2) {
    if (method === 'GET') {
      const names = db.signatures.slice(-80).reverse().map(s => s.handle);
      return send(res, 200, { names, count: db.signatures.length });
    }
    if (method === 'POST') {
      const data = await readJson(req);
      if (data.website) return send(res, 201, { ok: true });
      if (limited('sign:' + viewer, 3, 10 * 60_000)) return fail(res, 429, "You've signed plenty. We see you.");
      if (limited('sign:global', 300, 10 * 60_000) || db.signatures.length >= MAX_SIGNATURES) return fail(res, 503, 'The wall is full up right now. Try again later.');
      const handle = clean(String(data.handle || '').replace(/^[~@\s]+/, ''), LIMITS.handle);
      const contact = clean(data.contact, LIMITS.contact);
      if (handle.length < 2) return fail(res, 400, 'Handle needs at least 2 characters.');
      if (db.signatures.some(s => s.handle.toLowerCase() === handle.toLowerCase())) {
        return fail(res, 409, 'That name is already on the wall. Pick a stranger one.');
      }
      db.signatures.push({ handle, contact, createdAt: Date.now(), by: viewer });
      scheduleSave();
      return send(res, 201, { ok: true, count: db.signatures.length });
    }
    return fail(res, 405, 'method not allowed');
  }

  // GET /api/admin/reports — what needs a look
  if (parts[1] === 'admin' && parts[2] === 'reports' && method === 'GET') {
    if (!isAdmin(req)) return fail(res, 401, 'admins only');
    const flagged = db.posts.filter(p => p.reports.length || p.hidden)
      .map(p => ({ ...publicPost(p), hidden: p.hidden, reports: p.reports.length }));
    return send(res, 200, { flagged });
  }

  return fail(res, 404, 'no such route');
}

/* ---------- static files ----------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
// only these are ever served — never server.js, data/, tests, etc.
const PUBLIC_FILES = new Set(['index.html', 'privacy.html', '404.html', 'robots.txt', 'sitemap.xml', 'site.webmanifest', 'favicon.svg']);
const PUBLIC_DIRS = ['css', 'js', 'fonts', 'img'];

async function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, ''); }
  catch { return fail(res, 400, 'bad path'); }
  if (rel === '' ) rel = 'index.html';
  if (rel === 'privacy') rel = 'privacy.html';
  const norm = path.posix.normalize(rel);
  const allowed = PUBLIC_FILES.has(norm) || PUBLIC_DIRS.some(d => norm.startsWith(d + '/'));
  const file = path.join(ROOT, norm);
  if (!allowed || norm.includes('..') || !file.startsWith(ROOT + path.sep)) return notFound(res);
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return notFound(res);
    const ext = path.extname(file);
    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    const longCache = norm.startsWith('fonts/') || norm.startsWith('img/');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...SECURITY_HEADERS, ...headers }); return res.end(); }
    res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  fs.readFile(path.join(ROOT, '404.html'), (err, buf) => {
    if (err) return fail(res, 404, 'not found');
    send(res, 404, buf, { 'Content-Type': 'text/html; charset=utf-8' });
  });
}

/* ---------- boot ------------------------------------------- */

function createServer() {
  if (!db) loadDb();
  return http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { return fail(res, 400, 'bad request'); }
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed');
      return await serveStatic(req, res, url);
    } catch (err) {
      if (err.close) res.setHeader('Connection', 'close');
      if (!res.headersSent) fail(res, err.status || 500, err.status ? err.message : 'the amp blew a fuse');
      if (!err.status) console.error(err);
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => console.log(`🤘 3chords.dev plugged in at http://localhost:${PORT}  (data: ${DB_FILE})`));
  // last line of defence: log, never die on a stray async error
  process.on('unhandledRejection', err => console.error('unhandledRejection:', err));
  const shutdown = async () => {
    server.close();
    setTimeout(() => process.exit(0), 3000).unref();
    try { await flush(); } catch (err) { console.error('final save failed:', err); }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer, flushSync, flush, clientIp, FLAVORS, _db: () => db };
