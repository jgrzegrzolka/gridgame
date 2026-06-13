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
 *         + worldwideBump                           // global search penalty
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
 * `worldwideBump` (+1.0) fires when the filter has no `continent:`
 * include token at all — the player has to search the whole globe
 * rather than a known region. "Find all cross + red flags" is much
 * harder than "find all European cross flags" because the mental
 * search space is ~200 countries instead of ~44. Exempt: single-token
 * filters using a "membership" motif (currently just `motif:eu-member`)
 * — those puzzles ask the player to recall a discrete known list
 * (which countries are in the EU), not to search.
 *
 * The formula intentionally has small absolute differences (most
 * puzzles cluster between 1.5 and 6.0) — the rank order matters, the
 * absolute numbers are not a measurement.
 *
 * If you change the math here, update the calibration anchors in
 * `daily/difficulty.test.js` AND the SKILL.md anchors in lockstep.
 */

/**
 * @typedef {{ nameScore?: number }} CountryLike
 *
 * @typedef {Object} DifficultyScore
 * @property {number} score             the composite difficulty (sort key)
 * @property {number} mean              mean nameScore across answers
 * @property {number} max               max nameScore across answers
 * @property {number} outlier           the outlier-bump contribution
 * @property {number} sizeAdjust        the size-bucket adjustment
 * @property {number} tokenAdjust       the compound-complexity adjustment
 * @property {number} worldwideAdjust   the global-search bump (0 or 1.0)
 * @property {number} setSize           answers.length
 * @property {number} tokens            token count in the filter string
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

// Motifs that act as membership-style filters — the player is asked
// to recall a discrete known list (e.g. "which countries are EU
// members") rather than to search by visual property. These don't
// get the worldwide bump even when they appear without a continent
// token, because the search isn't really global — the player either
// knows the list or doesn't.
const MEMBERSHIP_MOTIFS = new Set(['eu-member']);

/**
 * Worldwide bump: +1.0 when the filter forces the player to think
 * across the whole globe instead of a known region. Fires whenever
 * the filter has no `continent:X` include token. Single-token
 * membership filters are exempt — see `MEMBERSHIP_MOTIFS`.
 *
 * Why an include-only check (not `continent:!X` too): excluding a
 * single continent still leaves ~150-180 countries in scope and feels
 * worldwide to the player, so a partial half-credit was tempting —
 * but in practice authors using `continent:!X` tend to want it scored
 * like "worldwide minus a niche corner," so the simpler flat bump
 * matches behaviour better. Revisit if `!continent` puzzles start
 * landing too easy.
 *
 * @param {string} filter
 * @returns {number}
 */
function worldwideBumpFor(filter) {
  const tokens = filter.split(',');
  // Any include-form continent token disables the bump.
  if (tokens.some((t) => /^continent:[^!]/.test(t))) return 0;
  // Single-token membership motif → discrete recall puzzle, no bump.
  if (tokens.length === 1) {
    const m = tokens[0].match(/^motif:(.+)$/);
    if (m && MEMBERSHIP_MOTIFS.has(m[1])) return 0;
  }
  return 1.0;
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
 * @param {{ kind?: string, filter?: string, answers: string[] }} entry
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
  // Manual entries have no filter — no token-count friction, and the
  // worldwide bump applies (a hand-curated list with no continent
  // scoping forces the same global recall as a filter without a
  // continent token does).
  const isManual = entry.kind === 'manual' || typeof entry.filter !== 'string';
  const tokens = isManual ? 0 : entry.filter.split(',').length;
  const tokenAdjust = 0.1 * Math.max(0, tokens - 2);
  const worldwideAdjust = isManual ? 1.0 : worldwideBumpFor(entry.filter);
  const score = mean + outlier + sizeAdjust + tokenAdjust + worldwideAdjust;

  return { score, mean, max, outlier, sizeAdjust, tokenAdjust, worldwideAdjust, setSize, tokens };
}
