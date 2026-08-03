import {
  MODES,
  loadBest,
  bestKey,
  formatBestScoreLabel,
} from '../flags/quiz.js';

/**
 * Your records, read as coverage of each pool rather than as a grid of slots.
 *
 * The old page showed eight rows × two mode chips = sixteen cells, each a
 * score in its own units: 60s counted flags found, "all" counted mistakes.
 * Nothing was comparable with anything else, so the page could not answer the
 * one question you go to it with — *what should I practise?*
 *
 * One measure per row fixes that. The **60s record** is the number, the bar
 * and the sort key, so rows line up against each other on sight and the
 * bottom of the list is the answer. The other mode doesn't disappear; it
 * drops to a quiet line, present only where it was actually played.
 *
 * Which mode wins that job isn't arbitrary: 60s is the mode the whole page
 * links into (tapping a row starts it), and it's the one with a leaderboard.
 */

/** The mode whose record is the row's headline number, bar, and sort key. */
export const HEADLINE_MODE = '60s';
/** The mode demoted to the quiet second line. */
export const SECONDARY_MODE = 'all';

/**
 * How many of a pool the player has ever got, in one mode.
 *
 * Both modes store a `Result` but mean opposite things by `score` — 60s
 * counts flags found, "all" counts mistakes — which is exactly the confusion
 * this page existed to create. `formatBestScoreLabel` already owns that
 * translation for the result screen, so the number is parsed back out of it
 * rather than re-deriving the same flip in a second place.
 *
 * @param {import('../flags/quiz.js').BestStore} store
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {number} poolSize
 * @returns {{ correct: number, ratio: number, label: string } | null} null when never played
 */
export function modeCoverage(store, variantKey, modeKey, poolSize) {
  const best = loadBest(store, bestKey(variantKey, modeKey));
  if (!best) return null;
  const label = formatBestScoreLabel(modeKey, best, poolSize);
  const correct = Number(label.split('/')[0]);
  return {
    correct,
    ratio: poolSize > 0 ? Math.min(1, correct / poolSize) : 0,
    label,
  };
}

/**
 * One pool's row.
 *
 * `headline` null means the row has no bar and no number — either the pool
 * was never played at all, or it was only played without a clock, which the
 * bar cannot represent because the bar measures the 60s record. The row still
 * renders, and tapping it still starts 60s; it simply has nothing to show yet.
 *
 * @param {import('../flags/quiz.js').BestStore} store
 * @param {{ key: string, poolSize: number }} pool
 * @returns {{
 *   key: string,
 *   poolSize: number,
 *   headline: { correct: number, ratio: number, label: string } | null,
 *   secondary: { correct: number, ratio: number, label: string } | null,
 *   played: boolean,
 * }}
 */
export function coverageRow(store, { key, poolSize }) {
  const headline = modeCoverage(store, key, HEADLINE_MODE, poolSize);
  const secondary = modeCoverage(store, key, SECONDARY_MODE, poolSize);
  return { key, poolSize, headline, secondary, played: !!(headline || secondary) };
}

/**
 * Best-first, so the end of the list is what to practise.
 *
 * Three bands, in this order:
 *   1. Rows with a 60s record — sorted by coverage, highest first.
 *   2. Rows played only without a clock — nothing to sort *by*, since the
 *      ordering measure is the 60s record they don't have.
 *   3. Rows never played at all.
 *
 * Ties inside a band keep their incoming order, which is the decks' display
 * order, so an untouched list reads in the same sequence as the settings tray.
 *
 * @template {{ headline: { ratio: number } | null, played: boolean }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function sortCoverageRows(rows) {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const ah = a.row.headline;
      const bh = b.row.headline;
      // Band 1: both measured — the coverage decides.
      if (ah && bh) return (bh.ratio - ah.ratio) || (a.i - b.i);
      // One measured, one not: measured always wins, however bad it is. A
      // 1/47 outranks a perfect no-clock run, because the ordering measure
      // is the 60s record and the other row simply has none.
      if (ah) return -1;
      if (bh) return 1;
      // Neither measured: played-in-the-other-mode above never-played-at-all.
      return (Number(b.row.played) - Number(a.row.played)) || (a.i - b.i);
    })
    .map((x) => x.row);
}

/** Both modes play the whole pool; pinned by the test rather than assumed. */
export const MODE_KEYS = Object.keys(MODES);
