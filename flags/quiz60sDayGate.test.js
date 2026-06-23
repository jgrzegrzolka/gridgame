import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRecordQuiz60sDay } from './quiz60sDayGate.js';

test('shouldRecordQuiz60sDay: 1 correct pick → true (engaged)', () => {
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 1, wrongCount: 0 }), true);
});

test('shouldRecordQuiz60sDay: 1 wrong pick → true (engaged; tried and missed)', () => {
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 0, wrongCount: 1 }), true);
});

test('shouldRecordQuiz60sDay: zero picks (neither right nor wrong) → false (did not engage)', () => {
  // The case this gate exists to catch: immediate give-up at second 1,
  // OR a player who sat through 60s without touching anything. Neither
  // is "playing a quiz today" by the spirit of the streak achievements.
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 0, wrongCount: 0 }), false);
});

test('shouldRecordQuiz60sDay: any combination with at least one pick → true', () => {
  // Mixed-outcome rounds (some right, some wrong) clearly count.
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 5, wrongCount: 3 }), true);
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 0, wrongCount: 5 }), true);
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 5, wrongCount: 0 }), true);
});

test('shouldRecordQuiz60sDay: non-integer / negative inputs treated as zero (defensive)', () => {
  // Should never happen in production (the counts come from the round
  // engine, which always emits non-negative integers), but the gate
  // shouldn't crash or false-positive on malformed input.
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: -1, wrongCount: 0 }), false);
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 0, wrongCount: -1 }), false);
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 1.5, wrongCount: 0 }), false);
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: /** @type {any} */ ('NaN'), wrongCount: 0 }), false);
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: NaN, wrongCount: NaN }), false);
});

test('shouldRecordQuiz60sDay: negative-and-positive combination → counts only the positive', () => {
  // wrongCount=-1 reads as 0; answeredCount=2 reads as 2; total = 2 > 0 → true.
  assert.equal(shouldRecordQuiz60sDay({ answeredCount: 2, wrongCount: -1 }), true);
});
