import test from 'node:test';
import assert from 'node:assert/strict';

import { madeAnyQuizPick } from './quizEngagement.js';

test('madeAnyQuizPick: 1 correct pick → true (engaged)', () => {
  assert.equal(madeAnyQuizPick({ answeredCount: 1, wrongCount: 0 }), true);
});

test('madeAnyQuizPick: 1 wrong pick → true (engaged; tried and missed)', () => {
  assert.equal(madeAnyQuizPick({ answeredCount: 0, wrongCount: 1 }), true);
});

test('madeAnyQuizPick: zero picks (neither right nor wrong) → false (did not engage)', () => {
  // The case the gate exists to catch: immediate give-up at second 1,
  // OR a player who sat through 60s without touching anything. Neither
  // is "playing a quiz" by the spirit of the streak / attempts metrics.
  assert.equal(madeAnyQuizPick({ answeredCount: 0, wrongCount: 0 }), false);
});

test('madeAnyQuizPick: any combination with at least one pick → true', () => {
  // Mixed-outcome rounds (some right, some wrong) clearly count.
  assert.equal(madeAnyQuizPick({ answeredCount: 5, wrongCount: 3 }), true);
  assert.equal(madeAnyQuizPick({ answeredCount: 0, wrongCount: 5 }), true);
  assert.equal(madeAnyQuizPick({ answeredCount: 5, wrongCount: 0 }), true);
});

test('madeAnyQuizPick: non-integer / negative inputs treated as zero (defensive)', () => {
  // Should never happen in production (the counts come from the round
  // engine, which always emits non-negative integers), but the gate
  // shouldn't crash or false-positive on malformed input.
  assert.equal(madeAnyQuizPick({ answeredCount: -1, wrongCount: 0 }), false);
  assert.equal(madeAnyQuizPick({ answeredCount: 0, wrongCount: -1 }), false);
  assert.equal(madeAnyQuizPick({ answeredCount: 1.5, wrongCount: 0 }), false);
  assert.equal(madeAnyQuizPick({ answeredCount: /** @type {any} */ ('NaN'), wrongCount: 0 }), false);
  assert.equal(madeAnyQuizPick({ answeredCount: NaN, wrongCount: NaN }), false);
});

test('madeAnyQuizPick: negative-and-positive combination → counts only the positive', () => {
  // wrongCount=-1 reads as 0; answeredCount=2 reads as 2; total = 2 > 0 → true.
  assert.equal(madeAnyQuizPick({ answeredCount: 2, wrongCount: -1 }), true);
});
