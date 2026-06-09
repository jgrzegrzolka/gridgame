/**
 * Format the two-line community-stats panel shown below the
 * found/missed lists.
 *
 *   line 1 (headline): "Average today: 2.5/6"
 *   line 2 (detail):   "3 plays · Hardest: Kazakhstan (12% found)"
 *
 * Returns `{ headline, detail }` or null when there's nothing
 * meaningful to display (no submissions yet).
 *
 * **Wording note:** we label the median value as "Average" because
 * that's the plain-English word most players reach for. The code
 * still computes the median (sees `stats.median`) because it's the
 * better "typical value" measure for this kind of data — one perfect
 * attempt or one give-up doesn't distort it the way a mean would.
 *
 * `targets` and `getCountryName` are needed to compute and localize
 * the "hardest" flag. When `perCodeFinds` is empty (nobody has found
 * anything yet — typical when the player is the first submitter with
 * a give-up), the hardest piece is dropped from the detail line.
 */

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * @param {{
 *   stats: { totalAttempts: number, median: number, perCodeFinds: Record<string, number> } | null | undefined,
 *   totalCount: number,
 *   targets: Country[],
 *   getCountryName: (c: Country) => string,
 *   templates: { headline: string, plays: string, hardest: string, separator?: string },
 * }} args
 * @returns {{ headline: string, detail: string } | null}
 */
export function formatStatsLines({ stats, totalCount, targets, getCountryName, templates }) {
  if (!stats || stats.totalAttempts === 0) return null;

  const headline = interpolate(templates.headline, {
    average: stats.median,
    total: totalCount,
  });

  const detailParts = [
    interpolate(templates.plays, { n: stats.totalAttempts }),
  ];
  const hardest = findHardest(stats.perCodeFinds, stats.totalAttempts, targets);
  if (hardest) {
    detailParts.push(interpolate(templates.hardest, {
      name: getCountryName(hardest.country),
      pct: hardest.pct,
    }));
  }
  const separator = templates.separator ?? ' · ';
  const detail = detailParts.join(separator);

  return { headline, detail };
}

/**
 * Pick the flag with the lowest find rate. Tie-break by country code
 * (alphabetical) so renders are deterministic.
 *
 * Returns null when `perCodeFinds` is empty — when literally nobody
 * has found anything, "hardest" is meaningless (every flag is equally
 * hard at 0%) and the piece is better dropped than misleading.
 */
function findHardest(perCodeFinds, totalAttempts, targets) {
  if (!perCodeFinds || Object.keys(perCodeFinds).length === 0) return null;
  if (!Array.isArray(targets) || targets.length === 0) return null;

  let hardest = null;
  for (const c of targets) {
    const finds = perCodeFinds[c.code] || 0;
    const pct = Math.round((finds / totalAttempts) * 100);
    if (hardest === null
        || pct < hardest.pct
        || (pct === hardest.pct && c.code < hardest.country.code)) {
      hardest = { country: c, pct };
    }
  }
  return hardest;
}

/**
 * Replace `{key}` placeholders in `s` with the corresponding value
 * from `vars`. Unknown keys are left as-is (so a typo in the template
 * is visible rather than silently dropped).
 */
function interpolate(s, vars) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
