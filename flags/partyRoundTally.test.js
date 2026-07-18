import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPoints, emptyTally, addQuestionToTally, chipsFor } from './partyRoundTally.js';
import { CORRECT_POINTS, SPEED_BONUS, scoreQuestion } from './partyScore.js';

test('splitPoints: a correct answer with no speed bonus is all base', () => {
  assert.deepEqual(splitPoints(CORRECT_POINTS), { base: 10, speed: 0 });
});

test('splitPoints: each speed rank is recovered exactly', () => {
  SPEED_BONUS.forEach((bonus) => {
    assert.deepEqual(splitPoints(CORRECT_POINTS + bonus), { base: 10, speed: bonus });
  });
});

test('splitPoints: a wrong answer splits to nothing', () => {
  assert.deepEqual(splitPoints(0), { base: 0, speed: 0 });
});

test('splitPoints: the double round scales both halves', () => {
  assert.deepEqual(splitPoints(30, 2), { base: 20, speed: 10 });
  assert.deepEqual(splitPoints(20, 2), { base: 20, speed: 0 });
});

test('splitPoints: every total scoreQuestion can actually produce round-trips', () => {
  // The guarantee the whole client-side derivation rests on. If a future scoring
  // change breaks it, this fails and Phase 5's server-sent breakdown is overdue.
  for (const multiplier of [1, 2]) {
    for (let correctCount = 1; correctCount <= 5; correctCount += 1) {
      const buzzes = Array.from({ length: correctCount }, (_, i) => ({ playerId: `p${i}`, correct: true }));
      const points = scoreQuestion(buzzes, { multiplier });
      for (const total of Object.values(points)) {
        const { base, speed } = splitPoints(total, multiplier);
        assert.equal(base + speed, total, `${total} must split back to itself`);
        assert.equal(base, CORRECT_POINTS * multiplier, `${total} keeps a full base`);
      }
    }
  }
});

test('splitPoints: an unrecognised total is reported as base rather than throwing', () => {
  // A stale client meeting a newer server's scoring. Chips are decoration; a
  // slightly wrong label beats a broken break screen.
  const s = splitPoints(999);
  assert.equal(s.base + s.speed, 999);
  assert.equal(s.speed, 0);
});

test('addQuestionToTally: accumulates base and speed across a round', () => {
  let t = emptyTally();
  t = addQuestionToTally(t, { a: 15, b: 10 });     // a fastest, b correct
  t = addQuestionToTally(t, { a: 10, b: 13 });     // b second-fastest
  t = addQuestionToTally(t, { a: 0, b: 15 });      // a wrong
  assert.deepEqual(t.a, { base: 20, speed: 5 });
  assert.deepEqual(t.b, { base: 30, speed: 8 });
});

test('addQuestionToTally: does not mutate the tally it was given', () => {
  const first = addQuestionToTally(emptyTally(), { a: 15 });
  const second = addQuestionToTally(first, { a: 15 });
  assert.deepEqual(first.a, { base: 10, speed: 5 }, 'the earlier tally is untouched');
  assert.deepEqual(second.a, { base: 20, speed: 10 });
});

test('addQuestionToTally: a player who never buzzed simply is not in the tally', () => {
  const t = addQuestionToTally(emptyTally(), { a: 10 });
  assert.equal(t.b, undefined);
});

test('addQuestionToTally: survives missing or empty input', () => {
  assert.deepEqual(addQuestionToTally(emptyTally(), /** @type {any} */ (undefined)), {});
  assert.deepEqual(addQuestionToTally(/** @type {any} */ (null), { a: 10 }), { a: { base: 10, speed: 0 } });
});

test('chipsFor: shows base then speed, loudest first', () => {
  assert.deepEqual(chipsFor({ base: 30, speed: 8 }), [
    { kind: 'base', value: 30 },
    { kind: 'speed', value: 8 },
  ]);
});

test('chipsFor: never renders a zero chip', () => {
  assert.deepEqual(chipsFor({ base: 20, speed: 0 }), [{ kind: 'base', value: 20 }]);
  assert.deepEqual(chipsFor({ base: 0, speed: 0 }), []);
  assert.deepEqual(chipsFor(undefined), []);
});

test('chips always add up to the round gain the board shows', () => {
  let t = emptyTally();
  t = addQuestionToTally(t, { a: 15 });
  t = addQuestionToTally(t, { a: 13 });
  const total = chipsFor(t.a).reduce((sum, c) => sum + c.value, 0);
  assert.equal(total, 28, 'the chips must reconcile with the number beside them');
});
