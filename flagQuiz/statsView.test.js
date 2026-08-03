import test from 'node:test';
import assert from 'node:assert/strict';

import {
  modeCoverage,
  coverageRow,
  sortCoverageRows,
  HEADLINE_MODE,
  SECONDARY_MODE,
  MODE_KEYS,
} from './statsView.js';
import { bestKey, saveBest, targetFor } from '../flags/quiz.js';

/** @param {Record<string, string>} [initial] */
function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem: (k) => (data.has(k) ? /** @type {string} */ (data.get(k)) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => data.set(k, v),
  };
}

/**
 * Seed a best through the real writer, so the stored shape is never guessed.
 * @param {ReturnType<typeof fakeStore>} store
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {number} score
 * @param {number} [time]
 */
function seed(store, variantKey, modeKey, score, time = 60_000) {
  saveBest(store, bestKey(variantKey, modeKey), { score, time });
  return store;
}

/**
 * Assert-and-narrow. A null here is a test failure either way; this just says
 * so at the point it happens instead of as a confusing property read.
 * @template T
 * @param {T | null} v
 * @returns {T}
 */
function must(v) {
  assert.notEqual(v, null, 'expected a coverage value, got null');
  return /** @type {T} */ (v);
}

// ---- the two modes mean opposite things by `score` ----

test('the 60s record reads as flags found', () => {
  const store = seed(fakeStore(), 'europe', '60s', 40);
  assert.deepEqual(modeCoverage(store, 'europe', '60s', 44), {
    correct: 40, ratio: 40 / 44, label: '40/44',
  });
});

test('the no-clock record reads as flags found too, though it stores mistakes', () => {
  // `all` is one-shot per question and stores the MISTAKE count. Rendering
  // that raw is what made the old page incomparable with itself — "Europe 4"
  // meant four wrong, next to "Europe 40" meaning forty right.
  const store = seed(fakeStore(), 'europe', 'all', 4);
  assert.deepEqual(modeCoverage(store, 'europe', 'all', 44), {
    correct: 40, ratio: 40 / 44, label: '40/44',
  });
});

test('an unplayed mode is null, not a zero', () => {
  // Zero and "never touched" must not render the same: one is a bar at 0%,
  // the other is a row with no bar at all.
  assert.equal(modeCoverage(fakeStore(), 'europe', '60s', 44), null);
});

test('coverage never exceeds the pool, even on a legacy over-count', () => {
  // Pre-cabinet rounds could bank more mistakes than the pool had flags;
  // formatBestScoreLabel clamps the count, and the ratio must not exceed 1
  // or the bar would overflow its track.
  const store = seed(fakeStore(), 'oceania', 'all', 99);
  const c = must(modeCoverage(store, 'oceania', 'all', 14));
  assert.equal(c.correct, 0);
  assert.ok(c.ratio >= 0 && c.ratio <= 1);
});

test('an empty pool cannot divide by zero', () => {
  const store = seed(fakeStore(), 'europe', '60s', 0);
  assert.equal(must(modeCoverage(store, 'europe', '60s', 0)).ratio, 0);
});

// ---- the four row states from the canvas ----

test('both modes played: the 60s record leads, no-clock goes quiet', () => {
  const store = fakeStore();
  seed(store, 'europe', '60s', 40);
  seed(store, 'europe', 'all', 1);
  const row = coverageRow(store, { key: 'europe', poolSize: 44 });
  assert.equal(must(row.headline).label, '40/44');
  assert.equal(must(row.secondary).label, '43/44');
  assert.equal(row.played, true);
});

test('only 60s played: there is simply no second line', () => {
  const store = seed(fakeStore(), 'asia', '60s', 18);
  const row = coverageRow(store, { key: 'asia', poolSize: 47 });
  assert.equal(must(row.headline).label, '18/47');
  assert.equal(row.secondary, null);
});

