import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warsawClock, warsawToday } from './warsawTime.js';

// 22:05 UTC during CEST (June, summer) → 00:05 Warsaw next day
test('warsawClock: 22:05 UTC mid-June (CEST) is 00:05 Warsaw the next day', () => {
  const now = new Date(Date.UTC(2026, 5, 16, 22, 5));
  assert.deepEqual(warsawClock(now), {
    year: 2026, month: 6, day: 17, hour: 0, minute: 5,
  });
});

// 22:05 UTC during CET (December, winter) → 23:05 Warsaw same day
test('warsawClock: 22:05 UTC mid-December (CET) is 23:05 Warsaw same day', () => {
  const now = new Date(Date.UTC(2026, 11, 16, 22, 5));
  assert.deepEqual(warsawClock(now), {
    year: 2026, month: 12, day: 16, hour: 23, minute: 5,
  });
});

// 23:05 UTC during CEST (June) → 01:05 Warsaw next day
test('warsawClock: 23:05 UTC mid-June (CEST) is 01:05 Warsaw the next day', () => {
  const now = new Date(Date.UTC(2026, 5, 16, 23, 5));
  assert.deepEqual(warsawClock(now), {
    year: 2026, month: 6, day: 17, hour: 1, minute: 5,
  });
});

// 23:05 UTC during CET (December) → 00:05 Warsaw next day
test('warsawClock: 23:05 UTC mid-December (CET) is 00:05 Warsaw the next day', () => {
  const now = new Date(Date.UTC(2026, 11, 16, 23, 5));
  assert.deepEqual(warsawClock(now), {
    year: 2026, month: 12, day: 17, hour: 0, minute: 5,
  });
});

test('warsawToday: zero-pads month and day', () => {
  // 2026-02-03 12:00 UTC = 2026-02-03 13:00 Warsaw (CET)
  const now = new Date(Date.UTC(2026, 1, 3, 12, 0));
  assert.equal(warsawToday(now), '2026-02-03');
});

test('warsawToday: rolls over at Warsaw midnight, not UTC midnight', () => {
  // 23:30 UTC mid-June is already 01:30 next day in Warsaw (CEST)
  const beforeMidnightUtc = new Date(Date.UTC(2026, 5, 16, 23, 30));
  assert.equal(warsawToday(beforeMidnightUtc), '2026-06-17');
});
