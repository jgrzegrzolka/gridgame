import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDate } from './migrate-to-dated-catalog.mjs';

test('assignDate: anchor maps to its date', () => {
  assert.equal(assignDate(12), '2026-06-17');
});

test('assignDate: first puzzle maps to launch date', () => {
  assert.equal(assignDate(1), '2026-06-06');
});

test('assignDate: backlog entries walk forward day by day', () => {
  assert.equal(assignDate(13), '2026-06-18');
  assert.equal(assignDate(14), '2026-06-19');
});

test('assignDate: crosses month boundary correctly', () => {
  // n=25 is 13 days past n=12 → 2026-06-30
  assert.equal(assignDate(25), '2026-06-30');
  // n=26 → 2026-07-01
  assert.equal(assignDate(26), '2026-07-01');
});

test('assignDate: handles a long horizon (60+ entries)', () => {
  // n=72 is 60 days past n=12 → 2026-08-16
  assert.equal(assignDate(72), '2026-08-16');
});

test('assignDate: customizable anchor for hypothetical tests', () => {
  assert.equal(assignDate(5, 1, '2027-01-01'), '2027-01-05');
});
