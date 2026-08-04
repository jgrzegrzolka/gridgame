import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlayClock } from './playClock.js';

/** A clock we drive by hand, so no test sleeps. */
function fake(start = 1_000) {
  let t = start;
  const clock = createPlayClock({ now: () => t });
  return { clock, tick: (ms) => { t += ms; }, at: () => t };
}

// ---- it does not run until the player plays ----

test('the clock does not run before the first pick', () => {
  // The bug this exists for: startGame stamped the start time and then
  // requested the first four flags, so a cold load spent real seconds of the
  // budget on a blank board. Time cannot accrue before the round is playable.
  const { clock, tick } = fake();
  tick(4_000);
  assert.equal(clock.elapsedMs(), 0);
  assert.equal(clock.isStarted(), false);
});

test('the first pick arms it, and time runs from there', () => {
  const { clock, tick } = fake();
  tick(4_000);           // page load, flags fetching, player reading
  clock.start();
  assert.equal(clock.isStarted(), true);
  tick(1_500);
  assert.equal(clock.elapsedMs(), 1_500, 'the 4s of loading is not charged');
});

test('later picks do not restart the round', () => {
  // start() is called on every pick, not just the first — the round would
  // otherwise reset its clock on each answer and never end.
  const { clock, tick } = fake();
  clock.start();
  tick(9_000);
  clock.start();
  clock.start();
  assert.equal(clock.elapsedMs(), 9_000);
});

// ---- the settings tray is not play time ----

test('a pause is banked, not counted', () => {
  const { clock, tick } = fake();
  clock.start();
  tick(3_000);
  clock.pause();
  tick(30_000);          // a long look at the settings tray
  assert.equal(clock.elapsedMs(), 3_000, 'frozen while paused');
  clock.resume();
  tick(2_000);
  assert.equal(clock.elapsedMs(), 5_000, 'the 30s in the tray is not charged');
});

test('pause and resume are both idempotent', () => {
  const { clock, tick } = fake();
  clock.start();
  tick(1_000);
  clock.pause();
  tick(500);
  clock.pause();         // a second pause must not re-stamp the start of it
  tick(500);
  clock.resume();
  clock.resume();        // a second resume must not bank the pause twice
  tick(1_000);
  assert.equal(clock.elapsedMs(), 2_000);
});

test('pausing before the first pick blocks picks but banks nothing', () => {
  // Opening the tray on an unarmed round is legal, and `isPaused` is what
  // stops a keyboard pick from landing on the dimmed board. Since the clock
  // never ran, the pause has no elapsed time to inflate.
  const { clock, tick } = fake();
  clock.pause();
  assert.equal(clock.isPaused(), true);
  assert.equal(clock.isStarted(), false, 'a pause must not arm the clock');
  tick(10_000);
  assert.equal(clock.elapsedMs(), 0);
  clock.resume();
  assert.equal(clock.isPaused(), false);
  clock.start();
  tick(1_000);
  assert.equal(clock.elapsedMs(), 1_000, 'the pre-start pause banks nothing');
});

test('elapsed stays 0 for a round the player walked out of', () => {
  // Give up without picking anything: the result path reads elapsedMs, and
  // it must be 0 rather than "however long the page had been open".
  const { clock, tick } = fake();
  tick(20_000);
  assert.equal(clock.elapsedMs(), 0);
});
