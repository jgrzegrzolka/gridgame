/**
 * The superlative round's pure core: pick four countries with a clear extreme.
 *
 * Split out of `superlative.js` (Feature V Phase 4a) for one reason: that file
 * statically imports 32 metric JSONs, and **a browser cannot load it**.
 * `import x from './x.json' with { type: 'json' }` is fine on the server, where
 * superlative.js has always run (PartyKit), but in a real browser it kills the
 * whole module and ships a blank page. That exact mistake broke prod in #767
 * and was fixed in #769, and Playwright's Chromium HIDES it — the page looks
 * fine in a headless check and is dead for real users.
 *
 * So the logic lives here, data-free, and the two consumers bring their own:
 *   - `superlative.js` (server) imports its JSON statically, as it always has.
 *   - flagQuiz's Facts deck (Phase 4b, browser) fetches the metric JSON and
 *     hands it in.
 *
 * Nothing here touches the filesystem, the network or the DOM. If an import
 * ever appears in this file that isn't pure logic, the browser side breaks
 * silently — that's the whole point of the split.
 */

import { lookalikesOf } from '../quiz.js';

/** The only import here, and it must stay that way: quiz.js and its whole
 *  chain (flagPools, group, contourPool) are free of JSON imports, so this
 *  module still loads in a browser. Verified, not assumed. */

/**
 * Structural type for what this module needs from a metric: can you ask about
 * a code, and what's its value. Typed structurally rather than importing
 * `createMetric`, so nothing here can drag a JSON import in by the back door.
 * Matches createMetric's real shape, `valueOf` included — it returns undefined
 * for a code the metric has no data for.
 *
 * @typedef {{ has(code: string): boolean, valueOf(code: string): number | undefined }} Metric
 */

/** @typedef {{ code: string }} PoolEntry */
/** @typedef {{ prompt: 'most' | 'least', options: string[], answer: string }} Question */


/**
 * How much the extreme must beat the runner-up by for a quartet to be accepted,
 * as a ratio of values. Keeps China-vs-India coin-flips out: the biggest must be
 * at least 25% bigger than the second (and the smallest at least 25% smaller
 * than the second-smallest). Correctness never depends on this — populations are
 * distinct, so there's always a strict extreme — it's purely a fairness knob.
 */
const GAP_RATIO = 1.25;

/** How many quartets to try for one that clears GAP_RATIO before accepting the
 *  first draw anyway. With ~195 sovereigns spanning nine orders of magnitude a
 *  clear extreme is the norm, so this is rarely exhausted. */
const MAX_ATTEMPTS = 20;


/**
 * Fisher-Yates over a copy, using an injectable RNG so tests are deterministic.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Draw four entries such that no two are visual flag lookalikes (Indonesia /
 * Monaco, Romania / Chad, Ireland / Côte d'Ivoire, …). This round renders its
 * options as *flags with no numbers*, so two indistinguishable flags among the
 * four would be an unfair coin-flip: you could know Monaco is the densest yet be
 * unable to tell which of two red-white tiles is Monaco. Greedy over a shuffled
 * copy, marking each pick's whole lookalike group taken — the same guard
 * `buildChoices` in `flags/quiz.js` applies to the flag-pick round, sharing its
 * `lookalikesOf` list so the two rounds can't drift apart. Falls back to filling
 * from the skipped remainder if the constraint can't reach four (a pool that's
 * mostly one lookalike group), so it always returns four when `src` has four.
 *
 * @param {PoolEntry[]} src
 * @param {() => number} rng
 * @returns {PoolEntry[]}
 */
function drawFourDistinct(src, rng) {
  const taken = new Set();
  /** @type {PoolEntry[]} */ const picked = [];
  /** @type {PoolEntry[]} */ const skipped = [];
  for (const c of shuffle(src, rng)) {
    if (picked.length === 4) break;
    if (taken.has(c.code)) { skipped.push(c); continue; }
    picked.push(c);
    for (const k of lookalikesOf(c.code)) taken.add(k);
  }
  for (const c of skipped) {
    if (picked.length === 4) break;
    picked.push(c);
  }
  return picked;
}

