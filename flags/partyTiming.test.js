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
  NAME_REVEAL_OPTIONS,
  DEFAULT_REVEAL,
  revealCategoryFor,
  isMetricRound,
  clampReveal,
  clampNameReveal,
  validateReveal,
  veilProgress,
  namesRevealed,
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
  assert.ok(NAME_REVEAL_OPTIONS.includes(DEFAULT_REVEAL.name), 'the name default is a pickable name option');
  assert.ok(DEFAULT_REVEAL.name < 1, 'names land before the buzzer');
  assert.deepEqual(DEFAULT_REVEAL, { flag: 0.8, map: 0.4, metric: 0.2, name: 0.5 }, 'the agreed defaults');
});

test('revealCategoryFor: maps, metrics, and everything-else-is-flags', () => {
  assert.equal(revealCategoryFor('mapPick'), 'map');
  assert.equal(revealCategoryFor('superlative'), 'metric');
  assert.equal(revealCategoryFor('flagPick'), 'flag', 'flag-pick is a flag round');
  assert.equal(revealCategoryFor(undefined), 'flag', 'an unknown/absent round defaults to flag');
});

test('isMetricRound: every superlative id is metric, catching the ones revealCategoryFor misses', () => {
  assert.equal(isMetricRound('superlative'), true, 'population');
  assert.equal(isMetricRound('superlative-area'), true, 'area');
  assert.equal(isMetricRound('superlative-coffee'), true, 'a crop');
  assert.equal(isMetricRound('superlative-gold'), true, 'the newest metric');
  assert.equal(isMetricRound('flagPick'), false, 'flags are not metric');
  assert.equal(isMetricRound('mapPick'), false, 'maps are not metric');
  assert.equal(isMetricRound(undefined), false, 'an absent round is not metric');
  // The gap this closes: revealCategoryFor only calls the literal 'superlative'
  // id metric, so the other superlative rounds would slip past a category check.
  assert.notEqual(revealCategoryFor('superlative-area'), 'metric');
  assert.equal(isMetricRound('superlative-area'), true);
});

test('clampReveal: snaps to the nearest option, falls back on non-numbers', () => {
  assert.equal(clampReveal(0.4, 0.8), 0.4, 'an exact option is kept');
  assert.equal(clampReveal(0.55, 0.8), 0.6, 'snaps to the nearest option');
  assert.equal(clampReveal(0.05, 0.8), 0.2, 'clamps a too-low value up to the lowest option');
  assert.equal(clampReveal(9, 0.8), 0.8, 'clamps a too-high value down to the highest option');
  assert.equal(clampReveal('40', 0.4), 0.4, 'a non-number falls back to the default');
  assert.equal(clampReveal(NaN, 0.6), 0.6, 'NaN falls back to the default');
});

test('clampNameReveal: null stays off, numbers snap, junk falls back', () => {
  assert.equal(clampNameReveal(null, 0.5), null, 'explicit null is off and stays off');
  assert.equal(clampNameReveal(0.5, 0.4), 0.5, 'an exact option is kept');
  assert.equal(clampNameReveal(0.55, 0.4), 0.6, 'snaps to the nearest option');
  assert.equal(clampNameReveal(0.01, 0.4), 0.4, 'clamps a too-low value up to the lowest option');
  assert.equal(clampNameReveal(9, 0.4), 0.8, 'clamps a too-high value down to the highest option');
  assert.equal(clampNameReveal(undefined, 0.5), 0.5, 'a missing value defaults on (not off)');
  assert.equal(clampNameReveal('50', 0.5), 0.5, 'a non-number falls back to the default');
  assert.equal(clampNameReveal(NaN, 0.6), 0.6, 'NaN falls back to the default');
});

test('validateReveal: fills a full config, snapping and defaulting each field', () => {
  assert.deepEqual(validateReveal({ flag: 0.6, map: 0.2, metric: 0.4, name: 0.6 }), { flag: 0.6, map: 0.2, metric: 0.4, name: 0.6 });
  assert.deepEqual(validateReveal({ flag: 0.55 }), { flag: 0.6, map: DEFAULT_REVEAL.map, metric: DEFAULT_REVEAL.metric, name: DEFAULT_REVEAL.name }, 'missing fields default, present ones snap');
  assert.deepEqual(validateReveal({ name: null }), { flag: DEFAULT_REVEAL.flag, map: DEFAULT_REVEAL.map, metric: DEFAULT_REVEAL.metric, name: null }, 'an explicit name:null (host turned names off) survives validation');
  assert.deepEqual(validateReveal(null), DEFAULT_REVEAL, 'a missing config is the full default');
  assert.deepEqual(validateReveal('nope'), DEFAULT_REVEAL, 'a garbage config is the full default');
});

test('namesRevealed: off never shows, otherwise flips true at the fraction and holds', () => {
  const now = 1_000_000;
  const total = 20_000;
  const at = (/** @type {number} */ frac, /** @type {number} */ mult) => namesRevealed(now + total * (1 - mult), now, total, frac);
  assert.equal(namesRevealed(now + total, now, total, null), false, 'off never reveals');
  assert.equal(at(0.5, 0), false, 'hidden at the start');
  assert.equal(at(0.5, 0.49), false, 'still hidden just before the half-way point');
  assert.equal(at(0.5, 0.5), true, 'revealed exactly at the fraction');
  assert.equal(at(0.5, 0.9), true, 'stays revealed after');
  assert.equal(namesRevealed(now, now, total, 0.5), true, 'at the deadline names are shown');
  assert.equal(namesRevealed(now + total, now, total, 0), true, 'a zero fraction reveals immediately');
  assert.equal(namesRevealed(now, now, 0, 0.5), true, 'a non-positive total is a safe reveal');
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
