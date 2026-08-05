/**
 * Pure logic for the result screen's "most common mistake" rail — the
 * distractor flags other players clicked by mistake on this puzzle. No
 * DOM, no network — `daily/page.js` renders the shape these return.
 *
 * (The old "Najczęściej rozpoznane" ranking of every target by find rate
 * was removed — it duplicated the per-tile %s already on the grids.)
 *
 * Two pieces:
 *   - `pickMistakes` sorts every wrong-clicked flag by how many players
 *     clicked it (desc, alphabetical tie-break for a stable render).
 *   - `splitMistakeRail` decides what the collapsed vs expanded rail
 *     shows: collapsed surfaces the *repeated* mistakes (≥ 2 players),
 *     capped, so a one-off click by a single player doesn't read as "a
 *     common mistake"; expanding reveals the full list. When no mistake
 *     is repeated it falls back to the singles rather than collapsing to
 *     nothing — see the note on `tiles` below.
 */

/** Max repeated-mistake tiles shown in the collapsed rail. */
export const MISTAKE_COLLAPSE_CAP = 6;

/**
 * @typedef {{ totalAttempts: number, perWrongCode?: Record<string, number> }} StatsInput
 * @typedef {{ code: string, count: number }} MistakePick
 */

/**
 * Every wrong-clicked flag, sorted most-clicked → least, alphabetical
 * within a tie. Empty when there are no submissions or the (legacy
 * cached) response carries no `perWrongCode`.
 *
 * @param {{ stats: StatsInput | null | undefined }} input
 * @returns {MistakePick[]}
 */
export function pickMistakes({ stats }) {
  if (!stats || !stats.totalAttempts) return [];
  const perWrongCode = stats.perWrongCode;
  if (!perWrongCode) return [];
  return Object.entries(perWrongCode)
    .map(([code, count]) => ({ code, count: /** @type {number} */ (count) }))
    .filter((e) => e.count > 0)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.code < b.code ? -1 : 1;
    });
}

/**
 * Split a sorted mistake list into the tiles to render plus the counts
 * the rail's controls need.
 *
 *   - `tiles`          — collapsed: the repeated (≥ 2) mistakes, capped at
 *                        `MISTAKE_COLLAPSE_CAP`; expanded: the whole list.
 *                        **When nothing is repeated, collapsed falls back
 *                        to the singles** (same cap). Otherwise the first
 *                        player on a puzzle — every count is 1, so nothing
 *                        is "repeated" — would get an empty rail, and the
 *                        rail is the only place a player's own wrong
 *                        clicks appear at all (the Found / Missed grids
 *                        are built from the targets, so a distractor they
 *                        clicked is in neither).
 *   - `totalCount`     — every distinct mistake (drives "pokaż wszystkie
 *                        pomyłki (N)").
 *   - `repeatedCount`  — how many were clicked by ≥ 2 players.
 *   - `singlesCount`   — one-off (single-player) mistakes.
 *   - `collapsedCount` — how many tiles the *collapsed* rail renders. The
 *                        caller compares it against `totalCount` to decide
 *                        whether an expand toggle is needed; deriving that
 *                        from `repeatedCount` would offer "show all (2)"
 *                        over an already-complete two-tile fallback rail.
 *
 * @param {MistakePick[]} mistakes sorted output of `pickMistakes`
 * @param {boolean} expanded
 */
export function splitMistakeRail(mistakes, expanded) {
  const repeated = mistakes.filter((m) => m.count >= 2);
  const collapsed = (repeated.length > 0 ? repeated : mistakes).slice(0, MISTAKE_COLLAPSE_CAP);
  return {
    tiles: expanded ? mistakes : collapsed,
    totalCount: mistakes.length,
    repeatedCount: repeated.length,
    singlesCount: mistakes.length - repeated.length,
    collapsedCount: collapsed.length,
  };
}
