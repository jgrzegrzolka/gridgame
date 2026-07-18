import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_SECONDS,
  CLEAN_REVEAL_SECONDS,
  MISS_REVEAL_SECONDS,
  revealSecondsFor,
  secondsLeft,
  remainingFraction,
  REVEAL_OPTIONS,
  NAME_REVEAL_SECONDS,
  DEFAULT_REVEAL,
  revealCategoryFor,
  isMetricQuestion,
  clampReveal,
  validateReveal,
  veilProgress,
  namesRevealed,
  veilActive,
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

test('DEFAULT_REVEAL: flags obscured longest, metrics shortest, all an allowed option below 1', () => {
  assert.ok(DEFAULT_REVEAL.metric < DEFAULT_REVEAL.map, 'metrics clear before maps');
  assert.ok(DEFAULT_REVEAL.map < DEFAULT_REVEAL.flag, 'maps clear before flags');
  for (const v of [DEFAULT_REVEAL.flag, DEFAULT_REVEAL.map, DEFAULT_REVEAL.metric]) {
    assert.ok(REVEAL_OPTIONS.includes(v), `${v} is a pickable option`);
    assert.ok(v < 1, 'the tile is fully clear before the buzzer');
  }
  assert.deepEqual(DEFAULT_REVEAL, { flag: 0.8, map: 0.4, metric: 0.2 }, 'the agreed defaults');
  assert.ok(NAME_REVEAL_SECONDS * 1000 < QUESTION_SECONDS * 1000, 'names land well before the buzzer');
});

test('revealCategoryFor: maps, metrics, and everything-else-is-flags', () => {
  assert.equal(revealCategoryFor('mapPick'), 'map');
  assert.equal(revealCategoryFor('superlative'), 'metric');
  assert.equal(revealCategoryFor('flagPick'), 'flag', 'flag-pick is a flag question');
  assert.equal(revealCategoryFor(undefined), 'flag', 'an unknown/absent question defaults to flag');
});

test('isMetricQuestion: every superlative id is metric, catching the ones revealCategoryFor misses', () => {
  assert.equal(isMetricQuestion('superlative'), true, 'population');
  assert.equal(isMetricQuestion('superlative-area'), true, 'area');
  assert.equal(isMetricQuestion('superlative-coffee'), true, 'a crop');
  assert.equal(isMetricQuestion('superlative-gold'), true, 'the newest metric');
  assert.equal(isMetricQuestion('flagPick'), false, 'flags are not metric');
  assert.equal(isMetricQuestion('mapPick'), false, 'maps are not metric');
  assert.equal(isMetricQuestion(undefined), false, 'an absent question is not metric');
  // The gap this closes: revealCategoryFor only calls the literal 'superlative'
  // id metric, so the other superlative questions would slip past a category check.
  assert.notEqual(revealCategoryFor('superlative-area'), 'metric');
  assert.equal(isMetricQuestion('superlative-area'), true);
});

test('clampReveal: snaps to the nearest option, falls back on non-numbers', () => {
  assert.equal(clampReveal(0.4, 0.8), 0.4, 'an exact option is kept');
  assert.equal(clampReveal(0.55, 0.8), 0.6, 'snaps to the nearest option');
  assert.equal(clampReveal(0.05, 0.8), 0.2, 'clamps a too-low value up to the lowest option');
  assert.equal(clampReveal(9, 0.8), 0.8, 'clamps a too-high value down to the highest option');
  assert.equal(clampReveal('40', 0.4), 0.4, 'a non-number falls back to the default');
  assert.equal(clampReveal(NaN, 0.6), 0.6, 'NaN falls back to the default');
});

