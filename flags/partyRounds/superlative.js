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
import { createMetric } from '../metrics.js';
import { createSuperlativeRound } from './superlativeCore.js';

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
 * The quartet-picking logic lives in `superlativeCore.js` — this file is the
 * data half. Keep it that way: the core is imported by the BROWSER (flagQuiz's
 * Facts deck), and the static JSON imports below would kill it there.
 *
 * The metric is built once, at module load, from `flags/metrics/population.json`
 * — the self-contained pattern `mapPick.js` uses for `CONTOUR_CODE_SET`. This
 * module runs *only on the server* (PartyKit; the page never imports it), so the
 * browser "fetch JSON, never import" rule doesn't apply — a static JSON import
 * is fine here, the way `party/partyGameServer.js` imports `countries.json`.
 * `createMetric` needs no country list for world-scope value lookups (`has` /
 * `valueOf` read the `values` map directly), so we pass `[]`.
 */

// Population instance: the original round, exported flat (id / generate /
// isCorrect) for back-compat with `party/partyGameServer.js` and the tests.
const populationRound = createSuperlativeRound(createMetric(population, []), 'superlative');
export const id = populationRound.id;
export const generate = populationRound.generate;
export const isCorrect = populationRound.isCorrect;

// Area instance: the km² twin, id 'superlative-area'.
export const areaRound = createSuperlativeRound(createMetric(area, []), 'superlative-area');

// Density instance: people per km², id 'superlative-density'.
export const densityRound = createSuperlativeRound(createMetric(density, []), 'superlative-density');

// GDP instance: total economy in US$, id 'superlative-gdp'.
export const gdpRound = createSuperlativeRound(createMetric(gdp, []), 'superlative-gdp');

// GDP-per-capita instance: US$ per head, id 'superlative-gdppc'.
export const gdpPerCapitaRound = createSuperlativeRound(createMetric(gdpPerCapita, []), 'superlative-gdppc');

// Coffee instance: green-coffee tonnes, id 'superlative-coffee'. Coffee is a
// sparse metric, so `createMetric` reads its producers-only `values` map and
// `metric.has` is true only for growers — the round ranks the producers, never
// the non-growers (who'd all tie at 0). No zero-fill here: that lives only on
// the TTT threshold field. Locked to 'most': "biggest coffee producer" is the
// good question; "smallest grower" is obscure, so 'least' is never dealt.
export const coffeeRound = createSuperlativeRound(createMetric(coffee, []), 'superlative-coffee', { direction: 'most' });

// Wine instance: wine tonnes, id 'superlative-wine'. Sparse like coffee, so the
// round ranks the makers only (non-makers would tie at 0). Locked to 'most':
// "biggest wine producer" is the good question; "smallest maker" is obscure.
export const wineRound = createSuperlativeRound(createMetric(wine, []), 'superlative-wine', { direction: 'most' });

// Cocoa instance: cocoa-bean tonnes, id 'superlative-cocoa'. Sparse like coffee /
// wine, so the round ranks the growers only (non-growers would tie at 0). Locked
// to 'most': "biggest cocoa producer" (Côte d'Ivoire) is the good question.
export const cocoaRound = createSuperlativeRound(createMetric(cocoa, []), 'superlative-cocoa', { direction: 'most' });

// Banana instance: banana tonnes, id 'superlative-banana'. Sparse like the other
// crops, so the round ranks the producers only. Locked to 'most': "biggest
// banana producer" (India) is the good question.
export const bananaRound = createSuperlativeRound(createMetric(banana, []), 'superlative-banana', { direction: 'most' });

// Apple instance: apple tonnes, id 'superlative-apple'. Sparse like the other
// crops, so the round ranks the producers only. Locked to 'most': "biggest
// apple producer" (China) is the good question.
export const appleRound = createSuperlativeRound(createMetric(apple, []), 'superlative-apple', { direction: 'most' });

// Elevation instance: highest point in metres, id 'superlative-elevation'. Dense
// and two-directional (no direction lock, unlike coffee): both "highest peak"
// (Everest) and the fun "lowest highpoint" (the Maldives, the low coral atolls)
// are good questions, so 'most' and 'least' are both dealt.
export const elevationRound = createSuperlativeRound(createMetric(elevation, []), 'superlative-elevation');

