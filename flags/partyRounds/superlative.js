import population from '../metrics/population.json' with { type: 'json' };
import area from '../metrics/area.json' with { type: 'json' };
import { createMetric } from '../metrics.js';

/**
 * The "superlative" round: "Which of these four flags is the *most* (or *least*)
 * populous?" — the third mirror of flag-pick. The prompt is a direction token
 * (`'most'` / `'least'`) rather than a target country, the options are four
 * flag codes, and the answer is whichever of the four the population metric
 * ranks at the extreme. Same `{ prompt, options, answer }` shape as flag-pick
 * and map-pick, so the room and scoring stay round-agnostic; the page renders
 * the options as flags (`flags/svg/<code>.svg`), exactly like flag-pick.
 *
 * This is the first round whose answer is *not* derivable from what the client
 * is shown (four flags with no numbers) — that's why the round contract keeps
 * the answer server-side. The only genuinely new logic here is picking four
 * countries with a clear extreme (below).
 *
 * The metric is built once, at module load, from `flags/metrics/population.json`
 * — the self-contained pattern `mapPick.js` uses for `CONTOUR_CODE_SET`. This
 * module runs *only on the server* (PartyKit; the page never imports it), so the
 * browser "fetch JSON, never import" rule doesn't apply — a static JSON import
 * is fine here, the way `party/partyGameServer.js` imports `countries.json`.
 * `createMetric` needs no country list for world-scope value lookups (`has` /
 * `valueOf` read the `values` map directly), so we pass `[]`.
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
 * @param {ReturnType<typeof createMetric>} metric the metric to rank by.
 * @param {PoolEntry[]} pool  any pool of country entries; narrowed to the ones
 *   that carry a value for this metric before use.
 * @param {Set<string>} [exclude] answer codes already used this game, so a round
 *   doesn't repeat a country. Falls back to the full valued set if excluding
 *   would leave too few to build a question.
 * @param {() => number} [rng] injectable for tests; defaults to `Math.random`.
 * @returns {Question}
 */
function generateFor(metric, pool, exclude, rng = Math.random) {
  const withValue = pool.filter((c) => metric.has(c.code));
  const usable = exclude && exclude.size ? withValue.filter((c) => !exclude.has(c.code)) : withValue;
  const src = usable.length >= 4 ? usable : withValue;
  /** @type {'most' | 'least'} */
  const direction = rng() < 0.5 ? 'least' : 'most';
  // Every entry in `src` cleared `metric.has`, so its value is defined; the cast
  // spares the comparator and the gap check a redundant undefined check.
  const val = (/** @type {string} */ code) => /** @type {number} */ (metric.valueOf(code));

  // Draw four, sorted by value; the extreme (largest for 'most', smallest for
  // 'least') is the answer. Resample until the extreme clears the runner-up by
  // GAP_RATIO, then accept the first draw regardless so we always return.
  /** @type {{ codes: string[], answer: string } | null} */
  let fallback = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const four = shuffle(src, rng).slice(0, 4);
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
 * @param {ReturnType<typeof createMetric>} metric a `createMetric(...)` instance
 * @param {string} roundId stable round id (matches the PARTY_MODES roundId)
 * @returns {{ id: string, generate: (pool: PoolEntry[], exclude?: Set<string>, rng?: () => number) => Question, isCorrect: (q: { answer: string }, choice: string) => boolean }}
 */
export function createSuperlativeRound(metric, roundId) {
  return {
    id: roundId,
    generate: (pool, exclude, rng = Math.random) => generateFor(metric, pool, exclude, rng),
    isCorrect: (question, choice) => choice === question.answer,
  };
}

// Population instance: the original round, exported flat (id / generate /
// isCorrect) for back-compat with `party/partyGameServer.js` and the tests.
const populationRound = createSuperlativeRound(createMetric(population, []), 'superlative');
export const id = populationRound.id;
export const generate = populationRound.generate;
export const isCorrect = populationRound.isCorrect;

// Area instance: the km² twin, id 'superlative-area'.
export const areaRound = createSuperlativeRound(createMetric(area, []), 'superlative-area');
