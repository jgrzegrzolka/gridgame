import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createSuperlativeRound } from './superlativeCore.js';
import { collectReachable, findJsonModuleOffenders } from '../../tooling/browserImportGraph.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// THE reason this module exists. `superlative.js` statically imports 32 metric
// JSONs; in a real browser that kills the module and ships a blank page (#767,
// fixed in #769). The core must stay loadable, so it must never import JSON —
// directly or through anything it imports.
//
// This is the ONLY protection, and it has to be: Playwright's Chromium loads
// superlative.js and all 32 JSON imports perfectly happily (verified 2026-07-17,
// `dataHalfLoads: true`). A browser probe cannot tell safe from fatal here and
// would argue the split was pointless right up until real users get a blank page.
// Treat "but it works in Playwright" as no evidence at all.
//
// The walk itself is `tooling/browserImportGraph.js` — the repo's existing
// guard, unit-tested on fixtures, which also handles `export … from` re-exports
// that a hand-rolled `^import` regex misses. The catalog needs no entry here:
// `flagParty/page.js` imports it, so tooling's repo-wide test (which walks every
// page.js) already covers it. The CORE is the gap — no page reaches it until
// flagQuiz's Facts deck lands in Phase 4b-ii — so it gets this explicit walk
// until then.
test('superlativeCore.js imports no JSON, directly or transitively', () => {
  const read = (/** @type {string} */ p) => {
    try { return readFileSync(p, 'utf8'); } catch { return null; }
  };
  const reachable = collectReachable([join(HERE, 'superlativeCore.js')], read);
  assert.ok(reachable.size > 1, `import walk looks broken: only ${reachable.size} files reached`);
  const offenders = findJsonModuleOffenders(reachable, read)
    .map((p) => p.replace(/\\/g, '/').split('/').slice(-2).join('/'));
  assert.deepEqual(offenders, [],
    `these would break the browser: ${offenders.join(', ')}`);
});

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
