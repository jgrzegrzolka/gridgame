/**
 * The superlative question's pure core: pick four countries with a clear extreme.
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
import { createMetric } from '../metrics.js';

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
/**
 * `ranking` is the four option codes ordered **best-first in the question's own
 * direction** — so index 0 is always the answer, whether the question asked for
 * the most or the least. `values` is each option's raw metric value, for the
 * reveal's bar chart.
 *
 * Both are answer-bearing and must never reach a client before the reveal.
 * `publicQuestion` in `flags/partyRoom.js` is an allow-list (it names each field
 * it copies) rather than a deny-list, so they are excluded by construction
 * rather than by remembering to strip them.
 *
 * @typedef {{ prompt: 'most' | 'least', options: string[], answer: string,
 *   ranking: string[], values: Record<string, number> }} Question
 */


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
 * Monaco, Romania / Chad, Ireland / Côte d'Ivoire, …). This question renders its
 * options as *flags with no numbers*, so two indistinguishable flags among the
 * four would be an unfair coin-flip: you could know Monaco is the densest yet be
 * unable to tell which of two red-white tiles is Monaco. Greedy over a shuffled
 * copy, marking each pick's whole lookalike group taken — the same guard
 * `buildChoices` in `flags/quiz.js` applies to the flag-pick question, sharing its
 * `lookalikesOf` list so the two questions can't drift apart. Falls back to filling
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
 * @param {Set<string>} [exclude] answer codes already used this game, so a question
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
  /** @type {{ codes: string[], answer: string, ranking: string[] } | null} */
  let fallback = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const four = drawFourDistinct(src, rng);
    const byValue = four.slice().sort((a, b) => val(b.code) - val(a.code));
    const extreme = /** @type {PoolEntry} */ (direction === 'most' ? byValue[0] : byValue[byValue.length - 1]);
    const runnerUp = /** @type {PoolEntry} */ (direction === 'most' ? byValue[1] : byValue[byValue.length - 2]);
    const ev = val(extreme.code);
    const rv = val(runnerUp.code);
    const clear = direction === 'most' ? ev >= rv * GAP_RATIO : rv >= ev * GAP_RATIO;
    // `byValue` is descending. A 'least' question wants the smallest first, so
    // the ranking is reversed for it — which keeps "index 0 is the answer" true
    // in both directions and lets the scorer treat rank uniformly.
    const ordered = direction === 'most' ? byValue : byValue.slice().reverse();
    const candidate = {
      codes: four.map((c) => c.code),
      answer: extreme.code,
      ranking: ordered.map((c) => c.code),
    };
    if (clear) { fallback = candidate; break; }
    if (!fallback) fallback = candidate;
  }
  const chosen = /** @type {{ codes: string[], answer: string, ranking: string[] }} */ (fallback);
  /** @type {Record<string, number>} */
  const values = {};
  for (const code of chosen.codes) values[code] = val(code);
  return {
    prompt: direction,
    options: shuffle(chosen.codes, rng),
    answer: chosen.answer,
    ranking: chosen.ranking,
    values,
  };
}

/**
 * Build a superlative question bound to a metric. The metric is passed in (rather
 * than hard-imported) so every world metric gets a Flag Party question from one
 * factory: population is `superlative`, area is `superlative-area`, etc.
 *
 * @param {Metric} metric a `createMetric(...)` instance — anything with  /
 *   . Typed structurally rather than importing createMetric, because
 *   this module must stay free of imports that could drag JSON in.
 * @param {string} questionId stable question id (matches the PARTY_MODES questionId)
 * @param {{ direction?: 'most' | 'least' }} [opts] `direction` locks the prompt
 *   to one extreme (coffee is `'most'`-only); omitted = both, chosen per question.
 * @returns {{ id: string, generate: (pool: PoolEntry[], exclude?: Set<string>, rng?: () => number) => Question, isCorrect: (q: { answer: string }, choice: string) => boolean }}
 */
export function createSuperlativeQuestion(metric, questionId, opts = {}) {
  const forcedDirection = opts.direction;
  return {
    id: questionId,
    generate: (pool, exclude, rng = Math.random) => generateFor(metric, pool, exclude, rng, forcedDirection),
    isCorrect: (question, choice) => choice === question.answer,
  };
}

/**
 * Drop the real zeros from a metric's `values`, so they're never *selected*.
 *
 * A landlocked country's 0 km of coast and a desert's 0.0% forest cover are real
 * values, not gaps — but a quartet drawn from four of them ties at zero, which is
 * a question with no answer (and degenerates the GAP_RATIO gate). Removing them
 * from `values` makes `metric.has` false, the same mechanism that already
 * restricts a sparse crop metric to its growers.
 *
 * @param {import('../metrics.js').MetricData} raw
 * @returns {import('../metrics.js').MetricData}
 */
function positiveOnly(raw) {
  return {
    ...raw,
    values: Object.fromEntries(Object.entries(raw.values).filter(([, v]) => v > 0)),
  };
}

/**
 * Turn a catalog entry plus its raw values file into a playable question: apply the
 * zero-filter, build the metric, lock the direction.
 *
 * **This is the single definition of "apply the catalog's rules", and it lives
 * here for the same reason the catalog does.** Two consumers need it and they
 * load their data by completely different routes — `superlative.js` imports 32
 * JSONs statically (server-only), flagQuiz's Facts deck fetches them — so the
 * one thing they must NOT do is each decide for themselves what `zeroFiltered`
 * means. A second copy is precisely the silent drift Phase 4b-i existed to
 * prevent: nothing fails when one of them forgets that coastline has landlocked
 * zeros, it just starts asking questions with no answer.
 *
 * Takes the raw data rather than fetching it, so this file stays JSON-free and
 * browser-loadable — the whole point of the core/data split.
 *
 * @param {import('./superlativeCatalog.js').SuperlativeMetric} entry
 * @param {import('../metrics.js').MetricData} raw the metric's values file
 * @returns {ReturnType<typeof createSuperlativeQuestion>}
 */
export function buildSuperlativeQuestion(entry, raw) {
  return createSuperlativeQuestion(
    createMetric(entry.zeroFiltered ? positiveOnly(raw) : raw, []),
    entry.questionId,
    entry.direction ? { direction: entry.direction } : {},
  );
}
