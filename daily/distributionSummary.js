/**
 * Format the one-line community-stats headline shown above the
 * found/missed lists. Pure: takes raw numbers + a localized template
 * with `{median}` `{total}` `{topPct}` `{attempts}` placeholders,
 * returns a string (or null when there's nothing meaningful to show).
 *
 * Returns null when:
 *   - stats is null/undefined (fetch failed)
 *   - totalAttempts === 0 (player is the first to submit — no
 *     comparison to make, no honest median, no "top X%" to report)
 *
 * Template placeholders supported:
 *   {median}    e.g. 3
 *   {total}     e.g. 9  (the puzzle's answer count)
 *   {topPct}    e.g. 12 (percent who got everything)
 *   {attempts}  e.g. 47 (total submissions so far)
 *
 * Caller looks up the template via i18n.t() and passes it in. Keeps
 * this module decoupled from i18n's lookup mechanism + makes the
 * interpolation directly testable without a fake t().
 */

/**
 * @param {{
 *   stats: { totalAttempts: number, median: number, topPct: number } | null | undefined,
 *   totalCount: number,
 *   template: string,
 * }} args
 * @returns {string | null}
 */
export function formatStatsHeadline({ stats, totalCount, template }) {
  if (!stats || stats.totalAttempts === 0) return null;
  return interpolate(template, {
    median: stats.median,
    total: totalCount,
    topPct: stats.topPct,
    attempts: stats.totalAttempts,
  });
}

/**
 * Replace `{key}` placeholders in `s` with the corresponding value
 * from `vars`. Unknown keys are left as-is (so a typo in the template
 * is visible rather than silently dropped).
 *
 * @param {string} s
 * @param {Record<string, number | string>} vars
 */
function interpolate(s, vars) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
