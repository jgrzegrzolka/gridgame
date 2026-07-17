/**
 * What each world metric's superlative round asks, and how it asks it.
 *
 * Three facts per metric that are *not* derivable from the metric data:
 *
 *   - `direction` — whether both extremes make a good question, or only one.
 *     "Biggest coffee producer" is a real question; "smallest grower" is an
 *     obscure long tail, so coffee is locked to 'most' and 'least' is never
 *     dealt.
 *   - `zeroFiltered` — whether a real 0 means "not a candidate". ~42 landlocked
 *     countries carry a real 0 km of coastline and ~19 treeless places a real
 *     0.0% forest cover; a quartet drawn from those ties at 0, which is a
 *     question with no answer. Filtering them out of *selection* is the fix
 *     (the same way a sparse crop metric ranks only its producers).
 *   - `hintMost` / `hintLeast` — the criterion label a player reads. Never the
 *     winner, so it can't leak the answer the tiles reveal.
 *
 * **Why this is its own file, and why it holds no data.** Until Feature V these
 * three facts lived in `superlative.js`, next to the 32 static JSON imports that
 * make that module server-only — so the browser could never read them. The
 * hints separately lived in `flagParty/page.js`, page-local. flagQuiz's Facts
 * deck (Feature V Phase 4b) needs all three in a browser, and a second copy of
 * the zero-filter rules is exactly the kind that drifts silently: nothing fails
 * when one copy forgets that coastline has landlocked zeros, you just start
 * dealing unanswerable questions. One table, three consumers:
 *
 *   - `superlative.js` (server) — builds its 32 rounds from this + its imports.
 *   - `flagParty/page.js` (browser) — the in-round prompt's criterion label.
 *   - flagQuiz's Facts deck (browser) — both.
 *
 * Like `flags/metrics/index.js`, this file **names** metrics and never imports
 * their JSON. Keep it that way: it is on the browser's import path, and
 * `import x from './x.json' with { type: 'json' }` ships a blank page to real
 * users. `superlativeCore.test.js` walks the import graph and fails if any JSON
 * import appears.
 *
 * `key` is the `flags/metrics/index.js` metric key; `roundId` is the
 * `flags/partyPlan.js` PARTY_MODES roundId. Both are pinned against their
 * registries by `superlativeCatalog.test.js` — a metric added to one and
 * forgotten in the other fails CI rather than shipping a round that can't
 * resolve its own data.
 *
 * @typedef {{ key: string, fallback: string }} Hint
 * @typedef {Object} SuperlativeMetric
 * @property {string} key metric key, as in `flags/metrics/index.js`
 * @property {string} roundId stable round id, as in `flags/partyPlan.js`
 * @property {'most' | null} direction locked to one extreme, or null for both
 * @property {boolean} zeroFiltered drop real-0 places from selection
 * @property {Hint} hintMost criterion label for a 'most' question
 * @property {Hint | null} hintLeast label for 'least'; null iff direction is locked
 */

/**
 * The 32 metric rounds, in `flags/metrics/index.js` order.
 *
 * The i18n keys are `party.*` because Flag Party shipped them first and they
 * are the same strings wherever a superlative is asked. Renaming 62 live keys
 * across en + pl to widen a namespace would be pure churn with a real chance of
 * breaking a page that reads one via `data-i18n` (which no `*.js` grep sees —
 * that bit us in Phase 1b).
 *
 * @type {SuperlativeMetric[]}
 */
