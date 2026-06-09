import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatStatsHeadline } from './distributionSummary.js';

const template = 'Median today: {median}/{total} — {topPct}% got everything';

test('null stats returns null (fetch failed)', () => {
  assert.equal(formatStatsHeadline({ stats: null, totalCount: 9, template }), null);
});

test('undefined stats returns null', () => {
  assert.equal(formatStatsHeadline({ stats: undefined, totalCount: 9, template }), null);
});

test('totalAttempts === 0 returns null (no honest comparison yet)', () => {
  const stats = { totalAttempts: 0, median: 0, topPct: 0, perCodeFinds: {} };
  assert.equal(formatStatsHeadline({ stats, totalCount: 9, template }), null);
});

test('interpolates {median} {total} {topPct} into the template', () => {
  const stats = { totalAttempts: 47, median: 3, topPct: 12 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template }),
    'Median today: 3/9 — 12% got everything',
  );
});

test('supports {attempts} placeholder', () => {
  const stats = { totalAttempts: 47, median: 3, topPct: 12 };
  assert.equal(
    formatStatsHeadline({
      stats, totalCount: 9,
      template: 'Across {attempts} attempts, median: {median}/{total}',
    }),
    'Across 47 attempts, median: 3/9',
  );
});

test('unknown {placeholder} is left intact (typo visibility)', () => {
  const stats = { totalAttempts: 1, median: 2, topPct: 0 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template: 'value: {nope}/{median}' }),
    'value: {nope}/2',
  );
});

test('non-integer median (e.g. 2.5) renders verbatim', () => {
  const stats = { totalAttempts: 4, median: 2.5, topPct: 0 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template }),
    'Median today: 2.5/9 — 0% got everything',
  );
});

test('respects Polish-shaped templates with same placeholders', () => {
  const stats = { totalAttempts: 47, median: 3, topPct: 12 };
  assert.equal(
    formatStatsHeadline({
      stats, totalCount: 9,
      template: 'Mediana dziś: {median}/{total} — {topPct}% zdobyło wszystko',
    }),
    'Mediana dziś: 3/9 — 12% zdobyło wszystko',
  );
});

test('topPct=100 is rendered (everybody got perfect — flatters when the player is part of "everybody")', () => {
  const stats = { totalAttempts: 5, median: 9, topPct: 100 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template }),
    'Median today: 9/9 — 100% got everything',
  );
});

test('totalAttempts >= 1 still produces output (single-row case after own submission)', () => {
  const stats = { totalAttempts: 1, median: 0, topPct: 0 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template }),
    'Median today: 0/9 — 0% got everything',
  );
});
