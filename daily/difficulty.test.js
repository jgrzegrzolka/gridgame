import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { scoreEntry } from './difficulty.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Build a tiny synthetic byCode lookup from a `{code: nameScore}` map
 * so unit tests don't depend on real country data.
 *
 * @param {Record<string, number>} scores
 */
function mk(scores) {
  /** @type {Record<string, { nameScore: number }>} */
  const m = {};
  for (const [code, ns] of Object.entries(scores)) m[code] = { nameScore: ns };
  return m;
}

// --- size buckets ---

test('scoreEntry: size bucket 1 gets +2.0', () => {
  const r = scoreEntry({ filter: 'x', answers: ['a'] }, mk({ a: 1 }));
  assert.equal(r.sizeAdjust, 2.0);
});

test('scoreEntry: size bucket 2-3 gets +0.3', () => {
  for (const ans of [['a', 'b'], ['a', 'b', 'c']]) {
    const r = scoreEntry({ filter: 'x', answers: ans }, mk({ a: 1, b: 1, c: 1 }));
    assert.equal(r.sizeAdjust, 0.3, `n=${ans.length}`);
  }
});

test('scoreEntry: size bucket 4-15 is the zero baseline', () => {
  for (const n of [4, 7, 10, 15]) {
    const answers = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
    const r = scoreEntry({ filter: 'x', answers }, mk(Object.fromEntries(answers.map(c => [c, 1]))));
    assert.equal(r.sizeAdjust, 0, `n=${n}`);
  }
});

test('scoreEntry: size bucket 16-25 gets +0.2', () => {
  for (const n of [16, 25]) {
    const answers = Array.from({ length: n }, (_, i) => `c${i}`);
    const r = scoreEntry({ filter: 'x', answers }, mk(Object.fromEntries(answers.map(c => [c, 1]))));
    assert.equal(r.sizeAdjust, 0.2, `n=${n}`);
  }
});

test('scoreEntry: size bucket 26-30 gets +0.5', () => {
  for (const n of [26, 30]) {
    const answers = Array.from({ length: n }, (_, i) => `c${i}`);
    const r = scoreEntry({ filter: 'x', answers }, mk(Object.fromEntries(answers.map(c => [c, 1]))));
    assert.equal(r.sizeAdjust, 0.5, `n=${n}`);
  }
});

// --- outlier bump ---

test('scoreEntry: no outlier bump when max is close to mean', () => {
  // All flags nm=2, no outlier
  const r = scoreEntry({ filter: 'x', answers: ['a', 'b', 'c'] }, mk({ a: 2, b: 2, c: 2 }));
  assert.equal(r.outlier, 0);
});

test('scoreEntry: outlier bump fires only when max > mean + 1.5', () => {
  // mean=2, max=3 → max-mean=1, below threshold → no bump
  const noBump = scoreEntry({ filter: 'x', answers: ['a', 'b', 'c'] }, mk({ a: 1, b: 2, c: 3 }));
  assert.equal(noBump.outlier, 0);
  // mean=2, max=4 → max-mean=2, above threshold (1.5) → bump = 0.4 * (2 - 1.5) = 0.2
  const bump = scoreEntry({ filter: 'x', answers: ['a', 'b', 'c'] }, mk({ a: 1, b: 1, c: 4 }));
  assert.equal(+bump.outlier.toFixed(4), 0.2);
});

test('scoreEntry: Vatican-style outlier (5 famous + 1 nm=6) adds ~0.8', () => {
  // mean = (1+1+2+2+3+6)/6 = 2.5, max=6 → bump = 0.4 * (6 - 2.5 - 1.5) = 0.8
  const r = scoreEntry({ filter: 'x', answers: ['a', 'b', 'c', 'd', 'e', 'f'] }, mk({ a: 1, b: 1, c: 2, d: 2, e: 3, f: 6 }));
  assert.equal(r.mean, 2.5);
  assert.equal(r.max, 6);
  assert.equal(+r.outlier.toFixed(4), 0.8);
});

