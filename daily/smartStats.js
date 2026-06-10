/**
 * Pure picker + gating logic for the "Best known / Most missed / Most
 * common mistake" rows that sit below the per-tile % overlay. No DOM,
 * no network — `daily/page.js` consumes the result and renders.
 *
 * The whole block is *opt-in based on signal*. Every gate below exists
 * to avoid producing rows that would be pointlessly tautological
 * (perfect-streak puzzle: "Best known" is everything, "Most missed"
 * is nothing). When a section can't say anything interesting it
 * returns [], and the renderer skips it. If all three return [] the
 * renderer skips the block entirely — keeps the result page from
 * growing a stale-looking empty section.
 *
 * Note on minimum sample size: we used to gate the whole block at 5
 * submissions, but with the site's early-days community of 3–4 active
 * players that threshold suppressed the rail on nearly every puzzle.
 * The per-section rules below (top picks at 100%, bottom picks ≥80%,
 * mistake count ≥2) already prevent the worst single-player edge cases
 * on their own, so the global floor is gone.
 */

// Best known + Most missed only render for puzzles with at least this
// many flags. On a 3- or 4-flag puzzle the top-3 best and top-3 worst
// would overlap heavily (or fully) and the per-tile % already says it
// all without the redundant list.
export const MIN_TARGETS_FOR_FIND_SECTIONS = 5;

export const FIND_TOP_N = 3;
export const MISTAKE_TOP_N = 1;

// A single off-hand wrong click isn't a "trap". Require at least two
// players to have made the same mistake before naming it.
export const MIN_MISTAKE_COUNT = 2;

// "Best known" is uninteresting if all top picks are at 100% — every
// player found them. The per-tile overlay already shows that.
export const BEST_KNOWN_HIDE_AT_PCT = 100;

// "Most missed" is uninteresting if even the bottom-N flags were found
// by most players. 80% is the threshold below which a tile genuinely
// stumped a meaningful share of submissions.
export const MOST_MISSED_HIDE_AT_PCT = 80;

/**
 * @typedef {{ totalAttempts: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> }} StatsInput
 * @typedef {{ code: string, pct: number }} FindPick
 * @typedef {{ code: string, count: number }} MistakePick
 * @typedef {{ bestKnown: FindPick[], mostMissed: FindPick[], topMistake: MistakePick[] }} SmartPicks
 */

/**
 * @param {{ stats: StatsInput | null | undefined, targetCodes: string[] }} input
 * @returns {SmartPicks}
 */
export function pickSmartStats({ stats, targetCodes }) {
  if (!stats || !stats.totalAttempts) {
    return { bestKnown: [], mostMissed: [], topMistake: [] };
  }
  return {
    bestKnown: pickFindRanked({ stats, targetCodes, direction: 'best' }),
    mostMissed: pickFindRanked({ stats, targetCodes, direction: 'worst' }),
    topMistake: pickTopMistake({ stats }),
  };
}

/**
 * @param {SmartPicks} picks
 */
export function hasAnySmartStats(picks) {
  return picks.bestKnown.length > 0
    || picks.mostMissed.length > 0
    || picks.topMistake.length > 0;
}

/**
 * @param {{ stats: StatsInput, targetCodes: string[], direction: 'best' | 'worst' }} input
 * @returns {FindPick[]}
 */
function pickFindRanked({ stats, targetCodes, direction }) {
  if (!Array.isArray(targetCodes) || targetCodes.length < MIN_TARGETS_FOR_FIND_SECTIONS) return [];
  const { totalAttempts, perCodeFinds } = stats;
  // Project every target to its find rate, then sort + slice. Tie-break
  // by code so a 3-way tie at the cutoff yields the same trio on every
  // render — never a "random 3 of the 4" surprise.
  const ranked = targetCodes
    .map((code) => ({
      code,
      pct: Math.round(((perCodeFinds[code] || 0) / totalAttempts) * 100),
    }))
    .sort((a, b) => {
      if (a.pct !== b.pct) return direction === 'best' ? b.pct - a.pct : a.pct - b.pct;
      return a.code < b.code ? -1 : 1;
    })
    .slice(0, FIND_TOP_N);

  if (ranked.length === 0) return [];

  if (direction === 'best') {
    // Everyone got the top picks → nothing to celebrate that the
    // overlay isn't already saying.
    if (ranked.every((r) => r.pct >= BEST_KNOWN_HIDE_AT_PCT)) return [];
  } else {
    // Bottom picks are still mostly found → there is no "most missed"
    // worth showing.
    if (ranked.every((r) => r.pct >= MOST_MISSED_HIDE_AT_PCT)) return [];
  }
  return ranked;
}

/**
 * @param {{ stats: StatsInput }} input
 * @returns {MistakePick[]}
 */
function pickTopMistake({ stats }) {
  const perWrongCode = stats.perWrongCode;
  if (!perWrongCode) return [];
  return Object.entries(perWrongCode)
    .map(([code, count]) => ({ code, count: /** @type {number} */ (count) }))
    .filter((e) => e.count >= MIN_MISTAKE_COUNT)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.code < b.code ? -1 : 1;
    })
    .slice(0, MISTAKE_TOP_N);
}
