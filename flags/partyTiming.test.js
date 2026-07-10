import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_SECONDS,
  REVEAL_SECONDS,
  SOLO_REVEAL_SECONDS,
  revealSecondsFor,
  secondsLeft,
  remainingFraction,
} from './partyTiming.js';

test('durations are sane: a question outlasts a reveal, both positive', () => {
  assert.ok(QUESTION_SECONDS > 0);
  assert.ok(REVEAL_SECONDS > 0);
  assert.ok(QUESTION_SECONDS > REVEAL_SECONDS, 'a question should stay open longer than a reveal lingers');
});

test('revealSecondsFor: solo trims the reveal, multiplayer keeps the full beat', () => {
  assert.ok(SOLO_REVEAL_SECONDS > 0);
  assert.ok(SOLO_REVEAL_SECONDS < REVEAL_SECONDS, 'solo reveal is snappier than multiplayer');
  assert.equal(revealSecondsFor(0), SOLO_REVEAL_SECONDS, 'an empty room is treated as solo');
  assert.equal(revealSecondsFor(1), SOLO_REVEAL_SECONDS, 'one seat is solo');
  assert.equal(revealSecondsFor(2), REVEAL_SECONDS, 'two seats get the full reveal');
  assert.equal(revealSecondsFor(6), REVEAL_SECONDS, 'a full room gets the full reveal');
});

test('secondsLeft: a fresh full-length deadline reads the whole duration', () => {
  const now = 1_000_000;
  assert.equal(secondsLeft(now + QUESTION_SECONDS * 1000, now), QUESTION_SECONDS);
});

test('secondsLeft: ceils partial seconds so it only hits 0 at true expiry', () => {
  const now = 1_000_000;
  assert.equal(secondsLeft(now + 4001, now), 5, '4.001s left still reads 5');
  assert.equal(secondsLeft(now + 1, now), 1, '1ms left still reads 1, not 0');
  assert.equal(secondsLeft(now, now), 0, 'exactly at the deadline reads 0');
});

test('secondsLeft: never goes negative once the deadline has passed', () => {
  const now = 1_000_000;
  assert.equal(secondsLeft(now - 5000, now), 0);
});

test('remainingFraction: 1 at the start, 0.5 at the midpoint, 0 at the deadline', () => {
  const total = 10_000;
  const now = 1_000_000;
  assert.equal(remainingFraction(now + total, now, total), 1);
  assert.equal(remainingFraction(now + total / 2, now, total), 0.5);
  assert.equal(remainingFraction(now, now, total), 0);
});

test('remainingFraction: clamps to [0, 1] for out-of-range now', () => {
  const total = 10_000;
  const now = 1_000_000;
  assert.equal(remainingFraction(now - 3000, now, total), 0, 'past the deadline clamps to 0');
  assert.equal(remainingFraction(now + total * 2, now, total), 1, 'somehow-early clamps to 1');
});

test('remainingFraction: a non-positive total is a safe 0 (no divide-by-zero)', () => {
  assert.equal(remainingFraction(1_000, 1_000, 0), 0);
});
