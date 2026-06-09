/**
 * Format the stats-panel headline for a finished daily puzzle.
 *
 * Two shapes:
 *   - score-only ("Your score: 5/9") — paint immediately on finish/revisit;
 *     stats may not have arrived (or may never arrive — failed fetch).
 *   - score-with-average ("Your score: 5/9 · Average score: 3/9") — paint
 *     once stats are in and totalAttempts > 0.
 *
 * **Wording note:** the "Average" value is actually the median (more
 * robust to outliers — one zero-finder + one perfect player don't skew
 * it). The label says Average because that's the plain-English word
 * people reach for.
 *
 * Caller looks up the templates via i18n.t() and passes them in. Keeps
 * the module decoupled from i18n's lookup mechanism and the templates
 * directly testable.
 */

/**
 * @param {{
 *   found: number,
 *   total: number,
 *   stats?: { totalAttempts: number, median: number } | null,
 *   templates: { scoreOnly: string, scoreWithAverage: string },
 * }} args
 * @returns {string}
 */
export function formatScoreLine({ found, total, stats, templates }) {
  if (stats && stats.totalAttempts > 0) {
    return interpolate(templates.scoreWithAverage, {
      found, total, average: stats.median,
    });
  }
  return interpolate(templates.scoreOnly, { found, total });
}

/**
 * Replace `{key}` placeholders in `s` with the corresponding value
 * from `vars`. Unknown keys are left as-is (so a typo in the template
 * is visible rather than silently dropped).
 */
function interpolate(s, vars) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
