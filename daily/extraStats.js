/**
 * Pure picker logic for the two rail sections that sit below the
 * stats caption: a single ranking of every puzzle flag by find rate,
 * plus the most common wrong-clicks. No DOM, no network — `daily/page.js`
 * consumes the result and renders.
 *
 * The ranking shows every target code with its community find pct,
 * sorted most-found → least-found (tie-break alphabetical). One row
 * instead of two ("Mostly guessed" + "Most missed") so the player can
 * read the difficulty gradient across the whole puzzle at a glance.
 * The green/red corner marker (set in page.js via pickMarkerKind) tells
 * them which flags they personally got vs. missed.
 *
 * The mistakes row aims for the TARGET top wrong-clicked flags but
 * grows past it whenever the count at position TARGET ties with the
 * next entries — otherwise a single shared count would arbitrarily
 * hide every tied flag except the alphabetically-first. The MAX cap
 * keeps a pathological all-tied puzzle (e.g. 30 distractors each
 * clicked once) from blowing out the rail.
 */

export const MISTAKE_TARGET = 10;
export const MISTAKE_MAX = 20;
/**
 * The collapsed "Most common mistake" rail shows only the genuinely-shared
 * mistakes (count ≥ 2), capped at this many tiles. The one-off (×1) mistakes
 * and any overflow sit behind the "pokaż wszystkie pomyłki" toggle so the
 * resting rail stays a tight glance, not a wall of single clicks.
 */
export const MISTAKE_COLLAPSED_CAP = 6;
/**
 * The most tied-difficulty flags a single hardest/easiest fact will name
 * inline before collapsing the rest to a "+N" tail — so an all-tied puzzle
 * doesn't spell out a dozen countries on one line.
 */
