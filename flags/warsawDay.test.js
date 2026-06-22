import test from 'node:test';
import assert from 'node:assert/strict';

import { warsawDayNumber } from './warsawDay.js';

// These cases mirror api/src/lib/warsawDay.test.js (server CJS copy)
// so drift between the two files trips CI loudly. See the comment in
// warsawDay.js explaining why we keep two copies.

/**
 * Asserts the result is a non-null number; lets the rest of the test
 * do arithmetic without null-checks at every site. Throws (loud test
 * failure) if the function returned null — that's a bug in the
 * helper, not a soft data-quality issue.
 *
 * @param {number | null} v
 * @returns {number}
 */
function num(v) {
  assert.ok(typeof v === 'number', 'expected a number, got null');
  return /** @type {number} */ (v);
}

test('warsawDayNumber: same calendar day in Warsaw → same number', () => {
  // Two times on 2026-06-23 Warsaw — both 09:00 local and 23:30 local
  // (UTC offsets differ but the Warsaw calendar day is the same).
  const morning = Date.UTC(2026, 5, 23, 7, 0, 0);  // 09:00 CEST
  const night = Date.UTC(2026, 5, 23, 21, 30, 0);  // 23:30 CEST
  assert.equal(warsawDayNumber(morning), warsawDayNumber(night));
});

test('warsawDayNumber: distinct calendar days → distinct numbers, consecutive days differ by 1', () => {
  const day1 = Date.UTC(2026, 5, 23, 12, 0, 0);
  const day2 = Date.UTC(2026, 5, 24, 12, 0, 0);
  assert.equal(num(warsawDayNumber(day2)) - num(warsawDayNumber(day1)), 1);
});

test('warsawDayNumber: Warsaw-midnight boundary — UTC 22:00 the previous day = Warsaw next day in CEST', () => {
  // In CEST (UTC+2), 2026-06-23 22:01 UTC is 2026-06-24 00:01 Warsaw —
  // the next day. The UTC-time math would put it on day-1, so this
  // pins the timezone-aware behaviour.
  const beforeMidnightUtc = Date.UTC(2026, 5, 23, 21, 59, 0);
  const afterMidnightWarsaw = Date.UTC(2026, 5, 23, 22, 1, 0);
  assert.equal(num(warsawDayNumber(afterMidnightWarsaw)) - num(warsawDayNumber(beforeMidnightUtc)), 1);
});

test('warsawDayNumber: NaN / non-finite / non-number → null (so callers can filter)', () => {
  assert.equal(warsawDayNumber(NaN), null);
  assert.equal(warsawDayNumber(Infinity), null);
  assert.equal(warsawDayNumber(-Infinity), null);
  assert.equal(warsawDayNumber(/** @type {any} */ ('1234')), null);
  assert.equal(warsawDayNumber(/** @type {any} */ (null)), null);
});

test('warsawDayNumber: returns a positive integer for present-day inputs', () => {
  const now = Date.UTC(2026, 5, 23, 12, 0, 0);
  const n = warsawDayNumber(now);
  assert.ok(Number.isInteger(n));
  assert.ok(num(n) > 20_000, `expected > 20,000 days since epoch, got ${n}`);
});
