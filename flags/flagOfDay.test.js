import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flagOfDay } from './flagOfDay.js';

const POOL = ['gb', 'gb-eng', 'gb-sct', 'gb-wls', 'ie', 'ch', 'gr', 'pl'];

test('empty pool yields null', () => {
  assert.equal(flagOfDay('2026-07-02', []), null);
  assert.equal(flagOfDay('2026-07-02', /** @type {any} */ (null)), null);
});

test('single-flag pool always returns that flag', () => {
  for (const d of ['2026-01-01', '2026-07-02', '2030-12-31']) {
    assert.equal(flagOfDay(d, ['pl']), 'pl');
  }
});

test('deterministic: same date + pool → same flag', () => {
  assert.equal(flagOfDay('2026-07-02', POOL), flagOfDay('2026-07-02', POOL));
});

test('everyone sees a flag that is actually in the pool', () => {
  for (let i = 0; i < 40; i++) {
    const d = `2026-07-${String((i % 28) + 1).padStart(2, '0')}`;
    assert.ok(POOL.includes(/** @type {string} */ (flagOfDay(d, POOL))));
  }
});

test('order-independent: input pool order does not change the pick', () => {
  const reversed = POOL.slice().reverse();
  const shuffledInput = ['gr', 'pl', 'gb', 'ch', 'ie', 'gb-wls', 'gb-sct', 'gb-eng'];
  for (const d of ['2026-07-02', '2026-08-15', '2027-03-09']) {
    const a = flagOfDay(d, POOL);
    assert.equal(flagOfDay(d, reversed), a);
    assert.equal(flagOfDay(d, shuffledInput), a);
  }
});

test('perfect coverage: every flag appears exactly once per N-day cycle', () => {
  // A cycle is `pool.length` consecutive days. Walk one full cycle from a
  // known cycle boundary and assert each code shows up exactly once.
  const n = POOL.length;
  // Find a date whose dayNumber is a multiple of n so we start at pos 0.
  // 2026-01-01 is dayNumber 20454; scan forward for a cycle start.
  const start = new Date(Date.UTC(2026, 0, 1));
  let cursor = start;
  for (let guard = 0; guard < n; guard++) {
    const iso = cursor.toISOString().slice(0, 10);
    // Recompute the same dayNumber the module uses and stop at a boundary.
    const dn = Math.floor(Date.UTC(2026, 0, 1 + guard) / 86400000);
    if (dn % n === 0) { cursor = new Date(Date.UTC(2026, 0, 1 + guard)); break; }
    void iso;
  }
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const d = new Date(cursor.getTime() + i * 86400000).toISOString().slice(0, 10);
    seen.add(flagOfDay(d, POOL));
  }
  assert.equal(seen.size, n, 'each of the N days showed a distinct flag');
  for (const code of POOL) assert.ok(seen.has(code), `${code} appeared in the cycle`);
});

test('editorial override pins a specific date to a specific flag', () => {
  const ov = { '2026-07-02': 'pl' };
  assert.equal(flagOfDay('2026-07-02', POOL, ov), 'pl');
  // Other dates are unaffected — normal rotation still applies.
  assert.equal(flagOfDay('2026-07-03', POOL, ov), flagOfDay('2026-07-03', POOL));
});

test('override is ignored when the forced code is not in the pool', () => {
  // 'zz' has no story, so the pin can not be honoured — fall back to rotation.
  const ov = { '2026-07-02': 'zz' };
  assert.equal(flagOfDay('2026-07-02', POOL, ov), flagOfDay('2026-07-02', POOL));
});

test('consecutive cycles use different shuffles (not the same order every time)', () => {
  const n = POOL.length;
  // Two full cycles back to back; the day-0 pick of each cycle should differ
  // for at least one cycle pair (a fixed order would make them identical).
  const picks = [];
  for (let c = 0; c < 4; c++) {
    const dn = c * n; // dayNumber at each cycle's pos 0
    const d = new Date(dn * 86400000).toISOString().slice(0, 10);
    picks.push(flagOfDay(d, POOL));
  }
  assert.ok(new Set(picks).size > 1, 'cycle-start flag is not constant across cycles');
});
