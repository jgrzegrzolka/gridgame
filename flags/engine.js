/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./group.js').Continent} Continent */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} label
 * @property {(country: Country) => boolean} predicate
 * @property {import('./flagsFilter.js').Filters} [filter]
 * @property {{ metric?: string, flag?: boolean }} [lead]  daily play-header lead
 *                              when there are no filter chips: a superlative's
 *                              ranking metric icon (`{ metric }`) or a manual
 *                              flag-design theme's flag glyph (`{ flag: true }`).
 *   Present on filter-derived categories (findFlag mixes + daily filter
 *   puzzles, via `filterToCategory`) — the source `Filters`, so a play-screen
 *   header can render the criteria as chips instead of the plain `label`.
 *   Absent on tic-tac-toe / superlative / manual categories, which fall back
 *   to `label`.
 * @property {string} [exclusiveGroup]
 *   When set, two categories with the same `exclusiveGroup` but different
 *   `id` can never coexist on opposite axes (axesConflict catches it).
 *   Handles same-dimension impossibilities — `Europe × Asia`,
 *   `colorCount:=2 × colorCount:=3`.
 * @property {string[]} [incompatibleWith]
 *   List of category ids this one must never pair with across axes.
 *   Handles cross-dimension structural disjointness — `stripesOnly:*` lists
 *   every charge motif (`hasMotif:cross`, `coat-of-arms`, etc.) because a
 *   pure-stripes flag has no overlay by definition, so those cells are
 *   always empty. Symmetric — axesConflict checks both directions.
 */

/**
 * @typedef {Object} Puzzle
 * @property {Category[]} rows
 * @property {Category[]} cols
 */

/**
 * @param {Puzzle} puzzle
 * @param {number} row
 * @param {number} col
 * @param {Country | null} country
 * @returns {boolean}
 */
export function validateCell(puzzle, row, col, country) {
  if (!country) return false;
  return puzzle.rows[row].predicate(country) && puzzle.cols[col].predicate(country);
}

/**
 * @typedef {Object} PickOutcome
 * @property {boolean} accepted
 * @property {(Country | null)[][]} [solution]
 */

/**
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][]} solution
 * @param {number} row
 * @param {number} col
 * @param {Country} country
 * @returns {PickOutcome}
 */
export function tryPick(puzzle, solution, row, col, country) {
  if (solution[row][col]) {
    return { accepted: false };
  }
  if (!validateCell(puzzle, row, col, country)) {
    return { accepted: false };
  }
  for (let r = 0; r < solution.length; r++) {
    for (let c = 0; c < solution[r].length; c++) {
      if (r === row && c === col) continue;
      if (solution[r][c]?.code === country.code) {
        return { accepted: false };
      }
    }
  }
  const next = solution.map((rowArr) => rowArr.slice());
  next[row][col] = country;
  return { accepted: true, solution: next };
}

/**
 * @param {string} name
 * @returns {Category}
 */
export function continent(name) {
  return {
    id: `continent:${name}`,
    label: name,
    predicate: (c) => c.continent === name,
    exclusiveGroup: 'continent',
  };
}

/**
 * @param {string} value
 * @param {string} [label]
 * @returns {Category}
 */
export function statehood(value, label) {
  return {
    id: `statehood:${value}`,
    label: label ?? value.replace(/_/g, ' '),
    predicate: (c) => c.statehood === value,
    exclusiveGroup: 'statehood',
  };
}

/**
 * Charge motifs — any visual element overlaid on a flag's field. A flag
 * whose `motifs` carries any of these can never be pure equal-band stripes
 * by definition. The single source of truth: `hasStripesOnly` reads it to
 * declare `incompatibleWith` so the generator skips the pair before testing
 * cells; `authoring/audit-stripe-orientation.mjs` reads it to surface
 * `stripesOnly`-tagged countries that contradict it.
 *
 * Kept narrow: `eu-member` is a *political* tag, not a visual element, so
 * it stays out (most pure tricolours are EU members).
 *
 * @type {string[]}
 */
export const CHARGE_MOTIFS = [
  'cross', 'coat-of-arms', 'animal', 'bird',
  'weapon', 'star-or-moon', 'union-jack',
];

/** Pre-resolved category ids for stripesOnly's `incompatibleWith`. Hoisted
 * out of the factory body so the list is computed once at module load,
 * not once per `hasStripesOnly()` call (every pool build triggers two). */
const STRIPES_ONLY_INCOMPATIBLE = CHARGE_MOTIFS.map((m) => `hasMotif:${m}`);

/**
 * "Pure stripes" Category — matches when the country's `stripesOnly` field
 * equals the orientation. The factory wires three pieces of behaviour:
 *
 *   - `exclusiveGroup: 'stripesOnly'` — `horizontal` and `vertical` can
 *     never appear on opposite axes (a flag can't be both).
 *   - `incompatibleWith` lists every charge motif id, so the generator
 *     never tries to pair stripesOnly with a charge — the resulting cell
 *     is empty by construction.
 *
 * @param {'horizontal' | 'vertical'} orientation
 * @returns {Category}
 */
export function hasStripesOnly(orientation) {
  return {
    id: `stripesOnly:${orientation}`,
    label: `${orientation} stripes only`,
    predicate: (c) => c.stripesOnly === orientation,
    exclusiveGroup: 'stripesOnly',
    incompatibleWith: STRIPES_ONLY_INCOMPATIBLE,
  };
}

/** @type {Array<'horizontal' | 'vertical'>} */
export const STRIPES_ORIENTATIONS_FOR_RANDOM = ['horizontal', 'vertical'];

/** @type {Continent[]} */
export const CONTINENTS_FOR_RANDOM = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
];

/**
 * Colours the random-puzzle generator is allowed to pair with continents.
 * Every (continent × colour) cell must admit at least one country, so this
 * is the *narrow* palette — additions need a sanity check that every
 * continent has at least one flag carrying the new colour.
 */
export const COLORS_FOR_RANDOM = [
  'red',
  'white',
  'blue',
  'green',
  'yellow',
  'black',
  'orange',
];

/**
 * All colours that may appear on any flag in `countries.json` — the wider
 * data palette. This is `COLORS_FOR_RANDOM` plus the rare emblem-only
 * colours that don't have continent-wide coverage (currently just `violet`,
 * which only shows up on Dominica's sisserou parrot and Northern Mariana
 * Islands' wreath). Used by the findFlag chooser so the UI can offer a
 * violet filter (the existing `count > 0` filter keeps it from appearing
 * on empty continents), and by the palette validator in countries.test.js.
 * Not used by the random-puzzle generator — that path stays on the narrow
 * `COLORS_FOR_RANDOM` so it can't pick an unfillable (continent × colour)
 * pair.
 */
export const ALL_FLAG_COLORS = [...COLORS_FOR_RANDOM, 'violet'];

/**
 * Colour-count Categories the random puzzle generator is allowed to pair
 * with continents / colours / motifs on the row / column axes. Members
 * share `exclusiveGroup: 'colorCount'` so two different colour-count
 * constraints can never appear on the same axis or across axes
 * (axesConflict catches it). Tuples are [op, n]:
 *
 *   ['=', 2]  — exactly 2 colours (Japan-style minimalist)
 *   ['=', 3]  — exactly 3 colours (most tricolours)
 *   ['=', 4]  — exactly 4 colours
 *   ['>=', 4] — 4 or more colours (busy / coat-of-arms-heavy flags)
 *
 * The `=` members of N=2/3 every continent in `flagsGamePool` has at least
 * one flag for; South America has just 1 at N=2 which is tight but
 * `isPuzzleGeneratable`'s minPerCell already screens that. `>=4` has
 * comfortable coverage everywhere. `=1` is empty in the pool and `>=5`
 * is empty on Asia, so neither makes it in.
 *
 * @type {Array<['=' | '>=', number]>}
 */
export const COLOR_COUNTS_FOR_RANDOM = [['=', 2], ['=', 3], ['=', 4], ['>=', 4]];

