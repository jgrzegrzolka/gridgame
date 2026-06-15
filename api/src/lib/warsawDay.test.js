const test = require('node:test');
const assert = require('node:assert/strict');
const { warsawDayNumber } = require('./warsawDay');

// 2026-06-15 12:00:00 UTC = 14:00 Warsaw (CEST, UTC+2). Warsaw day = 2026-06-15.
const NOON_2026_06_15_UTC = Date.UTC(2026, 5, 15, 12, 0, 0);

test('warsawDayNumber: midday UTC produces same Warsaw date', () => {
  const expected = Math.floor(Date.UTC(2026, 5, 15) / 86_400_000);
  assert.equal(warsawDayNumber(NOON_2026_06_15_UTC), expected);
});

test('warsawDayNumber: just before midnight UTC in summer is NEXT Warsaw day', () => {
  // 2026-06-14 23:00 UTC = 01:00 Warsaw next day (CEST, UTC+2).
  const ms = Date.UTC(2026, 5, 14, 23, 0, 0);
  const expected = Math.floor(Date.UTC(2026, 5, 15) / 86_400_000);
  assert.equal(warsawDayNumber(ms), expected);
});

test('warsawDayNumber: just before midnight UTC in winter is NEXT Warsaw day', () => {
  // 2026-01-14 23:30 UTC = 00:30 Warsaw next day (CET, UTC+1).
  const ms = Date.UTC(2026, 0, 14, 23, 30, 0);
  const expected = Math.floor(Date.UTC(2026, 0, 15) / 86_400_000);
  assert.equal(warsawDayNumber(ms), expected);
});

test('warsawDayNumber: two submissions on the same Warsaw day return the same number', () => {
  // 09:00 Warsaw and 23:00 Warsaw on 2026-06-15.
  const am = Date.UTC(2026, 5, 15, 7, 0, 0);    // 09:00 CEST
  const pm = Date.UTC(2026, 5, 15, 21, 0, 0);   // 23:00 CEST
  assert.equal(warsawDayNumber(am), warsawDayNumber(pm));
});

test('warsawDayNumber: consecutive Warsaw days produce consecutive integers', () => {
  // 12:00 Warsaw on 2026-06-15 and 12:00 Warsaw on 2026-06-16.
  const day1 = Date.UTC(2026, 5, 15, 10, 0, 0); // 12:00 CEST
  const day2 = Date.UTC(2026, 5, 16, 10, 0, 0);
  assert.equal(warsawDayNumber(day2) - warsawDayNumber(day1), 1);
});

test('warsawDayNumber: DST spring-forward (last Sunday of March 2026)', () => {
  // 2026-03-29 is the last Sunday of March → CET → CEST at 02:00 local.
  // Before: 01:00 Warsaw = 00:00 UTC, day = 2026-03-29.
  // After:  03:00 Warsaw = 01:00 UTC, day still = 2026-03-29.
  const before = Date.UTC(2026, 2, 29, 0, 0, 0);
  const after = Date.UTC(2026, 2, 29, 1, 0, 0);
  const expected = Math.floor(Date.UTC(2026, 2, 29) / 86_400_000);
  assert.equal(warsawDayNumber(before), expected);
  assert.equal(warsawDayNumber(after), expected);
});

test('warsawDayNumber: DST fall-back (last Sunday of October 2026)', () => {
  // 2026-10-25 is the last Sunday of October → CEST → CET at 03:00 local.
  // Midday safely produces the right Warsaw date in either offset.
  const ms = Date.UTC(2026, 9, 25, 10, 0, 0);
  const expected = Math.floor(Date.UTC(2026, 9, 25) / 86_400_000);
  assert.equal(warsawDayNumber(ms), expected);
});

test('warsawDayNumber: invalid inputs return null', () => {
  assert.equal(warsawDayNumber(NaN), null);
  assert.equal(warsawDayNumber(Infinity), null);
  assert.equal(warsawDayNumber(-Infinity), null);
  assert.equal(warsawDayNumber(/** @type {any} */ ('string')), null);
  assert.equal(warsawDayNumber(/** @type {any} */ (null)), null);
  assert.equal(warsawDayNumber(/** @type {any} */ (undefined)), null);
});
