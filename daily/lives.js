/**
 * Wrong-guess budget for the daily puzzle.
 *
 * The daily is a find-all format: unlimited guesses made it possible to
 * crawl the alphabet until the grid filled, which scores the same as
 * knowing the answers. A budget makes each guess a decision.
 *
 * Two rules the rest of the flow depends on:
 *
 * 1. **Only a real country that doesn't fit costs anything.** Typos and
 *    half-typed names (`classifyGuess` → `unknown`) and re-picking a
 *    flag already found (`duplicate`) stay free. Charging for those
 *    would make the mechanic punish spelling rather than knowledge.
 * 2. **The budget is keyed on country code, not on guess events.** A
 *    player who retypes a country they already got wrong is repeating
 *    one mistake, not making a second. This mirrors how `playFlow`
 *    already dedups `wrongCodes` into a Set for the stats API, so the
 *    life count and the reported wrong-guess count can never disagree.
 *
 * The cap is a module constant rather than a per-puzzle field: the
 * author skill has enough to get right on every entry, and a number
 * that varies per puzzle can't be explained in the UI without a rules
 * popover the daily doesn't have.
 */

/**
 * Wrong countries a player may name before the round ends.
 *
 * 7, not 5: the catalog's median puzzle has 8 targets (p25 5, p90 17),
 * so a cap of 5 is fewer lives than there are answers on most of the
 * catalog and would cut runs off before the player had seen the bulk of
 * the puzzle — which then reads as a bad `found / total` score rather
 * than a lost game. Any small number defeats alphabet-crawling (that
 * needs dozens of wrong guesses across ~200 countries), so the only
 * thing this number really decides is whether a knowledgeable player
 * gets cut off on a bad day. 7 absorbs the two or three genuine
 * near-misses that colour-count and motif puzzles invite.
 *
 * Tighten it once the mistake distribution is visible in real rows.
 */
export const DAILY_LIVES = 7;

/**
 * @typedef {object} Lives
 * @property {number} max Lives the run started with.
 * @property {(code: string) => boolean} spend Charge for a wrong country. Returns true if a life actually came off (false when the country was already charged for).
 * @property {() => number} remaining Lives left.
 * @property {() => number} spent Lives used.
 * @property {() => boolean} exhausted True once the budget is gone.
 */

/**
 * Create a wrong-guess budget for one round.
 *
 * @param {number} [max] Lives to start with. Defaults to `DAILY_LIVES`.
 * @returns {Lives}
 */
export function createLives(max = DAILY_LIVES) {
  /** @type {Set<string>} */
  const charged = new Set();
  const spent = () => Math.min(charged.size, max);
  const remaining = () => Math.max(0, max - charged.size);
  return {
    max,
    spend(code) {
      if (charged.has(code)) return false;
      charged.add(code);
      return true;
    },
    remaining,
    spent,
    exhausted: () => remaining() === 0,
  };
}