test('validateReveal: fills a full config, snapping and defaulting each field', () => {
  assert.deepEqual(validateReveal({ flag: 0.6, map: 0.2, metric: 0.4 }), { flag: 0.6, map: 0.2, metric: 0.4 });
  assert.deepEqual(validateReveal({ flag: 0.55 }), { flag: 0.6, map: DEFAULT_REVEAL.map, metric: DEFAULT_REVEAL.metric }, 'missing fields default, present ones snap');
  assert.deepEqual(validateReveal({ name: 0.5 }), DEFAULT_REVEAL, 'a stale name field is ignored, not carried through');
  assert.deepEqual(validateReveal(null), DEFAULT_REVEAL, 'a missing config is the full default');
  assert.deepEqual(validateReveal('nope'), DEFAULT_REVEAL, 'a garbage config is the full default');
});

// ---- veilActive ----

test('veilActive: follows the host tricky setting on picture questions', () => {
  assert.equal(veilActive(true, 'flagPick'), true);
  assert.equal(veilActive(true, 'mapPick'), true);
  assert.equal(veilActive(false, 'flagPick'), false);
  assert.equal(veilActive(false, 'mapPick'), false);
});

test('veilActive: never veils a statistics question, even with tricky on', () => {
  // The veil is a flag / outline recognition challenge. On "which grows the most
  // coffee?" the flag is incidental, so hiding it tests the wrong skill.
  for (const id of ['superlative', 'superlative-area', 'superlative-coffee', 'superlative-happiness']) {
    assert.equal(veilActive(true, id), false, id);
    assert.equal(veilActive(false, id), false, id);
  }
});

test('veilActive: nothing else can turn the veil on', () => {
  // Regression pin: the final round used to veil regardless of the setting, so a
  // host who never enabled tricky still got a veiled finale, and draft (which
  // never shows the toggle) got one out of nowhere. veilActive takes no round
  // index at all now — there is no argument through which that could come back.
  assert.equal(veilActive(false, 'flagPick'), false);
  assert.equal(veilActive(false, undefined), false, 'an unknown question is not a veil trigger');
  assert.equal(veilActive.length, 2, 'takes only (tricky, questionId)');
});

test('veilActive: a non-boolean tricky is not truthy-veiled', () => {
  // The room defaults tricky to false, but a stale/garbage value must not veil.
  for (const junk of [undefined, null, 1, 'yes', {}]) {
    assert.equal(veilActive(/** @type {any} */ (junk), 'flagPick'), false, String(junk));
  }
});

test('namesRevealed: flips true at a fixed NAME_REVEAL_SECONDS and holds', () => {
  const now = 1_000_000;
  const total = QUESTION_SECONDS * 1000;
  // `elapsed` seconds into a question whose window is `total` long.
  const at = (/** @type {number} */ elapsed) => namesRevealed(now + total - elapsed * 1000, now, total);
  assert.equal(at(0), false, 'hidden at the start');
  assert.equal(at(NAME_REVEAL_SECONDS - 0.1), false, 'still hidden just before the beat');
  assert.equal(at(NAME_REVEAL_SECONDS), true, 'revealed exactly at the beat');
  assert.equal(at(NAME_REVEAL_SECONDS + 5), true, 'stays revealed after');
  assert.equal(namesRevealed(now, now, total), true, 'at the deadline names are shown');
  assert.equal(namesRevealed(now, now, 0), true, 'a non-positive total is a safe reveal');
});

test('namesRevealed: the beat is absolute, not a fraction of the window', () => {
  // The whole point of the change: a 3 s beat means 3 s whatever the window is.
  const now = 1_000_000;
  for (const total of [10_000, 20_000, 60_000]) {
    const at3 = namesRevealed(now + total - NAME_REVEAL_SECONDS * 1000, now, total);
    assert.equal(at3, true, `revealed at ${NAME_REVEAL_SECONDS}s in a ${total}ms window`);
    const justBefore = namesRevealed(now + total - (NAME_REVEAL_SECONDS * 1000 - 100), now, total);
    assert.equal(justBefore, false, `still hidden just before it in a ${total}ms window`);
  }
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
