import {
  MODES,
  isTimedMode,
  shouldShowBestTime,
  formatBestScoreLabel,
  formatTime,
  accuracyRatio,
} from '../flags/quiz.js';

/**
 * What the result screen leads with.
 *
 * A round can end in two genuinely different ways, and the old screen said
 * the same thing about both: a labelled score, a time, and a best line. But
 * in 60s the time is *always* the budget unless you cleared the pool — so
 * "Time: 1:00.000" was printing a constant — and once you HAVE cleared the
 * pool the score is always the pool size, so the score is the constant and
 * the time is the only thing that varies.
 *
 * So the headline swaps: normally the score is the hero, and on a clean
 * sweep the clock is.
 */

/**
 * Did this round clear the whole pool with time to spare?
 *
 * Three conditions, and the third is the subtle one. Clearing the pool at the
 * exact moment the budget expires records a time of exactly the budget, which
 * says nothing — it's the same number every timed-out round produces. That is
 * precisely the rule `shouldShowBestTime` already encodes for the stats
 * screen, so this reads it rather than restating it.
 *
 * Untimed rounds never qualify: there is no clock to have beaten.
 *
 * @param {{ modeKey: string, answeredCount: number, target: number, budgetUsed: number, gaveUp: boolean }} args
 * @returns {boolean}
 */
export function clearedWholePool({ modeKey, answeredCount, target, budgetUsed, gaveUp }) {
  if (gaveUp) return false;
  if (!isTimedMode(modeKey)) return false;
  if (target <= 0 || answeredCount < target) return false;
  return shouldShowBestTime(modeKey, { time: budgetUsed });
}

/**
 * The result screen as data: what to print big, what colour it is, and what
 * the quiet line under it says.
 *
 * Strings that are numbers get formatted here (they are pure); words come
 * from the caller's `t`, so this module stays out of i18n's way. `recordScore`
 * and `recordTime` are separate because the caller joins them with the
 * translated "in".
 *
 * @param {{
 *   modeKey: string,
 *   answeredCount: number,
 *   wrongCount: number,
 *   target: number,
 *   budgetUsed: number,
 *   elapsedMs: number,
 *   gaveUp: boolean,
 *   best: { score: number, time: number },
 * }} args
 * @returns {{
 *   clearedAll: boolean,
 *   headline: string,
 *   colorRatio: number,
 *   detail: string | null,
 *   recordScore: string | null,
 *   recordTime: string | null,
 * }}
 */
export function quizResultView({
  modeKey, answeredCount, wrongCount, target, budgetUsed, elapsedMs, gaveUp, best,
}) {
  const timed = isTimedMode(modeKey);

  if (clearedWholePool({ modeKey, answeredCount, target, budgetUsed, gaveUp })) {
    return {
      clearedAll: true,
      // The clock is the hero. The score is still shown, demoted to the line
      // below as "44 / 44" — it is the thing that made this screen happen,
      // but it can no longer distinguish one clean sweep from another.
      headline: formatTime(budgetUsed),
      // Full green, not accuracy-tinted. Clearing the pool IS the ceiling;
      // shading it by how many you fumbled on the way would make the best
      // possible outcome render as a mediocre colour.
      colorRatio: 1,
      detail: `${answeredCount} / ${target}`,
      recordScore: null,
      recordTime: formatTime(best.time),
    };
  }

  // Timed: there is no "out of target" to measure against (the round ends on
  // the clock, not on the pool), so tint by accuracy — a clean run is green, a
  // coin-flip round amber, all-wrong red. Untimed is one-shot per question, so
  // correct + wrong = target and the ratio is against the pool.
  const picks = answeredCount + wrongCount;
  const colorRatio = timed
    ? (picks === 0 ? 0 : answeredCount / picks)
    : accuracyRatio(wrongCount, target);

  return {
    clearedAll: false,
    headline: timed ? String(answeredCount) : `${answeredCount}/${target}`,
    colorRatio,
    detail: null,
    recordScore: formatBestScoreLabel(modeKey, best, target),
    // Only when it means something. In 60s that is never on this branch —
    // an unfinished pool always burns the whole budget — so the record line
    // stays a bare score there, and carries a time in the untimed mode where
    // it is the only thing separating two identical scores.
    recordTime: shouldShowBestTime(modeKey, best) ? formatTime(best.time) : null,
  };
}

/** Exposed for the test that pins the two modes this view knows about. */
export const KNOWN_MODES = Object.keys(MODES);
