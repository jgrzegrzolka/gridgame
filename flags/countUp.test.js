import test from 'node:test';
import assert from 'node:assert/strict';

import { countUpValue, runCountUp } from './countUp.js';

// ---- countUpValue ----

test('countUpValue starts at 0 and lands exactly on the target', () => {
  assert.equal(countUpValue({ target: 38, durationMs: 600, elapsedMs: 0 }), 0);
  assert.equal(countUpValue({ target: 38, durationMs: 600, elapsedMs: 600 }), 38);
  // Past the end stays at the target rather than overshooting.
  assert.equal(countUpValue({ target: 38, durationMs: 600, elapsedMs: 5000 }), 38);
});

test('countUpValue is monotonic and whole-numbered across the run', () => {
  let prev = 0;
  for (let ms = 0; ms <= 602; ms += 7) {
    const v = countUpValue({ target: 38, durationMs: 600, elapsedMs: ms });
    assert.ok(Number.isInteger(v), `${v} at ${ms}ms is not a whole number`);
    assert.ok(v >= prev, `went backwards at ${ms}ms: ${prev} → ${v}`);
    assert.ok(v <= 38, `overshot at ${ms}ms: ${v}`);
    prev = v;
  }
  assert.equal(prev, 38);
});

test('countUpValue floors rather than rounds, so it never shows a number early', () => {
  // Halfway through a 40-point run is 20, not 21 — a rounded midpoint would
  // show the final value before the animation had finished.
  assert.equal(countUpValue({ target: 40, durationMs: 600, elapsedMs: 300 }), 20);
  assert.equal(countUpValue({ target: 40, durationMs: 600, elapsedMs: 299 }), 19);
});

test('countUpValue reproduces daily\'s one-per-60ms cadence when asked for it', () => {
  // Daily walks the found list at 60ms a flag; expressing that as
  // `durationMs = target * 60` has to produce exactly that sequence, or
  // sharing this module with daily would have changed how daily reads.
  const target = 14;
  const durationMs = target * 60;
  assert.equal(countUpValue({ target, durationMs, elapsedMs: 59 }), 0);
  assert.equal(countUpValue({ target, durationMs, elapsedMs: 60 }), 1);
  assert.equal(countUpValue({ target, durationMs, elapsedMs: 120 }), 2);
  assert.equal(countUpValue({ target, durationMs, elapsedMs: 13 * 60 }), 13);
  assert.equal(countUpValue({ target, durationMs, elapsedMs: 14 * 60 }), 14);
});

test('countUpValue degenerate inputs resolve to the final value, not a throw', () => {
  assert.equal(countUpValue({ target: 12, durationMs: 0, elapsedMs: 0 }), 12);
  assert.equal(countUpValue({ target: 12, durationMs: -5, elapsedMs: 0 }), 12);
  assert.equal(countUpValue({ target: 0, durationMs: 600, elapsedMs: 100 }), 0);
  assert.equal(countUpValue({ target: -3, durationMs: 600, elapsedMs: 100 }), 0);
});

// ---- runCountUp ----

/**
 * A hand-cranked clock + frame scheduler, so a run can be stepped
 * deterministically instead of waited on.
 */
function harness() {
  let clock = 0;
  /** @type {(() => void)[]} */
  let queued = [];
  /** @type {number[]} */
  const values = [];
  return {
    values,
    now: () => clock,
    /** @param {() => void} cb */
    schedule: (cb) => { queued.push(cb); return queued.length; },
    cancel: () => { queued = []; },
    /** @param {number} v */
    onValue: (v) => values.push(v),
    /**
     * Advance the clock and run whatever frame was pending.
     * @param {number} ms
     */
    tick(ms) {
      clock += ms;
      const due = queued;
      queued = [];
      for (const cb of due) cb();
    },
  };
}

test('runCountUp paints 0 first, then every whole number up to the target', () => {
  const h = harness();
  runCountUp({
    target: 4, durationMs: 400, onValue: h.onValue,
    now: h.now, schedule: h.schedule, cancel: h.cancel, reducedMotion: false,
  });
  assert.deepEqual(h.values, [0], 'the starting value must be painted synchronously');
  for (let i = 0; i < 8; i++) h.tick(50);
  assert.deepEqual(h.values, [0, 1, 2, 3, 4]);
});

test('runCountUp reports each value once, however many frames it sits on', () => {
  const h = harness();
  runCountUp({
    target: 2, durationMs: 200, onValue: h.onValue,
    now: h.now, schedule: h.schedule, cancel: h.cancel, reducedMotion: false,
  });
  // Ten frames across a two-step run: the caller must not be told "still 1"
  // nine times, or a DOM write per frame becomes a repaint per frame.
  for (let i = 0; i < 10; i++) h.tick(20);
  assert.deepEqual(h.values, [0, 1, 2]);
});

test('runCountUp stops scheduling once it reaches the target', () => {
  const h = harness();
  runCountUp({
    target: 1, durationMs: 100, onValue: h.onValue,
    now: h.now, schedule: h.schedule, cancel: h.cancel, reducedMotion: false,
  });
  h.tick(100);
  assert.deepEqual(h.values, [0, 1]);
  const after = h.values.length;
  h.tick(1000);
  assert.equal(h.values.length, after, 'kept running after finishing');
});

test('runCountUp catches up after a dropped frame instead of falling behind', () => {
  // The wall clock is the source of truth: a 300ms gap lands on the value
  // for 300ms, not on "one more than last time".
  const h = harness();
  runCountUp({
    target: 10, durationMs: 600, onValue: h.onValue,
    now: h.now, schedule: h.schedule, cancel: h.cancel, reducedMotion: false,
  });
  h.tick(300);
  assert.deepEqual(h.values, [0, 5]);
});

test('runCountUp stop() halts a run in flight', () => {
  const h = harness();
  const stop = runCountUp({
    target: 10, durationMs: 600, onValue: h.onValue,
    now: h.now, schedule: h.schedule, cancel: h.cancel, reducedMotion: false,
  });
  h.tick(60);
  const seen = [...h.values];
  stop();
  h.tick(600);
  assert.deepEqual(h.values, seen, 'kept painting after stop()');
});

test('runCountUp under reduced motion shows the final value and never schedules', () => {
  const h = harness();
  let scheduled = 0;
  runCountUp({
    target: 38, durationMs: 600, onValue: h.onValue,
    now: h.now, schedule: (cb) => { scheduled++; return h.schedule(cb); }, cancel: h.cancel,
    reducedMotion: true,
  });
  assert.deepEqual(h.values, [38]);
  assert.equal(scheduled, 0);
});
