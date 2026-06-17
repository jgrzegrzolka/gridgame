/**
 * Pure filters for the dated catalog. The page hands these the full
 * `puzzles.json` array (each entry `{ n, date, … }`) and a Warsaw date
 * string (`YYYY-MM-DD`); they decide what the player is allowed to see.
 *
 * Comparison is lexicographic on YYYY-MM-DD — valid because the format
 * sorts identically to chronological order.
 */

/** @typedef {import('./daily.js').DailyPuzzle} DailyPuzzle */

/**
 * Entries whose release date has arrived in Warsaw. Future-dated
 * entries fall out — the page never sees them.
 *
 * @param {DailyPuzzle[]} entries
 * @param {string} today  YYYY-MM-DD in Warsaw time
 * @returns {DailyPuzzle[]}
 */
export function visiblePuzzles(entries, today) {
  return entries.filter((p) => typeof p.date === 'string' && p.date <= today);
}

/**
 * Today's puzzle = the highest-dated visible entry. Returns `null` when
 * the catalog has no entries released yet (only possible if the catalog
 * is empty or every entry is in the future).
 *
 * @param {DailyPuzzle[]} entries
 * @param {string} today  YYYY-MM-DD in Warsaw time
 * @returns {DailyPuzzle | null}
 */
export function latestPuzzle(entries, today) {
  const visible = visiblePuzzles(entries, today);
  if (visible.length === 0) return null;
  return visible.reduce((best, p) => (
    /** @type {string} */ (p.date) > /** @type {string} */ (best.date) ? p : best
  ));
}