export const DIFFICULTY_FACT_MAX = 3;

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
 * Decide the per-tile corner marker for the extra-stats rail. The player's
 * own found / wrong sets are the source of truth for "what did I do here":
 *
 *   - 'found'  → code is in userFoundCodes (player got it right). Green dot.
 *   - 'missed' → code is in targetCodes but NOT in userFoundCodes (player
 *                saw it and didn't get it). Red dot.
 *   - 'wrong'  → code is a distractor the player clicked (in userWrongCodes).
 *                Only occurs on the topMistake row, whose tiles are all
 *                distractors. Marks "I made this mistake too."
 *   - null     → none of the above (a distractor the player did NOT click).
 *
 * The three markable states are naturally partitioned by row: the ranking row
 * holds only targets (found / missed), the topMistake row only distractors
 * (wrong / null), so a code never qualifies for two. `userWrongCodes` is
 * optional — when absent (old record with no persisted `w`, or an in-progress
 * caller) the topMistake row stays unmarked rather than guessing.
 *
 * @param {{ code: string, targetCodes: Set<string>, userFoundCodes: Set<string>, userWrongCodes?: Set<string> }} input
 * @returns {'found' | 'missed' | 'wrong' | null}
 */
export function pickMarkerKind({ code, targetCodes, userFoundCodes, userWrongCodes }) {
  if (userFoundCodes.has(code)) return 'found';
  if (targetCodes.has(code)) return 'missed';
  if (userWrongCodes && userWrongCodes.has(code)) return 'wrong';
  return null;
}

/**
 * @typedef {{ pct: number, codes: string[], extra: number }} DifficultyFact
 *   `codes` names up to DIFFICULTY_FACT_MAX tied flags; `extra` is how many
 *   more share the same pct beyond those named (the "+N" tail).
 * @typedef {{ allEqual: true, pct: number } | { allEqual: false, hardest: DifficultyFact, easiest: DifficultyFact }} DifficultyFacts
 */

/**
 * The hardest and easiest flags of the puzzle, by community find-rate, for the
 * two-fact community line ("najtrudniejsza · Grenada 0% · najłatwiejsza · USA
 * 71%"). Hardest = lowest find-%, easiest = highest. Ties share the fact: up to
 * DIFFICULTY_FACT_MAX flags are named on each side, with `extra` counting the
 * rest.
 *
 * When every flag lands on the SAME find-% (e.g. all 100%) the two facts would
 * be identical and the per-tile % strips already repeat the number, so the
 * caller collapses to a single sentence — signalled by `allEqual: true` with
 * the shared `pct`.
 *
 * `null` when there are no stats to rank by (no submissions, or an empty
 * target list) — the caller renders no community facts at all.
 *
 * @param {{ stats: StatsInput | null | undefined, targetCodes: string[] }} input
 * @returns {DifficultyFacts | null}
 */
export function pickDifficultyFacts({ stats, targetCodes }) {
  if (!stats || !stats.totalAttempts) return null;
  if (!Array.isArray(targetCodes) || targetCodes.length === 0) return null;
  const { totalAttempts, perCodeFinds } = stats;
  const pcts = targetCodes.map((code) => ({
    code,
    pct: Math.round(((perCodeFinds[code] || 0) / totalAttempts) * 100),
  }));
  const min = Math.min(...pcts.map((p) => p.pct));
  const max = Math.max(...pcts.map((p) => p.pct));
  if (min === max) return { allEqual: true, pct: min };
  return {
    allEqual: false,
    hardest: factAt(pcts, min),
    easiest: factAt(pcts, max),
  };
}

/**
 * Collect every code at exactly `pct` into one difficulty fact: the codes
 * sorted alphabetically (stable across renders), the first DIFFICULTY_FACT_MAX
 * named, the remainder counted in `extra`.
 *
 * @param {{ code: string, pct: number }[]} pcts
 * @param {number} pct
 * @returns {DifficultyFact}
 */
function factAt(pcts, pct) {
  const codes = pcts.filter((p) => p.pct === pct).map((p) => p.code).sort();
  return {
    pct,
    codes: codes.slice(0, DIFFICULTY_FACT_MAX),
    extra: Math.max(0, codes.length - DIFFICULTY_FACT_MAX),
  };
}

/**
 * @typedef {{ collapsed: MistakePick[], all: MistakePick[], total: number, hidden: number }} MistakeRail
 *   `collapsed` = the resting rail (count ≥ 2, capped). `all` = the full list
 *   revealed by "pokaż wszystkie pomyłki". `total` = all.length (the toggle's
 *   count). `hidden` = how many entries only appear when expanded (the tail's
 *   count — overwhelmingly the ×1 one-off mistakes).
 */

/**
 * Split the community's wrong-clicks into the collapsed rail vs. the full list.
 * The resting rail names only shared mistakes (count ≥ 2, capped at
 * MISTAKE_COLLAPSED_CAP); everything else — the long tail of one-off clicks —
 * hides behind the expand toggle. `all` is capped at MISTAKE_MAX so a
 * pathological puzzle (100 distractors clicked once each) can't blow out the
 * expanded list either.
 *
 * @param {{ stats: StatsInput | null | undefined }} input
 * @returns {MistakeRail}
 */
export function pickMistakeRail({ stats }) {
  const perWrongCode = stats && stats.perWrongCode;
  const sorted = perWrongCode
    ? Object.entries(perWrongCode)
        .map(([code, count]) => ({ code, count: /** @type {number} */ (count) }))
        .filter((e) => e.count > 0)
        .sort((a, b) => {
          if (a.count !== b.count) return b.count - a.count;
          return a.code < b.code ? -1 : 1;
        })
    : [];
  const all = sorted.slice(0, MISTAKE_MAX);
  const collapsed = all.filter((e) => e.count >= 2).slice(0, MISTAKE_COLLAPSED_CAP);
  return { collapsed, all, total: all.length, hidden: all.length - collapsed.length };
}

/**
 * @param {{ stats: StatsInput }} input
 * @returns {MistakePick[]}
 */
function pickTopMistake({ stats }) {
  const perWrongCode = stats.perWrongCode;
  if (!perWrongCode) return [];
  const sorted = Object.entries(perWrongCode)
    .map(([code, count]) => ({ code, count: /** @type {number} */ (count) }))
    .filter((e) => e.count > 0)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.code < b.code ? -1 : 1;
    });
  if (sorted.length <= MISTAKE_TARGET) return sorted.slice(0, MISTAKE_MAX);
  const cutoffCount = sorted[MISTAKE_TARGET - 1].count;
  let end = MISTAKE_TARGET;
  while (end < sorted.length && end < MISTAKE_MAX && sorted[end].count === cutoffCount) {
    end++;
  }
  return sorted.slice(0, end);
}
