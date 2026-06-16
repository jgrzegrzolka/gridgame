import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warsawClock, daysBetween, expectedTodayN, shouldRun } from './warsawTime.js';

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

test('daysBetween: zero for the same date, positive for forward, negative for backward', () => {
  const launch = { year: 2026, month: 6, day: 6 };
  assert.equal(daysBetween(launch, launch), 0);
  assert.equal(daysBetween(launch, { year: 2026, month: 6, day: 16 }), 10);
  assert.equal(daysBetween({ year: 2026, month: 6, day: 16 }, launch), -10);
});

test('expectedTodayN: launch day in Warsaw is #1', () => {
  // 2026-06-06 00:01 Warsaw (CEST) = 2026-06-05 22:01 UTC
  const now = new Date(Date.UTC(2026, 5, 5, 22, 1));
  assert.equal(expectedTodayN(now), 1);
});

test('expectedTodayN: 10 days after launch is #11', () => {
  // 2026-06-16 12:00 Warsaw (CEST) = 2026-06-16 10:00 UTC
  const now = new Date(Date.UTC(2026, 5, 16, 10, 0));
  assert.equal(expectedTodayN(now), 11);
});

// The summer dual-cron expectation: CEST has 22:05 UTC as Warsaw midnight,
// 23:05 UTC as Warsaw 01:05 — handler runs once.
test('shouldRun (CEST): 22:05 UTC runs, 23:05 UTC skips (wrong cron)', () => {
  const r1 = shouldRun(new Date(Date.UTC(2026, 5, 16, 22, 5)), 11);
  assert.deepEqual(r1, { run: true });
  const r2 = shouldRun(new Date(Date.UTC(2026, 5, 16, 23, 5)), 11);
  assert.equal(r2.run, false);
  assert.match(r2.reason, /Warsaw hour is 1/);
});

// The winter dual-cron expectation: CET has 23:05 UTC as Warsaw midnight,
// 22:05 UTC as Warsaw 23:05 — handler runs once.
test('shouldRun (CET): 23:05 UTC runs, 22:05 UTC skips (wrong cron)', () => {
  const r1 = shouldRun(new Date(Date.UTC(2026, 11, 16, 23, 5)), 11);
  assert.deepEqual(r1, { run: true });
  const r2 = shouldRun(new Date(Date.UTC(2026, 11, 16, 22, 5)), 11);
  assert.equal(r2.run, false);
  assert.match(r2.reason, /Warsaw hour is 23/);
});

// Idempotency: even at the right cron fire, if today's puzzle was already
// promoted, the handler should skip.
test('shouldRun: skips when live already has today\'s puzzle', () => {
  // 2026-06-17 00:05 Warsaw (CEST). Expected today's puzzle is #12.
  const now = new Date(Date.UTC(2026, 5, 16, 22, 5));
  assert.equal(expectedTodayN(now), 12);
  const r = shouldRun(now, 12);
  assert.equal(r.run, false);
  assert.match(r.reason, /already promoted/);
});

// Catalog one behind today's date: the case the handler is meant to fix.
test('shouldRun: runs when live is one entry behind today', () => {
  // 2026-06-17 00:05 Warsaw (CEST). Expected #12; live ends at #11.
  const now = new Date(Date.UTC(2026, 5, 16, 22, 5));
  const r = shouldRun(now, 11);
  assert.deepEqual(r, { run: true });
});
