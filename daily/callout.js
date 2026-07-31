/**
 * Pure picker for the result screen's "callout line" — the one-line
 * summary of the round's community spread that sits above the mistake
 * rail: `najłatwiejsza · USA 71% · najtrudniejsza · Grenada 0%`. No DOM,
 * no network — `daily/page.js` renders the shape this returns.
 *
 * Find-rate is `perCodeFinds[code] / totalAttempts`, rounded to a whole
 * percent (the same number the per-tile strips show), so a tie is
 * decided on what the player actually sees. The two ends are evaluated
 * independently — one end can tie while the other stays singular:
 *
 *   - `kind: 'none'`     — no stats / no targets; render nothing.
 *   - `kind: 'allEqual'` — max % === min %, so there is no hardest end.
 *                          One end only: every target flag at the shared %.
 *   - `kind: 'spread'`   — distinct ends. `easiest` (highest %) and
 *                          `hardest` (lowest %) each carry every code tied
 *                          at that %; a single-code end renders with the
 *                          country name, a multi-code end as a flag row.
 *
 * Tied codes come out alphabetically for a stable render.
 */

/**
 * @typedef {{ totalAttempts: number, perCodeFinds: Record<string, number> }} StatsInput
 * @typedef {{ codes: string[], pct: number }} CalloutEnd
 * @typedef {{ kind: 'none' }
 *   | { kind: 'allEqual', codes: string[], pct: number }
 *   | { kind: 'spread', easiest: CalloutEnd, hardest: CalloutEnd }} Callout
 */

/**
 * @param {{ stats: StatsInput | null | undefined, targetCodes: string[] }} input
 * @returns {Callout}
 */
export function pickCallout({ stats, targetCodes }) {
  if (!stats || !stats.totalAttempts || !Array.isArray(targetCodes) || targetCodes.length === 0) {
    return { kind: 'none' };
  }
  const { totalAttempts, perCodeFinds } = stats;
  const rated = targetCodes.map((code) => ({
    code,
    pct: Math.round(((perCodeFinds[code] || 0) / totalAttempts) * 100),
  }));
  const pcts = rated.map((r) => r.pct);
  const max = Math.max(...pcts);
  const min = Math.min(...pcts);
  const codesAt = (pct) => rated.filter((r) => r.pct === pct).map((r) => r.code).sort();

  if (max === min) {
    return { kind: 'allEqual', codes: codesAt(max), pct: max };
  }
  return {
    kind: 'spread',
    easiest: { codes: codesAt(max), pct: max },
    hardest: { codes: codesAt(min), pct: min },
  };
}
