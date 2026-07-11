import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_SECONDS,
  CLEAN_REVEAL_SECONDS,
  MISS_REVEAL_SECONDS,
  revealSecondsFor,
  secondsLeft,
  remainingFraction,
  FLAG_CLEAR_FRACTION,
  OUTLINE_CLEAR_FRACTION,
  veilClearFraction,
  veilProgress,
} from './partyTiming.js';

test('durations are sane: a question outlasts either reveal, all positive', () => {
  assert.ok(QUESTION_SECONDS > 0);
  assert.ok(CLEAN_REVEAL_SECONDS > 0);
  assert.ok(QUESTION_SECONDS > MISS_REVEAL_SECONDS, 'a question should stay open longer than a reveal lingers');
});

test('revealSecondsFor: a clean sweep snaps on, a miss holds longer', () => {
  assert.ok(CLEAN_REVEAL_SECONDS < MISS_REVEAL_SECONDS, 'a clean reveal is snappier than a missed one');
  assert.equal(revealSecondsFor(true), CLEAN_REVEAL_SECONDS, 'everyone correct → fast');
  assert.equal(revealSecondsFor(false), MISS_REVEAL_SECONDS, 'someone missed → hold');
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

test('veilClearFraction: outlines clear sooner than flags, both below 1', () => {
  assert.equal(veilClearFraction(false), FLAG_CLEAR_FRACTION, 'a flag round uses the flag fraction');
  assert.equal(veilClearFraction(true), OUTLINE_CLEAR_FRACTION, 'the map round uses the outline fraction');
  assert.ok(OUTLINE_CLEAR_FRACTION < FLAG_CLEAR_FRACTION, 'outlines resolve earlier in the window');
  assert.ok(FLAG_CLEAR_FRACTION < 1, 'the tile is fully clear before the buzzer');
});

test('veilProgress: 0 at the start, hits 1 at the clear point, holds clear after', () => {
  const total = 20_000;
  const now = 1_000_000;
  const clear = 0.5; // clears halfway through the window
  assert.equal(veilProgress(now + total, now, total, clear), 0, 'fully hidden at the start');
  // midway to the clear point (25% of the window) → half-revealed
  assert.equal(veilProgress(now + total * 0.75, now, total, clear), 0.5);
  // at the clear point (50% of the window) → fully clear
  assert.equal(veilProgress(now + total * 0.5, now, total, clear), 1);
  // past the clear point stays clamped at 1, never overshoots
  assert.equal(veilProgress(now + total * 0.25, now, total, clear), 1);
  assert.equal(veilProgress(now, now, total, clear), 1, 'at the deadline it is fully clear');
});

test('veilProgress: clamps to [0, 1] and is divide-by-zero safe', () => {
  const now = 1_000_000;
  assert.equal(veilProgress(now - 5000, now, 20_000, 0.9), 1, 'past the deadline clamps to 1');
  assert.equal(veilProgress(now + 30_000, now, 20_000, 0.9), 0, 'somehow-early clamps to 0');
  assert.equal(veilProgress(now, now, 0, 0.9), 1, 'a non-positive total is a safe clear');
  assert.equal(veilProgress(now, now, 20_000, 0), 1, 'a zero clear fraction is a safe clear');
});
