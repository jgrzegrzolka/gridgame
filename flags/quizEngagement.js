/**
 * "Did the player actually engage with this quiz round?"
 *
 * Single source of truth for round-engagement gating. Replaces two
 * proxies that drifted apart:
 *   - Phase 5's `shouldPushQuizRecord` used `gaveUp` (a UI intent
 *     signal). That false-skipped give-ups with real progress, and
 *     false-fired timer-ends with zero picks.
 *   - The 60s day-log gate (this file's first version) used pick
 *     count directly. Correct, but only for one consumer.
 *
 * The pick-count proxy is the honest one: a round counts as "played"
 * iff the player made at least one pick — correct OR wrong. Anything
 * else (immediate give-up, walk away from a timer, sit through 60s
 * doing nothing) doesn't.
 *
 * Used by:
 *   - `flags/quizRecordThrottle.js#shouldPushQuizRecord` — gates the
 *     POST to /api/v1/quiz/record (so server's `attempts` /
 *     `lastPlayedAt` only bump on real plays).
 *   - `flagQuiz/page.js` 60s finish site — gates the bump to the
 *     `quiz60sDayLog` (so streak achievements only count real plays).
 *
 * Pure decision, no DOM, no clock. Defensive against malformed
 * inputs (negative / NaN / non-integer → treated as zero, never
 * crashes).
 *
 * @param {{ answeredCount: number, wrongCount: number }} args
 * @returns {boolean}
 */
export function madeAnyQuizPick({ answeredCount, wrongCount }) {
  const answered = Number.isInteger(answeredCount) && answeredCount > 0 ? answeredCount : 0;
  const wrong = Number.isInteger(wrongCount) && wrongCount > 0 ? wrongCount : 0;
  return (answered + wrong) > 0;
}
