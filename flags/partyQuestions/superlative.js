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
import { buildSuperlativeQuestion } from './superlativeCore.js';
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
