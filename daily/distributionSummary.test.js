import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatStatsHeadline } from './distributionSummary.js';

const template = 'Average today: {average}/{total}';

test('null stats → null', () => {
  assert.equal(formatStatsHeadline({ stats: null, totalCount: 9, template }), null);
});

test('undefined stats → null', () => {
  assert.equal(formatStatsHeadline({ stats: undefined, totalCount: 9, template }), null);
});

test('totalAttempts === 0 → null (no honest comparison yet)', () => {
  const stats = { totalAttempts: 0, median: 0 };
  assert.equal(formatStatsHeadline({ stats, totalCount: 9, template }), null);
});

test('interpolates {average} {total} into the template', () => {
  const stats = { totalAttempts: 10, median: 3 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template }),
    'Average today: 3/9',
  );
});

test('non-integer median (e.g. 2.5) renders verbatim', () => {
  const stats = { totalAttempts: 4, median: 2.5 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 6, template }),
    'Average today: 2.5/6',
  );
});

test('totalAttempts >= 1 still produces output (single-row case after own submission)', () => {
  const stats = { totalAttempts: 1, median: 0 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template }),
    'Average today: 0/9',
  );
});

test('unknown {placeholder} in template is left intact (typo visibility)', () => {
  const stats = { totalAttempts: 5, median: 2 };
  assert.equal(
    formatStatsHeadline({ stats, totalCount: 9, template: 'wat {nope}/{average}' }),
    'wat {nope}/2',
  );
});

test('respects Polish-shaped templates', () => {
  const stats = { totalAttempts: 47, median: 3 };
  assert.equal(
    formatStatsHeadline({
      stats, totalCount: 9,
      template: 'Średnio dziś: {average}/{total}',
    }),
    'Średnio dziś: 3/9',
  );
});
