import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createSuperlativeRound } from './superlativeCore.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// THE reason these modules exist. `superlative.js` statically imports 32 metric
// JSONs; in a real browser that kills the module and ships a blank page (#767,
// fixed in #769). Its browser-side halves must stay loadable, so they must never
// import JSON — directly or through anything they import.
//
// This is the ONLY protection, and it has to be: Playwright's Chromium loads
// superlative.js and all 32 JSON imports perfectly happily (verified 2026-07-17,
// `dataHalfLoads: true`). A browser probe cannot tell safe from fatal here and
// would argue the split was pointless right up until real users get a blank page.
// Treat "but it works in Playwright" as no evidence at all.
//
// Both entry points are walked from one test rather than a copy per file: the
// walker is the mechanism, and two copies would drift.
for (const entry of ['superlativeCore.js', 'superlativeCatalog.js']) {
  test(`${entry} imports no JSON, directly or transitively`, () => {
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {string[]} */
    const offenders = [];
    /** @param {string} file */
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
    walk(join(HERE, entry));
    assert.deepEqual(offenders, [],
      `these would break the browser: ${offenders.join(', ')}`);
  });
}

test('a round generates a quartet with a clear extreme', () => {
  // A fake metric: powers of ten, so the gap rule is trivially satisfied.
  /** @type {Record<string, number>} */
  const values = { a: 1, b: 10, c: 100, d: 1000, e: 10000, f: 100000 };
  const metric = { has: (/** @type {string} */ c) => c in values, valueOf: (/** @type {string} */ c) => values[c] };
  const pool = Object.keys(values).map((code) => ({ code }));
  const round = createSuperlativeRound(metric, 'test-round');
  const q = round.generate(pool, new Set(), () => 0.5);
  assert.equal(q.options.length, 4);
  assert.ok(['most', 'least'].includes(q.prompt));
  assert.ok(q.options.includes(q.answer));
  // the answer really is the extreme among the four it offered
  const vals = q.options.map((/** @type {string} */ c) => values[c]);
  const want = q.prompt === 'most' ? Math.max(...vals) : Math.min(...vals);
  assert.equal(values[q.answer], want);
});

test('direction can be locked to one extreme', () => {
  /** @type {Record<string, number>} */
  const values = { a: 1, b: 10, c: 100, d: 1000, e: 10000 };
  const metric = { has: (/** @type {string} */ c) => c in values, valueOf: (/** @type {string} */ c) => values[c] };
  const pool = Object.keys(values).map((code) => ({ code }));
  const round = createSuperlativeRound(metric, 'r', { direction: 'most' });
  for (let i = 0; i < 8; i++) {
    assert.equal(round.generate(pool, new Set(), Math.random).prompt, 'most');
  }
});

test('isCorrect only accepts the answer', () => {
  /** @type {Record<string, number>} */
  const values = { a: 1, b: 10, c: 100, d: 1000 };
  const metric = { has: (/** @type {string} */ c) => c in values, valueOf: (/** @type {string} */ c) => values[c] };
  const round = createSuperlativeRound(metric, 'r');
  const q = round.generate(Object.keys(values).map((code) => ({ code })), new Set(), () => 0.5);
  assert.equal(round.isCorrect(q, q.answer), true);
  // `.find` is string|undefined to the checker; the question always has a
  // non-answer option, so assert that rather than casting the doubt away.
  const other = q.options.find((/** @type {string} */ o) => o !== q.answer);
  assert.ok(other, 'a quartet must contain a non-answer option');
  assert.equal(round.isCorrect(q, other), false);
});
