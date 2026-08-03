import test from 'node:test';
import assert from 'node:assert/strict';

import { clearedWholePool, quizResultView, KNOWN_MODES } from './resultView.js';
import { MODES } from '../flags/quiz.js';

/**
 * The 60s budget, read off the mode table rather than hardcoded, so these
 * tests keep meaning "exactly the budget" if it is ever retuned. The narrowing
 * is because `Mode` is a union and only the timed arm carries `budgetMs`.
 */
const timedMode = MODES['60s'];
const BUDGET = timedMode.kind === 'timed' ? timedMode.budgetMs : 0;

// ---- clearedWholePool ----

test('clearedWholePool is true only when the pool fell before the clock did', () => {
  const base = { modeKey: '60s', answeredCount: 44, target: 44, budgetUsed: 47_312, gaveUp: false };
  assert.equal(clearedWholePool(base), true);
});

test('clearedWholePool is false when the budget was fully spent', () => {
  // Clearing the pool on the very last tick records a time of exactly the
  // budget — the same number every timed-out round produces. It distinguishes
  // nothing, so the time-as-hero screen must not claim it does.
  assert.equal(clearedWholePool({
    modeKey: '60s', answeredCount: 44, target: 44, budgetUsed: BUDGET, gaveUp: false,
  }), false);
});

test('clearedWholePool is false for an unfinished pool', () => {
  assert.equal(clearedWholePool({
    modeKey: '60s', answeredCount: 43, target: 44, budgetUsed: BUDGET, gaveUp: false,
  }), false);
});

test('clearedWholePool is false after a give-up', () => {
  // Belt-and-braces: giving up cannot leave answeredCount at target today,
  // but a screen that congratulates a quitter would be a bad way to find out
  // that changed.
  assert.equal(clearedWholePool({
    modeKey: '60s', answeredCount: 44, target: 44, budgetUsed: 20_000, gaveUp: true,
  }), false);
});

test('clearedWholePool is false in the untimed mode — there is no clock to beat', () => {
  assert.equal(clearedWholePool({
    modeKey: 'all', answeredCount: 44, target: 44, budgetUsed: 0, gaveUp: false,
  }), false);
});

test('clearedWholePool is false for an empty pool', () => {
  // target 0 with answeredCount 0 satisfies ">= target" arithmetically; there
  // is nothing to have cleared.
  assert.equal(clearedWholePool({
    modeKey: '60s', answeredCount: 0, target: 0, budgetUsed: 1_000, gaveUp: false,
  }), false);
});

// ---- quizResultView: the clean-sweep screen ----

test('a clean sweep leads with the clock, and demotes the score to the line below', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 44, wrongCount: 3, target: 44,
    budgetUsed: 47_312, elapsedMs: 47_312, gaveUp: false,
    best: { score: 44, time: 53_467 },
  });
  assert.equal(v.clearedAll, true);
  assert.equal(v.headline, '0:47.312');
  assert.equal(v.detail, '44 / 44');
  assert.equal(v.recordScore, null, 'the record is a time here, not a score');
  assert.equal(v.recordTime, '0:53.467');
});

test('a clean sweep is full green regardless of how many were fumbled on the way', () => {
  // Wrong picks in 60s cost seconds, not score — the cabinet requeues them
  // until they are answered. Tinting the ceiling by accuracy would render the
  // best possible outcome in a mediocre colour.
  const messy = quizResultView({
    modeKey: '60s', answeredCount: 44, wrongCount: 20, target: 44,
    budgetUsed: 55_000, elapsedMs: 55_000, gaveUp: false,
    best: { score: 44, time: 55_000 },
  });
  assert.equal(messy.clearedAll, true);
  assert.equal(messy.colorRatio, 1);
});

// ---- quizResultView: the ordinary 60s screen ----

test('an ordinary 60s round leads with the score and tints it by accuracy', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 38, wrongCount: 2, target: 195,
    budgetUsed: BUDGET, elapsedMs: BUDGET, gaveUp: false,
    best: { score: 51, time: BUDGET },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '38');
  assert.equal(v.colorRatio, 38 / 40);
  assert.equal(v.detail, null);
  assert.equal(v.recordScore, '51/195');
});

test('an ordinary 60s round carries no time on the record line', () => {
  // It would always read 1:00.000 — an unfinished pool burns the whole
  // budget by definition, so the number is a constant, not information.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 38, wrongCount: 2, target: 195,
    budgetUsed: BUDGET, elapsedMs: BUDGET, gaveUp: false,
    best: { score: 51, time: BUDGET },
  });
  assert.equal(v.recordTime, null);
});

test('a 60s round with no picks at all is red, not NaN', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 0, wrongCount: 0, target: 195,
    budgetUsed: BUDGET, elapsedMs: BUDGET, gaveUp: false,
    best: { score: 0, time: BUDGET },
  });
  assert.equal(v.colorRatio, 0);
  assert.equal(v.headline, '0');
});

// ---- quizResultView: the untimed screen ----

test('the untimed mode reads against the pool, and keeps its time', () => {
  // One-shot per question, so correct + wrong = target and the score means
  // "out of the pool". Time is the only thing separating two equal scores
  // here, which is why it survives on this branch and not on the 60s one.
  const v = quizResultView({
    modeKey: 'all', answeredCount: 40, wrongCount: 4, target: 44,
    budgetUsed: 0, elapsedMs: 83_400, gaveUp: false,
    best: { score: 4, time: 80_512 },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '40/44');
  assert.equal(v.detail, null);
  // best.score is the MISTAKE count in this mode; the label flips it back.
  assert.equal(v.recordScore, '40/44');
  assert.equal(v.recordTime, '1:20.512');
});

test('a perfect untimed round is full green but is NOT the clean-sweep screen', () => {
  // No clock was beaten, so the time cannot be the hero — the score stays it.
  const v = quizResultView({
    modeKey: 'all', answeredCount: 44, wrongCount: 0, target: 44,
    budgetUsed: 0, elapsedMs: 60_000, gaveUp: false,
    best: { score: 0, time: 60_000 },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.colorRatio, 1);
  assert.equal(v.headline, '44/44');
});

// ---- coverage ----

test('every mode produces a usable view — no mode falls through to undefined', () => {
  // The rank-badge bug (#51 shipped numberless because a badge read
  // `metric === 'population'`) is the reason this walks the registry instead
  // of naming the two modes it happens to know about today.
  for (const modeKey of KNOWN_MODES) {
    const v = quizResultView({
      modeKey, answeredCount: 10, wrongCount: 1, target: 44,
      budgetUsed: 30_000, elapsedMs: 30_000, gaveUp: false,
      best: { score: 10, time: 30_000 },
    });
    assert.equal(typeof v.headline, 'string', `${modeKey}: no headline`);
    assert.ok(v.headline.length > 0, `${modeKey}: empty headline`);
    assert.ok(v.colorRatio >= 0 && v.colorRatio <= 1, `${modeKey}: ratio out of range`);
    assert.equal(typeof v.clearedAll, 'boolean', `${modeKey}: clearedAll not a boolean`);
  }
});

test('giving up still produces the ordinary screen, not a congratulation', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 44, wrongCount: 0, target: 44,
    budgetUsed: 12_000, elapsedMs: 12_000, gaveUp: true,
    best: { score: 44, time: 12_000 },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '44');
});
