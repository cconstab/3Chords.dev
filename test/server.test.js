'use strict';
// Run: npm test   (node --test, zero dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '3chords-test-'));
process.env.ADMIN_TOKEN = 'test-admin';
process.env.HIDE_AFTER = '2';
process.env.TRUST_PROXY = '1';
process.env.MAX_POSTS = '40';
const { createServer, flushSync, clientIp, _db } = require('../server.js');
const net = require('node:net');

let base, server;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { flushSync(); server.close(); });

let ipCounter = 0;
const call = (p, { method = 'GET', body, headers = {}, ip } = {}) =>
  fetch(base + p, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-forwarded-for': ip || `10.0.0.${++ipCounter % 250}`,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const post = (b, opts = {}) => call('/api/posts', { method: 'POST', body: b, ...opts });

test('serves the site with security headers', async () => {
  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await r.text(), /THREE CHORDS/);
});

test('never serves server source, data, or traversal paths', async () => {
  for (const p of ['/server.js', '/data/db.json', '/data-seed.json', '/package.json', '/css/../server.js', '/%2e%2e/etc/passwd', '/test/server.test.js']) {
    const r = await call(p);
    assert.equal(r.status, 404, p);
  }
});

test('seeds house posts on a fresh db', async () => {
  const { posts } = await (await call('/api/posts')).json();
  assert.ok(posts.length >= 5);
  assert.ok(posts.every(p => p.house && p.by === 'the house'));
});

test('create, read, and owner-delete a post', async () => {
  const r = await post({ title: 'i shipped it', body: 'before breakfast', by: '@punk', flavor: 'FIELD NOTE' });
  assert.equal(r.status, 201);
  const { post: p, deleteToken } = await r.json();
  assert.equal(p.title, 'I SHIPPED IT');
  assert.equal(p.by, 'punk');
  assert.ok(deleteToken);

  assert.equal((await call(`/api/posts/${p.id}`)).status, 200);
  assert.equal((await call(`/api/posts/${p.id}`, { method: 'DELETE', headers: { 'x-delete-token': 'nope' } })).status, 403);
  assert.equal((await call(`/api/posts/${p.id}`, { method: 'DELETE', headers: { 'x-delete-token': deleteToken } })).status, 204);
  assert.equal((await call(`/api/posts/${p.id}`)).status, 404);
});

test('validates input and strips control characters', async () => {
  assert.equal((await post({ title: 'x', body: 'hello', by: 'a' })).status, 400);
  assert.equal((await post({ title: 'hello', body: '', by: 'a' })).status, 400);
  assert.equal((await post({ title: 'hello', body: 'hi there', by: '' })).status, 400);
  assert.equal((await post({ title: 'hello', body: 'hi there', by: 'The House' })).status, 400);
  const r = await post({ title: 'ctrl\u0000chars‮', body: 'a'.repeat(5000), by: 'x'.repeat(100), flavor: 'NOT A FLAVOR' });
  const { post: p } = await r.json();
  assert.equal(p.title, 'CTRLCHARS');
  assert.equal(p.body.length, 600);
  assert.equal(p.by.length, 24);
  assert.equal(p.flavor, 'FIELD NOTE');
});

test('html is stored as text, never interpreted server-side', async () => {
  const { post: p } = await (await post({ title: '<img src=x onerror=alert(1)>', body: '<script>x</script>', by: 'h' })).json();
  assert.equal(p.body, '<script>x</script>'); // client escapes on render; server stores raw text
});

test('honeypot submissions are silently dropped', async () => {
  const before = (await (await call('/api/posts')).json()).posts.length;
  const r = await post({ title: 'buy pills', body: 'cheap pills', by: 'bot', website: 'http://spam' });
  assert.equal(r.status, 201);
  const after = (await (await call('/api/posts')).json()).posts.length;
  assert.equal(after, before);
});

