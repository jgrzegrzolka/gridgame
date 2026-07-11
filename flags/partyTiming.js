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
 *  there's nothing to study and the round snaps on. Mirrors flagQuiz's pace
 *  (a correct pick advances almost immediately). */
export const CLEAN_REVEAL_SECONDS = 0.9;

/** Seconds a reveal lingers when someone missed (a wrong pick or a timeout), so
 *  players get a beat to see the correct flag they didn't land — and read the
 *  name strip on the flag they wrongly picked. Same reason flagQuiz holds longer
 *  on a wrong answer than a right one. */
export const MISS_REVEAL_SECONDS = 2.5;

/**
 * How long the reveal lingers, keyed on whether the round was a clean sweep. A
 * clean round ({@link CLEAN_REVEAL_SECONDS}) moves fast; a missed one
 * ({@link MISS_REVEAL_SECONDS}) holds so the answer can be read.
 * @param {boolean} clean  every present player picked the correct answer
 * @returns {number}
 */
export function revealSecondsFor(clean) {
  return clean ? CLEAN_REVEAL_SECONDS : MISS_REVEAL_SECONDS;
}

/** Tricky mode: the reveal-timing options a host can pick per round category — a
 *  tile stays veiled until this fraction of the question window has elapsed, then
 *  it is fully clear. Every option is below 1, so a late decider always gets a
 *  clean look while an early buzzer gambled on partial detail for the speed bonus. */
export const REVEAL_OPTIONS = [0.2, 0.4, 0.6, 0.8];

/** Default reveal fraction per round category. Flags stay obscured longest (they
 *  carry the most give-away detail); outlines clear earlier (a monochrome
 *  silhouette is already hard, and grey does nothing to it); metric rounds clear
 *  earliest (the flags are incidental there — the question is the number — so the
 *  veil is just flavour). The host can override each in the lobby. */
export const DEFAULT_REVEAL = { flag: 0.8, map: 0.4, metric: 0.2 };

/**
 * The reveal category for a round, from its `roundId`: the map round is `map`,
 * the population / superlative round is `metric`, and every flag-pick round
 * (sovereign or territory) is `flag`. Both flag modes share one category — the
 * distinction that matters to the veil is flags vs outlines vs numbers.
 * @param {string} [roundId]
 * @returns {'flag' | 'map' | 'metric'}
 */
export function revealCategoryFor(roundId) {
  if (roundId === 'mapPick') return 'map';
  if (roundId === 'superlative') return 'metric';
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
