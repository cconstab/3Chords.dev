'use strict';
// Keeps the jukebox setlist singable and its share links stable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/jukebox.js'), 'utf8'), ctx);
const { ideas, tools, nerves } = ctx.window.JUKEBOX;
const lock = require('./jukebox.lock.json');

const lists = { ideas, tools, nerves };

test('lists are append-only, so shared #song links keep working', () => {
  for (const [name, arr] of Object.entries(lists)) {
    lock[name].forEach((entry, i) => {
      assert.equal(arr[i], entry, `${name}[${i}] moved or changed. Only add to the END of the list (old song links store positions).`);
    });
  }
});

test('every entry follows the house rules', () => {
  for (const [name, arr] of Object.entries(lists)) {
    assert.ok(arr.length >= 20, `${name} needs a decent setlist`);
    const seen = new Set();
    for (const s of arr) {
      assert.equal(typeof s, 'string');
      assert.ok(s.length >= 6 && s.length <= 90, `${name}: keep it between 6 and 90 chars: "${s}"`);
      assert.ok(!/[.]$/.test(s), `${name}: no full stop at the end: "${s}"`);
      assert.equal(s, s.trim(), `${name}: no stray spaces: "${s}"`);
      assert.ok(!seen.has(s.toLowerCase()), `${name}: duplicate: "${s}"`);
      seen.add(s.toLowerCase());
    }
  }
  for (const s of ideas) assert.match(s, /^an? /, `ideas finish "I'm building...", so start with "a" or "an": "${s}"`);
  for (const s of nerves) assert.match(s, /^[a-z]/, `nerves are instructions starting lowercase: "${s}"`);
});

test('song prompts read as sentences', () => {
  const sentence = `I'm building ${ideas[0]}. I've got ${tools[0]}. My rule: ${nerves[0]}.`;
  assert.ok(!sentence.includes('..'));
});