test('rejects duplicate posts and cross-origin writes', async () => {
  const b = { title: 'same song', body: 'same chords', by: 'echo' };
  assert.equal((await post(b)).status, 201);
  assert.equal((await post(b)).status, 409);
  const r = await post({ title: 'csrf', body: 'from evil', by: 'x' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('rate limits posting per ip', async () => {
  const ip = '192.168.9.9';
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post({ title: `post ${i}`, body: `noise ${i}`, by: 'spammy' }, { ip })).status);
  assert.deepEqual(codes.slice(0, 5), [201, 201, 201, 201, 201]);
  assert.equal(codes[5], 429);
});

test('rock toggles once per person', async () => {
  const { post: p } = await (await post({ title: 'rock me', body: 'please', by: 'r' })).json();
  const ip = '172.16.0.1';
  let j = await (await call(`/api/posts/${p.id}/rock`, { method: 'POST', ip })).json();
  assert.deepEqual(j, { rocks: 1, rocked: true });
  j = await (await call(`/api/posts/${p.id}/rock`, { method: 'POST', ip })).json();
  assert.deepEqual(j, { rocks: 0, rocked: false });
});

test('reports hide a post after threshold; admin can review and restore', async () => {
  const { post: p } = await (await post({ title: 'gross thing', body: 'bad', by: 'troll' })).json();
  await call(`/api/posts/${p.id}/report`, { method: 'POST', ip: '1.1.1.1' });
  await call(`/api/posts/${p.id}/report`, { method: 'POST', ip: '1.1.1.1' }); // same person twice counts once
  assert.equal((await call(`/api/posts/${p.id}`)).status, 200);
  await call(`/api/posts/${p.id}/report`, { method: 'POST', ip: '2.2.2.2' });
  assert.equal((await call(`/api/posts/${p.id}`)).status, 404);

  assert.equal((await call('/api/admin/reports')).status, 401);
  const auth = { authorization: 'Bearer test-admin' };
  const { flagged } = await (await call('/api/admin/reports', { headers: auth })).json();
  assert.ok(flagged.some(f => f.id === p.id && f.hidden));
  assert.equal((await call(`/api/posts/${p.id}/restore`, { method: 'POST', headers: auth })).status, 200);
  assert.equal((await call(`/api/posts/${p.id}`)).status, 200);
});

test('house posts cannot be hidden by reports', async () => {
  const { posts } = await (await call('/api/posts')).json();
  const house = posts.find(p => p.house);
  for (const ip of ['3.3.3.1', '3.3.3.2', '3.3.3.3']) await call(`/api/posts/${house.id}/report`, { method: 'POST', ip });
  assert.equal((await call(`/api/posts/${house.id}`)).status, 200);
});

test('signatures: public handles, private contact, no dupes', async () => {
  const r = await call('/api/signatures', { method: 'POST', body: { handle: '@sid', contact: 'sid@example.com' } });
  assert.equal(r.status, 201);
  assert.equal((await call('/api/signatures', { method: 'POST', body: { handle: 'SID' } })).status, 409);
  const j = await (await call('/api/signatures')).json();
  assert.ok(j.names.includes('sid'));
  assert.ok(!JSON.stringify(j).includes('example.com'), 'contact must never be exposed');
});

test('rejects oversized and non-json bodies', async () => {
  const big = await call('/api/posts', { method: 'POST', body: { title: 'x'.repeat(20000), body: 'y', by: 'z' } });
  assert.equal(big.status, 413);
  const txt = await fetch(base + '/api/posts', { method: 'POST', body: 'hi', headers: { 'content-type': 'text/plain' } });
  assert.equal(txt.status, 415);
});

test('unknown paths get the 404 page', async () => {
  const r = await call('/nope');
  assert.equal(r.status, 404);
});

test('persists to disk', async () => {
  await post({ title: 'remember me', body: 'on disk', by: 'disk' });
  flushSync();
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8'));
  assert.ok(saved.posts.some(p => p.title === 'REMEMBER ME'));
});

/* ---------- regressions from the security review ----------- */

const rawRequest = (payload) => new Promise((resolve) => {
  const sock = net.connect(server.address().port, '127.0.0.1', () => sock.end(payload));
  let out = '';
  sock.on('data', d => { out += d; });
  sock.on('close', () => resolve(out));
  sock.on('error', () => resolve(out));
});

test('a malformed request target does not crash the server', async () => {
  const out = await rawRequest('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 400/);
  assert.equal((await call('/api/health')).status, 200, 'still alive');
});

test('client-supplied X-Forwarded-For entries are ignored (rightmost hop wins)', () => {
  const req = (xff, remote = '10.0.0.1') => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(req('1.1.1.1, 2.2.2.2, 203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(req('::ffff:198.51.100.4')), '198.51.100.4');
});

test('spoofed left-hand XFF cannot dodge rate limits or mass-report', async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) {
    codes.push((await post({ title: `spoof ${i}`, body: `spoof body ${i}`, by: 'spoofer' }, { ip: `9.9.9.${i}, 198.51.100.77` })).status);
  }
  assert.equal(codes[5], 429);
  const { post: p } = await (await post({ title: 'do not hide me', body: 'innocent', by: 'victim' })).json();
  for (let i = 0; i < 4; i++) await call(`/api/posts/${p.id}/report`, { method: 'POST', ip: `7.7.7.${i}, 198.51.100.88` });
  assert.equal((await call(`/api/posts/${p.id}`)).status, 200, 'one real reporter cannot hide a post');
});

test('IPv6 addresses in the same /64 count as one visitor', () => {
  const req = (ip) => ({ headers: {}, socket: { remoteAddress: ip } });
  assert.equal(clientIp(req('2001:db8:1:2::1')), clientIp(req('2001:db8:1:2:ffff::9')));
  assert.notEqual(clientIp(req('2001:db8:1:2::1')), clientIp(req('2001:db8:1:3::1')));
});

test('steady writes still reach disk (throttled, not debounced)', async () => {
  const { post: p } = await (await post({ title: 'steady stream', body: 'must persist', by: 'steady' })).json();
  const file = path.join(process.env.DATA_DIR, 'db.json');
  const started = Date.now();
  let persisted = false;
  while (Date.now() - started < 1500 && !persisted) {
    await call(`/api/posts/${p.id}/rock`, { method: 'POST', ip: '172.20.0.1' });
    await new Promise(r => setTimeout(r, 40));
    persisted = fs.readFileSync(file, 'utf8').includes('STEADY STREAM');
  }
  assert.ok(persisted, 'post reached disk while writes kept coming');
});

test('null, array and string JSON bodies get 400, not 500', async () => {
  for (const body of ['null', '[]', '"x"', '42']) {
    const r = await fetch(base + '/api/posts', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' } });
    assert.equal(r.status, 400, body);
  }
});

test('invisible characters cannot fake a duplicate handle', async () => {
  assert.equal((await call('/api/signatures', { method: 'POST', body: { handle: 'ghost' } })).status, 201);
  for (const sneaky of ['gh­ost', 'ghost﻿', 'gh⁠ost', ' ghost', 'ｇｈｏｓｔ']) {
    assert.equal((await call('/api/signatures', { method: 'POST', body: { handle: sneaky } })).status, 409, JSON.stringify(sneaky));
  }
});

test('wrong admin token is refused', async () => {
  assert.equal((await call('/api/admin/reports', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/api/admin/reports', { headers: { authorization: 'Bearer test-admin' } })).status, 200);
});

test('community posts are capped at MAX_POSTS; house posts are kept', async () => {
  for (let i = 0; i < 45; i++) await post({ title: `cap filler ${i}`, body: `filler ${i}`, by: 'cap' });
  const all = _db().posts;
  assert.ok(all.filter(p => !p.house).length <= 40);
  assert.ok(all.some(p => p.house));
});