export const SUPERLATIVE_METRICS = [
  {
    key: 'population',
    // The original round, and the only id without a metric suffix: it predates
    // the others. Renaming it would break every open tab mid-game.
    roundId: 'superlative',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMost', fallback: 'Most populous' },
    hintLeast: { key: 'party.hintLeast', fallback: 'Least populous' },
  },
  {
    key: 'area',
    roundId: 'superlative-area',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostArea', fallback: 'Largest area' },
    hintLeast: { key: 'party.hintLeastArea', fallback: 'Smallest area' },
  },
  {
    key: 'density',
    roundId: 'superlative-density',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostDensity', fallback: 'Highest density' },
    hintLeast: { key: 'party.hintLeastDensity', fallback: 'Lowest density' },
  },
  {
    key: 'gdp',
    roundId: 'superlative-gdp',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostGdp', fallback: 'Largest GDP' },
    hintLeast: { key: 'party.hintLeastGdp', fallback: 'Smallest GDP' },
  },
  {
    key: 'gdpPerCapita',
    roundId: 'superlative-gdppc',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostGdppc', fallback: 'Largest GDP (per capita)' },
    hintLeast: { key: 'party.hintLeastGdppc', fallback: 'Smallest GDP (per capita)' },
  },
  // The crops are sparse metrics: `values` lists growers only, so `metric.has`
  // already drops the non-growers (who would all tie at 0) and no zero-filter is
  // needed. All are 'most'-only — "biggest producer" is the question everyone
  // has an opinion about; "smallest grower" is a data-entry trivia question.
  {
    key: 'coffee',
    roundId: 'superlative-coffee',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostCoffee', fallback: 'Largest coffee production' },
    hintLeast: null,
  },
  {
    key: 'wine',
    roundId: 'superlative-wine',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostWine', fallback: 'Largest wine production' },
    hintLeast: null,
  },
  {
    key: 'cocoa',
    roundId: 'superlative-cocoa',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostCocoa', fallback: 'Largest cocoa production' },
    hintLeast: null,
  },
  {
    key: 'banana',
    roundId: 'superlative-banana',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostBanana', fallback: 'Largest banana production' },
    hintLeast: null,
  },
  {
    key: 'apple',
    roundId: 'superlative-apple',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostApple', fallback: 'Largest apple production' },
    hintLeast: null,
  },
  // Dense and genuinely two-directional: the highest peak (Everest) and the fun
  // lowest highpoint (the Maldives' coral atolls) are both good questions.
  {
    key: 'elevation',
    roundId: 'superlative-elevation',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostElevation', fallback: 'Highest point' },
    hintLeast: { key: 'party.hintLeastElevation', fallback: 'Lowest highpoint' },
  },
  // Zero-filtered: ~42 landlocked places carry a real 0 km, and a 'least'
  // quartet drawn from them would tie at 0. Dropping them from selection leaves
  // only coastal countries, among which both extremes are clean questions.
  {
    key: 'coastline',
    roundId: 'superlative-coastline',
    direction: null,
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostCoastline', fallback: 'Longest coast' },
    hintLeast: { key: 'party.hintLeastCoastline', fallback: 'Shortest coast' },
  },
  // Zero-filtered for the same reason as coastline: ~19 treeless places
  // (deserts, ice sheets, city-states) carry a real 0.0%, where the GAP_RATIO
  // fairness gate degenerates.
  {
    key: 'forest',
    roundId: 'superlative-forest',
    direction: null,
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostForest', fallback: 'Most forested' },
    hintLeast: { key: 'party.hintLeastForest', fallback: 'Least forested' },
  },
  {
    key: 'oil',
    roundId: 'superlative-oil',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostOil', fallback: 'Largest oil production' },
    hintLeast: null,
  },
  {
    key: 'rice',
    roundId: 'superlative-rice',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostRice', fallback: 'Largest rice production' },
    hintLeast: null,
  },
  {
    key: 'coal',
    roundId: 'superlative-coal',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostCoal', fallback: 'Largest coal production' },
    hintLeast: null,
  },
  // The livestock / consumption metrics are dense-ish but carry real zeros (no
  // sheep, no cattle, dry states), so they zero-filter: every option should be a
  // country that genuinely does the thing, not a filler 0. All 'most'-only —
  // "more sheep than people" is the fun question; the low tail is a religion or
  // geography quiz wearing a beer label.
  {
    key: 'sheepPerCapita',
    roundId: 'superlative-sheep',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostSheep', fallback: 'Most sheep per person' },
    hintLeast: null,
  },
  {
    key: 'cattlePerCapita',
    roundId: 'superlative-cattle',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostCattle', fallback: 'Most cattle per person' },
    hintLeast: null,
  },
  {
    key: 'beerPerCapita',
    roundId: 'superlative-beer',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostBeer', fallback: 'Most beer consumption per person' },
    hintLeast: null,
  },
  {
    key: 'tea',
    roundId: 'superlative-tea',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostTea', fallback: 'Largest tea production' },
    hintLeast: null,
  },
  {
    key: 'sugarcane',
    roundId: 'superlative-sugarcane',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostSugarcane', fallback: 'Largest sugarcane production' },
    hintLeast: null,
  },
  {
    key: 'gold',
    roundId: 'superlative-gold',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostGold', fallback: 'Largest gold production' },
    hintLeast: null,
  },
  {
    key: 'alcoholPerCapita',
    roundId: 'superlative-alcohol',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostAlcohol', fallback: 'Most alcohol consumption per person' },
    hintLeast: null,
  },
  {
    key: 'meatPerCapita',
    roundId: 'superlative-meat',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostMeat', fallback: 'Most meat consumption per person' },
    hintLeast: null,
  },
  // Zero-filtered because 'least' would tie every island at 0 borders — and
  // 'most'-only because Russia & China at 14 is the fun question.
  {
    key: 'borders',
    roundId: 'superlative-borders',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostBorders', fallback: 'Most bordering countries' },
    hintLeast: null,
  },
  {
    key: 'oliveOil',
    roundId: 'superlative-olive-oil',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostOliveOil', fallback: 'Largest olive oil production' },
    hintLeast: null,
  },
  {
    key: 'honey',
    roundId: 'superlative-honey',
    direction: 'most',
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostHoney', fallback: 'Largest honey production' },
    hintLeast: null,
  },
  // INVERTED at the hint layer, and only here: the CPI runs higher = cleaner, so
  // the round's 'most' extreme (highest CPI) is the LEAST corrupt country. The
  // party round and the Facts deck ask the direct "corrupt" question because
  // that is the clearest trivia phrasing; the filter / TTT surfaces keep the
  // clean-pole "integrity" framing. Nothing below the hint inverts — the round
  // ranks raw CPI.
  {
    key: 'corruption',
    roundId: 'superlative-corruption',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostCorruption', fallback: 'Least corrupt' },
    hintLeast: { key: 'party.hintLeastCorruption', fallback: 'Most corrupt' },
  },
  // Carries negatives, which the round handles fine: the sort is a plain
  // subtraction, and the only sign-sensitive spot (the GAP_RATIO gate) degrades
  // gracefully rather than wrongly.
  {
    key: 'temperature',
    roundId: 'superlative-temperature',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostTemperature', fallback: 'Hottest' },
    hintLeast: { key: 'party.hintLeastTemperature', fallback: 'Coldest' },
  },
  // Sparse (Gallup reaches ~147 countries), so `metric.has` already drops the
  // unsurveyed — they are absent from `values`, not 0, hence no zero-filter.
  // Two-directional: we first shipped this most-only on tone grounds, then
  // matched corruption's framing, because the low pole is a known, distinct
  // answer (Afghanistan) rather than an obscure tail. NOT inverted: higher =
  // happier, so 'most' = happiest.
  {
    key: 'happiness',
    roundId: 'superlative-happiness',
    direction: null,
    zeroFiltered: false,
    hintMost: { key: 'party.hintMostHappiness', fallback: 'Happiest' },
    hintLeast: { key: 'party.hintLeastHappiness', fallback: 'Least happy' },
  },
  {
    key: 'tourismPerCapita',
    roundId: 'superlative-tourism',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostTourism', fallback: 'Most tourist arrivals per resident' },
    hintLeast: null,
  },
  {
    key: 'electricityPerCapita',
    roundId: 'superlative-electricity',
    direction: 'most',
    zeroFiltered: true,
    hintMost: { key: 'party.hintMostElectricity', fallback: 'Most electricity use per person' },
    hintLeast: null,
  },
];

