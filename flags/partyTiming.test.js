import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_SECONDS,
  CLEAN_REVEAL_SECONDS,
  MISS_REVEAL_SECONDS,
  revealSecondsFor,
  secondsLeft,
  remainingFraction,
  NAME_REVEAL_SECONDS,
  DEFAULT_REVEAL,
  revealCategoryFor,
  isMetricQuestion,
  veilProgress,
  namesRevealed,
  veilActive,
  ROUND_BREAK_SECONDS,
  LEDGER_HOLD_MS,
  LEDGER_COUNT_MS,
  LEDGER_SETTLE_MS,
  LEDGER_SLIDE_MS,
  ledgerSchedule,
  LEDGER_ENTER_MS,
  LEDGER_ENTER_STAGGER_MS,
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

test('DEFAULT_REVEAL: flags obscured longest, metrics shortest, all below 1', () => {
  assert.ok(DEFAULT_REVEAL.metric < DEFAULT_REVEAL.map, 'metrics clear before maps');
  assert.ok(DEFAULT_REVEAL.map < DEFAULT_REVEAL.flag, 'maps clear before flags');
  for (const v of [DEFAULT_REVEAL.flag, DEFAULT_REVEAL.map, DEFAULT_REVEAL.metric]) {
    assert.ok(v > 0 && v < 1, 'the tile starts veiled and is fully clear before the buzzer');
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

test('the ledger animation fits inside the break with reading time left over', () => {
  const motion = LEDGER_HOLD_MS + LEDGER_COUNT_MS + LEDGER_SETTLE_MS + LEDGER_SLIDE_MS;
  assert.ok(motion < ROUND_BREAK_SECONDS * 1000, 'ledger must finish before the host advances');
  // The break exists to be read, not watched: at least a third of it stays still.
  assert.ok(ROUND_BREAK_SECONDS * 1000 - motion >= ROUND_BREAK_SECONDS * 1000 / 3);
});

test('ledgerSchedule: the rows slide only AFTER the counting finishes', () => {
  const s = ledgerSchedule(4);
  const countEndsAt = s.countAt + LEDGER_COUNT_MS;
  // The whole point of the settle beat: counting and row movement must not overlap,
  // or they read as one blur instead of cause and effect.
  assert.ok(s.slideAt >= countEndsAt, `slide at ${s.slideAt}ms must not start before the count ends at ${countEndsAt}ms`);
  assert.equal(s.slideAt - countEndsAt, LEDGER_SETTLE_MS, 'the breath between them is exactly the settle beat');
});

test('ledgerSchedule: beats run in order and the chips outlast the slide', () => {
  const s = ledgerSchedule(4);
  assert.ok(s.countAt < s.slideAt, 'count comes before the slide');
  assert.ok(s.slideAt < s.chipsOffAt, 'the gain chips stay up through the slide');
  assert.equal(s.chipsOffAt - s.slideAt, LEDGER_SLIDE_MS);
});

test('ledgerSchedule: the whole sequence still fits inside the break with reading time', () => {
  const s = ledgerSchedule(4);
  assert.ok(s.totalMs < ROUND_BREAK_SECONDS * 1000);
  assert.ok(ROUND_BREAK_SECONDS * 1000 - s.totalMs >= ROUND_BREAK_SECONDS * 1000 / 3);
});

test('ledgerSchedule: the hold starts only once the last row has faded in', () => {
  for (const rows of [2, 4, 8]) {
    const s = ledgerSchedule(rows);
    const lastRowLandsAt = (rows - 1) * LEDGER_ENTER_STAGGER_MS + LEDGER_ENTER_MS;
    assert.equal(s.enterMs, lastRowLandsAt, `entrance for ${rows} rows`);
    assert.ok(s.countAt > s.enterMs, 'counting must not start mid-arrival');
  }
});

test('ledgerSchedule: even a full room finishes with reading time left in the break', () => {
  // 8 seats is the biggest room worth planning for; the cascade grows with seats,
  // so this is where the budget would blow if the stagger were ever raised.
  const s = ledgerSchedule(8);
  assert.ok(s.totalMs < ROUND_BREAK_SECONDS * 1000, `8-row ledger takes ${s.totalMs}ms`);
  assert.ok(ROUND_BREAK_SECONDS * 1000 - s.totalMs >= 2000, 'at least 2s to actually read the board');
});

test('ledgerSchedule: an empty board has no entrance to wait for', () => {
  assert.equal(ledgerSchedule(0).enterMs, 0);
});
