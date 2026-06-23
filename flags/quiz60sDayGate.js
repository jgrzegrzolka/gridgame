/**
 * Decide whether a 60s-mode finish should be recorded on the
 * `quiz60sDayLog` for streak purposes.
 *
 * Pre-fix, every "finish" (timer end OR explicit give-up) added today
 * to the log, even when the player made zero picks. That broke the
 * spirit of the streak achievements — "Sprint Habit" / "Steady
 * Sprinter" / "Monthly Sprinter" / "Quiz Centurion" all measure
 * actual engagement, not "page open + tab close".
 *
 * The gate: the round counts toward the streak iff the player made at
 * least one pick (correct OR wrong). A natural timer-end with zero
 * answers, OR an immediate give-up, doesn't count.
 *
 * Why this threshold:
 *   - One correct pick: clearly engaged.
 *   - One wrong pick: also clearly engaged (tried and missed).
 *   - Zero picks: either bailed instantly OR sat through 60s without
 *     touching anything — neither is "playing" by the achievement's
 *     intent.
 *
 * Pure decision function, no DOM, no clock — same shape as
 * `shouldPushQuizRecord` in `quizRecordThrottle.js`. Tests inject all
 * inputs.
 *
 * @param {{ answeredCount: number, wrongCount: number }} args
 * @returns {boolean}
 */
export function shouldRecordQuiz60sDay({ answeredCount, wrongCount }) {
  const answered = Number.isInteger(answeredCount) && answeredCount > 0 ? answeredCount : 0;
  const wrong = Number.isInteger(wrongCount) && wrongCount > 0 ? wrongCount : 0;
  return (answered + wrong) > 0;
}
