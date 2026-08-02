import population from '../metrics/population.json' with { type: 'json' };
import area from '../metrics/area.json' with { type: 'json' };
import density from '../metrics/density.json' with { type: 'json' };
import gdp from '../metrics/gdp.json' with { type: 'json' };
import gdpPerCapita from '../metrics/gdpPerCapita.json' with { type: 'json' };
import coffee from '../metrics/coffee.json' with { type: 'json' };
import wine from '../metrics/wine.json' with { type: 'json' };
import cocoa from '../metrics/cocoa.json' with { type: 'json' };
import banana from '../metrics/banana.json' with { type: 'json' };
import apple from '../metrics/apple.json' with { type: 'json' };
import elevation from '../metrics/elevation.json' with { type: 'json' };
import coastline from '../metrics/coastline.json' with { type: 'json' };
import forest from '../metrics/forest.json' with { type: 'json' };
import oil from '../metrics/oil.json' with { type: 'json' };
import rice from '../metrics/rice.json' with { type: 'json' };
import coal from '../metrics/coal.json' with { type: 'json' };
import sheepPerCapita from '../metrics/sheepPerCapita.json' with { type: 'json' };
import cattlePerCapita from '../metrics/cattlePerCapita.json' with { type: 'json' };
import beerPerCapita from '../metrics/beerPerCapita.json' with { type: 'json' };
import tea from '../metrics/tea.json' with { type: 'json' };
import sugarcane from '../metrics/sugarcane.json' with { type: 'json' };
import gold from '../metrics/gold.json' with { type: 'json' };
import alcoholPerCapita from '../metrics/alcoholPerCapita.json' with { type: 'json' };
import meatPerCapita from '../metrics/meatPerCapita.json' with { type: 'json' };
import borders from '../metrics/borders.json' with { type: 'json' };
import oliveOil from '../metrics/oliveOil.json' with { type: 'json' };
import honey from '../metrics/honey.json' with { type: 'json' };
import temperature from '../metrics/temperature.json' with { type: 'json' };
import happiness from '../metrics/happiness.json' with { type: 'json' };
import corruption from '../metrics/corruption.json' with { type: 'json' };
import tourismPerCapita from '../metrics/tourismPerCapita.json' with { type: 'json' };
import electricityPerCapita from '../metrics/electricityPerCapita.json' with { type: 'json' };
import mcdonaldsPerMillion from '../metrics/mcdonaldsPerMillion.json' with { type: 'json' };
import nobel from '../metrics/nobel.json' with { type: 'json' };
import nobelPerCapita from '../metrics/nobelPerCapita.json' with { type: 'json' };
import summerMedals from '../metrics/summerMedals.json' with { type: 'json' };
import summerMedalsPerCapita from '../metrics/summerMedalsPerCapita.json' with { type: 'json' };
import winterMedals from '../metrics/winterMedals.json' with { type: 'json' };
import winterMedalsPerCapita from '../metrics/winterMedalsPerCapita.json' with { type: 'json' };
import { lookalikesOf } from '../quiz.js';
import { createMetric } from '../metrics.js';
import { SUPERLATIVE_METRICS } from './superlativeCatalog.js';

