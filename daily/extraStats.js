/**
 * Pure picker logic for the two rail sections that sit below the
 * stats caption: a single ranking of every puzzle flag by find rate,
 * plus the most common wrong-click. No DOM, no network — `daily/page.js`
 * consumes the result and renders.
 *
 * The ranking shows every target code with its community find pct,
 * sorted most-found → least-found (tie-break alphabetical). One row
 * instead of two ("Mostly guessed" + "Most missed") so the player can
 * read the difficulty gradient across the whole puzzle at a glance.
 * The green/red corner marker (set in page.js via pickMarkerKind) tells
 * them which flags they personally got vs. missed.
 */

export const MISTAKE_TOP_N = 1;

/**
 * @typedef {{ totalAttempts: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> }} StatsInput
 * @typedef {{ code: string, pct: number }} CodePick
 * @typedef {{ code: string, count: number }} MistakePick
 * @typedef {{ ranking: CodePick[], topMistake: MistakePick[] }} ExtraPicks
 */

/**
 * @param {{ stats: StatsInput | null | undefined, targetCodes: string[] }} input
 * @returns {ExtraPicks}
 */
export function pickExtraStats({ stats, targetCodes }) {
  if (!stats || !stats.totalAttempts) {
    return { ranking: [], topMistake: [] };
  }
  return {
    ranking: pickRanking({ stats, targetCodes }),
    topMistake: pickTopMistake({ stats }),
  };
}

/**
 * @param {ExtraPicks} picks
 */
export function hasAnyExtraStats(picks) {
  return picks.ranking.length > 0 || picks.topMistake.length > 0;
}

/**
 * Every target code with its community find pct, sorted descending
 * by pct (alphabetical tie-break for stability across renders).
 *
 * @param {{ stats: StatsInput, targetCodes: string[] }} input
 * @returns {CodePick[]}
 */
function pickRanking({ stats, targetCodes }) {
  if (!Array.isArray(targetCodes) || targetCodes.length === 0) return [];
  const { totalAttempts, perCodeFinds } = stats;
  return targetCodes
    .map((code) => ({
      code,
      pct: Math.round(((perCodeFinds[code] || 0) / totalAttempts) * 100),
    }))
    .sort((a, b) => {
      if (a.pct !== b.pct) return b.pct - a.pct;
      return a.code < b.code ? -1 : 1;
    });
}

/**
 * Decide the per-tile corner marker for the extra-stats rail. The
 * player's foundCodes is the source of truth for "I got this":
 *
 *   - 'found'  → code is in userFoundCodes (player got it right). Green dot.
 *   - 'missed' → code is in targetCodes but NOT in userFoundCodes (player
 *                saw it and didn't get it). Red dot.
 *   - null     → code isn't a target at all (only happens on the topMistake
 *                row, whose tile is a distractor flag). No dot.
 *
 * The topMistake row is intentionally never marked: we don't store the
 * player's own wrongCodes in localStorage, so we can't reliably tell
 * "did I click this wrong myself" on revisit. The marker stays silent
 * rather than guess wrong.
 *
 * @param {{ code: string, targetCodes: Set<string>, userFoundCodes: Set<string> }} input
 * @returns {'found' | 'missed' | null}
 */
export function pickMarkerKind({ code, targetCodes, userFoundCodes }) {
  if (userFoundCodes.has(code)) return 'found';
  if (targetCodes.has(code)) return 'missed';
  return null;
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
    .filter((e) => e.count > 0)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.code < b.code ? -1 : 1;
    })
    .slice(0, MISTAKE_TOP_N);
}
