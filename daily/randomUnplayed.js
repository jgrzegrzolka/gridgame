/**
 * "Play a puzzle you haven't done yet" — the archive's shuffle action.
 *
 * A puzzle counts as **unplayed when `daily.scores` has no record for its
 * `n`**. A record is written when a run finishes or is given up, so
 * "has a record" is the same thing as "has been played". Deliberately NOT
 * keyed on `isCompleteRecord`: that predicate asks whether a record is
 * rich enough to re-render the result screen, which is a question about
 * old record shapes, not about whether the player has seen the puzzle.
 *
 * Today's puzzle is a candidate like any other. If it hasn't been played,
 * offering it is the single most useful thing the button can do.
 */

/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */
/** @typedef {import('./scores.js').DailyScore} DailyScore */

/**
 * Every catalog entry the player has no saved score for, in catalog order.
 *
 * @param {DailyPuzzle[]} catalog
 * @param {Record<number, DailyScore | undefined>} scores
 * @returns {DailyPuzzle[]}
 */
export function unplayedPuzzles(catalog, scores) {
  if (!Array.isArray(catalog)) return [];
  const played = scores || {};
  return catalog.filter((entry) => !played[entry.n]);
}

/**
 * Pick one unplayed puzzle at random, or null when there are none left.
 *
 * `rand` is injectable so the choice is testable; it must behave like
 * `Math.random` (in `[0, 1)`). The index is clamped anyway, because a
 * stub — or a hostile `Math.random` polyfill — returning exactly 1 would
 * otherwise index off the end of the pool and return `undefined`.
 *
 * @param {DailyPuzzle[]} catalog
 * @param {Record<number, DailyScore | undefined>} scores
 * @param {() => number} [rand]
 * @returns {DailyPuzzle | null}
 */
export function pickRandomUnplayed(catalog, scores, rand = Math.random) {
  const pool = unplayedPuzzles(catalog, scores);
  if (pool.length === 0) return null;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
  return pool[i];
}