/**
 * Population-threshold Categories the random generator may pair on the row /
 * column axes. Three "populous" tiers (>= N people) and three "small" tiers
 * (<= N people), tuned so a player feels an easy→hard gradient: `>=10M` /
 * `<=20M` each cover roughly half the world, while `>=100M` (≈16 countries)
 * and `<=1M` are tight pools that demand real knowledge.
 *
 * All six share `exclusiveGroup: 'population'` (baked by the `population`
 * factory) so two population constraints can never meet across axes — that
 * rules out both the impossible band (`>=100M × <=1M`, always empty) and the
 * merely redundant one (`>=10M × <=20M`). The same-axis case (two population
 * tiers both down the rows) is rejected separately by `metricGroupRepeated`,
 * so a puzzle carries population at most once, on either axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const POPULATION_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10_000_000 },
  { op: '>=', n: 50_000_000 },
  { op: '>=', n: 100_000_000 },
  { op: '<=', n: 20_000_000 },
  { op: '<=', n: 5_000_000 },
  { op: '<=', n: 1_000_000 },
];

/**
 * Land-area-threshold Categories the random generator may pair on the row /
 * column axes, in km². Three "large" tiers (>= N) and three "small" tiers
 * (<= N), same easy→hard gradient as population: `>=100K` / `<=100K` each cover
 * roughly half the world, while `>=1M` (the ~28 giant countries) and `<=1K`
 * (tiny states) demand real knowledge.
 *
 * All six share `exclusiveGroup: 'area'` (baked by the `area` factory) so two
 * area constraints can never meet across axes, ruling out the impossible band
 * (`>=1M × <=1K`, always empty) and the redundant one (`>=100K × <=100K`). The
 * same-axis case is rejected by `metricGroupRepeated`, so a puzzle carries area
 * at most once.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const AREA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100_000 },
  { op: '>=', n: 500_000 },
  { op: '>=', n: 1_000_000 },
  { op: '<=', n: 100_000 },
  { op: '<=', n: 10_000 },
  { op: '<=', n: 1_000 },
];

/**
 * Population-density-threshold Categories (people per km²), same easy→hard
 * gradient as population / area. Dense tiers `>=100 / >=200 / >=500` (city-states
 * and crowded nations) and sparse `<=100 / <=30 / <=10` (Mongolia, Australia,
 * Canada, …). `exclusiveGroup: 'density'`; `>=100` covers roughly half the world.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const DENSITY_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100 },
  { op: '>=', n: 200 },
  { op: '>=', n: 500 },
  { op: '<=', n: 100 },
  { op: '<=', n: 30 },
  { op: '<=', n: 10 },
];

/**
 * GDP-threshold Categories (nominal current US$), same easy→hard gradient as the
 * other metrics. Big economies `>=$100B / >=$500B / >=$1T` (77 / 33 / 20 real
 * places) and small `<=$10B / <=$1B / <=$100M` (97 / 41 / 20).
 * `exclusiveGroup: 'gdp'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const GDP_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100_000_000_000 },
  { op: '>=', n: 500_000_000_000 },
  { op: '>=', n: 1_000_000_000_000 },
  { op: '<=', n: 10_000_000_000 },
  { op: '<=', n: 1_000_000_000 },
  { op: '<=', n: 100_000_000 },
];

/**
 * GDP-per-capita-threshold Categories (nominal current US$ per person). Rich
 * `>=$30K / >=$50K / >=$70K` (70 / 36 / 18 real places) and modest
 * `<=$5K / <=$2K / <=$1K` (91 / 51 / 28). `exclusiveGroup: 'gdpPerCapita'`. The
 * chosen breakpoints never overlap GDP's (>=$100M) so a bare "$30K" reads as per-capita
 * and "$100M" as total, no metric prefix needed to disambiguate a pill.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const GDP_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 30_000 },
  { op: '>=', n: 50_000 },
  { op: '>=', n: 70_000 },
  { op: '<=', n: 5_000 },
  { op: '<=', n: 2_000 },
  { op: '<=', n: 1_000 },
];

/**
 * Coffee-production-threshold Categories (green-coffee tonnes). The first
 * *sparse* metric, and so the first that is **`>=`-only**: only ~80 countries
 * grow coffee at all, so a `<=` / "produces under N" tier would just collect the
 * ~180 non-growers sitting at 0 (via `absence: 'zero'`) — trivially fillable and
 * meaningless ("grows little/no coffee" is almost everyone). So the meaningful
 * axis is "produces AT LEAST N": `>=1K / >=10K / >=100K tonnes` (52 / 33 / 14
 * real places). `exclusiveGroup: 'coffee'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const COFFEE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
];

/**
 * Wine-production-threshold Categories (wine tonnes). Sparse like coffee, so
 * **`>=`-only**: only ~80 countries make wine, so a `<=` / "makes under N" tier
 * would just collect the ~180 non-makers sitting at 0 (via `absence: 'zero'`),
 * trivially fillable and meaningless. The meaningful axis is "makes AT LEAST N":
 * `>=1K / >=10K / >=100K tonnes` (66 / 44 / 21 real places). `exclusiveGroup:
 * 'wine'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const WINE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
];

/**
 * Cocoa-production-threshold Categories (cocoa-bean tonnes). Sparse like coffee
 * and wine, so **`>=`-only**: only ~60 countries grow cocoa, so a `<=` tier
 * would just collect the ~180 non-growers at 0 (via `absence: 'zero'`),
 * trivially fillable and meaningless. The meaningful axis is "grows AT LEAST N":
 * `>=1K/10K/100K tonnes` (37 / 25 / 8 real places). `exclusiveGroup: 'cocoa'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const COCOA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
];

/**
 * Banana-production-threshold Categories (banana tonnes). Sparse like the other
 * crops, so **`>=`-only**: the ~135 non-tropical non-producers sit at 0 (via
 * `absence: 'zero'`), so a `<=` tier would be meaningless. The meaningful axis is
 * "produces AT LEAST N": `>=1K/10K/100K tonnes` (112 / 93 / 61 real places, the
 * healthiest spread of any sparse crop, bananas grow across the whole tropics).
 * `exclusiveGroup: 'banana'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const BANANA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
];

/**
 * Apple-production-threshold Categories (apple tonnes). Sparse like the other
 * crops, so **`>=`-only**: apples are a temperate fruit, the ~167 tropical /
 * non-producing real places sit at 0 (via `absence: 'zero'`), so a `<=` tier
 * would be meaningless. The meaningful axis is "produces AT LEAST N":
 * `>=10K/100K/1M tonnes` (75 / 52 / 13 real places, a clean spread from the
 * broad commercial growers up to the 13 giants: China, the US, Turkey, Poland,
 * India, Italy, Iran, Russia, France, Uzbekistan, South Africa, Chile, Ukraine).
 * `exclusiveGroup: 'apple'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const APPLE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
  { op: '>=', n: 1_000_000 },
];

/**
 * Highest-elevation-threshold Categories (metres above sea level of each place's
 * highest point). Dense and *two-directional*, the mirror of area / GDP: both
 * extremes make good questions, so there are three "high" tiers (`>= N`) and
 * three "low" tiers (`<= N`). High `>=1000 / >=3000 / >=5000 m` (175 / 71 / 27
 * real places, the elite high-mountain nations at the tight end); low
 * `<=500 / <=200 / <=100 m` (51 / 28 / 18, the flat countries and low coral
 * islands, bottoming out at the Maldives). `exclusiveGroup: 'elevation'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const ELEVATION_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 3_000 },
  { op: '>=', n: 5_000 },
  { op: '<=', n: 500 },
  { op: '<=', n: 200 },
  { op: '<=', n: 100 },
];

/**
 * Coastline-threshold Categories (kilometres of coastline). Dense and
 * two-directional, the mirror of area / elevation. High `>=1000 / >=5000 /
 * >=25000 km` (76 / 23 / 7 sovereign) climbs from the long-coast countries to
 * the archipelago giants (Canada ~202k, Indonesia ~55k, Russia, the
 * Philippines, Japan, Australia, Norway). Low `<=500 / <=100 / <=1 km`
 * (99 / 56 / 41 sovereign) picks out the short-coast and landlocked places: a
 * landlocked country carries a real 0 km, so it satisfies every low tier
 * (correctly, it has no coast), and `<=1` is effectively "landlocked" (the 41
 * sovereign 0-km states, no coastal state dips that low). `exclusiveGroup:
 * 'coastline'`.
 *
 * Counts are tuned against flags/metrics/coastline.json; a 0-count tier is
 * dropped by `buildMetricTierItems` so it never reaches a surface.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const COASTLINE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 5_000 },
  { op: '>=', n: 25_000 },
  { op: '<=', n: 500 },
  { op: '<=', n: 100 },
  { op: '<=', n: 1 },
];

/**
 * Forest-cover-threshold Categories (forest area as a percentage of land area).
 * Dense, intensive and two-directional, the mirror of area / elevation but
 * *size-independent*: the tiers reward how forested a place is, not how big it
 * is. High `>=30 / >=50 / >=70 %` (101 / 46 / 15 sovereign) climbs from the
 * broadly-wooded countries to the rainforest belt (the Guianas, Gabon, the
 * Pacific micro-states, Finland). Low `<=20 / <=5 / <=1 %` (73 / 31 / 16
 * sovereign) picks out the arid and ice-bound places: a treeless place carries a
 * real 0.0%, so it satisfies every low tier (correctly, it has no forest), and
 * `<=1` is effectively "practically treeless" (the deserts, ice sheets and
 * city-states). `exclusiveGroup: 'forest'`.
 *
 * Counts are tuned against flags/metrics/forest.json; a 0-count tier is dropped
 * by `buildMetricTierItems` so it never reaches a surface.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const FOREST_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 30 },
  { op: '>=', n: 50 },
  { op: '>=', n: 70 },
  { op: '<=', n: 20 },
  { op: '<=', n: 5 },
  { op: '<=', n: 1 },
];

/**
 * Oil-production-threshold Categories (terawatt-hours). Sparse like the crops,
 * so **`>=`-only**: only ~92 real places pump any oil, the rest sit at 0 (via
 * `absence: 'zero'`), so a `<=` tier would be meaningless. The meaningful axis is
 * "produces AT LEAST N": `>=10/100/1000 TWh` (76 / 35 / 12 real places, a clean
 * spread from the minor producers up to the 12 giants: the US, Russia, Saudi
 * Arabia, China, Iran, Iraq, Canada, Brazil, the UAE, Kuwait, Mexico, Kazakhstan).
 * `exclusiveGroup: 'oil'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const OIL_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10 },
  { op: '>=', n: 100 },
  { op: '>=', n: 1_000 },
];

/**
 * Rice-production-threshold Categories (paddy tonnes). Sparse like the other
 * crops, so **`>=`-only**: the cool and arid non-growers sit at 0 (via
 * `absence: 'zero'`), so a `<=` tier would be meaningless. Rice is the largest
 * crop by tonnage, so the tiers sit high: `>=100K/1M/10M tonnes` (76 / 42 / 13
 * real places, a clean spread from the minor growers up to the 13 giants: India,
 * China, Bangladesh, Indonesia, Vietnam, Thailand, Myanmar, the Philippines,
 * Brazil, Cambodia, the US, Japan, Pakistan). `exclusiveGroup: 'rice'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const RICE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100_000 },
  { op: '>=', n: 1_000_000 },
  { op: '>=', n: 10_000_000 },
];

/**
 * Coal-production-threshold Categories (terawatt-hours). Sparse like oil, so
 * **`>=`-only**: only ~59 real places mine any coal, the rest sit at 0 (via
 * `absence: 'zero'`), so a `<=` tier would be meaningless. The meaningful axis is
 * "produces AT LEAST N": `>=10/100/1000 TWh` (38 / 17 / 7 real places, a spread
 * from the minor miners up to the 7 giants: China, India, Indonesia, Australia,
 * the US, Russia, South Africa; China alone is 26,245 TWh, ~5x #2). `exclusiveGroup: 'coal'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const COAL_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10 },
  { op: '>=', n: 100 },
  { op: '>=', n: 1_000 },
];

/**
 * Sheep-per-capita-threshold Categories (sheep head per person). Intensive and
 * top-heavy: the whole point is the tiny club that has more sheep than people,
 * so like the sparse crops this axis is **`>=`-only** and integer-break-only
 * (`parseThreshold` needs a positive integer, and nearly every country sits
 * below 1 anyway, so a `<=` tier would just collect ~240 places under one
 * sheep/person, meaningless). `>=1` (~15 real places: NZ, Mongolia, Australia,
 * Uruguay, Wales, the Falklands, …) is the iconic "more sheep than people" cell;
 * `>=2` (~7) is the harder tier. `exclusiveGroup: 'sheepPerCapita'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1 },
  { op: '>=', n: 2 },
];

/**
 * Cattle-per-capita-threshold Categories (cattle head per person), the bovine
 * twin of sheep-per-capita and the same shape: intensive, top-heavy, so
 * **`>=`-only and integer-break-only** (`parseThreshold` needs a positive
 * integer, and nearly every country sits below 1). `>=1` (~10 real places:
 * Uruguay, Chad, Paraguay, New Zealand, Mongolia, Ireland, Argentina, Australia,
 * Brazil) is the iconic "more cows than people" cell; `>=2` (Uruguay, Chad) is
 * the harder tier. `exclusiveGroup: 'cattlePerCapita'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1 },
  { op: '>=', n: 2 },
];

/**
 * Beer-per-capita break tiers (litres of beer drunk per person per year). `>=`-only
 * like the crops: the fun axis is "who drinks the MOST" (over 50 L is a beer
 * culture, over 100 L is the elite: Czechia, Gabon, Austria, Panama, Croatia,
 * Brazil, Poland). The `<=` low end is the dry states, but that reads as a
 * religion/geography quiz rather than a beer one, so we leave it off. Integer `n`
 * (parseThreshold requires it), which the 0..131 L range gives comfortably.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const BEER_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 50 },
  { op: '>=', n: 100 },
];

/**
 * Alcohol-per-capita break tiers (litres of PURE alcohol per person per year).
 * `>=`-only like beer: the fun axis is "who drinks the MOST" overall. `>=10` L is
 * a heavy-drinking country (~32 real places), `>=12` L the elite (~11: Lithuania,
 * Ireland, Latvia, Moldova, Czechia, Romania, Slovenia, France, Portugal, Germany,
 * Croatia). The `<=` dry-state low end reads as a religion/geography quiz, so it is
 * left off. Integer `n` (parseThreshold requires it), which the 0..13 L range gives.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10 },
  { op: '>=', n: 12 },
];

/**
 * Meat-per-capita break tiers (kg of meat per person per year). `>=`-only like the
 * drink metrics: "who eats the MOST". `>=80` kg is a big-meat-eating country (~26
 * real places), `>=100` kg the elite (~7: United States, Australia, Argentina,
 * Mongolia, New Zealand, Spain, Brazil). Integer `n` (parseThreshold requires it),
 * which the 0..124 kg range gives comfortably.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const MEAT_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 80 },
  { op: '>=', n: 100 },
];

/**
 * Tourism-per-capita break tiers (international tourist arrivals per resident per
 * year). `>=`-only like the drink / meat metrics: the fun axis is "who gets the
 * MOST tourists per resident". `>=1` = "more arrivals than residents" (~71 real
 * places), `>=5` = the elite tourist magnets (~27: the micro-states and island
 * territories, Andorra, Monaco, San Marino, the Caribbean). The `<=` low end is the
 * big countries with few visitors per head, which reads as a population quiz rather
 * than a tourism one, so it is left off. Integer `n`, which the 0..~102 range gives.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const TOURISM_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1 },
  { op: '>=', n: 5 },
];

/**
 * Electricity-per-capita break tiers (electric power consumption, kWh per person per
 * year). `>=`-only like the other consumption metrics: the fun axis is "who uses the
 * MOST electricity per head". `>=5000` = a high-consumption country (~45 real
 * places), `>=10000` = the elite (~14: Iceland, Norway, the Gulf states, Canada, the
 * US, the Nordics). The `<=` low end is the developing world, which reads as a
 * development quiz rather than an energy one, so it is left off. Integer `n`, which
 * the 14..~49,000 kWh range gives comfortably.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const ELECTRICITY_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 5000 },
  { op: '>=', n: 10000 },
];

/**
 * McDonald's-density break tiers (restaurants per million people). `>=10` is "the
 * chain is genuinely everywhere here" (~53 real places, the developed world plus
 * the Gulf and the richer Caribbean / Latin American markets), `>=25` the elite
 * (~14: Australia, the US, Canada, New Zealand, Qatar, Singapore, Japan and a
 * handful of small high-density territories).
 *
 * `>=`-only, for the same reason the production metrics are. The low end here is
 * dominated by the 151 places with an explicit 0, so a `<=` break would deal a cell
 * matching half the world, most of which never had a McDonald's at all. That is a
 * "which countries are poor or closed to Western chains" question, not a fun one.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const MCDONALDS_PER_MILLION_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10 },
  { op: '>=', n: 25 },
];

/**
 * Bordering-countries break tiers (number of countries sharing a land border).
 * `>=5` is a well-connected country (~59 real places), `>=8` the elite (~11:
 * Russia & China at 14, Brazil 10, DR Congo & Germany 9, plus the 8-border club:
 * France, Austria, Serbia, Turkey, Tanzania, Sudan).
 *
 * One low tier, `<=0` = "island (no land border)" (~94 real places). The low end
 * is dominated by that island pile at 0, so `<=0` is the one genuinely selective
 * and evocative low tier; a `<=1` / `<=2` would just fold in the thin 1-2-border
 * tail and get loose (119 / 148 places), so we keep the single island tier. As a
 * threshold (set membership) the 94-way tie at 0 is an asset, not the problem it
 * is for the Party "fewest" superlative (which drops the 0s entirely). `n = 0`
 * needs `signed` on the THRESHOLD_METRICS entry so `parseThreshold` admits it.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const BORDERS_BREAKS_FOR_RANDOM = [
  { op: '<=', n: 0 },
  { op: '>=', n: 5 },
  { op: '>=', n: 8 },
];

/**
 * Tea-production-threshold Categories (green-tea-leaf tonnes). Sparse like
 * coffee, so `>=`-only: only ~46 countries grow tea, and a `<=` tier would just
 * collect the ~180 non-growers sitting at 0 (via `absence: 'zero'`). The FAOSTAT
 * green-leaf series runs large (China ~13.8M t), so the breaks scale up one
 * decade from coffee, matching apple's `10K / 100K / 1M` (24 / 17 / 6 real
 * places). `exclusiveGroup: 'tea'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const TEA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
  { op: '>=', n: 1_000_000 },
];

/**
 * Sugar-cane-production-threshold Categories (tonnes of cane). Sparse like the
 * other crops, so `>=`-only: ~104 countries grow cane, and a `<=` tier would
 * just collect the ~180 non-growers at 0 (via `absence: 'zero'`). Cane is the
 * largest crop on Earth by tonnage (world ~1.9B t), so the breaks sit a decade
 * above rice: `1M / 10M / 100M` (54 / 19 / 3 real places). `exclusiveGroup:
 * 'sugarcane'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const SUGARCANE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000_000 },
  { op: '>=', n: 10_000_000 },
  { op: '>=', n: 100_000_000 },
];

/**
 * Gold-production-threshold Categories (tonnes of mined gold). Sparse like the
 * crops, so `>=`-only: gold is measured in small whole tonnes (China ~380 t
 * tops it), and the USGS itemizes only ~17 major producers, so a `<=` tier would
 * just collect the ~180 non-producers at 0 (via `absence: 'zero'`). The breaks
 * `50 / 100 / 200` scale to gold's low tonnage: 17 / 12 / 4 real places, the
 * significant / major / giant producers. `exclusiveGroup: 'gold'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const GOLD_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 50 },
  { op: '>=', n: 100 },
  { op: '>=', n: 200 },
];

/**
 * Olive-oil-production-threshold Categories (tonnes of olive oil). Sparse like
 * the other crops (coffee / wine / cocoa / banana), so `>=`-only: FAOSTAT lists
 * only ~28 producers, so a `<=` tier would just collect the ~230 non-producers
 * at 0 (via `absence: 'zero'`). The breaks `1K / 10K / 100K` mirror the crop
 * convention and sit well inside olive oil's range (Spain ~666K t tops it):
 * 25 / 20 / 8 producers, the growers / notable / major-producer tiers.
 * `exclusiveGroup: 'oliveOil'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const OLIVE_OIL_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000 },
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
];

/**
 * Honey-production-threshold Categories (tonnes of natural honey). Sparse like
 * the crops, so `>=`-only: FAOSTAT itemizes ~100 producers (we pin the top 55),
 * so a `<=` tier would just collect the ~200 non-producers at 0 (via
 * `absence: 'zero'`). The breaks `10K / 50K / 100K` scale to honey's spread
 * (China ~462K t tops it, then a steep drop): 28 / 10 / 2 real places, the
 * producers / big / giant (China & Türkiye only) tiers. `exclusiveGroup: 'honey'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const HONEY_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10_000 },
  { op: '>=', n: 50_000 },
  { op: '>=', n: 100_000 },
];

/**
 * Average-temperature-threshold Categories (degrees Celsius, dense metric). Hot
 * `>=25 / >=20 / >=10` (99 / 165 / 212 real places) and cold `<=10 / <=5 / <=0`
 * (50 / 16 / 6). The `<=0` "below freezing on average" tier (Antarctica,
 * Greenland, Svalbard, Canada, Russia, Bouvet) is the first metric break whose
 * `n` is not positive, which is why `parseThreshold` admits zero. Breaks stay
 * whole integers so the `.`-split i18n keys and `parseThreshold` round-trip.
 * `exclusiveGroup: 'temperature'`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const TEMPERATURE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 25 },
  { op: '>=', n: 20 },
  { op: '>=', n: 10 },
  { op: '<=', n: 10 },
  { op: '<=', n: 5 },
  { op: '<=', n: 0 },
];

/**
 * Happiness-score-threshold Categories (World Happiness Report Cantril ladder,
 * 0-10). Sparse `absence: 'unknown'` survey metric (the Gallup poll reaches
 * ~147 countries), so `>=`-only and happiest-first: `>=7 / >=6 / >=5` (9 / 61 /
 * 100 covered places), the "very happy / happy / above the midpoint" tiers. A
 * `<=` tier would surface the conflict / poverty tail, a poverty quiz not a
 * happiness one, so it is deliberately omitted. `exclusiveGroup: 'happiness'`.
 *
 * Breaks are whole integers (the ladder is 0-10) so no signed parse is needed.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const HAPPINESS_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 7 },
  { op: '>=', n: 6 },
  { op: '>=', n: 5 },
];

/**
 * Government-integrity-threshold Categories (Transparency International CPI,
 * 0-100, higher = cleaner). Displayed as "Government integrity" so the
 * high-is-good scale reads intuitively; the code key stays `corruption`. Sparse
 * `absence: 'unknown'` (TI scores ~181 states), so `>=`-only and cleanest-first:
 * `>=50 / >=60 / >=70` (58 / 37 / 19 covered places), the "cleaner than the
 * midpoint / clean / very clean" tiers. A `<=` tier would surface the
 * failed-state tail, a grim quiz, so it is omitted. `exclusiveGroup: 'corruption'`.
 *
 * Breaks are whole integers (the index is 0-100) so no signed parse is needed.
 *
 * @type {Array<{ op: '>=' | '<=', n: number }>}
 */
