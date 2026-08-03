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

test('a clean sweep leads with the score, and demotes the clock to the line below', () => {
  // The clock led here for a while, on the reasoning that the score had
  // become a constant. It made the hardest screen to earn the one screen
  // that measured you differently from every other.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 44, target: 44,
    budgetUsed: 47_312, gaveUp: false,
    best: { score: 44, time: 53_467 },
  });
  assert.equal(v.clearedAll, true);
  assert.equal(v.headline, '44 / 44');
  assert.equal(v.detail, '0:47.3');
  assert.equal(v.recordScore, null, 'the record is a time here, not a score');
  assert.equal(v.recordTime, '0:53.5');
});

test('a clean sweep counts its score up — and never its time', () => {
  // A stopwatch ticking up to a finishing time implies a run that did not
  // happen. Counts count; clocks arrive whole.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 44, target: 44,
    budgetUsed: 47_312, gaveUp: false,
    best: { score: 44, time: 53_467 },
  });
  assert.equal(v.countUpTo, 44);
  assert.equal(`${v.countUpTo}${v.headlineSuffix}`, v.headline);
  assert.ok(!/\d:\d/.test(String(v.countUpTo)), 'a time must never be the count-up target');
});

test('a clean sweep that IS the record drops the beaten time', () => {
  // The time you just set is printed at the head of this line and the badge
  // says it is new; quoting the old one alongside is noise.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 44, target: 44,
    budgetUsed: 47_312, gaveUp: false, isNew: true,
    best: { score: 44, time: 47_312 },
  });
  assert.equal(v.detail, '0:47.3');
  assert.equal(v.recordTime, null);
  assert.equal(v.recordScore, null);
});

// ---- quizResultView: the ordinary 60s screen ----

test('an ordinary 60s round leads with a bare count — no denominator', () => {
  // Nobody approaches the pool in a minute, so "38/195" renders a good round
  // as a fraction of a percent.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 38, target: 195,
    budgetUsed: BUDGET, gaveUp: false,
    best: { score: 51, time: BUDGET },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '38');
  assert.equal(v.headlineSuffix, '');
  assert.equal(v.countUpTo, 38);
  assert.equal(v.detail, null);
  assert.equal(v.recordScore, '51/195');
});

test('the view carries no colour at all', () => {
  // The headline used to be tinted by how the round went: it called a 38
  // under a best of 51 "good", and put green on screen every round, when
  // green now has exactly one job on this screen — the record badge.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 38, target: 195,
    budgetUsed: BUDGET, gaveUp: false,
    best: { score: 51, time: BUDGET },
  });
  assert.ok(!('colorRatio' in v), 'colorRatio is back — the hero is ink now');
});

test('a personal best drops the record text and leaves the badge to say it', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 53, target: 195,
    budgetUsed: BUDGET, gaveUp: false, isNew: true,
    best: { score: 53, time: BUDGET },
  });
  assert.equal(v.recordScore, null, '"record 53" under a 53 restates the number above it');
  assert.equal(v.recordTime, null);
  assert.equal(v.headline, '53');
});

test('an ordinary 60s round carries no time on the record line', () => {
  // It would always read 1:00.000 — an unfinished pool burns the whole
  // budget by definition, so the number is a constant, not information.
  const v = quizResultView({
    modeKey: '60s', answeredCount: 38, target: 195,
    budgetUsed: BUDGET, gaveUp: false,
    best: { score: 51, time: BUDGET },
  });
  assert.equal(v.recordTime, null);
});

test('a 60s round with no picks at all still renders a headline', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 0, target: 195,
    budgetUsed: BUDGET, gaveUp: false,
    best: { score: 0, time: BUDGET },
  });
  assert.equal(v.headline, '0');
  assert.equal(v.countUpTo, 0);
});

// ---- quizResultView: the untimed screen ----

test('the untimed mode reads against the pool, and keeps its time', () => {
  // One-shot per question, so correct + wrong = target and the score means
  // "out of the pool". Time is the only thing separating two equal scores
  // here, which is why it survives on this branch and not on the 60s one.
  const v = quizResultView({
    modeKey: 'all', answeredCount: 40, target: 44,
    budgetUsed: 0, gaveUp: false,
    best: { score: 4, time: 80_512 },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '40/44');
  assert.equal(v.headlineSuffix, '/44', 'the count-up has to keep the denominator');
  assert.equal(v.detail, null);
  // best.score is the MISTAKE count in this mode; the label flips it back.
  assert.equal(v.recordScore, '40/44');
  assert.equal(v.recordTime, '1:20.5');
});

test('a perfect untimed round is NOT the clean-sweep screen', () => {
  // No clock was beaten, so this is the ordinary board — and the
  // denominator stays, because here you really did go through the pool.
  const v = quizResultView({
    modeKey: 'all', answeredCount: 44, target: 44,
    budgetUsed: 0, gaveUp: false,
    best: { score: 0, time: 60_000 },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '44/44');
});

// ---- coverage ----

test('every mode produces a usable view — no mode falls through to undefined', () => {
  // The rank-badge bug (#51 shipped numberless because a badge read
  // `metric === 'population'`) is the reason this walks the registry instead
  // of naming the two modes it happens to know about today.
  for (const modeKey of KNOWN_MODES) {
    const v = quizResultView({
      modeKey, answeredCount: 10, target: 44,
      budgetUsed: 30_000, gaveUp: false,
      best: { score: 10, time: 30_000 },
    });
    assert.equal(typeof v.headline, 'string', `${modeKey}: no headline`);
    assert.ok(v.headline.length > 0, `${modeKey}: empty headline`);
    assert.equal(typeof v.clearedAll, 'boolean', `${modeKey}: clearedAll not a boolean`);
    // Every headline this screen can show is a count, so every one of them
    // is safe to animate — and `headline` must be where the count lands, or
    // the number would jump at the end of the count-up.
    assert.equal(typeof v.countUpTo, 'number', `${modeKey}: no count-up target`);
    assert.equal(`${v.countUpTo}${v.headlineSuffix}`, v.headline, `${modeKey}: count-up lands elsewhere`);
  }
});

test('giving up still produces the ordinary screen, not a congratulation', () => {
  const v = quizResultView({
    modeKey: '60s', answeredCount: 44, target: 44,
    budgetUsed: 12_000, gaveUp: true,
    best: { score: 44, time: 12_000 },
  });
  assert.equal(v.clearedAll, false);
  assert.equal(v.headline, '44');
});