// Coastline instance: km of coast, id 'superlative-coastline'. Dense and
// two-directional like elevation, but with one wrinkle: ~42 landlocked places
// carry a real 0 km, and a "least" quartet drawn from them would tie at 0 (an
// unfair question with no clear answer). So the round metric is built from a
// zero-filtered values map: landlocked places are excluded from selection (the
// way a sparse crop metric's non-producers are), leaving only coastal countries,
// among which both "longest" and "shortest coastline" are clean questions.
const coastalCoastline = {
  ...coastline,
  values: Object.fromEntries(Object.entries(coastline.values).filter(([, v]) => v > 0)),
};
export const coastlineRound = createSuperlativeRound(createMetric(coastalCoastline, []), 'superlative-coastline');

// Forest instance: forest cover as a % of land area, id 'superlative-forest'.
// Dense, intensive (size-independent) and two-directional like coastline, and
// with the same wrinkle: ~19 treeless places (deserts, ice sheets, city-states)
// carry a real 0.0%, and a "least" quartet drawn from them would tie at 0 (an
// unfair question: the GAP_RATIO check degenerates when the extreme is 0). So
// the round metric drops the 0.0% places from selection, leaving only forested
// countries, among which both "most" and "least forested" are clean questions.
const forestedForest = {
  ...forest,
  values: Object.fromEntries(Object.entries(forest.values).filter(([, v]) => v > 0)),
};
export const forestRound = createSuperlativeRound(createMetric(forestedForest, []), 'superlative-forest');

// Oil instance: oil production in TWh, id 'superlative-oil'. Sparse like the
// crops, so the round ranks the ~92 producers only. Locked to 'most': "biggest
// oil producer" (the US) is the good question.
export const oilRound = createSuperlativeRound(createMetric(oil, []), 'superlative-oil', { direction: 'most' });

// Rice instance: rice paddy tonnes, id 'superlative-rice'. Sparse like the other
// crops, so the round ranks the ~119 growers only. Locked to 'most': "biggest
// rice producer" (India) is the good question.
export const riceRound = createSuperlativeRound(createMetric(rice, []), 'superlative-rice', { direction: 'most' });

// Coal instance: coal production in TWh, id 'superlative-coal'. Sparse like oil,
// so the round ranks the ~59 producers only. Locked to 'most': "biggest coal
// producer" (China) is the good question.
export const coalRound = createSuperlativeRound(createMetric(coal, []), 'superlative-coal', { direction: 'most' });

// Sheep-per-capita instance: sheep head per person, id 'superlative-sheep'.
// Locked to 'most': "which has the MOST sheep per person" is the good question
// (the famous "more sheep than people" club); "fewest sheep per person" is an
// obscure long tail, so 'least' is never dealt. The round metric still drops the
// 0-sheep places from selection (like the sparse crops rank producers only), so
// every option is a genuine sheep-raising country rather than a filler zero.
const sheepRaising = {
  ...sheepPerCapita,
  values: Object.fromEntries(Object.entries(sheepPerCapita.values).filter(([, v]) => v > 0)),
};
export const sheepPerCapitaRound = createSuperlativeRound(createMetric(sheepRaising, []), 'superlative-sheep', { direction: 'most' });

// Cattle-per-capita instance: cattle head per person, id 'superlative-cattle'.
// Locked to 'most', same reasoning as sheep: "which has the MOST cattle per
// person" is the fun question (Uruguay, more cows than people); "fewest cattle
// per person" is an obscure long tail, so 'least' is never dealt. The round
// metric drops the 0-cattle places so every option is a genuine cattle-raising
// country rather than a filler zero.
const cattleRaising = {
  ...cattlePerCapita,
  values: Object.fromEntries(Object.entries(cattlePerCapita.values).filter(([, v]) => v > 0)),
};
export const cattlePerCapitaRound = createSuperlativeRound(createMetric(cattleRaising, []), 'superlative-cattle', { direction: 'most' });

