/**
 * Build the share-sheet title line for a finished flagQuiz round.
 *
 * Two modes differ only in how the score reads:
 *   - timed (60s):  "{correct}"           e.g. 23
 *   - count (all):  "{correct}/{target}"  e.g. 47/54
 *
 * Both end up substituted into the same outer template
 * ("Yet Another Quiz — Europe 60s — 23"). The caller passes already-
 * localized variant and mode labels so this module stays free of i18n
 * state.
 *
 * @param {{
 *   template: string,
 *   variant: string,
 *   mode: string,
 *   timed: boolean,
 *   correct: number,
 *   target: number,
 * }} args
 * @returns {string}
 */
export function buildQuizShareTitle({ template, variant, mode, timed, correct, target }) {
  const score = timed ? String(correct) : `${correct}/${target}`;
  return template
    .replace('{variant}', variant)
    .replace('{mode}', mode)
    .replace('{score}', score);
}