/** @type {Record<string, SuperlativeMetric>} */
const BY_ROUND_ID = Object.fromEntries(SUPERLATIVE_METRICS.map((m) => [m.roundId, m]));

/** @type {Record<string, SuperlativeMetric>} */
const BY_KEY = Object.fromEntries(SUPERLATIVE_METRICS.map((m) => [m.key, m]));

/**
 * @param {string} roundId
 * @returns {SuperlativeMetric | null} null for a round id this build doesn't
 *   know — a still-open tab can be dealt one by a newer server.
 */
export function superlativeMetricByRoundId(roundId) {
  return BY_ROUND_ID[roundId] ?? null;
}

/**
 * @param {string} key
 * @returns {SuperlativeMetric | null}
 */
export function superlativeMetricByKey(key) {
  return BY_KEY[key] ?? null;
}

/**
 * Does this build have copy for a question dealt in this direction?
 *
 * **This is a version-skew check, not a data check.** Within one build it is
 * always true: the same `direction` field that locks generation is the one that
 * decides whether `hintLeast` exists. But the server (PartyKit, on Cloudflare)
 * and the page (SWA) are separate deploys of this very file — that skew is
 * precisely why `flagParty/staleGuard.js` exists. Flip a metric from `'most'`
 * to `null` (a one-word edit this table is designed to make easy) and the server
 * starts dealing 'least' while an open tab still has `hintLeast: null`. The
 * round id is unchanged, so the id-based staleness check waves it through.
 *
 * A client that can't label a direction must NOT guess: showing the 'most' label
 * over a 'least' question mis-scores every player silently, which is worse than
 * the crash it would replace. `flagParty/staleGuard.js` composes this into
 * `canRenderQuestion` so the tab reloads onto the new build instead — the same
 * path a brand-new round id takes.
 *
 * @param {SuperlativeMetric} metric
 * @param {'most' | 'least'} direction
 * @returns {boolean}
 */
export function canLabelDirection(metric, direction) {
  return direction !== 'least' || metric.hintLeast !== null;
}

/**
 * The criterion label to show for a question's direction.
 *
 * Callers must have cleared {@link canLabelDirection} first — `flagParty` does,
 * via `staleGuard.canRenderQuestion`, before a round ever renders. The
 * `hintMost` fallback is belt-and-braces for a caller that doesn't (and beats
 * reading `.key` off `undefined`, which is what this replaced), but it is not a
 * behaviour anything should rely on: a wrong label is only better than a dead
 * screen, never right. flagQuiz's Facts deck can't reach it at all — it
 * generates and labels from the same in-process catalog, so no skew exists.
 *
 * @param {SuperlativeMetric} metric
 * @param {'most' | 'least'} direction
 * @returns {Hint}
 */
export function hintFor(metric, direction) {
  return direction === 'least' && metric.hintLeast ? metric.hintLeast : metric.hintMost;
}
