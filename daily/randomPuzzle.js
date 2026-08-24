/**
 * "Give me a puzzle" — the archive's shuffle action.
 *
 * **Prefers one you haven't played, but always offers something.** The
 * first cut removed the dock item once every puzzle had a score, which
 * hid the feature from precisely the people who use the site most: the
 * regulars, who are the only ones who ever reach that state. A control
 * labelled "Random" that disappears for your best players is worse than
 * one that occasionally repeats a puzzle, and replaying is already a
 * first-class action here (every archive tile replays, and the result
 * screen has Play again).
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
 * Pick a puzzle at random, preferring ones with no saved score. Falls back
 * to the whole catalog once everything has been played, so the action is
 * only ever empty-handed when the catalog itself is empty.
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
export function pickRandomPuzzle(catalog, scores, rand = Math.random) {
  const unplayed = unplayedPuzzles(catalog, scores);
  const pool = unplayed.length > 0 ? unplayed : (Array.isArray(catalog) ? catalog : []);
  if (pool.length === 0) return null;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
  return pool[i];
}
