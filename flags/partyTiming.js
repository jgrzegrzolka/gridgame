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

/** Tricky mode: the fraction of the question window over which a veiled tile
 *  resolves from fully hidden to fully clear. Flags stay obscured longer (they
 *  carry more give-away detail, so a 70% window keeps them tricky well past the
 *  midpoint); outlines clear sooner (a monochrome silhouette is already hard, and
 *  grey does nothing to it, so 40% is plenty). Both are below 1, so the tile is
 *  fully readable before time runs out — a late decider still gets a clean look,
 *  while an early buzzer gambled on partial detail for the speed bonus. */
export const FLAG_CLEAR_FRACTION = 0.7;
export const OUTLINE_CLEAR_FRACTION = 0.4;

/**
 * The tricky-mode clear fraction for a round, keyed on whether its tiles are
 * country outlines (the map round) rather than flags.
 * @param {boolean} isOutline
 * @returns {number}
 */
export function veilClearFraction(isOutline) {
  return isOutline ? OUTLINE_CLEAR_FRACTION : FLAG_CLEAR_FRACTION;
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