test('only no-clock played: no bar, because the bar measures the 60s record', () => {
  const store = seed(fakeStore(), 'weird', 'all', 8);
  const row = coverageRow(store, { key: 'weird', poolSize: 54 });
  assert.equal(row.headline, null, 'nothing to draw a bar from');
  assert.equal(must(row.secondary).label, '46/54');
  assert.equal(row.played, true, 'it WAS played — just not in the measured mode');
});

test('nothing played: name only', () => {
  const row = coverageRow(fakeStore(), { key: 'africa', poolSize: 54 });
  assert.equal(row.headline, null);
  assert.equal(row.secondary, null);
  assert.equal(row.played, false);
});

// ---- ordering ----

test('rows sort best-first, so the end of the list is what to practise', () => {
  const store = fakeStore();
  seed(store, 'south-america', '60s', 12);
  seed(store, 'europe', '60s', 40);
  seed(store, 'asia', '60s', 18);
  const rows = [
    coverageRow(store, { key: 'asia', poolSize: 47 }),
    coverageRow(store, { key: 'europe', poolSize: 44 }),
    coverageRow(store, { key: 'south-america', poolSize: 12 }),
  ];
  assert.deepEqual(
    sortCoverageRows(rows).map((r) => r.key),
    ['south-america', 'europe', 'asia'],
  );
});

test('a no-clock-only row sinks below every measured row, and unplayed below that', () => {
  const store = fakeStore();
  seed(store, 'asia', '60s', 1);
  seed(store, 'weird', 'all', 8);
  const rows = [
    coverageRow(store, { key: 'africa', poolSize: 54 }),
    coverageRow(store, { key: 'weird', poolSize: 54 }),
    coverageRow(store, { key: 'asia', poolSize: 47 }),
  ];
  // asia's 1/47 is a terrible score and still outranks weird's 46/54 — the
  // ordering measure is the 60s record, and weird has none.
  assert.deepEqual(
    sortCoverageRows(rows).map((r) => r.key),
    ['asia', 'weird', 'africa'],
  );
});

test('ties keep their incoming order, so an untouched list reads in deck order', () => {
  const rows = [
    coverageRow(fakeStore(), { key: 'europe', poolSize: 44 }),
    coverageRow(fakeStore(), { key: 'asia', poolSize: 47 }),
    coverageRow(fakeStore(), { key: 'africa', poolSize: 54 }),
  ];
  assert.deepEqual(
    sortCoverageRows(rows).map((r) => r.key),
    ['europe', 'asia', 'africa'],
  );
});

test('sortCoverageRows does not mutate its input', () => {
  const store = seed(fakeStore(), 'asia', '60s', 18);
  const rows = [
    coverageRow(store, { key: 'africa', poolSize: 54 }),
    coverageRow(store, { key: 'asia', poolSize: 47 }),
  ];
  const before = rows.map((r) => r.key);
  sortCoverageRows(rows);
  assert.deepEqual(rows.map((r) => r.key), before);
});

// ---- assumptions this module rests on ----

test('both modes target the whole pool, which is why one poolSize serves both', () => {
  // The row takes a single `poolSize` for both the headline and the quiet
  // line. That is only honest while every mode plays the entire pool — ask
  // targetFor rather than trusting the comment.
  const pool = { length: 44 };
  for (const modeKey of MODE_KEYS) {
    assert.equal(
      targetFor(modeKey, pool), 44,
      `${modeKey} does not target the whole pool — the row needs a per-mode denominator`,
    );
  }
});

test('the headline and secondary modes are real, distinct modes', () => {
  assert.ok(MODE_KEYS.includes(HEADLINE_MODE));
  assert.ok(MODE_KEYS.includes(SECONDARY_MODE));
  assert.notEqual(HEADLINE_MODE, SECONDARY_MODE);
  assert.equal(MODE_KEYS.length, 2, 'a third mode needs a decision about where it renders');
});