// --- token adjustment ---

test('scoreEntry: token adjust is zero for 1-2 tokens', () => {
  assert.equal(scoreEntry({ filter: 'a', answers: ['x'] }, mk({ x: 1 })).tokenAdjust, 0);
  assert.equal(scoreEntry({ filter: 'a,b', answers: ['x'] }, mk({ x: 1 })).tokenAdjust, 0);
});

test('scoreEntry: token adjust adds 0.1 per token past 2', () => {
  assert.equal(+scoreEntry({ filter: 'a,b,c', answers: ['x'] }, mk({ x: 1 })).tokenAdjust.toFixed(4), 0.1);
  assert.equal(+scoreEntry({ filter: 'a,b,c,d,e', answers: ['x'] }, mk({ x: 1 })).tokenAdjust.toFixed(4), 0.3);
});

// --- robustness ---

test('scoreEntry: missing country code falls back to nameScore 3', () => {
  // 1-flag, mean=3, sizeAdjust=2.0, no outlier, no token bump (1 token)
  const r = scoreEntry({ filter: 'x', answers: ['xx'] }, mk({}));
  assert.equal(r.mean, 3);
  assert.equal(r.score, 5);
});

test('scoreEntry: accepts Map or plain object as byCode', () => {
  const asMap = new Map([['a', { nameScore: 2 }]]);
  const asObj = { a: { nameScore: 2 } };
  const entry = { filter: 'x', answers: ['a'] };
  assert.equal(scoreEntry(entry, asMap).score, scoreEntry(entry, asObj).score);
});

// --- calibration anchors against real catalog data ---
//
// These pin the formula's behaviour on actual entries from the live
// catalog. If country data shifts (a nameScore is bumped) or the
// formula is tweaked, these ranges fire — that's the cue to either
// confirm the change is intended and update the bounds, or revert.
// Ranges are wide enough to absorb a single-country nameScore tweak
// (±0.2 typical) but narrow enough to catch a formula regression.

/** @type {{ nameScore: number, code: string }[]} */
const COUNTRIES = JSON.parse(readFileSync(join(HERE, '..', 'flags', 'countries.json'), 'utf-8'));
const BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
/** @type {{ n: number, filter: string, answers: string[] }[]} */
const LIVE = JSON.parse(readFileSync(join(HERE, 'daily_puzzles.json'), 'utf-8'));

function find(catalog, n) {
  const e = catalog.find((x) => x.n === n);
  if (!e) throw new Error(`anchor catalog has no entry #${n}`);
  return e;
}

test('calibration: live #1 Europe + cross lands very easy (≈1.2, range 1.0-1.4)', () => {
  // 9 European flags, 7 at nm=1 (incl. Greece), 2 at nm=2 (Iceland, Malta).
  // mean = 1.22, no outlier (max-mean = 0.78 < 1.5 threshold),
  // size 9 → bucket 4-15 → +0, tokens=2 → +0. Score == mean.
  const r = scoreEntry(find(LIVE, 1), BY_CODE);
  assert.ok(r.score >= 1.0 && r.score <= 1.4,
    `Europe + cross score ${r.score.toFixed(2)} outside [1.0, 1.4] — formula or country data drifted`);
});

test('calibration: live #3 EU members lands easy-but-big (≈1.8, range 1.5-2.2)', () => {
  // 27 famous flags, mean ≈ 1.3, sizeAdjust = +0.5 (n=27, bucket 26-30)
  const r = scoreEntry(find(LIVE, 3), BY_CODE);
  assert.ok(r.score >= 1.5 && r.score <= 2.2,
    `EU members score ${r.score.toFixed(2)} outside [1.5, 2.2] — formula or country data drifted`);
  // Size bump is non-trivial — pin it specifically so a future "make
  // large sets less harsh" tweak doesn't silently regress this anchor.
  assert.equal(r.sizeAdjust, 0.5);
});
