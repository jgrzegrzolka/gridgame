import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuizShareTitle } from './quizShareTitle.js';

const TPL = 'Yet Another Quiz — {variant} {mode} — {score}';

test('buildQuizShareTitle: timed mode renders raw count', () => {
  assert.equal(
    buildQuizShareTitle({
      template: TPL, variant: 'Europe', mode: '60s',
      timed: true, correct: 23, target: 0,
    }),
    'Yet Another Quiz — Europe 60s — 23',
  );
});

test('buildQuizShareTitle: count mode renders correct/target', () => {
  assert.equal(
    buildQuizShareTitle({
      template: TPL, variant: 'Africa', mode: 'all',
      timed: false, correct: 47, target: 54,
    }),
    'Yet Another Quiz — Africa all — 47/54',
  );
});

test('buildQuizShareTitle: zero score in both modes', () => {
  assert.equal(
    buildQuizShareTitle({
      template: TPL, variant: 'Asia', mode: '60s',
      timed: true, correct: 0, target: 0,
    }),
    'Yet Another Quiz — Asia 60s — 0',
  );
  assert.equal(
    buildQuizShareTitle({
      template: TPL, variant: 'Oceania', mode: 'all',
      timed: false, correct: 0, target: 14,
    }),
    'Yet Another Quiz — Oceania all — 0/14',
  );
});

test('buildQuizShareTitle: localized labels pass through unchanged', () => {
  assert.equal(
    buildQuizShareTitle({
      template: 'Yet Another Quiz — {variant} {mode} — {score}',
      variant: 'Europa', mode: 'wszystkie',
      timed: false, correct: 30, target: 50,
    }),
    'Yet Another Quiz — Europa wszystkie — 30/50',
  );
});