// Beer-per-capita instance: litres of beer per person, id 'superlative-beer'.
// Locked to 'most': "which drinks the MOST beer" is the fun question (Czechia,
// perennial world #1); "fewest" is a religion/geography quiz, not a beer one. The
// round metric drops the 0-litre places (the dry states) AND is inherently
// sovereign-scoped, so the absence:'unknown' gap (territories WHO does not
// measure) never surfaces: every option is a real beer-drinking country.
const beerDrinking = {
  ...beerPerCapita,
  values: Object.fromEntries(Object.entries(beerPerCapita.values).filter(([, v]) => v > 0)),
};
export const beerPerCapitaRound = createSuperlativeRound(createMetric(beerDrinking, []), 'superlative-beer', { direction: 'most' });

// Tea instance: green-tea-leaf tonnes, id 'superlative-tea'. Sparse like coffee,
// so the round ranks the growers only (non-growers would tie at 0). Locked to
// 'most': "biggest tea producer" (China) is the good question; "smallest grower"
// is obscure.
export const teaRound = createSuperlativeRound(createMetric(tea, []), 'superlative-tea', { direction: 'most' });

// Sugar cane instance: tonnes of cane, id 'superlative-sugarcane'. Sparse like
// the other crops, so the round ranks the growers only (non-growers would tie
// at 0). Locked to 'most': "biggest cane producer" (Brazil) is the good
// question; "smallest grower" is obscure.
export const sugarcaneRound = createSuperlativeRound(createMetric(sugarcane, []), 'superlative-sugarcane', { direction: 'most' });

// Gold instance: tonnes of mined gold, id 'superlative-gold'. Sparse (the USGS
// itemizes only ~17 major producers), so the round ranks those producers only.
// Locked to 'most': "biggest gold producer" (China) is the good question;
// "smallest producer" is obscure.
export const goldRound = createSuperlativeRound(createMetric(gold, []), 'superlative-gold', { direction: 'most' });

// Alcohol-per-capita instance: litres of pure alcohol per person, id
// 'superlative-alcohol'. Locked to 'most': "which drinks the MOST alcohol" is the
// fun question (Lithuania, Ireland, the European heavyweights); "fewest" is a
// religion/geography quiz, not a drinking one. The round metric drops the 0-litre
// dry states AND is inherently sovereign-scoped, so the absence:'unknown' gap
// (territories the source does not measure) never surfaces.
const alcoholDrinking = {
  ...alcoholPerCapita,
  values: Object.fromEntries(Object.entries(alcoholPerCapita.values).filter(([, v]) => v > 0)),
};
export const alcoholPerCapitaRound = createSuperlativeRound(createMetric(alcoholDrinking, []), 'superlative-alcohol', { direction: 'most' });

// Meat-per-capita instance: kg of meat per person, id 'superlative-meat'. Locked
// to 'most': "which eats the MOST meat" is the fun question (the United States,
// Australia, Argentina); "least" is the low-income / vegetarian tail. Zero-filtered
// for consistency with the drink metrics (though no covered place is actually 0),
// and inherently sovereign-scoped, so the absence:'unknown' gap never surfaces.
const meatEating = {
  ...meatPerCapita,
  values: Object.fromEntries(Object.entries(meatPerCapita.values).filter(([, v]) => v > 0)),
};
export const meatPerCapitaRound = createSuperlativeRound(createMetric(meatEating, []), 'superlative-meat', { direction: 'most' });

// Borders instance: number of countries sharing a land border, id
// 'superlative-borders'. Locked to 'most': "which borders the MOST countries" is
// the fun question (Russia & China at 14); "fewest" ties every island at 0. The
// round metric drops the 0-border places (all the islands) from selection, so every
// option is a country that actually borders someone.
const borderedBorders = {
  ...borders,
  values: Object.fromEntries(Object.entries(borders.values).filter(([, v]) => v > 0)),
};
export const bordersRound = createSuperlativeRound(createMetric(borderedBorders, []), 'superlative-borders', { direction: 'most' });

// Olive oil instance: tonnes of olive oil, id 'superlative-olive-oil'. Sparse
// like the other crops (FAO lists ~28 producers), so the round ranks those
// producers only (non-producers would tie at 0). Locked to 'most': "biggest
// olive oil producer" (Spain) is the good question; "smallest" is obscure.
export const oliveOilRound = createSuperlativeRound(createMetric(oliveOil, []), 'superlative-olive-oil', { direction: 'most' });