/**
 * The "superlative" question: "Which of these four flags is the *most* (or *least*)
 * populous?" — the third mirror of flag-pick. The prompt is a direction token
 * (`'most'` / `'least'`) rather than a target country, the options are four
 * flag codes, and the answer is whichever of the four the metric ranks at the
 * extreme. Same `{ prompt, options, answer }` shape as flag-pick and map-pick,
 * so the room and scoring stay question-agnostic; the page renders the options as
 * flags (`flags/svg/<code>.svg`), exactly like flag-pick.
 *
 * This is the first question whose answer is *not* derivable from what the client
 * is shown (four flags with no numbers) — that's why the question contract keeps
 * the answer server-side.
 *
 * **NOTHING MAY IMPORT THIS FILE FROM A PAGE.** The static JSON imports above are
 * fine here because this module runs only on the server (PartyKit), the way
 * `party/partyGameServer.js` imports `countries.json` — but
 * `import x from './x.json' with { type: 'json' }` kills the whole module in a
 * real browser and ships a blank page. That exact mistake broke prod in #767 and
 * was fixed in #769, and Playwright's Chromium HIDES it: the page looks fine in a
 * headless check and is dead for real users. Treat "but it works in Playwright"
 * as no evidence at all.
 *
 * The per-metric rules a browser DOES need (direction lock, zero-filter flag,
 * hint copy) live in `superlativeCatalog.js`, which has no imports whatsoever and
 * is loaded by `flagParty/page.js` for the prompt. That file is the browser-safe
 * half, and the repo-wide JSON-import guard (which walks every `page.js`) covers
 * it.
 *
 * The quartet-picking logic below used to live in a third file,
 * `superlativeCore.js`, split out in Feature V Phase 4a so that flagQuiz's Facts
 * deck could import it from a browser. Feature X deleted that deck — nobody
 * played it — so the core had exactly one consumer left: this file. It is folded
 * back in. If a browser ever needs to generate one of these questions again, split
 * it out again; keeping a file whose only purpose is a second consumer that no
 * longer exists just invites someone to import the wrong half.
 *
 * `createMetric` needs no country list for world-scope value lookups (`has` /
 * `valueOf` read the `values` map directly), so we pass `[]`.
 */

/**
 * Structural type for what the generator needs from a metric: can you ask about a
 * code, and what's its value. Matches `createMetric`'s real shape, `valueOf`
 * included — it returns undefined for a code the metric has no data for.
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
 * Exported for `superlative.test.js`, which exercises the draw / gap / ranking
 * rules against synthetic powers-of-ten metrics rather than real data. It is NOT
 * in `party/partyGameServer.js`'s question registry — that registry maps over an
 * explicit list of the per-metric exports below, not over this module's whole
 * namespace, so an extra named export here cannot leak into it.
 *
 * @param {Metric} metric a `createMetric(...)` instance — anything with `has` /
 *   `valueOf`. Typed structurally so a test can hand in a plain object.
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
 * **This is the single definition of "apply the catalog's rules."** It had a second
 * caller once (flagQuiz's Facts deck, which fetched its JSON rather than importing
 * it) and that is why it takes the raw data instead of reaching for it. The deck is
 * gone, so today there is one caller — but the shape is worth keeping, because the
 * failure mode it prevents is silent: nothing breaks when a caller forgets that
 * coastline has landlocked zeros, it just starts asking questions with no answer.
 *
 * @param {import('./superlativeCatalog.js').SuperlativeMetric} entry
 * @param {import('../metrics.js').MetricData} raw the metric's values file
 * @returns {ReturnType<typeof createSuperlativeQuestion>}
 */
function buildSuperlativeQuestion(entry, raw) {
  return createSuperlativeQuestion(
    createMetric(entry.zeroFiltered ? positiveOnly(raw) : raw, []),
    entry.questionId,
    entry.direction ? { direction: entry.direction } : {},
  );
}

/**
 * Metric key → its raw values file. The one thing this module owns that the
 * catalog deliberately cannot: the data itself. Keys match
 * `flags/metrics/index.js`; `superlativeCatalog.test.js` pins that set against
 * the catalog, and the DATA-coverage test below pins it against this table, so
 * a metric can't be registered and then silently deal nothing.
 *
 * @type {Record<string, import('../metrics.js').MetricData>}
 */
const DATA = {
  population, area, density, gdp, gdpPerCapita, coffee, wine, cocoa, banana,
  apple, elevation, coastline, forest, oil, rice, coal, sheepPerCapita,
  cattlePerCapita, beerPerCapita, tea, sugarcane, gold, alcoholPerCapita,
  meatPerCapita, borders, oliveOil, honey, temperature, happiness, corruption,
  tourismPerCapita, electricityPerCapita, mcdonaldsPerMillion, nobel, nobelPerCapita,
  summerMedals, summerMedalsPerCapita, winterMedals, winterMedalsPerCapita,
};

