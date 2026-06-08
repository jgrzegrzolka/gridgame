/**
 * Difficulty scoring for daily-catalog entries. Pure logic — no DOM, no
 * fetch, no I/O. Used by author tools (backlog ordering, ideas-page
 * sort, future generator) to rank puzzles from easy to hard. Advisory:
 * the author can override; soft rule 8 in the daily-puzzle-author skill
 * still owns the hard caps by N.
 *
 * Philosophy:
 *
 *   score = mean(nameScore)                         // primary: typical fame
 *         + 0.4 × max(0, max − mean − 1.5)          // outlier bump
 *         + sizeAdjust                              // U-shape
 *         + 0.1 × max(0, tokenCount − 2)            // compound friction
 *
 * `mean` (not `max`) is the primary signal because the *typical*
 * country drives the player's experience. A puzzle of 5 famous + 1
 * Vatican plays mostly easy — the player gets 5/6 and feels fine.
 * Vatican adds *some* drag (the outlier bump) but doesn't dominate.
 *
 * `sizeAdjust` is a U-shape — small AND large sets are harder than
 * the 4-15 sweet spot. 1-flag puzzles get a categorical +2.0: with
 * only one answer there's no margin (wrong guesses give nothing).
 * Large sets (16-30) grow harder because *recall* load grows even
 * when each country is famous — "list all 27 EU members" is genuinely
 * harder than "list 9 European cross flags," same individual fame.
 *
 * The formula intentionally has small absolute differences (most
 * puzzles cluster between 1.5 and 6.0) — the rank order matters, the
 * absolute numbers are not a measurement.
 *
 * If you change the math here, update the calibration anchors in
 * `daily/difficulty.test.js` AND the SKILL.md anchors in lockstep.
 */

/**
 * @typedef {{ nameScore: number }} CountryLike
 *
 * @typedef {Object} DifficultyScore
 * @property {number} score        the composite difficulty (sort key)
 * @property {number} mean         mean nameScore across answers
 * @property {number} max          max nameScore across answers
 * @property {number} outlier      the outlier-bump contribution
 * @property {number} sizeAdjust   the size-bucket adjustment
 * @property {number} tokenAdjust  the compound-complexity adjustment
 * @property {number} setSize      answers.length
 * @property {number} tokens       token count in the filter string
 */

/**
 * Size bucket adjustment. Hard at the extremes (1 = +2, small = +0.3,
 * large = +0.2/+0.5), zero across the 4-15 sweet spot.
 *
 * @param {number} n
 * @returns {number}
 */
function sizeAdjustFor(n) {
  if (n === 1) return 2.0;
  if (n <= 3) return 0.3;
  if (n <= 15) return 0;
  if (n <= 25) return 0.2;
  return 0.5;
}

/**
 * Score one catalog entry for difficulty. Missing countries fall back
 * to `nameScore: 3` (mid-range) so a stale entry doesn't crash the
 * sort — the catalog-shape tests catch the missing-country case
 * separately.
 *
 * `byCode` accepts either a `Map<string, CountryLike>` or a plain
 * `Record<string, CountryLike>` so callers don't have to convert.
 *
 * @param {{ filter: string, answers: string[] }} entry
 * @param {Map<string, CountryLike> | Record<string, CountryLike>} byCode
 * @returns {DifficultyScore}
 */
export function scoreEntry(entry, byCode) {
  const lookup = byCode instanceof Map
    ? (/** @type {string} */ c) => byCode.get(c)
    : (/** @type {string} */ c) => byCode[c];

  const ns = entry.answers.map((c) => lookup(c)?.nameScore ?? 3);
  const sum = ns.reduce((s, v) => s + v, 0);
  const mean = sum / ns.length;
  const max = Math.max(...ns);
  const outlier = 0.4 * Math.max(0, max - mean - 1.5);
  const setSize = entry.answers.length;
  const sizeAdjust = sizeAdjustFor(setSize);
  const tokens = entry.filter.split(',').length;
  const tokenAdjust = 0.1 * Math.max(0, tokens - 2);
  const score = mean + outlier + sizeAdjust + tokenAdjust;

  return { score, mean, max, outlier, sizeAdjust, tokenAdjust, setSize, tokens };
}