// Honey instance: tonnes of natural honey, id 'superlative-honey'. Sparse (FAO
// itemizes ~100 producers, we pin the top 55), so the round ranks those
// producers only. Locked to 'most': "biggest honey producer" (China, ~a quarter
// of world output) is the good question; "smallest producer" is obscure.
export const honeyRound = createSuperlativeRound(createMetric(honey, []), 'superlative-honey', { direction: 'most' });

// Temperature: dense and two-directional (no direction lock), like density /
// elevation. Both extremes are good questions: hottest (Burkina Faso, the
// Gulf / Sahel) and coldest (Antarctica, Greenland, the sub-zero floor). The
// metric carries negatives, which the round handles fine (plain-subtraction
// sort; the only sign-sensitive spot, the GAP_RATIO fairness gate, degrades
// gracefully, never wrong).
export const temperatureRound = createSuperlativeRound(createMetric(temperature, []), 'superlative-temperature');

// Happiness instance: World Happiness Report ladder score, id
// 'superlative-happiness'. Sparse absence:'unknown' survey (Gallup reaches ~147
// countries), so the round ranks the covered places only: raw
// createMetric(happiness, []) needs no zero-filter because the round's
// metric.has check already drops the ~115 unsurveyed places (they are absent
// from values, not 0). TWO-DIRECTIONAL: "happiest" (Finland, the Nordics) and
// "least happy" (conflict / poverty states). We first shipped this most-only on
// tone grounds, then matched the corruption round's most-&-least framing: the
// low pole is a known, distinct answer (Afghanistan), not an obscure tail, so it
// earns its half of the questions. Unlike corruption the scale is not inverted:
// higher = happier, so 'most' = happiest and 'least' = least happy, rendered
// directly by the SUPERLATIVE_MODES hints in flagParty/page.js.
export const happinessRound = createSuperlativeRound(createMetric(happiness, []), 'superlative-happiness');

// Corruption / "Government integrity" instance: Transparency International CPI
// (0-100, higher = cleaner), id 'superlative-corruption'. Sparse
// absence:'unknown' (TI scores ~181 states), so raw createMetric ranks the
// scored places only (the round's metric.has drops the rest). TWO-DIRECTIONAL
// (unlike the filter / TTT surfaces, which stay clean-pole "integrity"): the
// party round asks both "most corrupt" and "least corrupt" as direct questions,
// which are the clearest possible trivia phrasings. The CPI orientation is
// inverted at the HINT layer, not here: round 'most' = highest CPI = shown as
// "Least corrupt"; round 'least' = lowest CPI = "Most corrupt" (see the
// SUPERLATIVE_MODES entry in flagParty/page.js).
export const corruptionRound = createSuperlativeRound(createMetric(corruption, []), 'superlative-corruption');

// Tourism-per-capita instance: tourist arrivals per resident, id
// 'superlative-tourism'. Locked to 'most': "which gets the most tourists per
// resident" (Andorra, Monaco, the island magnets) is the fun question; "fewest" is
// the big-country long tail. The round metric drops the 0-arrival places AND is
// inherently sovereign-scoped, so the absence:'unknown' gap (states with no figure)
// never surfaces: every option is a real, measured tourist destination.
const tourismDestinations = {
  ...tourismPerCapita,
  values: Object.fromEntries(Object.entries(tourismPerCapita.values).filter(([, v]) => v > 0)),
};
export const tourismPerCapitaRound = createSuperlativeRound(createMetric(tourismDestinations, []), 'superlative-tourism', { direction: 'most' });

// Electricity-per-capita instance: kWh per person, id 'superlative-electricity'.
// Locked to 'most': "which uses the most electricity per person" (Iceland, Norway,
// the Gulf) is the fun question; "least" is the low-income tail. Zero-filtered for
// consistency with the other consumption metrics (though no covered place is 0),
// and inherently sovereign-scoped, so the absence:'unknown' gap never surfaces.
const electricityUsing = {
  ...electricityPerCapita,
  values: Object.fromEntries(Object.entries(electricityPerCapita.values).filter(([, v]) => v > 0)),
};
export const electricityPerCapitaRound = createSuperlativeRound(createMetric(electricityUsing, []), 'superlative-electricity', { direction: 'most' });
