import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flagOfDay } from './flagOfDay.js';
import { storyFlagPool } from './flagFacts.js';

/**
 * Build a `{code, addedOn}` pool; all stories share one add date by default.
 * @param {string[]} codes
 * @param {string} [addedOn]
 * @returns {Array<{ code: string, addedOn: string }>}
 */
const pool = (codes, addedOn = '2026-07-01') => codes.map((code) => ({ code, addedOn }));
const CODES = ['gb', 'gb-eng', 'gb-sct', 'gb-wls', 'ie', 'ch', 'gr', 'pl'];
const POOL = pool(CODES);

/**
 * Enumerate ISO date strings from `from` to `to` inclusive.
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
function dateRange(from, to) {
  const out = [];
  let d = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  for (; d <= end; d += 86400000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

test('empty / invalid pool yields null', () => {
  assert.equal(flagOfDay('2026-07-02', []), null);
  assert.equal(flagOfDay('2026-07-02', /** @type {any} */ (null)), null);
});

test('a flag is not eligible until the day after its addedOn', () => {
  const one = pool(['pl'], '2026-07-10');
  assert.equal(flagOfDay('2026-07-09', one), null); // before addedOn
  assert.equal(flagOfDay('2026-07-10', one), null); // on addedOn — still not eligible
  assert.equal(flagOfDay('2026-07-11', one), 'pl'); // day after — eligible
});

test('single-flag pool returns that flag every eligible day', () => {
  const one = pool(['pl'], '2026-07-01');
  for (const d of ['2026-07-02', '2026-09-01', '2030-12-31']) {
    assert.equal(flagOfDay(d, one), 'pl');
  }
});

test('deterministic: same date + pool → same flag', () => {
  assert.equal(flagOfDay('2026-08-15', POOL), flagOfDay('2026-08-15', POOL));
});

test('every pick is actually a flag in the pool', () => {
  for (const d of dateRange('2026-07-02', '2026-08-20')) {
    assert.ok(CODES.includes(/** @type {string} */ (flagOfDay(d, POOL))), `pick on ${d}`);
  }
});

test('order-independent: input pool order does not change the pick', () => {
  const reversed = POOL.slice().reverse();
  const shuffledInput = pool(['gr', 'pl', 'gb', 'ch', 'ie', 'gb-wls', 'gb-sct', 'gb-eng']);
  for (const d of ['2026-07-02', '2026-08-15', '2027-03-09']) {
    const a = flagOfDay(d, POOL);
    assert.equal(flagOfDay(d, reversed), a);
    assert.equal(flagOfDay(d, shuffledInput), a);
  }
});

test('APPEND-SAFETY: adding a flag never changes today or any past day', () => {
  // The whole point of the rewrite. Add a brand-new story dated `T`; it must
  // be invisible on every day up to and including `T`, and only weave into
  // days after `T`.
  const T = '2026-08-01';
  const range = dateRange('2026-07-02', '2026-09-15');
  const before = range.map((d) => flagOfDay(d, POOL));

  const augmented = POOL.concat({ code: 'us', addedOn: T });
  const after = range.map((d) => flagOfDay(d, augmented));

  for (let i = 0; i < range.length; i++) {
    const d = range[i];
    if (d <= T) {
      assert.equal(after[i], before[i], `pick on ${d} (<= ${T}) must be unchanged`);
      assert.notEqual(after[i], 'us', `newcomer must not appear on ${d}`);
    }
  }
  // ...and it does eventually get shown after its eligibility starts.
  assert.ok(after.some((c, i) => range[i] > T && c === 'us'), 'newcomer appears after T');
});

test('balanced coverage: no flag is starved, counts stay within 1 of each other', () => {
  // Least-recently-shown keeps the pick counts tight — every flag shown, and
  // the busiest/quietest differ by at most one over a whole-pool-multiple
  // window. (The old design guaranteed "exactly once per cycle"; this is the
  // pool-size-independent equivalent.)
  const window = dateRange('2026-07-02', '2026-09-27'); // 88 days = 8 flags × 11 rounds
  const tally = new Map(CODES.map((c) => [c, 0]));
  for (const d of window) {
    const c = /** @type {string} */ (flagOfDay(d, POOL));
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  const values = CODES.map((c) => tally.get(c) ?? 0);
  for (const c of CODES) assert.ok((tally.get(c) ?? 0) > 0, `${c} shown at least once`);
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, 'counts within 1 of each other');
});

test('editorial override pins a specific date to a specific flag', () => {
  const ov = { '2026-07-02': 'pl' };
  assert.equal(flagOfDay('2026-07-02', POOL, ov), 'pl');
  // Other dates are unaffected — normal rotation still applies.
  assert.equal(flagOfDay('2026-07-03', POOL, ov), flagOfDay('2026-07-03', POOL));
});

test('override is ignored when the forced code is not in the pool', () => {
  const ov = { '2026-07-02': 'zz' }; // no story → pin cannot be honoured
  assert.equal(flagOfDay('2026-07-02', POOL, ov), flagOfDay('2026-07-02', POOL));
});

test('resolves against the real story pool for the debut window', () => {
  // Integration sanity: the live pool produces a valid pick for a near date.
  const live = storyFlagPool();
  const code = flagOfDay('2026-07-03', live);
  assert.ok(live.some((e) => e.code === code), 'pick is a real story flag');
});