export const CORRUPTION_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 50 },
  { op: '>=', n: 60 },
  { op: '>=', n: 70 },
];

/** Motifs the random puzzle generator (ticTacToe) is allowed
 * to pair with continents on the row / column axes. Some motifs appear on
 * flags from only one continent (e.g. `eu-member` is Europe-only) — those
 * are still allowed in the pool because `generateRandomPuzzle` retries up
 * to 200 times when an attempted puzzle has an unfillable cell. The
 * seed-success test in countries.test.js guards the retry headroom: if
 * the pool ever drifts to where 30+ seeds can't yield a valid puzzle, the
 * test fails. See ALL_MOTIFS below for motifs that can be filtered on
 * (findFlag / flagsdata) but aren't suitable for random pairing — today
 * that's just `union-jack` which has narrow coverage and no compelling
 * puzzle hook. */
export const MOTIFS_FOR_RANDOM = [
  'animal',
  'bird',
  'coat-of-arms',
  'weapon',
  'star-or-moon',
  'cross',
  'eu-member',
];

/** Every motif key that can appear in `country.motifs`. Used by the
 * findFlag chooser and the flagsdata filter bar so the UI can offer
 * every tagged motif as a filter. Superset of MOTIFS_FOR_RANDOM —
 * adds motifs that work as filters but can't anchor a random puzzle
 * (e.g. union-jack, which no Asian flag carries). */
export const ALL_MOTIFS = [
  ...MOTIFS_FOR_RANDOM,
  'union-jack',
];

/**
 * @param {string} color
 * @returns {Category}
 */
export function hasColor(color) {
  return {
    id: `hasColor:${color}`,
    label: color,
    predicate: (c) => c.colors.includes(color),
  };
}

/**
 * Every count a player could reasonably give for this flag — the canonical
 * `c.colors.length` plus any values declared in `ambiguousColorCount`. Used
 * by the TTT `colorCount` predicate so a flag whose count is genuinely
 * contested (e.g. Kiribati's yellow/gold shade split) satisfies the cell
 * under any of its plausible reads. Daily / findFlag stay strict-canonical
 * via `flagsFilter.js` and instead veto ambiguity-straddling puzzles at
 * authoring time (`ambiguityAudit.js`).
 *
 * @param {{ colors: string[], ambiguousColorCount?: number[] }} c
 * @returns {number[]}
 */
function plausibleCounts(c) {
  const ambig = Array.isArray(c.ambiguousColorCount) ? c.ambiguousColorCount : [];
  return [c.colors.length, ...ambig];
}

/**
 * "Colour-count" Category — `op:'='` matches exactly N colours, `op:'>='`
 * matches N or more, `op:'<='` matches N or fewer. The id encodes the op
 * in URL-suffix form: bare `N` for `=` (keeps daily catalog entries and
 * shareable URLs stable), `>=N` / `<=N` for the inequality variants.
 *
 * Predicate accepts a flag if *any* of its plausible counts satisfies the
 * constraint — see `plausibleCounts` above.
 *
 * @param {'=' | '>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function colorCount(op, n) {
  const idSuffix = op === '=' ? String(n) : `${op}${n}`;
  let label = `only ${n} colours`;
  /** @type {(c: Country) => boolean} */
  let predicate = (c) => plausibleCounts(c).some((v) => v === n);
  if (op === '>=') {
    label = `${n} or more colours`;
    predicate = (c) => plausibleCounts(c).some((v) => v >= n);
  } else if (op === '<=') {
    label = `${n} or fewer colours`;
    predicate = (c) => plausibleCounts(c).some((v) => v <= n);
  }
  return {
    id: `colorCount:${idSuffix}`,
    label,
    predicate,
    exclusiveGroup: 'colorCount',
  };
}

/**
 * @param {string} motif
 * @returns {Category}
 */
export function hasMotif(motif) {
  return {
    id: `hasMotif:${motif}`,
    label: motif,
    predicate: (c) => Array.isArray(c.motifs) && c.motifs.includes(motif),
  };
}

/**
 * "Population threshold" Category — `op:'>='` matches countries with at least
 * `n` people, `op:'<='` matches at most `n`. The predicate reads the `population`
 * field denormalized onto each Country at load (`attachPopulations` in
 * group.js); a country with no population value (the metric is sparse — most
 * territories and all non-place flags lack one) never matches either
 * direction. That mirrors every other engine predicate reading a plain Country
 * field, so `categoryFromId` can rebuild a working predicate from the id alone
 * (the online path ships categories over the wire as `{id, label}` and
 * rehydrates via the id) with no population map to thread through.
 *
 * The id encodes the op in URL-suffix form: `>=N` / `<=N` with the raw people
 * count, keeping shareable URLs and stored puzzles stable. Members share
 * `exclusiveGroup: 'population'` so no two population constraints coexist
 * across axes.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function population(op, n) {
  const human = `${n / 1_000_000}M`;
  const label = op === '>=' ? `over ${human} people` : `under ${human} people`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.population === 'number' && c.population >= n
      : (c) => typeof c.population === 'number' && c.population <= n;
  /** @type {Category} */
  const cat = {
    id: `population:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'population',
  };
  return cat;
}

/**
 * Population-density-threshold Category factory (people per km²). Reads the
 * denormalized `country.density` field (`attachDensities`). `exclusiveGroup:
 * 'density'`. The label bakes a plain integer (`over 100 people/km²`).
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function density(op, n) {
  const label = op === '>=' ? `over ${n} people/km²` : `under ${n} people/km²`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.density === 'number' && c.density >= n
      : (c) => typeof c.density === 'number' && c.density <= n;
  /** @type {Category} */
  const cat = {
    id: `density:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'density',
  };
  return cat;
}

/**
 * Land-area-threshold Category factory, the km² twin of `population`. Reads the
 * denormalized `country.area` field (copied on at load by `attachAreas`), so a
 * category rehydrates from its id string alone across the wire and storage.
 * Members share `exclusiveGroup: 'area'`.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function area(op, n) {
  const human = n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`;
  const label = op === '>=' ? `over ${human} km²` : `under ${human} km²`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.area === 'number' && c.area >= n
      : (c) => typeof c.area === 'number' && c.area <= n;
  /** @type {Category} */
  const cat = {
    id: `area:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'area',
  };
  return cat;
}

/** Compact US$ label ("$100B", "$1T", "$100M") for the GDP threshold text. */
function usdCompact(/** @type {number} */ n) {
  if (n >= 1_000_000_000_000) return `$${n / 1_000_000_000_000}T`;
  if (n >= 1_000_000_000) return `$${n / 1_000_000_000}B`;
  if (n >= 1_000_000) return `$${n / 1_000_000}M`;
  return `$${n / 1_000}K`;
}

/** Compact US$ i18n token ("100b", "1t", "100m") aligned with the break lists. */
function usdToken(/** @type {number} */ n) {
  if (n >= 1_000_000_000_000) return `${n / 1_000_000_000_000}t`;
  if (n >= 1_000_000_000) return `${n / 1_000_000_000}b`;
  if (n >= 1_000_000) return `${n / 1_000_000}m`;
  return `${n / 1_000}k`;
}

/** Compact tonnes label ("1K", "10K", "100K", "1M") for the coffee threshold text. */
function tonnesCompact(/** @type {number} */ n) {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return `${n}`;
}

/** Compact tonnes i18n token ("1k", "10k", "100k", "1m") aligned with the break list. */
function tonnesToken(/** @type {number} */ n) {
  if (n >= 1_000_000) return `${n / 1_000_000}m`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return `${n}`;
}

/** Metres with thousands separators ("5,000", "500") for the elevation threshold text. */
function metresLabel(/** @type {number} */ n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Kilometres with thousands separators ("25,000", "500") for the coastline threshold text. */
function kmLabel(/** @type {number} */ n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Terawatt-hours with thousands separators ("1,000", "100") for the oil threshold text. */
function twhLabel(/** @type {number} */ n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * GDP-threshold Category factory (nominal current US$). Reads the denormalized
 * `country.gdp` field (`attachGdps`). `exclusiveGroup: 'gdp'`.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function gdp(op, n) {
  const human = usdCompact(n);
  const label = op === '>=' ? `over ${human}` : `under ${human}`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.gdp === 'number' && c.gdp >= n
      : (c) => typeof c.gdp === 'number' && c.gdp <= n;
  /** @type {Category} */
  const cat = {
    id: `gdp:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'gdp',
  };
  return cat;
}

