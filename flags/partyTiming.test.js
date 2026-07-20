import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_SECONDS,
  CLEAN_REVEAL_SECONDS,
  MISS_REVEAL_SECONDS,
  CHART_REVEAL_SECONDS,
  revealSecondsFor,
  barPaints,
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
  finalBoardSchedule,
  FINAL_ROW_STAGGER_MS,
  FINAL_WINNER_HOLD_MS,
  FINAL_ROW_ENTER_MS,
  initialHold,
  beginHold,
  endHold,
  heldMsAt,
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

// ---- finalBoardSchedule: the finish reveal, bottom-up with the winner last ----

test('finalBoardSchedule: last place leads, each row above follows a step later', () => {
  const s = finalBoardSchedule(4);
  // Index 3 is last place and goes first; 2 and 1 follow one stagger apart.
  assert.equal(s.rows[3].enterAt, 0);
  assert.equal(s.rows[2].enterAt, FINAL_ROW_STAGGER_MS);
  assert.equal(s.rows[1].enterAt, FINAL_ROW_STAGGER_MS * 2);
});

test('finalBoardSchedule: the winner is held back an extra beat', () => {
  // Without the hold, first place is just the next row one stagger later, and
  // "winner last" reads as nothing in particular.
  const s = finalBoardSchedule(4);
  assert.equal(s.rows[0].enterAt, FINAL_ROW_STAGGER_MS * 3 + FINAL_WINNER_HOLD_MS);
  assert.ok(s.rows[0].enterAt - s.rows[1].enterAt > FINAL_ROW_STAGGER_MS, 'the winner waits longer than a plain step');
});

test('finalBoardSchedule: every row enters strictly after the one below it', () => {
  // The property that makes it read as a walk up the board, at any table size.
  for (const n of [2, 3, 5, 8, 20]) {
    const s = finalBoardSchedule(n);
    for (let i = 0; i < n - 1; i += 1) {
      assert.ok(s.rows[i].enterAt > s.rows[i + 1].enterAt, `row ${i} must follow row ${i + 1} (n=${n})`);
    }
  }
});

test('finalBoardSchedule: a score counts only once its row is on screen', () => {
  const s = finalBoardSchedule(3);
  for (const row of s.rows) assert.ok(row.countAt > row.enterAt, 'the number moves where you are already looking');
});

test('finalBoardSchedule: the burst lands on the winner, not on the rows still arriving', () => {
  const s = finalBoardSchedule(4);
  assert.ok(s.celebrationAt > s.rows[0].enterAt, 'after the winner starts arriving');
  assert.ok(s.celebrationAt < s.rows[0].enterAt + FINAL_ROW_ENTER_MS, 'and while they are still landing');
});

test('finalBoardSchedule: a solo board has no hold and no cascade to wait for', () => {
  const s = finalBoardSchedule(1);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].enterAt, 0, 'one player is both first and last: nothing to hold them behind');
});

test('finalBoardSchedule: an empty board schedules nothing', () => {
  const s = finalBoardSchedule(0);
  assert.deepEqual(s.rows, []);
  assert.equal(s.celebrationAt, 0);
  assert.equal(s.totalMs, 0);
});

test('finalBoardSchedule: the whole reveal is long enough to read but stays under a second and a half', () => {
  // The measured complaint was a 3-row board finishing its cascade in 148 ms.
  // Guard both ways: slow enough to follow, not so slow the finish drags.
  const s = finalBoardSchedule(3);
  const cascadeMs = s.rows[0].enterAt - s.rows[2].enterAt;
  assert.ok(cascadeMs >= 400, `the walk up the board must be readable, got ${cascadeMs}ms`);
  assert.ok(s.totalMs <= 1500, `the finish must not drag, got ${s.totalMs}ms`);
});

test('a chart reveal gets its full beat even when everyone got it right', () => {
  // The ranking IS the payoff of a world-facts question, not a consolation for
  // missing it. A clean sweep skipping to 0.9s would cut the bars off mid-grow
  // exactly when the table is looking at them.
  assert.equal(revealSecondsFor(true, true), CHART_REVEAL_SECONDS);
  assert.equal(revealSecondsFor(false, true), CHART_REVEAL_SECONDS);
});

test('non-chart questions keep their old pace, and the default is unchanged', () => {
  // flag-pick and map-pick have nothing to chart. Calling with one argument, as
  // every existing caller does, must behave exactly as before.
  assert.equal(revealSecondsFor(true), CLEAN_REVEAL_SECONDS);
  assert.equal(revealSecondsFor(false), MISS_REVEAL_SECONDS);
  assert.equal(revealSecondsFor(true, false), CLEAN_REVEAL_SECONDS);
});

