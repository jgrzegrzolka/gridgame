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
import { buildSuperlativeRound } from './superlativeCore.js';
import { SUPERLATIVE_METRICS } from './superlativeCatalog.js';

/**
 * The "superlative" round: "Which of these four flags is the *most* (or *least*)
 * populous?" — the third mirror of flag-pick. The prompt is a direction token
 * (`'most'` / `'least'`) rather than a target country, the options are four
 * flag codes, and the answer is whichever of the four the metric ranks at the
 * extreme. Same `{ prompt, options, answer }` shape as flag-pick and map-pick,
 * so the room and scoring stay round-agnostic; the page renders the options as
 * flags (`flags/svg/<code>.svg`), exactly like flag-pick.
 *
 * This is the first round whose answer is *not* derivable from what the client
 * is shown (four flags with no numbers) — that's why the round contract keeps
 * the answer server-side.
 *
 * **This file is now only the data half.** It brings the 32 metric JSONs; the
 * quartet-picking logic lives in `superlativeCore.js` and the per-metric rules
 * (direction lock, zero-filter, hint copy) in `superlativeCatalog.js`. Both of
 * those are imported by the BROWSER — flagQuiz's Facts deck and flagParty's
 * prompt — and the static JSON imports below are exactly what would kill them
 * there (a blank page for real users; #767, fixed in #769). So the split is
 * load-bearing, not tidiness: **nothing may import this file from a page.**
 *
 * A static JSON import is fine *here* because this module runs only on the
 * server (PartyKit), the way `party/partyGameServer.js` imports `countries.json`.
 * `createMetric` needs no country list for world-scope value lookups (`has` /
 * `valueOf` read the `values` map directly), so we pass `[]`.
 */

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
  tourismPerCapita, electricityPerCapita,
};

/**
 * Every superlative round, keyed by metric key — one per catalog entry, built by
 * one factory. This replaced 32 hand-written `createSuperlativeRound(...)` calls
 * whose only differences were the three fields the catalog now states.
 *
 * @type {Record<string, ReturnType<typeof buildSuperlativeRound>>}
 */
const ROUNDS = Object.fromEntries(SUPERLATIVE_METRICS.map((m) => {
  const raw = DATA[m.key];
  if (!raw) throw new Error(`No metric data for catalog entry "${m.key}"`);
  return [
    m.key,
    buildSuperlativeRound(m, raw),
  ];
}));

// The population round is exported FLAT (id / generate / isCorrect) rather than
// as an object: it shipped before there was a second metric, and both
// `party/partyGameServer.js` (which spreads `* as superlative` into its round
// registry) and `superlative.test.js` import it that way.
export const id = ROUNDS.population.id;
export const generate = ROUNDS.population.generate;
export const isCorrect = ROUNDS.population.isCorrect;

// The rest, one named export each — the shape `party/partyGameServer.js` lists
// explicitly, reading `.id` off each to build its round registry. Keeping these
// names is what lets the catalog land without editing that server at all.
//
// It does NOT avoid a PartyKit deploy: `deploy-partykit.yml` triggers on
// `flags/partyRounds/**` because it tracks the server's whole import closure,
// deliberately over-triggering ("a redundant deploy beats a silently stale
// server"). So touching this file redeploys and restarts every Durable Object.
// The rounds it deals are unchanged; the in-progress rooms it drops are not.
export const areaRound = ROUNDS.area;
export const densityRound = ROUNDS.density;
export const gdpRound = ROUNDS.gdp;
export const gdpPerCapitaRound = ROUNDS.gdpPerCapita;
export const coffeeRound = ROUNDS.coffee;
export const wineRound = ROUNDS.wine;
export const cocoaRound = ROUNDS.cocoa;
export const bananaRound = ROUNDS.banana;
export const appleRound = ROUNDS.apple;
export const elevationRound = ROUNDS.elevation;
export const coastlineRound = ROUNDS.coastline;
export const forestRound = ROUNDS.forest;
export const oilRound = ROUNDS.oil;
export const riceRound = ROUNDS.rice;
export const coalRound = ROUNDS.coal;
export const sheepPerCapitaRound = ROUNDS.sheepPerCapita;
export const cattlePerCapitaRound = ROUNDS.cattlePerCapita;
export const beerPerCapitaRound = ROUNDS.beerPerCapita;
export const teaRound = ROUNDS.tea;
export const sugarcaneRound = ROUNDS.sugarcane;
export const goldRound = ROUNDS.gold;
export const alcoholPerCapitaRound = ROUNDS.alcoholPerCapita;
export const meatPerCapitaRound = ROUNDS.meatPerCapita;
export const bordersRound = ROUNDS.borders;
export const oliveOilRound = ROUNDS.oliveOil;
export const honeyRound = ROUNDS.honey;
export const temperatureRound = ROUNDS.temperature;
export const happinessRound = ROUNDS.happiness;
export const corruptionRound = ROUNDS.corruption;
export const tourismPerCapitaRound = ROUNDS.tourismPerCapita;
export const electricityPerCapitaRound = ROUNDS.electricityPerCapita;