/**
 * GDP-per-capita-threshold Category factory (nominal current US$ per person).
 * Reads the denormalized `country.gdpPerCapita` field (`attachGdpPerCapitas`).
 * `exclusiveGroup: 'gdpPerCapita'`.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function gdpPerCapita(op, n) {
  const human = usdCompact(n);
  const label = op === '>=' ? `over ${human}` : `under ${human}`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.gdpPerCapita === 'number' && c.gdpPerCapita >= n
      : (c) => typeof c.gdpPerCapita === 'number' && c.gdpPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `gdpPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'gdpPerCapita',
  };
  return cat;
}

/**
 * Coffee-production-threshold Category factory (green-coffee tonnes). Reads the
 * denormalized `country.coffee` field (`attachCoffees`, which fills 0 for a real
 * place that grows none). `exclusiveGroup: 'coffee'`. The break list is `>=`-only
 * (see COFFEE_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `coffee:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function coffee(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.coffee === 'number' && c.coffee >= n
      : (c) => typeof c.coffee === 'number' && c.coffee <= n;
  /** @type {Category} */
  const cat = {
    id: `coffee:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'coffee',
  };
  return cat;
}

/**
 * Wine-production-threshold Category factory (wine tonnes). Reads the
 * denormalized `country.wine` field (`attachWines`, which fills 0 for a real
 * place that makes none). `exclusiveGroup: 'wine'`. The break list is `>=`-only
 * (see WINE_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `wine:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function wine(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.wine === 'number' && c.wine >= n
      : (c) => typeof c.wine === 'number' && c.wine <= n;
  /** @type {Category} */
  const cat = {
    id: `wine:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'wine',
  };
  return cat;
}

/**
 * Cocoa-production-threshold Category factory (cocoa-bean tonnes). Reads the
 * denormalized `country.cocoa` field (`attachCocoas`, which fills 0 for a real
 * place that grows none). `exclusiveGroup: 'cocoa'`. The break list is `>=`-only
 * (see COCOA_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `cocoa:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function cocoa(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.cocoa === 'number' && c.cocoa >= n
      : (c) => typeof c.cocoa === 'number' && c.cocoa <= n;
  /** @type {Category} */
  const cat = {
    id: `cocoa:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'cocoa',
  };
  return cat;
}

/**
 * Banana-production-threshold Category factory (banana tonnes). Reads the
 * denormalized `country.banana` field (`attachBananas`, which fills 0 for a real
 * place that grows none). `exclusiveGroup: 'banana'`. The break list is
 * `>=`-only (see BANANA_BREAKS_FOR_RANDOM), but the `<=` branch is kept for
 * symmetry so a `banana:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function banana(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.banana === 'number' && c.banana >= n
      : (c) => typeof c.banana === 'number' && c.banana <= n;
  /** @type {Category} */
  const cat = {
    id: `banana:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'banana',
  };
  return cat;
}

/**
 * Apple-production-threshold Category factory (apple tonnes). Reads the
 * denormalized `country.apple` field (`attachApples`, which fills 0 for a real
 * place that grows none). `exclusiveGroup: 'apple'`. The break list is
 * `>=`-only (see APPLE_BREAKS_FOR_RANDOM), but the `<=` branch is kept for
 * symmetry so an `apple:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function apple(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.apple === 'number' && c.apple >= n
      : (c) => typeof c.apple === 'number' && c.apple <= n;
  /** @type {Category} */
  const cat = {
    id: `apple:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'apple',
  };
  return cat;
}

/**
 * Highest-elevation-threshold Category factory (metres above sea level). Reads
 * the denormalized `country.elevation` field (`attachElevations`).
 * `exclusiveGroup: 'elevation'`. Dense and two-directional, so both `>=` (high
 * peaks) and `<=` (low, flat places) are meaningful tiers, the mirror of area.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function elevation(op, n) {
  const human = metresLabel(n);
  const label = op === '>=' ? `over ${human} m` : `under ${human} m`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.elevation === 'number' && c.elevation >= n
      : (c) => typeof c.elevation === 'number' && c.elevation <= n;
  /** @type {Category} */
  const cat = {
    id: `elevation:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'elevation',
  };
  return cat;
}

/**
 * Coastline-threshold Category factory (kilometres of coastline). Reads the
 * denormalized `country.coastline` field (`attachCoastlines`). `exclusiveGroup:
 * 'coastline'`. Dense and two-directional: `>=` picks out the long-coast
 * archipelagos and giants, `<=` the short-coast and landlocked places (which
 * carry 0), the mirror of area / elevation.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function coastline(op, n) {
  const human = kmLabel(n);
  const label = op === '>=' ? `over ${human} km of coast` : `under ${human} km of coast`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.coastline === 'number' && c.coastline >= n
      : (c) => typeof c.coastline === 'number' && c.coastline <= n;
  /** @type {Category} */
  const cat = {
    id: `coastline:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'coastline',
  };
  return cat;
}

/**
 * Forest-cover-threshold Category factory (forest area as a percentage of land
 * area). Reads the denormalized `country.forest` field (`attachForests`).
 * `exclusiveGroup: 'forest'`. Dense, intensive and two-directional: `>=` picks
 * out the heavily-wooded places, `<=` the arid and ice-bound ones (which carry
 * 0.0), size-independent unlike the extensive metrics.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function forest(op, n) {
  const label = op === '>=' ? `over ${n}% forest` : `under ${n}% forest`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.forest === 'number' && c.forest >= n
      : (c) => typeof c.forest === 'number' && c.forest <= n;
  /** @type {Category} */
  const cat = {
    id: `forest:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'forest',
  };
  return cat;
}

/**
 * Oil-production-threshold Category factory (terawatt-hours). Reads the
 * denormalized `country.oil` field (`attachOils`, which fills 0 for a real place
 * that pumps none). `exclusiveGroup: 'oil'`. The break list is `>=`-only (see
 * OIL_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so an
 * `oil:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function oil(op, n) {
  const human = twhLabel(n);
  const label = op === '>=' ? `over ${human} TWh` : `under ${human} TWh`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.oil === 'number' && c.oil >= n
      : (c) => typeof c.oil === 'number' && c.oil <= n;
  /** @type {Category} */
  const cat = {
    id: `oil:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'oil',
  };
  return cat;
}

/**
 * Rice-production-threshold Category factory (paddy tonnes). Reads the
 * denormalized `country.rice` field (`attachRices`, which fills 0 for a real
 * place that grows none). `exclusiveGroup: 'rice'`. The break list is `>=`-only
 * (see RICE_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `rice:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function rice(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.rice === 'number' && c.rice >= n
      : (c) => typeof c.rice === 'number' && c.rice <= n;
  /** @type {Category} */
  const cat = {
    id: `rice:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'rice',
  };
  return cat;
}

/**
 * Coal-production-threshold Category factory (terawatt-hours). Reads the
 * denormalized `country.coal` field (`attachCoals`, which fills 0 for a real
 * place that mines none). `exclusiveGroup: 'coal'`. The break list is `>=`-only
 * (see COAL_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `coal:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function coal(op, n) {
  const human = twhLabel(n);
  const label = op === '>=' ? `over ${human} TWh` : `under ${human} TWh`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.coal === 'number' && c.coal >= n
      : (c) => typeof c.coal === 'number' && c.coal <= n;
  /** @type {Category} */
  const cat = {
    id: `coal:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'coal',
  };
  return cat;
}

/**
 * Sheep-per-capita-threshold Category factory (sheep head per person). Reads the
 * denormalized `country.sheepPerCapita` field (`attachSheepPerCapitas`, a dense
 * derived metric, so a place with no sheep reads a real 0). `exclusiveGroup:
 * 'sheepPerCapita'`. The break list is `>=`-only (see
 * SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry
 * so a `sheepPerCapita:<=N` id would still rehydrate correctly. The label bakes a
 * plain integer (`over 1 sheep per person`).
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function sheepPerCapita(op, n) {
  const label = op === '>=' ? `over ${n} sheep per person` : `under ${n} sheep per person`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.sheepPerCapita === 'number' && c.sheepPerCapita >= n
      : (c) => typeof c.sheepPerCapita === 'number' && c.sheepPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `sheepPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'sheepPerCapita',
  };
  return cat;
}

/**
 * Cattle-per-capita-threshold Category factory (cattle head per person), the
 * bovine twin of `sheepPerCapita`. Reads the denormalized `country.cattlePerCapita`
 * field (`attachCattlePerCapitas`, a dense derived metric, so a place with no
 * cattle reads a real 0). `exclusiveGroup: 'cattlePerCapita'`. The break list is
 * `>=`-only (see CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM), but the `<=` branch is
 * kept for symmetry so a `cattlePerCapita:<=N` id would still rehydrate. The
 * label bakes a plain integer (`over 1 cattle per person`).
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function cattlePerCapita(op, n) {
  const label = op === '>=' ? `over ${n} cattle per person` : `under ${n} cattle per person`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.cattlePerCapita === 'number' && c.cattlePerCapita >= n
      : (c) => typeof c.cattlePerCapita === 'number' && c.cattlePerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `cattlePerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'cattlePerCapita',
  };
  return cat;
}

/**
 * Beer-per-capita-threshold Category factory (litres of beer per person per year).
 * Reads the denormalized `country.beerPerCapita` field (`attachBeerPerCapitas`, an
 * `absence: 'unknown'` metric, so the predicate must guard on the field being a
 * number: a place WHO does not measure has none and never matches). `exclusiveGroup:
 * 'beerPerCapita'`. The break list is `>=`-only (see BEER_PER_CAPITA_BREAKS_FOR_RANDOM),
 * but the `<=` branch is kept for symmetry so a `beerPerCapita:<=N` id would still
 * rehydrate. The label bakes a plain integer (`over 50 litres per capita`).
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function beerPerCapita(op, n) {
  const label =
    op === '>=' ? `over ${n} litres per capita` : `under ${n} litres per capita`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.beerPerCapita === 'number' && c.beerPerCapita >= n
      : (c) => typeof c.beerPerCapita === 'number' && c.beerPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `beerPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'beerPerCapita',
  };
  return cat;
}

/**
 * Alcohol-per-capita-threshold Category factory (litres of pure alcohol per person
 * per year). Reads the denormalized `country.alcoholPerCapita` field
 * (`attachAlcoholPerCapitas`, an `absence: 'unknown'` metric, so the predicate must
 * guard on the field being a number: a place the source does not measure has none
 * and never matches). `exclusiveGroup: 'alcoholPerCapita'`. The break list is
 * `>=`-only (see ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM), but the `<=` branch is kept
 * for symmetry so an `alcoholPerCapita:<=N` id would still rehydrate.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function alcoholPerCapita(op, n) {
  const label =
    op === '>=' ? `over ${n} litres per capita` : `under ${n} litres per capita`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.alcoholPerCapita === 'number' && c.alcoholPerCapita >= n
      : (c) => typeof c.alcoholPerCapita === 'number' && c.alcoholPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `alcoholPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'alcoholPerCapita',
  };
  return cat;
}

/**
 * Meat-per-capita-threshold Category factory (kg of meat per person per year).
 * Reads the denormalized `country.meatPerCapita` field (`attachMeatPerCapitas`, an
 * `absence: 'unknown'` metric, so the predicate guards on the field being a number).
 * `exclusiveGroup: 'meatPerCapita'`. The break list is `>=`-only (see
 * MEAT_PER_CAPITA_BREAKS_FOR_RANDOM); the `<=` branch is kept for symmetry.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function meatPerCapita(op, n) {
  const label =
    op === '>=' ? `over ${n} kg per capita` : `under ${n} kg per capita`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.meatPerCapita === 'number' && c.meatPerCapita >= n
      : (c) => typeof c.meatPerCapita === 'number' && c.meatPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `meatPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'meatPerCapita',
  };
  return cat;
}

/**
 * Tourism-per-capita-threshold Category factory (international tourist arrivals per
 * resident per year). Reads the denormalized `country.tourismPerCapita` field
 * (`attachTourismPerCapitas`, an `absence: 'unknown'` metric, so the predicate must
 * guard on the field being a number: a place the World Bank has no figure for has
 * none and never matches). `exclusiveGroup: 'tourismPerCapita'`. The break list is
 * `>=`-only (see TOURISM_PER_CAPITA_BREAKS_FOR_RANDOM); the `<=` branch is kept for
 * symmetry so a `tourismPerCapita:<=N` id would still rehydrate.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function tourismPerCapita(op, n) {
  const noun = n === 1 ? 'arrival' : 'arrivals';
  const label =
    op === '>=' ? `over ${n} ${noun} per resident` : `under ${n} ${noun} per resident`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.tourismPerCapita === 'number' && c.tourismPerCapita >= n
      : (c) => typeof c.tourismPerCapita === 'number' && c.tourismPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `tourismPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'tourismPerCapita',
  };
  return cat;
}

/**
 * Electricity-per-capita-threshold Category factory (electric power consumption, kWh
 * per person per year). Reads the denormalized `country.electricityPerCapita` field
 * (`attachElectricityPerCapitas`, an `absence: 'unknown'` metric, so the predicate
 * must guard on the field being a number: a place the World Bank does not meter has
 * none and never matches). `exclusiveGroup: 'electricityPerCapita'`. The break list
 * is `>=`-only (see ELECTRICITY_PER_CAPITA_BREAKS_FOR_RANDOM); the `<=` branch is
 * kept for symmetry.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function electricityPerCapita(op, n) {
  const human = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const label =
    op === '>=' ? `over ${human} kWh per capita` : `under ${human} kWh per capita`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.electricityPerCapita === 'number' && c.electricityPerCapita >= n
      : (c) => typeof c.electricityPerCapita === 'number' && c.electricityPerCapita <= n;
  /** @type {Category} */
  const cat = {
    id: `electricityPerCapita:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'electricityPerCapita',
  };
  return cat;
}

/**
 * McDonald's-density-threshold Category factory (restaurants per million people).
 * Reads the denormalized `country.mcdonaldsPerMillion` field
 * (`attachMcdonaldsPerMillions`, an `absence: 'unknown'` metric, so the predicate
 * must guard on the field being a number). `exclusiveGroup: 'mcdonaldsPerMillion'`.
 * The break list is `>=`-only (see MCDONALDS_PER_MILLION_BREAKS_FOR_RANDOM); the
 * `<=` branch is kept for symmetry.
 *
 * Note the guard is doing real work here and is NOT the same as a zero check. A
 * place with an explicit 0 (Iceland, Bolivia, Russia: no McDonald's) correctly
 * fails a `>=` predicate, while a folded market (Monaco, Andorra, Liechtenstein:
 * has McDonald's, count unpublished) has no value at all and must not match
 * either. Both read false, for different and both-correct reasons.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function mcdonaldsPerMillion(op, n) {
  const label =
    op === '>=' ? `over ${n} McDonald's per million` : `under ${n} McDonald's per million`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.mcdonaldsPerMillion === 'number' && c.mcdonaldsPerMillion >= n
      : (c) => typeof c.mcdonaldsPerMillion === 'number' && c.mcdonaldsPerMillion <= n;
  /** @type {Category} */
  const cat = {
    id: `mcdonaldsPerMillion:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'mcdonaldsPerMillion',
  };
  return cat;
}

/**
 * Bordering-countries-threshold Category factory (number of countries sharing a
 * land border). Reads the denormalized `country.borders` field (`attachBorders`, a
 * dense metric that fills a true 0 for every island, so the predicate guards on the
 * field being a number only to exclude the org flags). `exclusiveGroup: 'borders'`.
 * The break list is mostly `>=` plus the one `<=0` "island" tier (see
 * BORDERS_BREAKS_FOR_RANDOM); the `<=` branch renders "0 or fewer" = no land border.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function borders(op, n) {
  const label = op === '>=' ? `${n} or more` : `${n} or fewer`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.borders === 'number' && c.borders >= n
      : (c) => typeof c.borders === 'number' && c.borders <= n;
  /** @type {Category} */
  const cat = {
    id: `borders:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'borders',
  };
  return cat;
}

/**
 * Tea-production-threshold Category factory (green-tea-leaf tonnes). Reads the
 * denormalized `country.tea` field (`attachTeas`, which fills 0 for a real place
 * that grows none). `exclusiveGroup: 'tea'`. The break list is `>=`-only (see
 * TEA_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `tea:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function tea(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.tea === 'number' && c.tea >= n
      : (c) => typeof c.tea === 'number' && c.tea <= n;
  /** @type {Category} */
  const cat = {
    id: `tea:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'tea',
  };
  return cat;
}

/**
 * Sugar-cane-production-threshold Category factory (tonnes of cane). Reads the
 * denormalized `country.sugarcane` field (`attachSugarcanes`, which fills 0 for
 * a real place that grows none). `exclusiveGroup: 'sugarcane'`. The break list is
 * `>=`-only (see SUGARCANE_BREAKS_FOR_RANDOM), but the `<=` branch is kept for
 * symmetry so a `sugarcane:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function sugarcane(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.sugarcane === 'number' && c.sugarcane >= n
      : (c) => typeof c.sugarcane === 'number' && c.sugarcane <= n;
  /** @type {Category} */
  const cat = {
    id: `sugarcane:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'sugarcane',
  };
  return cat;
}

/**
 * Gold-production-threshold Category factory (tonnes of mined gold). Reads the
 * denormalized `country.gold` field (`attachGolds`, which fills 0 for a real
 * place that mines none). `exclusiveGroup: 'gold'`. The break list is `>=`-only
 * (see GOLD_BREAKS_FOR_RANDOM), but the `<=` branch is kept for symmetry so a
 * `gold:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function gold(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.gold === 'number' && c.gold >= n
      : (c) => typeof c.gold === 'number' && c.gold <= n;
  /** @type {Category} */
  const cat = {
    id: `gold:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'gold',
  };
  return cat;
}

/**
 * Olive-oil-production-threshold Category factory (tonnes of olive oil). Reads
 * the denormalized `country.oliveOil` field (`attachOliveOils`, which fills 0 for
 * a real place that makes none). `exclusiveGroup: 'oliveOil'`. The break list is
 * `>=`-only (see OLIVE_OIL_BREAKS_FOR_RANDOM), but the `<=` branch is kept for
 * symmetry so an `oliveOil:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function oliveOil(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.oliveOil === 'number' && c.oliveOil >= n
      : (c) => typeof c.oliveOil === 'number' && c.oliveOil <= n;
  /** @type {Category} */
  const cat = {
    id: `oliveOil:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'oliveOil',
  };
  return cat;
}

/**
 * Honey-production-threshold Category factory (tonnes of natural honey). Reads
 * the denormalized `country.honey` field (`attachHoneys`, which fills 0 for a
 * real place that makes none). `exclusiveGroup: 'honey'`. The break list is
 * `>=`-only (see HONEY_BREAKS_FOR_RANDOM), but the `<=` branch is kept for
 * symmetry so a `honey:<=N` id would still rehydrate correctly.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function honey(op, n) {
  const human = tonnesCompact(n);
  const label = op === '>=' ? `over ${human} tonnes` : `under ${human} tonnes`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.honey === 'number' && c.honey >= n
      : (c) => typeof c.honey === 'number' && c.honey <= n;
  /** @type {Category} */
  const cat = {
    id: `honey:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'honey',
  };
  return cat;
}

/**
 * Average-temperature-threshold Category factory (degrees Celsius). Reads the
 * denormalized `country.temperature` field (`attachTemperatures`). Dense metric:
 * every real place has a value, so the no-data guard blocks only org flags.
 * `exclusiveGroup: 'temperature'`. Values and the `<=0` break may be negative.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function temperature(op, n) {
  const label = op === '>=' ? `over ${n} °C` : `under ${n} °C`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.temperature === 'number' && c.temperature >= n
      : (c) => typeof c.temperature === 'number' && c.temperature <= n;
  /** @type {Category} */
  const cat = {
    id: `temperature:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'temperature',
  };
  return cat;
}

/**
 * Happiness-score-threshold Category factory (World Happiness Report ladder,
 * 0-10). Reads the denormalized `country.happiness` field (`attachHappinesses`).
 * Sparse `absence: 'unknown'` survey metric: the ~115 unsurveyed real places
 * carry no value and correctly read "no data" on a happiness cell.
 * `exclusiveGroup: 'happiness'`. The `<=` branch is kept for symmetry so a
 * `happiness:<=N` id would still rehydrate, though the breaks are `>=`-only.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function happiness(op, n) {
  const label = op === '>=' ? `over ${n}/10` : `under ${n}/10`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.happiness === 'number' && c.happiness >= n
      : (c) => typeof c.happiness === 'number' && c.happiness <= n;
  /** @type {Category} */
  const cat = {
    id: `happiness:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'happiness',
  };
  return cat;
}

/**
 * Government-integrity-threshold Category factory (Transparency International
 * CPI, 0-100, higher = cleaner). Reads the denormalized `country.corruption`
 * field (`attachCorruptions`). Displayed as "Government integrity"; the code key
 * stays `corruption`. Sparse `absence: 'unknown'` survey: the states TI does not
 * score carry no value and correctly read "no data". `exclusiveGroup:
 * 'corruption'`. The `<=` branch is kept for symmetry, though the breaks are
 * `>=`-only.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @returns {Category}
 */
export function corruption(op, n) {
  const label = op === '>=' ? `over ${n}/100` : `under ${n}/100`;
  /** @type {(c: Country) => boolean} */
  const predicate =
    op === '>='
      ? (c) => typeof c.corruption === 'number' && c.corruption >= n
      : (c) => typeof c.corruption === 'number' && c.corruption <= n;
  /** @type {Category} */
  const cat = {
    id: `corruption:${op}${n}`,
    label,
    predicate,
    exclusiveGroup: 'corruption',
  };
  return cat;
}

/**
 * The threshold world-metrics as one registry, so every surface that treats
 * them uniformly (the filter DSL parse/serialize, `matchesFilters`, the pill
 * labels, `categoryFromId`, the random pool, the single-use rule, the
 * `metricTiers` tier builder) drives off one definition instead of a per-metric
 * copy. Adding a metric is one entry here (+ its `Filters` field) rather than a
 * block edited into a dozen places.
 *
 * Each entry is self-describing:
 *   `breaks`         the `<KEY>_BREAKS_FOR_RANDOM` tiers (op/n)
 *   `factory`        the Category factory (`population` / `area` / …)
 *   `prefixFallback` English metric name, backing the `metric.<key>` i18n key
 *   `field`          the denormalized `Country` field the predicate reads
 *   `has`            "does this country carry a value?" (drives the no-data guard)
 *   `labelFor`       op+n → the localized threshold text ("over 100 people/km²"),
 *                    shared by the findFlag pill and the TTT category label
 *
 * `has`/`field` stay explicit per entry (not `c[key]`) so the strict typecheck
 * over `flags/**` keeps real field types instead of an index signature.
 *
 * @typedef {Object} ThresholdMetric
 * @property {ReadonlyArray<{ op: '>=' | '<=', n: number }>} breaks
 * @property {(op: '>=' | '<=', n: number) => Category} factory
 * @property {string} prefixFallback
 * @property {string} field
 * @property {string} family  Co-occurrence family for TTT puzzle composition:
 *   two categories in the same family never share a puzzle (so `gdp` +
 *   `gdpPerCapita`, both the "gdp" family, can't both appear, since they'd
 *   read as two "GDP" questions). Usually equals the key; only closely-related metrics
 *   share one. Filters are unaffected: you can still filter by both at once.
 * @property {(c: Country) => boolean} has
 * @property {boolean} [signed]  When true, this metric's breaks may be zero or
 *   negative (temperature's `<=0` "below freezing" tier), so `parseThreshold`
 *   is told to admit non-positive `n` for it. Omitted (positive-only) elsewhere.
 * @property {(op: '>=' | '<=', n: number, translate: (key: string, fallback: string) => string) => string} labelFor
 */

/** @type {Record<string, ThresholdMetric>} */
export const THRESHOLD_METRICS = {
  population: {
    breaks: POPULATION_BREAKS_FOR_RANDOM,
    factory: population,
    prefixFallback: 'Population',
    field: 'population',
    family: 'population',
    has: (c) => typeof c.population === 'number',
    labelFor: (op, n, translate) => {
      const token = `${n / 1_000_000}m`;
      const human = `${n / 1_000_000}M`;
      if (op === '>=') return translate(`population.atLeast.${token}`, `over ${human} people`);
      return translate(`population.atMost.${token}`, `under ${human} people`);
    },
  },
  area: {
    breaks: AREA_BREAKS_FOR_RANDOM,
    factory: area,
    prefixFallback: 'Land area',
    field: 'area',
    family: 'area',
    has: (c) => typeof c.area === 'number',
    labelFor: (op, n, translate) => {
      const token = n >= 1_000_000 ? `${n / 1_000_000}m` : `${n / 1_000}k`;
      const human = n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`;
      if (op === '>=') return translate(`area.atLeast.${token}`, `over ${human} km²`);
      return translate(`area.atMost.${token}`, `under ${human} km²`);
    },
  },
  density: {
    breaks: DENSITY_BREAKS_FOR_RANDOM,
    factory: density,
    prefixFallback: 'Population density',
    field: 'density',
    family: 'density',
    has: (c) => typeof c.density === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`density.atLeast.${n}`, `over ${n} people/km²`);
      return translate(`density.atMost.${n}`, `under ${n} people/km²`);
    },
  },
  gdp: {
    breaks: GDP_BREAKS_FOR_RANDOM,
    factory: gdp,
    prefixFallback: 'GDP',
    field: 'gdp',
    family: 'gdp',
    has: (c) => typeof c.gdp === 'number',
    labelFor: (op, n, translate) => {
      const token = usdToken(n);
      const human = usdCompact(n);
      if (op === '>=') return translate(`gdp.atLeast.${token}`, `over ${human}`);
      return translate(`gdp.atMost.${token}`, `under ${human}`);
    },
  },
  gdpPerCapita: {
    breaks: GDP_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: gdpPerCapita,
    prefixFallback: 'GDP per capita',
    field: 'gdpPerCapita',
    family: 'gdp', // shares the "gdp" family with total GDP: never both in one TTT puzzle
    has: (c) => typeof c.gdpPerCapita === 'number',
    labelFor: (op, n, translate) => {
      const token = usdToken(n);
      const human = usdCompact(n);
      if (op === '>=') return translate(`gdpPerCapita.atLeast.${token}`, `over ${human}`);
      return translate(`gdpPerCapita.atMost.${token}`, `under ${human}`);
    },
  },
  coffee: {
    breaks: COFFEE_BREAKS_FOR_RANDOM,
    factory: coffee,
    prefixFallback: 'Coffee production',
    field: 'coffee',
    family: 'coffee',
    has: (c) => typeof c.coffee === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`coffee.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`coffee.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  wine: {
    breaks: WINE_BREAKS_FOR_RANDOM,
    factory: wine,
    prefixFallback: 'Wine production',
    field: 'wine',
    family: 'wine',
    has: (c) => typeof c.wine === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`wine.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`wine.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  cocoa: {
    breaks: COCOA_BREAKS_FOR_RANDOM,
    factory: cocoa,
    prefixFallback: 'Cocoa production',
    field: 'cocoa',
    family: 'cocoa',
    has: (c) => typeof c.cocoa === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`cocoa.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`cocoa.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  banana: {
    breaks: BANANA_BREAKS_FOR_RANDOM,
    factory: banana,
    prefixFallback: 'Banana production',
    field: 'banana',
    family: 'banana',
    has: (c) => typeof c.banana === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`banana.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`banana.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  apple: {
    breaks: APPLE_BREAKS_FOR_RANDOM,
    factory: apple,
    prefixFallback: 'Apple production',
    field: 'apple',
    family: 'apple',
    has: (c) => typeof c.apple === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`apple.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`apple.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  elevation: {
    breaks: ELEVATION_BREAKS_FOR_RANDOM,
    factory: elevation,
    prefixFallback: 'Highest elevation',
    field: 'elevation',
    family: 'elevation',
    has: (c) => typeof c.elevation === 'number',
    labelFor: (op, n, translate) => {
      const human = metresLabel(n);
      if (op === '>=') return translate(`elevation.atLeast.${n}`, `over ${human} m`);
      return translate(`elevation.atMost.${n}`, `under ${human} m`);
    },
  },
  coastline: {
    breaks: COASTLINE_BREAKS_FOR_RANDOM,
    factory: coastline,
    prefixFallback: 'Coastline length',
    field: 'coastline',
    family: 'coastline',
    has: (c) => typeof c.coastline === 'number',
    labelFor: (op, n, translate) => {
      const human = kmLabel(n);
      if (op === '>=') return translate(`coastline.atLeast.${n}`, `over ${human} km`);
      return translate(`coastline.atMost.${n}`, `under ${human} km`);
    },
  },
  forest: {
    breaks: FOREST_BREAKS_FOR_RANDOM,
    factory: forest,
    prefixFallback: 'Forest cover',
    field: 'forest',
    family: 'forest',
    has: (c) => typeof c.forest === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`forest.atLeast.${n}`, `over ${n}%`);
      return translate(`forest.atMost.${n}`, `under ${n}%`);
    },
  },
  oil: {
    breaks: OIL_BREAKS_FOR_RANDOM,
    factory: oil,
    prefixFallback: 'Oil production',
    field: 'oil',
    family: 'oil',
    has: (c) => typeof c.oil === 'number',
    labelFor: (op, n, translate) => {
      const human = twhLabel(n);
      if (op === '>=') return translate(`oil.atLeast.${n}`, `over ${human} TWh`);
      return translate(`oil.atMost.${n}`, `under ${human} TWh`);
    },
  },
  rice: {
    breaks: RICE_BREAKS_FOR_RANDOM,
    factory: rice,
    prefixFallback: 'Rice production',
    field: 'rice',
    family: 'rice',
    has: (c) => typeof c.rice === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`rice.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`rice.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  coal: {
    breaks: COAL_BREAKS_FOR_RANDOM,
    factory: coal,
    prefixFallback: 'Coal production',
    field: 'coal',
    family: 'coal',
    has: (c) => typeof c.coal === 'number',
    labelFor: (op, n, translate) => {
      const human = twhLabel(n);
      if (op === '>=') return translate(`coal.atLeast.${n}`, `over ${human} TWh`);
      return translate(`coal.atMost.${n}`, `under ${human} TWh`);
    },
  },
  sheepPerCapita: {
    breaks: SHEEP_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: sheepPerCapita,
    prefixFallback: 'Sheep per capita',
    field: 'sheepPerCapita',
    family: 'sheepPerCapita',
    has: (c) => typeof c.sheepPerCapita === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`sheepPerCapita.atLeast.${n}`, `over ${n} sheep per person`);
      return translate(`sheepPerCapita.atMost.${n}`, `under ${n} sheep per person`);
    },
  },
  cattlePerCapita: {
    breaks: CATTLE_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: cattlePerCapita,
    prefixFallback: 'Cattle per capita',
    field: 'cattlePerCapita',
    family: 'cattlePerCapita',
    has: (c) => typeof c.cattlePerCapita === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`cattlePerCapita.atLeast.${n}`, `over ${n} cattle per person`);
      return translate(`cattlePerCapita.atMost.${n}`, `under ${n} cattle per person`);
    },
  },
  beerPerCapita: {
    breaks: BEER_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: beerPerCapita,
    prefixFallback: 'Beer consumption',
    field: 'beerPerCapita',
    family: 'beerPerCapita',
    has: (c) => typeof c.beerPerCapita === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`beerPerCapita.atLeast.${n}`, `over ${n} litres per capita`);
      return translate(`beerPerCapita.atMost.${n}`, `under ${n} litres per capita`);
    },
  },
  tea: {
    breaks: TEA_BREAKS_FOR_RANDOM,
    factory: tea,
    prefixFallback: 'Tea production',
    field: 'tea',
    family: 'tea',
    has: (c) => typeof c.tea === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`tea.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`tea.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  sugarcane: {
    breaks: SUGARCANE_BREAKS_FOR_RANDOM,
    factory: sugarcane,
    prefixFallback: 'Sugarcane production',
    field: 'sugarcane',
    family: 'sugarcane',
    has: (c) => typeof c.sugarcane === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`sugarcane.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`sugarcane.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  gold: {
    breaks: GOLD_BREAKS_FOR_RANDOM,
    factory: gold,
    prefixFallback: 'Gold production',
    field: 'gold',
    family: 'gold',
    has: (c) => typeof c.gold === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`gold.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`gold.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  alcoholPerCapita: {
    breaks: ALCOHOL_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: alcoholPerCapita,
    prefixFallback: 'Alcohol consumption',
    field: 'alcoholPerCapita',
    family: 'alcoholPerCapita',
    has: (c) => typeof c.alcoholPerCapita === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`alcoholPerCapita.atLeast.${n}`, `over ${n} litres per capita`);
      return translate(`alcoholPerCapita.atMost.${n}`, `under ${n} litres per capita`);
    },
  },
  meatPerCapita: {
    breaks: MEAT_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: meatPerCapita,
    prefixFallback: 'Meat consumption',
    field: 'meatPerCapita',
    family: 'meatPerCapita',
    has: (c) => typeof c.meatPerCapita === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`meatPerCapita.atLeast.${n}`, `over ${n} kg per capita`);
      return translate(`meatPerCapita.atMost.${n}`, `under ${n} kg per capita`);
    },
  },
  tourismPerCapita: {
    breaks: TOURISM_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: tourismPerCapita,
    prefixFallback: 'Tourist arrivals per capita',
    field: 'tourismPerCapita',
    family: 'tourismPerCapita',
    has: (c) => typeof c.tourismPerCapita === 'number',
    labelFor: (op, n, translate) => {
      const noun = n === 1 ? 'arrival' : 'arrivals';
      if (op === '>=') return translate(`tourismPerCapita.atLeast.${n}`, `over ${n} ${noun} per resident`);
      return translate(`tourismPerCapita.atMost.${n}`, `under ${n} ${noun} per resident`);
    },
  },
  electricityPerCapita: {
    breaks: ELECTRICITY_PER_CAPITA_BREAKS_FOR_RANDOM,
    factory: electricityPerCapita,
    prefixFallback: 'Electricity use per capita',
    field: 'electricityPerCapita',
    family: 'electricityPerCapita',
    has: (c) => typeof c.electricityPerCapita === 'number',
    labelFor: (op, n, translate) => {
      const human = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if (op === '>=') return translate(`electricityPerCapita.atLeast.${n}`, `over ${human} kWh per capita`);
      return translate(`electricityPerCapita.atMost.${n}`, `under ${human} kWh per capita`);
    },
  },
  mcdonaldsPerMillion: {
    breaks: MCDONALDS_PER_MILLION_BREAKS_FOR_RANDOM,
    factory: mcdonaldsPerMillion,
    prefixFallback: "McDonald's per million people",
    field: 'mcdonaldsPerMillion',
    family: 'mcdonaldsPerMillion',
    has: (c) => typeof c.mcdonaldsPerMillion === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`mcdonaldsPerMillion.atLeast.${n}`, `over ${n} McDonald's per million`);
      return translate(`mcdonaldsPerMillion.atMost.${n}`, `under ${n} McDonald's per million`);
    },
  },
  borders: {
    breaks: BORDERS_BREAKS_FOR_RANDOM,
    factory: borders,
    prefixFallback: 'Bordering countries',
    field: 'borders',
    family: 'borders',
    // Signed: the `<=0` "island" break has a non-positive `n` (zero, not a
    // negative), so parseThreshold is told to admit it for this metric.
    signed: true,
    has: (c) => typeof c.borders === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`borders.atLeast.${n}`, `${n} or more`);
      return translate(`borders.atMost.${n}`, `${n} or fewer`);
    },
  },
  oliveOil: {
    breaks: OLIVE_OIL_BREAKS_FOR_RANDOM,
    factory: oliveOil,
    prefixFallback: 'Olive oil production',
    field: 'oliveOil',
    family: 'oliveOil',
    has: (c) => typeof c.oliveOil === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`oliveOil.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`oliveOil.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  honey: {
    breaks: HONEY_BREAKS_FOR_RANDOM,
    factory: honey,
    prefixFallback: 'Honey production',
    field: 'honey',
    family: 'honey',
    has: (c) => typeof c.honey === 'number',
    labelFor: (op, n, translate) => {
      const token = tonnesToken(n);
      const human = tonnesCompact(n);
      if (op === '>=') return translate(`honey.atLeast.${token}`, `over ${human} tonnes`);
      return translate(`honey.atMost.${token}`, `under ${human} tonnes`);
    },
  },
  temperature: {
    breaks: TEMPERATURE_BREAKS_FOR_RANDOM,
    factory: temperature,
    prefixFallback: 'Average temperature',
    field: 'temperature',
    family: 'temperature',
    // Signed: its `<=0` break has a non-positive `n`, so parseThreshold is told
    // to admit zero / negatives for this metric only.
    signed: true,
    has: (c) => typeof c.temperature === 'number',
    labelFor: (op, n, translate) => {
      // Breaks are whole integers, so `n` is a safe single i18n key segment
      // (no `.`-split); `temperature.atMost.0` is the below-freezing tier.
      if (op === '>=') return translate(`temperature.atLeast.${n}`, `over ${n} °C`);
      return translate(`temperature.atMost.${n}`, `under ${n} °C`);
    },
  },
  happiness: {
    breaks: HAPPINESS_BREAKS_FOR_RANDOM,
    factory: happiness,
    prefixFallback: 'Happiness score',
    field: 'happiness',
    family: 'happiness',
    has: (c) => typeof c.happiness === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`happiness.atLeast.${n}`, `over ${n}/10`);
      return translate(`happiness.atMost.${n}`, `under ${n}/10`);
    },
  },
  corruption: {
    breaks: CORRUPTION_BREAKS_FOR_RANDOM,
    factory: corruption,
    // Reframed to the clean pole so a high-is-good scale reads intuitively; the
    // key stays `corruption`. The "(less corrupt)" gloss spells out the
    // direction on a threshold cell (a high integrity score = less corruption),
    // since a bare number can't. This prefix backs both the TTT category label
    // and the metric-hub panel lead. See DATA_FEATURE.md Feature EJ.
    prefixFallback: 'Government integrity (less corrupt)',
    field: 'corruption',
    family: 'corruption',
    has: (c) => typeof c.corruption === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`corruption.atLeast.${n}`, `over ${n}/100`);
      return translate(`corruption.atMost.${n}`, `under ${n}/100`);
    },
  },
};

/** The registered threshold-metric keys, in registry (display) order. */
export const METRIC_KEYS = Object.keys(THRESHOLD_METRICS);

/**
 * Decode a `<metric>:<op><n>` id suffix into `{ op, n }`, or null if it isn't a
 * valid threshold token (`>=`/`<=` prefix, canonical integer). Shared by
 * `categoryFromId`, `translateCategoryLabel`, and the filter DSL so every metric
 * parses its suffix identically.
 *
 * By default the break must be a POSITIVE integer (every metric's tiers are).
 * A *signed* metric passes `allowNonPositive: true` so zero / negative breaks
 * parse too: temperature's `<=0` "below freezing" tier is the only such case
 * today. Callers derive the flag from `THRESHOLD_METRICS[key].signed`, so the
 * relaxation is scoped to that one metric and never widens what parses for
 * population / area / the rest.
 *
 * @param {string} suffix
 * @param {boolean} [allowNonPositive]
 * @returns {{ op: '>=' | '<=', n: number } | null}
 */
export function parseThreshold(suffix, allowNonPositive = false) {
  /** @type {'>=' | '<=' | null} */
  let op = null;
  if (suffix.startsWith('>=')) op = '>=';
  else if (suffix.startsWith('<=')) op = '<=';
  if (!op) return null;
  const nStr = suffix.slice(2);
  const n = Number.parseInt(nStr, 10);
  // Canonical integer only: rejects decimals, leading zeros, `+`, NaN.
  if (!Number.isInteger(n) || String(n) !== nStr) return null;
  // Positive-only unless the metric is signed (temperature's `<=0`).
  if (n <= 0 && !allowNonPositive) return null;
  return { op, n };
}

/**
 * @template T
 * @param {T[]} pool
 * @param {number} n
 * @param {() => number} rng
 * @returns {T[]}
 */
function pickRandom(pool, n, rng) {
  const arr = pool.slice();
  for (let i = 0; i < n && i < arr.length; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/**
 * Translate a category's display label by decoding its `id`. The factories
 * above bake an English label (`"Africa"`, `"red"`, `"weapon"`) onto every
 * Category so the engine stays pure of i18n; this is the boundary helper
 * that page code uses at render time to swap in the active language.
 * Unknown id prefixes fall through to the baked label so a stray category
 * never renders blank.
 *
 * Key conventions:
 *   `continent:<Name>` → `variant.<name-lower-kebab>` (reuses the flagQuiz
 *      variant translations — continents are translated as nouns, not as
 *      "Continent: Africa".)
 *   `hasColor:<x>`     → `color.<x>` (bare noun, no "Has " wrapper).
 *   `hasMotif:<x>`     → `motif.<x>` (bare noun, no "Has " wrapper).
 *   `stripesOnly:<o>`  → `stripesOnly.<o>` (e.g. "horizontal stripes only").
 *   `population/area/density:<op><n>` → `"<metric>: <threshold>"`, e.g.
 *      "Land area: over 100K km²". The metric name (from `metric.<kind>`) is
 *      prefixed so a bare "over 100K" cell can't be confused across the three
 *      threshold metrics; the threshold text itself keeps its unit.
 *
 * @param {Category} category
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
export function translateCategoryLabel(category, translate) {
  const colon = category.id.indexOf(':');
  if (colon < 0) return category.label;
  const kind = category.id.slice(0, colon);
  const value = category.id.slice(colon + 1);
  if (kind === 'continent') {
    const variantKey = value.toLowerCase().replace(/ /g, '-');
    return translate(`variant.${variantKey}`, category.label);
  }
  if (kind === 'hasColor') {
    return translate(`color.${value}`, value);
  }
  if (kind === 'hasMotif') {
    return translate(`motif.${value}`, value);
  }
  if (kind === 'stripesOnly') {
    return translate(`stripesOnly.${value}`, category.label);
  }
  if (kind === 'colorCount') {
    // The id suffix is the URL-suffix form: bare "N" → `filter.onlyN.N`,
    // ">=N" → `filter.atLeastN.N`, "<=N" → `filter.atMostN.N`. Keeps the
    // i18n keys aligned with what findFlag's pillLabel / filterTitle use.
    if (value.startsWith('>=')) {
      return translate(`filter.atLeastN.${value.slice(2)}`, category.label);
    }
    if (value.startsWith('<=')) {
      return translate(`filter.atMostN.${value.slice(2)}`, category.label);
    }
    return translate(`filter.onlyN.${value}`, category.label);
  }
  if (THRESHOLD_METRICS[kind]) {
    // value is the id suffix: ">=100" / "<=10". The metric name (from
    // `metric.<kind>`) is prefixed so a bare "over 100" cell can't be confused
    // across the threshold metrics; the metric's own `labelFor` renders the
    // threshold text (with its unit / compact token).
    const parsed = parseThreshold(value, THRESHOLD_METRICS[kind].signed === true);
    if (!parsed) return category.label;
    const prefix = translate(`metric.${kind}`, THRESHOLD_METRICS[kind].prefixFallback);
    return `${prefix}: ${THRESHOLD_METRICS[kind].labelFor(parsed.op, parsed.n, translate)}`;
  }
  return category.label;
}

/**
 * Reverse of the factory functions: given an `id` like 'continent:Europe',
 * 'hasColor:red', 'hasMotif:weapon', or 'statehood:un_member', return a
 * Category with its predicate restored. Used for rehydrating puzzles loaded
 * from storage (storage strips functions during structured-clone).
 *
 * @param {string | null | undefined} id
 * @returns {Category | null}
 */
export function categoryFromId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('continent:')) return continent(/** @type {any} */ (id.slice('continent:'.length)));
  if (id.startsWith('hasColor:')) return hasColor(id.slice('hasColor:'.length));
  if (id.startsWith('hasMotif:')) return hasMotif(id.slice('hasMotif:'.length));
  if (id.startsWith('statehood:')) return statehood(id.slice('statehood:'.length));
  if (id.startsWith('stripesOnly:')) {
    const v = id.slice('stripesOnly:'.length);
    if (v === 'horizontal' || v === 'vertical') return hasStripesOnly(v);
    return null;
  }
  if (id.startsWith('colorCount:')) {
    const suffix = id.slice('colorCount:'.length);
    /** @type {'=' | '>=' | '<='} */
    let op = '=';
    let nStr = suffix;
    if (suffix.startsWith('>=')) { op = '>='; nStr = suffix.slice(2); }
    else if (suffix.startsWith('<=')) { op = '<='; nStr = suffix.slice(2); }
    const n = Number.parseInt(nStr, 10);
    if (Number.isInteger(n) && n >= 0 && String(n) === nStr) return colorCount(op, n);
    return null;
  }
  // Threshold world-metrics (`population:>=10000000`, `density:<=10`, …): one
  // generic decode over THRESHOLD_METRICS.
  const colon = id.indexOf(':');
  if (colon > 0) {
    const metric = THRESHOLD_METRICS[id.slice(0, colon)];
    if (metric) {
      const parsed = parseThreshold(id.slice(colon + 1), metric.signed === true);
      return parsed ? metric.factory(parsed.op, parsed.n) : null;
    }
  }
  return null;
}

/** @returns {Category[]} */
export function buildRandomCategoryPool() {
  return [
    ...CONTINENTS_FOR_RANDOM.map(continent),
    ...COLORS_FOR_RANDOM.map(hasColor),
    ...MOTIFS_FOR_RANDOM.map(hasMotif),
    ...COLOR_COUNTS_FOR_RANDOM.map(([op, n]) => colorCount(op, n)),
    ...STRIPES_ORIENTATIONS_FOR_RANDOM.map(hasStripesOnly),
    ...Object.values(THRESHOLD_METRICS).flatMap((m) =>
      m.breaks.map(({ op, n }) => m.factory(op, n))),
  ];
}

/**
 * Every flag-visual category plus the six continents, with all 116 world-metric
 * thresholds filtered out. **This is what a tic-tac-toe board is dealt from by
 * default** — `buildRandomCategoryPool` is the opt-in "Advanced mode" pool.
 *
 * Why this is the default: the full pool is 142 categories of which only ~19
 * read the flag, so a random six-pick plays as a country-statistics quiz with
 * one flag question wedged in to satisfy `lacksFlagVisualCategory`. Measured at
 * 1.5 flag rules of 6. The page promises "tic-tac-toe where every move is a
 * country flag pick matching the row × column category", so a board that is
 * mostly GDP thresholds is not the advertised game. This pool inverts the ratio
 * to 4.9 of 6.
 *
 * Continents stay in despite being a country fact. They're the axis that makes
 * a flag question findable — "red × Europe" gives the player somewhere to look,
 * where "red × 3 colours" is a search of the whole world. So this pool is not
 * strictly "flags only"; the name is the closest honest short label, and the
 * player-facing wording never claims otherwise (see `ttt.advancedModeNote`).
 *
 * Derived, not annotated: membership is a function of the category id, so a new
 * motif or colour joins automatically and a new metric family stays out
 * automatically. No per-category flag to maintain — that was `ultimateEligible`'s
 * sin, 99 mentions across 32 factories for one boolean.
 *
 * @returns {Category[]}
 */
export function buildFlagCategoryPool() {
  return buildRandomCategoryPool().filter(
    (c) => isFlagVisualCategory(c) || c.id.startsWith('continent:'),
  );
}

/**
 * @param {Category[]} rows
 * @param {Category[]} cols
 * @returns {boolean}
 */
export function axesConflict(rows, cols) {
  for (const r of rows) {
    for (const c of cols) {
      if (r.exclusiveGroup && r.exclusiveGroup === c.exclusiveGroup && r.id !== c.id) {
        return true;
      }
      // Two threshold metrics in the same family (e.g. gdp × gdpPerCapita) must
      // not meet across axes, since they'd read as two "GDP" questions.
      // Same-family subsumes same-group for metrics; the check above still covers the
      // non-metric groups (continent, colorCount, …).
      const rFam = metricFamilyOf(r);
      const cFam = metricFamilyOf(c);
      if (rFam && rFam === cFam && r.id !== c.id) {
        return true;
      }
      // Cross-dimension structural disjointness — both directions checked
      // so the declaration only needs to live on one side. stripesOnly's
      // factory lists its incompatible charge-motif ids; the symmetric
      // check means `hasMotif:cross` doesn't need a reciprocal entry.
      if (r.incompatibleWith?.includes(c.id) || c.incompatibleWith?.includes(r.id)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The co-occurrence family of a threshold-metric category, or null if it isn't
 * a registered threshold metric. Two categories sharing a family never appear
 * in the same TTT puzzle (see `ThresholdMetric.family`).
 * @param {{ exclusiveGroup?: string } | null | undefined} cat
 * @returns {string | null}
 */
function metricFamilyOf(cat) {
  const group = cat?.exclusiveGroup;
  if (!group) return null;
  const metric = THRESHOLD_METRICS[group];
  return metric ? metric.family : null;
}

/**
 * World-metric exclusiveGroups that may appear at most ONCE across the whole
 * puzzle (rows + cols combined), not merely once per axis. `axesConflict`
 * already blocks two categories from the same group meeting on opposite axes,
 * but two thresholds on the *same* axis — e.g. `over 5M people` in one row and
 * `under 1M people` in another — slip past it: they never share a cell, so
 * they're not impossible, just redundant "population again" clutter that reads
 * as a bug to the player. These groups are the numeric world metrics; other
 * groups (continent, colorCount, statehood, stripesOnly) are legitimately
 * repeated on one axis — two different continents down the rows is a normal,
 * desirable grid — so they stay out of this set. A future metric that ships a
 * threshold factory with its own exclusiveGroup should be added here to
 * inherit the single-use rule.
 *
 * @type {Set<string>}
 */
export const SINGLE_USE_METRIC_GROUPS = new Set(METRIC_KEYS);

/**
 * True when any single-use metric *family* (see `ThresholdMetric.family` and
 * `SINGLE_USE_METRIC_GROUPS`) appears more than once across the puzzle's six
 * categories, regardless of axis. Complements `axesConflict` (which rejects
 * same-family pairs across opposite axes) by also catching the same-axis case:
 * the two together mean a puzzle carries each metric family at most once (so a
 * puzzle never stacks gdp with gdpPerCapita, nor the same metric twice).
 *
 * @param {Category[]} rows
 * @param {Category[]} cols
 * @returns {boolean}
 */
export function metricGroupRepeated(rows, cols) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const cat of [...rows, ...cols]) {
    const group = cat.exclusiveGroup;
    if (!group || !SINGLE_USE_METRIC_GROUPS.has(group)) continue;
    // Dedupe by family, not group, so two metrics in one family (gdp +
    // gdpPerCapita) count as a repeat and never share a puzzle.
    const family = metricFamilyOf(cat) ?? group;
    if (seen.has(family)) return true;
    seen.add(family);
  }
  return false;
}

/**
 * Detect a degenerate (row × col) pair where one axis's predicate is fully
 * implied by the other's. The classic case is `motif:eu-member` × `continent:Europe`
 * — every EU member is European, so the cell reduces to "EU member" and the
 * continent constraint does no work. The player sees a 3×3 where one cell
 * reads "EU member" twice over, breaking the implied-conjunction model that
 * makes the rest of the grid feel like progress.
 *
 * The check is set-subset: for each cross-axis (r, c) pair, if
 * {countries matching r} ⊆ {countries matching c} (or vice versa), one
 * predicate implies the other and the puzzle should be retried with a
 * different category mix. Note: an empty match-set is trivially a subset
 * of everything — we exclude that case here because empty cells are
 * already caught by `isPuzzleGeneratable`'s minPerCell threshold, and
 * treating them as "implied" would muddy the failure signal.
 *
 * @param {Category[]} rows
 * @param {Category[]} cols
 * @param {Country[]} countries
 * @returns {boolean}
 */
export function axesImpliedPair(rows, cols, countries) {
  /** @type {Map<string, Set<string>>} */
  const matchCodes = new Map();
  for (const cat of [...rows, ...cols]) {
    if (matchCodes.has(cat.id)) continue;
    const codes = new Set();
    for (const c of countries) if (cat.predicate(c)) codes.add(c.code);
    matchCodes.set(cat.id, codes);
  }
  for (const r of rows) {
    const rs = /** @type {Set<string>} */ (matchCodes.get(r.id));
    if (rs.size === 0) continue;
    for (const c of cols) {
      if (r.id === c.id) continue;
      const cs = /** @type {Set<string>} */ (matchCodes.get(c.id));
      if (cs.size === 0) continue;
      // r ⊆ c — every flag matching r also matches c, so the c constraint
      // is no-op inside the (r, c) cell.
      if (rs.size <= cs.size && [...rs].every((code) => cs.has(code))) return true;
      // c ⊆ r — symmetric case.
      if (cs.size <= rs.size && [...cs].every((code) => rs.has(code))) return true;
    }
  }
  return false;
}

/**
 * Category "kinds" (the id prefix before the colon) whose predicate reads the
 * flag's own visual design — its colours (`hasColor`), how many colours it
 * carries (`colorCount`), its charge motifs (`hasMotif`), or a stripes-only
 * layout (`stripesOnly`). Everything else in the random pool is a fact about
 * the COUNTRY, answerable without ever looking at its flag: `continent`, and
 * every world-metric threshold (`population`, `area`, `gdp`, `temperature`,
 * `happiness`, …). The metric families now outnumber the flag-visual kinds in
 * the pool by an order of magnitude, so an unconstrained six-pick very often
 * lands zero flag-visual rules — a board that reads as a geography/stats quiz,
 * not a flag game. `lacksFlagVisualCategory` is the guard that keeps at least
 * one flag-reading rule on every generated board.
 *
 * @type {Set<string>}
 */
export const FLAG_VISUAL_KINDS = new Set(['hasColor', 'colorCount', 'hasMotif', 'stripesOnly']);

/**
 * Categories that ride in a flag-visual KIND but describe membership of a
 * political bloc rather than anything drawn on the flag. `eu-member` lives in
 * `country.motifs` so the findFlag / flagsdata filter bars can offer it as one
 * more chip, but "is this country in the EU" is recalled, not seen — Ireland's
 * tricolour carries no EU mark. So it fails the one test `FLAG_VISUAL_KINDS`
 * exists to apply, despite matching the `hasMotif` prefix.
 *
 * `daily/difficulty.js` draws this same line independently (`MEMBERSHIP_MOTIFS`,
 * exempt from the worldwide bump because such a puzzle asks the player to recall
 * a discrete known list rather than search by sight). Same distinction, same
 * motif, different consumer — if a second membership motif is ever tagged (NATO,
 * Commonwealth, …), both sets want it.
 *
 * Full ids rather than bare motif keys, so the check is one Set lookup on
 * `cat.id` with no re-parsing.
 *
 * @type {Set<string>}
 */
export const MEMBERSHIP_MOTIF_IDS = new Set(['hasMotif:eu-member']);

/**
 * True when the category's predicate reads the flag's visual design (colour,
 * colour count, motif, or stripes-only) rather than a country fact.
 *
 * The kind prefix decides, with `MEMBERSHIP_MOTIF_IDS` as the one exception: a
 * membership motif matches `hasMotif` but isn't readable off the flag, so it
 * answers false. Without that exception a board whose only "flag-visual" rule
 * was `eu-member` would satisfy `lacksFlagVisualCategory` while still being
 * fully solvable without looking at a single flag — the exact degeneracy that
 * rule exists to catch.
 *
 * @param {Category} cat
 * @returns {boolean}
 */
export function isFlagVisualCategory(cat) {
  if (MEMBERSHIP_MOTIF_IDS.has(cat.id)) return false;
  const colon = cat.id.indexOf(':');
  const kind = colon < 0 ? cat.id : cat.id.slice(0, colon);
  return FLAG_VISUAL_KINDS.has(kind);
}

/**
 * Rejection rule: true when NONE of the puzzle's six categories reads the flag
 * itself — every row and column is a country fact (continent, or a world-metric
 * threshold). Such a board is fully solvable without looking at a single flag,
 * which defeats a flag game, so the generator retries for a mix carrying ≥1
 * flag-visual rule. Pure function on the six categories, no country data needed
 * (it reads ids only) — so it runs first and cheapest in the reject ladder.
 *
 * @param {Category[]} rows
 * @param {Category[]} cols
 * @returns {boolean}
 */
export function lacksFlagVisualCategory(rows, cols) {
  return ![...rows, ...cols].some(isFlagVisualCategory);
}

/**
 * @param {() => number} [rng]
 * @param {Category[]} [pool] Defaults to the full 3×3 random pool. Pass a
 *   narrowed pool to restrict which categories may be drawn.
 * @returns {Puzzle}
 */
export function randomPuzzle(rng = Math.random, pool = buildRandomCategoryPool()) {
  const six = pickRandom(pool, 6, rng);
  return {
    rows: six.slice(0, 3),
    cols: six.slice(3, 6),
  };
}

/**
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @returns {number[][]}
 */
export function puzzleCellCounts(puzzle, countries) {
  /** @type {number[][]} */
  const counts = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      for (const country of countries) {
        if (puzzle.rows[r].predicate(country) && puzzle.cols[c].predicate(country)) {
          counts[r][c]++;
        }
      }
    }
  }
  return counts;
}

/**
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @returns {Country[][] | null}
 */
export function findPuzzleSolution(puzzle, countries) {
  /** @type {Country[][][]} */
  const candidates = [];
  for (let r = 0; r < 3; r++) {
    /** @type {Country[][]} */
    const row = [];
    for (let c = 0; c < 3; c++) {
      row.push(
        countries.filter(
          (co) => puzzle.rows[r].predicate(co) && puzzle.cols[c].predicate(co),
        ),
      );
    }
    candidates.push(row);
  }

  /** @type {Array<{ r: number, c: number }>} */
  const cellOrder = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cellOrder.push({ r, c });
  cellOrder.sort(
    (a, b) => candidates[a.r][a.c].length - candidates[b.r][b.c].length,
  );

  /** @type {(Country | null)[][]} */
  const solution = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  /** @type {Set<string>} */
  const used = new Set();

  /** @param {number} i */
  function backtrack(i) {
    if (i === cellOrder.length) return true;
    const { r, c } = cellOrder[i];
    for (const co of candidates[r][c]) {
      if (used.has(co.code)) continue;
      solution[r][c] = co;
      used.add(co.code);
      if (backtrack(i + 1)) return true;
      used.delete(co.code);
      solution[r][c] = null;
    }
    return false;
  }

  if (!backtrack(0)) return null;
  return /** @type {Country[][]} */ (solution);
}

/**
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @param {number} [minPerCell]
 * @returns {boolean}
 */
export function isPuzzleGeneratable(puzzle, countries, minPerCell = 2) {
  const counts = puzzleCellCounts(puzzle, countries);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (counts[r][c] < minPerCell) return false;
    }
  }
  return findPuzzleSolution(puzzle, countries) !== null;
}

/**
 * @param {Country[]} countries
 * @param {{ rng?: () => number, minPerCell?: number, maxAttempts?: number, pool?: Category[] }} [options]
 *   `pool` defaults to every category this engine can build, world-metric
 *   thresholds included. Note that this is **not** what the tic-tac-toe boards
 *   deal from by default: they pass `buildFlagCategoryPool()` unless the player
 *   opted into Advanced mode, so the product default lives in the TTT code that
 *   reads the setting, not in this library. Hoisting the default out here also
 *   means the pool is built once per generate rather than once per attempt —
 *   `randomPuzzle`'s own default would rebuild all 142 categories on every
 *   retry, up to `maxAttempts` times.
 * @returns {Puzzle}
 */
export function generateRandomPuzzle(countries, options = {}) {
  const {
    rng = Math.random,
    minPerCell = 2,
    maxAttempts = 200,
    pool = buildRandomCategoryPool(),
  } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const puzzle = randomPuzzle(rng, pool);
    if (lacksFlagVisualCategory(puzzle.rows, puzzle.cols)) continue;
    if (axesConflict(puzzle.rows, puzzle.cols)) continue;
    if (metricGroupRepeated(puzzle.rows, puzzle.cols)) continue;
    if (axesImpliedPair(puzzle.rows, puzzle.cols, countries)) continue;
    if (isPuzzleGeneratable(puzzle, countries, minPerCell)) {
      return puzzle;
    }
  }
  throw new Error(
    `Could not generate a random puzzle with >= ${minPerCell} countries per cell after ${maxAttempts} attempts`,
  );
}

const MIN_QUERY_LENGTH = 3;

const NON_COMBINING_FOLD_MAP = /** @type {const} */ ({
  'ł': 'l', 'đ': 'd', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss',
});
const NON_COMBINING_FOLD_RE = /[łđøæœß]/g;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Normalize a string for diacritic-insensitive matching: lowercase, strip
 * combining accents (NFD then drop U+0300–U+036F), and fold a few
 * non-combining Latin letters (ł, đ, ø, æ, œ, ß) to their closest ASCII
 * equivalents.
 *
 * The picker accepts "lodz" for "Łódź", "wlochy" for "Włochy", and "espana"
 * for "España" because we apply this fold to both the query and every
 * candidate name/alias before the substring/equality check. ł and friends
 * need the manual map because they aren't combining-mark sequences — NFD
 * leaves them as single codepoints.
 *
 * @param {string} s
 * @returns {string}
 */
export function foldDiacritics(s) {
  const stripped = s.toLowerCase().normalize('NFD').replace(COMBINING_MARKS_RE, '');
  return stripped.replace(
    NON_COMBINING_FOLD_RE,
    (ch) => /** @type {Record<string, string>} */ (NON_COMBINING_FOLD_MAP)[ch] ?? ch,
  );
}

// nameScore for entries that don't carry one (test stubs; the real data always
// does). High enough to sort scoreless entries after every ranked country
// within the same match tier, without affecting relative order among them.
const NAMESCORE_FALLBACK = 1000;

/**
 * How well a single (already folded) candidate string matches the (already
 * folded) query, as a tier where lower is better:
 *   0 exact       — the whole string equals the query
 *   1 prefix      — the string starts with the query ("Pol" → "Polska")
 *   2 word-start  — the query starts a later word ("Pol" → "Korea Polnocna")
 *   3 substring   — the query appears mid-word ("and" → "Iceland")
 * Infinity when the query isn't present at all. A "word" boundary is any
 * non-alphanumeric character (space, hyphen, etc.) — the fold has already
 * stripped accents, so Polish "Północna" is "polnocna" by here.
 *
 * @param {string} folded
 * @param {string} q
 * @returns {number}
 */
function matchTier(folded, q) {
  const idx = folded.indexOf(q);
  if (idx === -1) return Infinity;
  if (folded === q) return 0;
  if (idx === 0) return 1;
  for (let i = idx; i !== -1; i = folded.indexOf(q, i + 1)) {
    if (!/[a-z0-9]/.test(folded[i - 1])) return 2;
  }
  return 3;
}

/**
 * @param {Country[]} allCountries
 * @param {string} query
 * @param {{ limit?: number, excludeCodes?: Set<string> }} [options]
 * @returns {Country[]}
 */
export function suggest(allCountries, query, options = {}) {
  const { limit = 8, excludeCodes = new Set() } = options;
  const trimmed = query.trim();
  // Keep the "must type 3 chars" rule against the raw input, not the folded
  // form — otherwise typing "ß" alone (folds to "ss") would inch over the
  // threshold and surprise the user.
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const q = foldDiacritics(trimmed);
  /** @type {{ c: Country, tier: number }[]} */
  const scored = [];
  for (const c of allCountries) {
    if (excludeCodes.has(c.code)) continue;
    // Best (lowest) tier across the name and every alias — a country ranks by
    // its strongest match, so Poland's "Polska" prefix wins even though its
    // English "Poland" also matches.
    let tier = matchTier(foldDiacritics(c.name), q);
    if (c.aliases) {
      for (const a of c.aliases) tier = Math.min(tier, matchTier(foldDiacritics(a), q));
    }
    if (tier === Infinity) continue;
    scored.push({ c, tier });
  }
  // Rank by match tier, then by country prominence (lower nameScore = more
  // recognizable). Array.sort is stable, so equal-tier/equal-score entries
  // keep their original data order. This lifts a prefix hit ("Polska") above
  // the mid-name "…Północna/Południowa" substring hits that the diacritic
  // fold otherwise scatters ahead of it.
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const sa = typeof a.c.nameScore === 'number' ? a.c.nameScore : NAMESCORE_FALLBACK;
    const sb = typeof b.c.nameScore === 'number' ? b.c.nameScore : NAMESCORE_FALLBACK;
    return sa - sb;
  });
  return scored.slice(0, limit).map((s) => s.c);
}

/**
 * Returns the country to auto-submit when the user has typed an exact full
 * country name (or one of its aliases) and the suggestion list has no
 * ambiguity; otherwise null.
 *
 * Ambiguity check is matches.length === 1 — so typing "Niger" while both
 * Niger and Nigeria match the substring waits for a deliberate pick rather
 * than guessing for the user.
 *
 * @template {{ name: string, aliases?: string[] }} T
 * @param {T[]} matches
 * @param {string} query
 * @returns {T | null}
 */
export function exactSingleMatch(matches, query) {
  if (matches.length !== 1) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  const typed = foldDiacritics(trimmed);
  const m = matches[0];
  if (foldDiacritics(m.name) === typed) return m;
  if (m.aliases) {
    for (const a of m.aliases) {
      if (foldDiacritics(a) === typed) return m;
    }
  }
  return null;
}

/**
 * @param {{
 *   classList: { add(c: string): void, remove(c: string): void },
 *   addEventListener(type: string, handler: () => void, options?: { once?: boolean }): void,
 * }} cell
 */
export function pulseShake(cell) {
  cell.addEventListener(
    'animationend',
    () => cell.classList.remove('shake'),
    { once: true },
  );
  cell.classList.add('shake');
}

