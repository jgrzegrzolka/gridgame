/**
 * Format the single-line community-stats headline shown below the
 * found/missed lists.
 *
 *   "Average today: 2.5/6"
 *
 * Returns the formatted string or null when there's nothing meaningful
 * to display (no submissions yet).
 *
 * **Wording note:** we label the median value as "Average" because
 * that's the plain-English word most players reach for. The code
 * still computes the median (sees `stats.median`) because it's the
 * better "typical value" measure for this kind of data — one perfect
 * attempt or one give-up doesn't distort it the way a mean would.
 *
 * Earlier shipped a second "detail" line ("X plays · Hardest: …") but
 * at low N (typical for an early-traffic puzzle) both pieces felt
 * awkward: "3 plays" is a low-traffic admission, and "12% found" at
 * N=3 is misleadingly precise (only 0/33/67/100% are possible). The
 * per-tile overlays still carry the per-flag detail, so the headline
 * + per-tile %s are enough. A proper percentile line ("you're in the
 * top X%") is the future replacement — see FEATURE.md for the plan.
 */

/**
 * @param {{
 *   stats: { totalAttempts: number, median: number } | null | undefined,
 *   totalCount: number,
 *   template: string,
 * }} args
 * @returns {string | null}
 */
export function formatStatsHeadline({ stats, totalCount, template }) {
  if (!stats || stats.totalAttempts === 0) return null;
  return interpolate(template, {
    average: stats.median,
    total: totalCount,
  });
}

/**
 * Replace `{key}` placeholders in `s` with the corresponding value
 * from `vars`. Unknown keys are left as-is (so a typo in the template
 * is visible rather than silently dropped).
 */
function interpolate(s, vars) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
