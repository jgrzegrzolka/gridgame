/**
 * Timing for the Flag Party live show. The room reducer (`flags/partyRoom.js`)
 * is deliberately time-free — it only knows "reveal now" / "next now". The pace
 * is driven by the host's page, which counts these durations down and fires the
 * `reveal` / `next` messages when they elapse. Every client also renders its own
 * copy of the countdown so the whole room feels the clock ticking, but only the
 * host's timer is authoritative for the transition (matching how the room already
 * treats the host as the only seat that can start / advance).
 *
 * Pure helpers, so the page stays thin and the arithmetic (clamping, ceil) is
 * unit-tested rather than eyeballed in DOM glue.
 */

/** Seconds a question stays open before it auto-reveals. A slow player gets
 *  the full window, but the room never waits it out when everyone has already
 *  answered — the server auto-reveals the moment the last seat buzzes. */
export const QUESTION_SECONDS = 20;

/** Seconds a clean reveal lingers — every present player got it right, so
 *  there's nothing to study and the question snaps on. Mirrors flagQuiz's pace
 *  (a correct pick advances almost immediately). */
export const CLEAN_REVEAL_SECONDS = 0.9;

/** Seconds a reveal lingers when someone missed (a wrong pick or a timeout), so
 *  players get a beat to see the correct flag they didn't land — and read the
 *  name strip on the flag they wrongly picked. Same reason flagQuiz holds longer
 *  on a wrong answer than a right one. */
export const MISS_REVEAL_SECONDS = 2.5;

/**
 * How long the reveal lingers, keyed on whether the question was a clean sweep. A
 * clean question ({@link CLEAN_REVEAL_SECONDS}) moves fast; a missed one
 * ({@link MISS_REVEAL_SECONDS}) holds so the answer can be read.
 * @param {boolean} clean  every present player picked the correct answer
 * @returns {number}
 */
export function revealSecondsFor(clean) {
  return clean ? CLEAN_REVEAL_SECONDS : MISS_REVEAL_SECONDS;
}

/** Seconds before a draft **pick** auto-resolves. There is **no visible pick
 *  countdown** — choosing a category shouldn't feel rushed — so this is a long,
 *  invisible safety net: the host (authoritative for timing, like the reveal)
 *  fires a `forcePick` only if the picker is truly absent, so an AFK / dropped
 *  seat can't stall the show. A present player picks long before it. */
export const PICK_TIMEOUT_SECONDS = 45;

/** Seconds a between-rounds **break** lingers before the host advances to the
 *  next round. The break shows the round's MVP and the standings (with rank
 *  movement) — a beat to read where everyone landed, so it holds longer than a
 *  reveal. Host-authoritative like the reveal: the host's page counts this down
 *  and fires `next` when it elapses; other clients just render the break. Keyed
 *  to reading a scoreboard, not to a question, so it's a flat duration rather than
 *  the reveal's clean/miss split. */
export const ROUND_BREAK_SECONDS = 6;

/** Seconds the **round title card** holds before the first question of a new round
 *  begins (round 2..N — the opening round starts play straight away). A short
 *  beat announcing "Round 2 of 3 · Coffee · 5 questions" with who picked it; the
 *  question clock and veil start fresh *after* it, so it costs no answer time.
 *  Client-side and uniform — every client (host included) holds the same beat, so
 *  no clock drift is introduced (the host's authoritative reveal clock simply
 *  starts after the card, like everyone else's). */
export const ROUND_INTRO_SECONDS = 2;

/** Tricky mode: the reveal-timing options a host can pick per question category — a
 *  tile stays veiled until this fraction of the question window has elapsed, then
 *  it is fully clear. Every option is below 1, so a late decider always gets a
 *  clean look while an early buzzer gambled on partial detail for the speed bonus. */
export const REVEAL_OPTIONS = [0.2, 0.4, 0.6, 0.8];

/** Tricky mode is about flag *visibility*; the world-facts name reveal is about
 *  flag *identity* — a separate axis. On a world-facts question the answer is a fact
 *  ("which grows the most coffee?"), not flag recognition, so a player who knows
 *  the fact but can't pick the country's flag out of four is blocked on the wrong
 *  skill. Three seconds in, the country names fade onto the tiles, so an early
 *  flag-recognizer still buzzes first for the speed bonus while a fact-knower
 *  gets a fair shot once the labels land. Applies to metric questions only,
 *  independent of tricky mode.
 *
 *  **Fixed, not configurable.** This was a host-configurable fraction of the
 *  window (40/50/60/80%, or off) — four options and an off switch for a beat
 *  nobody had a reason to tune, which cost a picker in the lobby, a field on
 *  every question message, and a validator. A fixed 3 s reads the same in a
 *  20-second window as in any future one, and is a plain number rather than a
 *  fraction the host has to convert in their head. */
export const NAME_REVEAL_SECONDS = 3;

/** Default reveal fraction per question category. Flags stay obscured longest (they
 *  carry the most give-away detail); outlines clear earlier (a monochrome
 *  silhouette is already hard, and grey does nothing to it); metric questions clear
 *  earliest (the flags are incidental there — the question is the number — so the
 *  veil is just flavour). The host can override each in the lobby. */
export const DEFAULT_REVEAL = { flag: 0.8, map: 0.4, metric: 0.2 };

/**
 * Whether a question plays a world metric (population / area / GDP / coffee / …).
 * Every superlative instance shares the `superlative` id prefix (`superlative`
 * for population, `superlative-area`, `superlative-coffee`, …), so one prefix
 * test catches them all — unlike {@link revealCategoryFor}, which only maps the
 * literal `superlative` id to `metric`. Used to decide which questions get the
 * name-reveal strip.
 * @param {string} [questionId]
 * @returns {boolean}
 */