/**
 * Every superlative question, keyed by metric key — one per catalog entry, built by
 * one factory. This replaced 32 hand-written `createSuperlativeQuestion(...)` calls
 * whose only differences were the three fields the catalog now states.
 *
 * @type {Record<string, ReturnType<typeof buildSuperlativeQuestion>>}
 */
const QUESTIONS = Object.fromEntries(SUPERLATIVE_METRICS.map((m) => {
  const raw = DATA[m.key];
  if (!raw) throw new Error(`No metric data for catalog entry "${m.key}"`);
  return [
    m.key,
    buildSuperlativeQuestion(m, raw),
  ];
}));

// The population question is exported FLAT (id / generate / isCorrect) rather than
// as an object: it shipped before there was a second metric, and both
// `party/partyGameServer.js` (which spreads `* as superlative` into its question
// registry) and `superlative.test.js` import it that way.
export const id = QUESTIONS.population.id;
export const generate = QUESTIONS.population.generate;
export const isCorrect = QUESTIONS.population.isCorrect;

// The rest, one named export each — the shape `party/partyGameServer.js` lists
// explicitly, reading `.id` off each to build its question registry. Keeping these
// names is what lets the catalog land without editing that server at all.
//
// It does NOT avoid a PartyKit deploy: `deploy-partykit.yml` triggers on
// `flags/partyQuestions/**` because it tracks the server's whole import closure,
// deliberately over-triggering ("a redundant deploy beats a silently stale
// server"). So touching this file redeploys and restarts every Durable Object.
// The questions it deals are unchanged; the in-progress rooms it drops are not.
export const areaQuestion = QUESTIONS.area;
export const densityQuestion = QUESTIONS.density;
export const gdpQuestion = QUESTIONS.gdp;
export const gdpPerCapitaQuestion = QUESTIONS.gdpPerCapita;
export const coffeeQuestion = QUESTIONS.coffee;
export const wineQuestion = QUESTIONS.wine;
export const cocoaQuestion = QUESTIONS.cocoa;
export const bananaQuestion = QUESTIONS.banana;
export const appleQuestion = QUESTIONS.apple;
export const elevationQuestion = QUESTIONS.elevation;
export const coastlineQuestion = QUESTIONS.coastline;
export const forestQuestion = QUESTIONS.forest;
export const oilQuestion = QUESTIONS.oil;
export const riceQuestion = QUESTIONS.rice;
export const coalQuestion = QUESTIONS.coal;
export const sheepPerCapitaQuestion = QUESTIONS.sheepPerCapita;
export const cattlePerCapitaQuestion = QUESTIONS.cattlePerCapita;
export const beerPerCapitaQuestion = QUESTIONS.beerPerCapita;
export const teaQuestion = QUESTIONS.tea;
export const sugarcaneQuestion = QUESTIONS.sugarcane;
export const goldQuestion = QUESTIONS.gold;
export const alcoholPerCapitaQuestion = QUESTIONS.alcoholPerCapita;
export const meatPerCapitaQuestion = QUESTIONS.meatPerCapita;
export const bordersQuestion = QUESTIONS.borders;
export const oliveOilQuestion = QUESTIONS.oliveOil;
export const honeyQuestion = QUESTIONS.honey;
export const temperatureQuestion = QUESTIONS.temperature;
export const happinessQuestion = QUESTIONS.happiness;
export const corruptionQuestion = QUESTIONS.corruption;
export const tourismPerCapitaQuestion = QUESTIONS.tourismPerCapita;
export const electricityPerCapitaQuestion = QUESTIONS.electricityPerCapita;
export const mcdonaldsPerMillionQuestion = QUESTIONS.mcdonaldsPerMillion;
export const nobelQuestion = QUESTIONS.nobel;
export const nobelPerCapitaQuestion = QUESTIONS.nobelPerCapita;
export const summerMedalsQuestion = QUESTIONS.summerMedals;
export const summerMedalsPerCapitaQuestion = QUESTIONS.summerMedalsPerCapita;
export const winterMedalsQuestion = QUESTIONS.winterMedals;
export const winterMedalsPerCapitaQuestion = QUESTIONS.winterMedalsPerCapita;
