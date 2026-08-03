import {
  MODES,
  isTimedMode,
  shouldShowBestTime,
  formatBestScoreLabel,
  formatTime,
} from '../flags/quiz.js';

/**
 * What the result screen leads with.
 *
 * A round can end in two genuinely different ways, and the old screen said
 * the same thing about both: a labelled score, a time, and a best line. But
 * in 60s the time is *always* the budget unless you cleared the pool — so
 * "Time: 1:00.000" was printing a constant.
 *
 * The hero is the score in both endings. A clean sweep briefly led with the
 * clock instead, on the reasoning that the score had become the constant
 * there — true, but it made the one screen you earn the hardest the one
 * screen that measures you differently from every other. `44 / 44` is the
 * achievement; the time is what separates two clean sweeps, and separating
 * two of anything is subline work.
 *
 * The score's own shape follows the same "print what varies" rule. In 60s it
 * is a bare count: nobody comes close to the pool in a minute, so `38 / 195`
 * renders a good round as a fraction of a percent. Where you do go through
 * the whole pool — the untimed mode, and the stats page — the denominator is
 * the measure and stays.
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
 * `countUpTo` is the number the headline animates to on a fresh finish, or
 * null where the headline must not be animated. That is a per-ending rule,
 * not a caller preference: a stopwatch ticking up to your finishing time
 * implies a run that didn't happen — it reads as a replay of the round at
 * the wrong speed — so the time always arrives whole and only counts count
 * up. It lives here because it is decided by the same branch that decides
 * what the headline says.
 *
 * `isNew` suppresses the record text. The badge that fires on a personal
 * best already carries the news, and "rekord 53" directly under a 53 you
 * have just been congratulated for restates the number you are looking at.
 * Without a record the line is the plain record readback, as before.
 *
 * @param {{
 *   modeKey: string,
 *   answeredCount: number,
 *   target: number,
 *   budgetUsed: number,
 *   gaveUp: boolean,
 *   isNew?: boolean,
 *   best: { score: number, time: number },
 * }} args
 * There is no colour in this model. The headline used to be tinted by how
 * the round went — green for a strong one, amber for a middling one — and
 * it said two untrue things at once: it called a 38 "good" while the record
 * line under it said 51, and it put green on the screen every single round,
 * which is the one colour that now has to mean "you beat your best" and
 * nothing else. The number is ink; the record line supplies the judgement.
 *
 * `headlineSuffix` is whatever follows the number in `headline` — the
 * denominator, or nothing. The count-up needs it: while the number is
 * ticking, the caller renders `value + suffix`, and `headline` is what it
 * lands on. Returning the pieces rather than a formatting callback keeps
 * this module data-only, which is what makes its rules readable in tests.
 *
 * @returns {{
 *   clearedAll: boolean,
 *   headline: string,
 *   headlineSuffix: string,
 *   countUpTo: number | null,
 *   detail: string | null,
 *   recordScore: string | null,
 *   recordTime: string | null,
 * }}
 */
export function quizResultView({
  modeKey, answeredCount, target, budgetUsed, gaveUp, isNew = false, best,
}) {
  const timed = isTimedMode(modeKey);

  if (clearedWholePool({ modeKey, answeredCount, target, budgetUsed, gaveUp })) {
    return {
      clearedAll: true,
      // The score is the hero here as everywhere else — "44 / 44" with the
      // denominator, because on this one ending you did go through the whole
      // pool and the fraction is the point.
      headline: `${answeredCount} / ${target}`,
      headlineSuffix: ` / ${target}`,
      countUpTo: answeredCount,
      // The finish time, demoted to the quiet line: it can't tell you how
      // well you did, only which of two clean sweeps was quicker.
      detail: formatTime(budgetUsed),
      recordScore: null,
      // On a record the time you just set IS the record, and it is already
      // printed at the head of this line — the beaten one is noise.
      recordTime: isNew ? null : formatTime(best.time),
    };
  }

  return {
    clearedAll: false,
    // Bare count in 60s, fraction where the pool is actually finishable.
    headline: timed ? String(answeredCount) : `${answeredCount}/${target}`,
    headlineSuffix: timed ? '' : `/${target}`,
    countUpTo: answeredCount,
    detail: null,
    recordScore: isNew ? null : formatBestScoreLabel(modeKey, best, target),
    // Only when it means something. In 60s that is never on this branch —
    // an unfinished pool always burns the whole budget — so the record line
    // stays a bare score there, and carries a time in the untimed mode where
    // it is the only thing separating two identical scores.
    recordTime: (!isNew && shouldShowBestTime(modeKey, best)) ? formatTime(best.time) : null,
  };
}

/** Exposed for the test that pins the two modes this view knows about. */
export const KNOWN_MODES = Object.keys(MODES);
