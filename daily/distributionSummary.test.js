import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatScoreLine } from './distributionSummary.js';

const templates = {
  scoreOnly: 'Your score: {found}/{total}',
  scoreWithAverage: 'Your score: {found}/{total} · Average score: {average}/{total}',
};

test('no stats → score-only template', () => {
  assert.equal(
    formatScoreLine({ found: 5, total: 9, templates }),
    'Your score: 5/9',
  );
});

test('null stats → score-only template', () => {
  assert.equal(
    formatScoreLine({ found: 5, total: 9, stats: null, templates }),
    'Your score: 5/9',
  );
});

test('stats with zero attempts → score-only (no honest comparison yet)', () => {
  assert.equal(
    formatScoreLine({
      found: 5, total: 9, templates,
      stats: { totalAttempts: 0, mean: 0 },
    }),
    'Your score: 5/9',
  );
});

test('stats with attempts → score-with-average template', () => {
  assert.equal(
    formatScoreLine({
      found: 5, total: 9, templates,
      stats: { totalAttempts: 47, mean: 3 },
    }),
    'Your score: 5/9 · Average score: 3/9',
  );
});

test('non-integer mean (defence-in-depth) renders verbatim', () => {
  // Server now rounds mean to nearest integer, but the client renders
  // whatever it receives — proves the template doesn't truncate or
  // re-round if a future server change ever ships fractional values.
  assert.equal(
    formatScoreLine({
      found: 4, total: 6, templates,
      stats: { totalAttempts: 4, mean: 2.5 },
    }),
    'Your score: 4/6 · Average score: 2.5/6',
  );
});

test('zero score is rendered (give-up case)', () => {
  assert.equal(
    formatScoreLine({
      found: 0, total: 9, templates,
      stats: { totalAttempts: 10, mean: 3 },
    }),
    'Your score: 0/9 · Average score: 3/9',
  );
});

test('perfect score is rendered', () => {
  assert.equal(
    formatScoreLine({
      found: 9, total: 9, templates,
      stats: { totalAttempts: 10, mean: 7 },
    }),
    'Your score: 9/9 · Average score: 7/9',
  );
});

test('single attempt still produces with-average line (mean == own score)', () => {
  assert.equal(
    formatScoreLine({
      found: 3, total: 9, templates,
      stats: { totalAttempts: 1, mean: 3 },
    }),
    'Your score: 3/9 · Average score: 3/9',
  );
});

test('unknown {placeholder} is left intact (typo visibility)', () => {
  assert.equal(
    formatScoreLine({
      found: 5, total: 9,
      templates: { scoreOnly: 'wat {nope}/{found}', scoreWithAverage: '' },
    }),
    'wat {nope}/5',
  );
});

test('respects Polish-shaped templates', () => {
  assert.equal(
    formatScoreLine({
      found: 5, total: 9,
      stats: { totalAttempts: 47, mean: 3 },
      templates: {
        scoreOnly: 'Twój wynik: {found}/{total}',
        scoreWithAverage: 'Twój wynik: {found}/{total} · Średni wynik: {average}/{total}',
      },
    }),
    'Twój wynik: 5/9 · Średni wynik: 3/9',
  );
});