export function isMetricQuestion(questionId) {
  return typeof questionId === 'string' && questionId.startsWith('superlative');
}

/**
 * The reveal category for a question, from its `questionId`: the map question is `map`,
 * the population / superlative question is `metric`, and every flag-pick question
 * (sovereign or territory) is `flag`. Both flag modes share one category — the
 * distinction that matters to the veil is flags vs outlines vs numbers.
 * @param {string} [questionId]
 * @returns {'flag' | 'map' | 'metric'}
 */
export function revealCategoryFor(questionId) {
  if (questionId === 'mapPick') return 'map';
  if (questionId === 'superlative') return 'metric';
  return 'flag';
}

/**
 * Snap an untrusted reveal fraction to the nearest allowed option, or fall back
 * to `fallback` when it isn't a usable number — so a host's pick (or a malformed
 * wire value) always lands inside the {20, 40, 60, 80}% set the UI offers.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function clampReveal(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  let best = REVEAL_OPTIONS[0];
  for (const opt of REVEAL_OPTIONS) {
    if (Math.abs(opt - value) < Math.abs(best - value)) best = opt;
  }
  return best;
}

/**
 * Sanitize an untrusted per-category reveal config into a full `{ flag, map,
 * metric }` with every value snapped to an allowed option, defaulting anything
 * missing. The server must never trust a client-supplied reveal config directly.
 * @param {unknown} reveal
 * @returns {{ flag: number, map: number, metric: number }}
 */
export function validateReveal(reveal) {
  const r = (reveal && typeof reveal === 'object') ? /** @type {any} */ (reveal) : {};
  return {
    flag: clampReveal(r.flag, DEFAULT_REVEAL.flag),
    map: clampReveal(r.map, DEFAULT_REVEAL.map),
    metric: clampReveal(r.metric, DEFAULT_REVEAL.metric),
  };
}

/**
 * Veil progress in [0, 1] for the tricky-mode reveal: 0 = fully hidden (grey,
 * blurred, panels covering the tile), 1 = fully clear. Reaches 1 at `clearFrac`
 * of the way through the question window and then holds clear. Clamped both ends
 * so a late tick or a reconnect that lands past the deadline never yields a
 * value outside [0, 1].
 *
 * @param {number} deadlineMs  epoch ms the question ends
 * @param {number} nowMs  current epoch ms
 * @param {number} totalMs  the question's full length in ms
 * @param {number} clearFrac  fraction of the window to reach full clarity by
 * @returns {number}
 */
export function veilProgress(deadlineMs, nowMs, totalMs, clearFrac) {
  if (totalMs <= 0 || clearFrac <= 0) return 1;
  const elapsed = totalMs - (deadlineMs - nowMs);
  return Math.min(1, Math.max(0, elapsed / (totalMs * clearFrac)));
}

/**
 * Whether a question's tiles are veiled (tricky mode's grey/blur/panel resolve).
 * Two rules, and deliberately no third:
 *
 * - the host's tricky setting decides it, and nothing else. The final round used
 *   to veil regardless — which made the veil something a host could neither
 *   predict nor turn off, and in draft, where the toggle is never offered, it
 *   appeared out of nowhere for the closing round. The finale reads as the finale
 *   through double points instead.
 * - **never on a statistics question.** The veil is a flag / outline recognition
 *   challenge; on a "which grows the most coffee?" question the flag is
 *   incidental, so hiding it tests the wrong skill. Statistics questions get the
 *   name reveal for their own flag-identity problem instead.
 *
 * Lives here rather than in the page so both rules are pinned by tests — they
 * have each been wrong in production once.
 *
 * @param {boolean} tricky  the host's tricky-mode setting
 * @param {string} [questionId]  the question being shown
 * @returns {boolean}
 */
export function veilActive(tricky, questionId) {
  if (isMetricQuestion(questionId)) return false;
  return tricky === true;
}

/**
 * Whether the world-facts country names should be shown yet: true once
 * {@link NAME_REVEAL_SECONDS} have elapsed in the question window. Reads the same
 * clock as the veil and the countdown, so every client flips the names on at the
 * same instant. A window already past its deadline reads as revealed.
 *
 * The caller decides *whether* a question gets names at all (metric questions
 * only — see {@link isMetricQuestion}); this only answers *when*.
 *
 * @param {number} deadlineMs  epoch ms the question ends
 * @param {number} nowMs  current epoch ms
 * @param {number} totalMs  the question's full length in ms
 * @returns {boolean}
 */
export function namesRevealed(deadlineMs, nowMs, totalMs) {
  if (totalMs <= 0) return true;
  const elapsed = totalMs - (deadlineMs - nowMs);
  return elapsed >= NAME_REVEAL_SECONDS * 1000;
}

/**
 * Whole seconds left until `deadlineMs`, never negative. Ceil so a freshly-set
 * 15,000 ms deadline reads "15" and the display only reaches "0" at true expiry
 * (a floor would flash "0" for the whole final second).
 *
 * @param {number} deadlineMs  epoch ms when the phase ends
 * @param {number} nowMs  current epoch ms
 * @returns {number}
 */
export function secondsLeft(deadlineMs, nowMs) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * Fraction of the phase still remaining, in [0, 1], for a shrinking bar: 1 at
 * the start, 0 at (or past) the deadline. Clamped both ends so a late tick or a
 * reconnect that arrives past the deadline never yields a negative or >1 width.
 *
 * @param {number} deadlineMs
 * @param {number} nowMs
 * @param {number} totalMs  the phase's full length in ms
 * @returns {number}
 */
export function remainingFraction(deadlineMs, nowMs, totalMs) {
  if (totalMs <= 0) return 0;
  const frac = (deadlineMs - nowMs) / totalMs;
  return Math.min(1, Math.max(0, frac));
}
