import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createSuperlativeRound } from './superlativeCore.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// THE reason this module exists. `superlative.js` statically imports 32 metric
// JSONs; in a real browser that kills the module and ships a blank page (#767,
// fixed in #769). The core must stay loadable by the browser, so it must never
// import JSON — directly or through anything it imports.
test('the core imports no JSON, directly or transitively', () => {
  const seen = new Set();
  const offenders = [];
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { return; }
    if (/with\s*\{\s*type:\s*['"]json['"]\s*\}/.test(src.replace(/^\s*\*.*$/gm, ''))) {
      offenders.push(file.split(/[\/]/).slice(-2).join('/'));
    }
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
      walk(join(dirname(file), m[1]));
    }
  };
  walk(join(HERE, 'superlativeCore.js'));
  assert.deepEqual(offenders, [],
    `these would break the browser: ${offenders.join(', ')}`);
});

test('a round generates a quartet with a clear extreme', () => {
  // A fake metric: powers of ten, so the gap rule is trivially satisfied.
  const values = { a: 1, b: 10, c: 100, d: 1000, e: 10000, f: 100000 };
  const metric = { has: (c) => c in values, valueOf: (c) => values[c] };
  const pool = Object.keys(values).map((code) => ({ code }));
  const round = createSuperlativeRound(metric, 'test-round');
  const q = round.generate(pool, new Set(), () => 0.5);
  assert.equal(q.options.length, 4);
  assert.ok(['most', 'least'].includes(q.prompt));
  assert.ok(q.options.includes(q.answer));
  // the answer really is the extreme among the four it offered
  const vals = q.options.map((c) => values[c]);
  const want = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
  assert.equal(values[q.answer], want);
});

test('direction can be locked to one extreme', () => {
  const values = { a: 1, b: 10, c: 100, d: 1000, e: 10000 };
  const metric = { has: (c) => c in values, valueOf: (c) => values[c] };
  const pool = Object.keys(values).map((code) => ({ code }));
  const round = createSuperlativeRound(metric, 'r', { direction: 'most' });
  for (let i = 0; i < 8; i++) {
    assert.equal(round.generate(pool, new Set(), Math.random).prompt, 'most');
  }
});

test('isCorrect only accepts the answer', () => {
  const values = { a: 1, b: 10, c: 100, d: 1000 };
  const metric = { has: (c) => c in values, valueOf: (c) => values[c] };
  const round = createSuperlativeRound(metric, 'r');
  const q = round.generate(Object.keys(values).map((code) => ({ code })), new Set(), () => 0.5);
  assert.equal(round.isCorrect(q, q.answer), true);
  assert.equal(round.isCorrect(q, q.options.find((o) => o !== q.answer)), false);
});