/**
 * @param {Metric} metric the metric to rank by.
 * @param {PoolEntry[]} pool  any pool of country entries; narrowed to the ones
 *   that carry a value for this metric before use.
 * @param {Set<string>} [exclude] answer codes already used this game, so a round
 *   doesn't repeat a country. Falls back to the full valued set if excluding
 *   would leave too few to build a question.
 * @param {() => number} [rng] injectable for tests; defaults to `Math.random`.
 * @param {'most' | 'least'} [forcedDirection] lock the prompt to one direction
 *   instead of a coin flip. Used by metrics where only one extreme is a good
 *   question — coffee asks "biggest producer" only ('most'); "smallest grower"
 *   is an obscure question, so 'least' is never dealt for it. When set, no rng
 *   byte is spent on the coin flip.
 * @returns {Question}
 */
function generateFor(metric, pool, exclude, rng = Math.random, forcedDirection) {
  const withValue = pool.filter((c) => metric.has(c.code));
  const usable = exclude && exclude.size ? withValue.filter((c) => !exclude.has(c.code)) : withValue;
  const src = usable.length >= 4 ? usable : withValue;
  /** @type {'most' | 'least'} */
  const direction = forcedDirection ?? (rng() < 0.5 ? 'least' : 'most');
  // Every entry in `src` cleared `metric.has`, so its value is defined; the cast
  // spares the comparator and the gap check a redundant undefined check.
  const val = (/** @type {string} */ code) => /** @type {number} */ (metric.valueOf(code));

  // Draw four, sorted by value; the extreme (largest for 'most', smallest for
  // 'least') is the answer. Resample until the extreme clears the runner-up by
  // GAP_RATIO, then accept the first draw regardless so we always return.
  /** @type {{ codes: string[], answer: string } | null} */
  let fallback = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const four = drawFourDistinct(src, rng);
    const byValue = four.slice().sort((a, b) => val(b.code) - val(a.code));
    const extreme = /** @type {PoolEntry} */ (direction === 'most' ? byValue[0] : byValue[byValue.length - 1]);
    const runnerUp = /** @type {PoolEntry} */ (direction === 'most' ? byValue[1] : byValue[byValue.length - 2]);
    const ev = val(extreme.code);
    const rv = val(runnerUp.code);
    const clear = direction === 'most' ? ev >= rv * GAP_RATIO : rv >= ev * GAP_RATIO;
    const candidate = { codes: four.map((c) => c.code), answer: extreme.code };
    if (clear) { fallback = candidate; break; }
    if (!fallback) fallback = candidate;
  }
  const chosen = /** @type {{ codes: string[], answer: string }} */ (fallback);
  return { prompt: direction, options: shuffle(chosen.codes, rng), answer: chosen.answer };
}

/**
 * Build a superlative round bound to a metric. The metric is passed in (rather
 * than hard-imported) so every world metric gets a Flag Party round from one
 * factory: population is `superlative`, area is `superlative-area`, etc.
 *
 * @param {Metric} metric a `createMetric(...)` instance — anything with  /
 *   . Typed structurally rather than importing createMetric, because
 *   this module must stay free of imports that could drag JSON in.
 * @param {string} roundId stable round id (matches the PARTY_MODES roundId)
 * @param {{ direction?: 'most' | 'least' }} [opts] `direction` locks the prompt
 *   to one extreme (coffee is `'most'`-only); omitted = both, chosen per round.
 * @returns {{ id: string, generate: (pool: PoolEntry[], exclude?: Set<string>, rng?: () => number) => Question, isCorrect: (q: { answer: string }, choice: string) => boolean }}
 */
export function createSuperlativeRound(metric, roundId, opts = {}) {
  const forcedDirection = opts.direction;
  return {
    id: roundId,
    generate: (pool, exclude, rng = Math.random) => generateFor(metric, pool, exclude, rng, forcedDirection),
    isCorrect: (question, choice) => choice === question.answer,
  };
}