test('the chart beat leaves real reading time after the motion stops', () => {
  // The first version of this test only checked the beat outlasted the
  // ANIMATION, which 3.2s satisfied comfortably -- and 3.2s was still too short
  // in play, because a chart that has finished moving is not a chart that has
  // been read. Four countries, four numbers and a scoreboard need stillness, so
  // that is what this pins. Same shape as the ledger's test against
  // ROUND_BREAK_SECONDS.
  const cascadeMs = 3 * 110;   // last row's entrance delay
  const barGrowMs = 700;       // and its bar still has to grow
  const motionMs = cascadeMs + barGrowMs;
  const stillMs = CHART_REVEAL_SECONDS * 1000 - motionMs;
  assert.ok(stillMs >= 3000,
    `chart reveal leaves only ${stillMs}ms of stillness after ${motionMs}ms of motion; need >= 3000ms to read it`);
});

test('the chart beat is not so long the round drags', () => {
  // The other side of the same judgement: five of these in a round, so an
  // over-generous beat is a minute of dead air. If a future change wants more
  // than this, it should be because the chart got denser, not by accident.
  assert.ok(CHART_REVEAL_SECONDS <= 7,
    `chart reveal ${CHART_REVEAL_SECONDS}s x5 questions would stall the round`);
  assert.ok(CHART_REVEAL_SECONDS > MISS_REVEAL_SECONDS,
    'a chart reveal must outlast an ordinary missed reveal');
});

// ---- hold-to-read accounting ----
// Held time is unbounded on purpose: an earlier version clamped it, which made
// the button quietly stop meaning what it said mid-read. The ways a hold could
// get stuck are closed at source instead -- released on let-go, on tab-hide, on
// phase change, and (the case no client can cover) server-side on disconnect.

test('a fresh reveal has held nothing and nobody holding', () => {
  const h = initialHold();
  assert.equal(heldMsAt(h, 1000), 0);
  assert.equal(h.sinceMs, null);
});

test('held time accrues while a hold is live and banks on release', () => {
  let h = beginHold(initialHold(), 1000);
  assert.equal(heldMsAt(h, 3000), 2000, 'two seconds into the hold, two seconds held');
  h = endHold(h, 3000);
  assert.equal(h.sinceMs, null);
  assert.equal(heldMsAt(h, 99999), 2000, 'after release, held time stops growing');
});

test('a second holder does not restart the stretch the first one is holding', () => {
  const first = beginHold(initialHold(), 1000);
  const second = beginHold(first, 2500);
  assert.deepEqual(second, first, 'begin is a no-op while a hold is already running');
  assert.equal(heldMsAt(second, 3000), 2000, 'still measured from the first press');
});

test('a long hold keeps accruing: there is no hidden ceiling', () => {
  // The property the cap used to break. Someone reading slowly must not have the
  // chart pulled away mid-sentence because an invisible allowance ran out.
  const h = beginHold(initialHold(), 0);
  assert.equal(heldMsAt(h, 30_000), 30_000);
  assert.equal(heldMsAt(h, 5 * 60_000), 5 * 60_000, 'five minutes is still five minutes');
});

test('hold and release repeatedly accumulates the time actually held', () => {
  let h = initialHold();
  let t = 0;
  for (let i = 0; i < 5; i += 1) {
    h = beginHold(h, t);
    t += 5000;
    h = endHold(h, t);
    t += 100;
  }
  assert.equal(heldMsAt(h, t), 25_000, 'five five-second holds');
});

test('releasing without a live hold is a no-op', () => {
  // Guests can send a stray hold-end (a pointerleave with no pointerdown, a late
  // message after the reveal moved on); it must not bank a phantom stretch.
  const h = initialHold();
  assert.deepEqual(endHold(h, 5000), h);
});

test('a clock that jumps backwards cannot rewind held time', () => {
  // heldMsAt is wall-clock derived, so an NTP correction (or a laptop waking)
  // could hand it a `now` before the press. Negative held time would pull the
  // reveal deadline IN, cutting the beat short for everyone.
  const h = beginHold(initialHold(), 10_000);
  assert.equal(heldMsAt(h, 9_000), 0, 'clamped at zero, never negative');
});

test('barPaints: the question always paints, and so does a chart reveal', () => {
  // The countdown bar means two different things by phase. During the question
  // it is "time to answer". During a CHART reveal it is "time until the next
  // question" -- which is the signal hold-to-read was missing: you cannot judge
  // whether to hold if you cannot see what is left, and a bar that visibly
  // stalls is the only confirmation that your press actually froze the room.
  assert.equal(barPaints('question', false), true);
  assert.equal(barPaints('question', true), true, 'chart-ness is irrelevant while answering');
  assert.equal(barPaints('reveal', true), true, 'the 5.5s readable chart earns a bar');
});

test('barPaints: short reveals and the pick stay bar-less', () => {
  // A clean/miss reveal is a fraction of a chart reveal, so a bar there would
  // just flicker -- the original reason the reveal was bar-less at all. The pick
  // is deliberately untimed (PICK_TIMEOUT_SECONDS is an invisible anti-stall
  // fallback, not a race), so painting it would invent pressure that the design
  // spent effort removing.
  assert.equal(barPaints('reveal', false), false);
  assert.equal(barPaints('picking', false), false);
  assert.equal(barPaints('picking', true), false, 'a pick is untimed even between chart questions');
});
