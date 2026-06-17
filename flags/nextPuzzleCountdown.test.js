import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextWarsawMidnightFrom,
  msUntilNextWarsawMidnight,
  formatCountdown,
} from './nextPuzzleCountdown.js';

// --- nextWarsawMidnightFrom ----------------------------------------

// Mid-June (CEST = UTC+2). 12:00 UTC = 14:00 Warsaw. Next midnight =
// 00:00 next day Warsaw = 22:00 UTC.
test('nextWarsawMidnight: CEST afternoon → next 22:00 UTC', () => {
  const now = new Date(Date.UTC(2026, 5, 17, 12, 0));
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-06-17T22:00:00.000Z');
});

// Mid-December (CET = UTC+1). 12:00 UTC = 13:00 Warsaw. Next midnight =
// 00:00 next day Warsaw = 23:00 UTC.
test('nextWarsawMidnight: CET afternoon → next 23:00 UTC', () => {
  const now = new Date(Date.UTC(2026, 11, 16, 12, 0));
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-12-16T23:00:00.000Z');
});

// CEST, just before midnight Warsaw (22:00 UTC = 00:00 Warsaw next day).
// At 21:59 UTC the next midnight is one minute away.
test('nextWarsawMidnight: 1 min before Warsaw midnight (CEST)', () => {
  const now = new Date(Date.UTC(2026, 5, 17, 21, 59));
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-06-17T22:00:00.000Z');
});

// At exact Warsaw midnight, the function returns the FOLLOWING midnight
// (24h later), never the present moment. Caller wants "next future
// midnight," not "right now."
test('nextWarsawMidnight: at midnight Warsaw → 24h later', () => {
  const midnight = new Date(Date.UTC(2026, 5, 17, 22, 0)); // 00:00 Warsaw 6/18 (CEST)
  const next = nextWarsawMidnightFrom(midnight);
  // Should be 00:00 Warsaw 6/19 = 22:00 UTC 6/18
  assert.equal(next.toISOString(), '2026-06-18T22:00:00.000Z');
});

// Crossing month boundary: late June Warsaw → early July midnight.
test('nextWarsawMidnight: rolls over month correctly', () => {
  // 22:00 UTC on 6/30 = 00:00 Warsaw 7/1 (already on the boundary)
  // 21:59 UTC on 6/30 = 23:59 Warsaw 6/30 → next midnight is 7/1 at 22:00 UTC
  const now = new Date(Date.UTC(2026, 5, 30, 21, 59));
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-06-30T22:00:00.000Z');
});

// Spring DST transition: 2026-03-29 is the last Sunday of March, when
// Warsaw springs forward from 02:00 → 03:00. At 22:00 UTC on Sat
// 3/28 (= 23:00 Warsaw CET, still pre-DST), the next Warsaw midnight
// is 1 hour away at 23:00 UTC = 00:00 Warsaw 3/29 (still CET).
test('nextWarsawMidnight: spring DST — Sat night → Sun midnight (still CET)', () => {
  const now = new Date(Date.UTC(2026, 2, 28, 22, 0));
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-03-28T23:00:00.000Z');
});

// After the spring DST transition, Warsaw is CEST. Asking for "next
// midnight" from 12:00 UTC on the DST-Sunday means the answer is
// 22:00 UTC (00:00 CEST 3/30), not 23:00 UTC (which would still be
// CET arithmetic).
test('nextWarsawMidnight: spring DST — afternoon after switch uses CEST offset', () => {
  const now = new Date(Date.UTC(2026, 2, 29, 12, 0)); // post-spring-forward
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-03-29T22:00:00.000Z');
});

// Fall DST transition: 2026-10-25 falls back from CEST → CET at 03:00.
// On the morning of 10/25, asking "next midnight" from 12:00 UTC =
// 13:00 Warsaw (now CET) means next midnight is 11h away = 23:00 UTC.
test('nextWarsawMidnight: fall DST — afternoon after switch uses CET offset', () => {
  const now = new Date(Date.UTC(2026, 9, 25, 12, 0));
  const next = nextWarsawMidnightFrom(now);
  assert.equal(next.toISOString(), '2026-10-25T23:00:00.000Z');
});

// --- msUntilNextWarsawMidnight -------------------------------------

test('msUntilNextWarsawMidnight: 30 minutes', () => {
  const now = new Date(Date.UTC(2026, 5, 17, 21, 30));
  assert.equal(msUntilNextWarsawMidnight(now), 30 * 60_000);
});

test('msUntilNextWarsawMidnight: just past midnight returns ~24h', () => {
  const now = new Date(Date.UTC(2026, 5, 17, 22, 0, 0, 100)); // 100ms past
  assert.equal(msUntilNextWarsawMidnight(now), 86_400_000 - 100);
});

// --- formatCountdown -----------------------------------------------

test('formatCountdown: hours + minutes', () => {
  assert.equal(formatCountdown(4 * 3600_000 + 32 * 60_000, 'en'), '4h 32m');
});

test('formatCountdown: hours + minutes — Polish uses the same compact form (not "godz.")', () => {
  // Locked: the Polish "X godz. Y min" form is too wide for the
  // result-panel slot. Both languages share the compact "Xh Ym" form.
  assert.equal(formatCountdown(4 * 3600_000 + 32 * 60_000, 'pl'), '4h 32m');
});

test('formatCountdown: exact-hour omits minutes — same form both langs', () => {
  assert.equal(formatCountdown(3 * 3600_000, 'en'), '3h');
  assert.equal(formatCountdown(3 * 3600_000, 'pl'), '3h');
});

test('formatCountdown: sub-hour shows minutes only — same form both langs', () => {
  assert.equal(formatCountdown(42 * 60_000, 'en'), '42 min');
  assert.equal(formatCountdown(42 * 60_000, 'pl'), '42 min');
});

test('formatCountdown: sub-minute shows "less than a minute"', () => {
  assert.equal(formatCountdown(30_000, 'en'), 'less than a minute');
  assert.equal(formatCountdown(30_000, 'pl'), 'mniej niż minuta');
});

test('formatCountdown: zero or past returns "now"', () => {
  assert.equal(formatCountdown(0, 'en'), 'now');
  assert.equal(formatCountdown(-1000, 'pl'), 'teraz');
});

test('formatCountdown: defaults to en when lang omitted', () => {
  assert.equal(formatCountdown(60_000), '1 min');
});
