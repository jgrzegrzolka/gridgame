/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./group.js').Continent} Continent */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} label
 * @property {(country: Country) => boolean} predicate
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
 * @property {boolean} [ultimateEligible]
 *   When explicitly `false`, the category is excluded from the 9×9 random
 *   pool. Used for categories whose answer pools are too narrow to back
 *   9-per-cell Hall-marriage solvability — e.g. stripesOnly:vertical has
 *   only 5 European flags. 3×3 (`generateRandomPuzzle`) still includes
 *   them because minPerCell=2 is achievable. Default behaviour
 *   (undefined / true) keeps the category in both pools.
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
 *   - `ultimateEligible: false` keeps stripesOnly out of the 9×9 pool:
 *     European horizontals (8) and verticals (5) are both under 9, and
 *     other continents are tighter, so Hall-marriage solvability fails.
 *     Daily-puzzle authoring (which hand-picks compounds) is unaffected.
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
    ultimateEligible: false,
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
 * `ultimate: true` marks the single breakpoint kept in the 9×9 pool. The
 * extreme tiers can't back 9-distinct-per-cell against a continent (e.g.
 * Oceania has no country over 10M), so only the broad `>=10M` tier survives
 * `buildUltimateCategoryPool` — the rest carry `ultimateEligible: false`, the
 * same mechanism that keeps `stripesOnly` out of 9×9.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const POPULATION_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10_000_000, ultimate: true },
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
 * `ultimate: true` marks the single breakpoint kept in the 9×9 pool: the broad
 * `>=100K` tier is the only one that can back 9-distinct-per-cell against a
 * continent; the rest carry `ultimateEligible: false`.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const AREA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100_000, ultimate: true },
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
 * Canada, …). `exclusiveGroup: 'density'`; `>=100` (~half the world) is the sole
 * `ultimate: true` break for 9×9.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const DENSITY_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100, ultimate: true },
  { op: '>=', n: 200 },
  { op: '>=', n: 500 },
  { op: '<=', n: 100 },
  { op: '<=', n: 30 },
  { op: '<=', n: 10 },
];

/**
 * GDP-threshold Categories (nominal current US$), same easy→hard gradient as the
 * other metrics. Big economies `>=$100B / >=$500B / >=$1T` (77 / 33 / 20 real
 * places) and small `<=$10B / <=$1B / <=$100M` (97 / 41 / 20). `exclusiveGroup:
 * 'gdp'`; the broad `>=$100B` tier is the sole `ultimate: true` break for 9×9.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const GDP_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 100_000_000_000, ultimate: true },
  { op: '>=', n: 500_000_000_000 },
  { op: '>=', n: 1_000_000_000_000 },
  { op: '<=', n: 10_000_000_000 },
  { op: '<=', n: 1_000_000_000 },
  { op: '<=', n: 100_000_000 },
];

/**
 * GDP-per-capita-threshold Categories (nominal current US$ per person). Rich
 * `>=$30K / >=$50K / >=$70K` (70 / 36 / 18 real places) and modest
 * `<=$5K / <=$2K / <=$1K` (91 / 51 / 28). `exclusiveGroup: 'gdpPerCapita'`; the
 * broad `>=$30K` tier is the sole `ultimate: true` break for 9×9. The chosen
 * breakpoints never overlap GDP's (>=$100M) so a bare "$30K" reads as per-capita
 * and "$100M" as total, no metric prefix needed to disambiguate a pill.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const GDP_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 30_000, ultimate: true },
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
 * No `ultimate: true` break — unlike the dense metrics, coffee is too sparse and
 * concentrated to back a 9×9 cell: whole continents (Europe, most of Oceania)
 * grow essentially none, so `coffee >= N × continent` can't reach 9 distinct.
 * Every break therefore carries `ultimateEligible: false`, keeping coffee out of
 * the Ultimate pool (the same mechanism that excludes `stripesOnly`); it stays a
 * 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: like coffee, wine is too sparse and concentrated
 * to back a 9×9 cell (whole continents make essentially none), so `wine >= N ×
 * continent` can't reach 9 distinct. Every break carries `ultimateEligible:
 * false`, keeping wine a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: like the other sparse crops, cocoa is too
 * concentrated (West Africa dominant) to back a 9×9 cell, so every break carries
 * `ultimateEligible: false`, keeping cocoa a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: bananas are still tropics-concentrated (Europe
 * grows essentially none), so `banana >= N × continent` can't reach 9 distinct.
 * Every break carries `ultimateEligible: false`, keeping banana a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: apples are temperate-concentrated (Oceania is just
 * Australia + New Zealand, sub-Saharan Africa barely grows any), so
 * `apple >= N × continent` can't reach 9 distinct. Every break carries
 * `ultimateEligible: false`, keeping apple a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * `ultimate: true` marks the single break kept in the 9×9 pool: the broad
 * `>=1000` tier (~2/3 of the world, spread across every continent) is the only
 * one that can back 9-distinct-per-cell against a continent; the rest carry
 * `ultimateEligible: false`. Dense, so unlike coffee it IS 9×9-eligible.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const ELEVATION_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000, ultimate: true },
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
 * `ultimate: true` marks the single break kept in the 9×9 pool: the broad
 * `>=1000` tier (76 sovereign, 9+ in every continent bar South America and
 * Antarctica) is the only one that can back 9-distinct-per-cell against a
 * continent; the rest carry `ultimateEligible: false`. Dense, so like elevation
 * it IS 9×9-eligible.
 *
 * Counts are tuned against flags/metrics/coastline.json; a 0-count tier is
 * dropped by `buildMetricTierItems` so it never reaches a surface.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const COASTLINE_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 1_000, ultimate: true },
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
 * `ultimate: true` marks the single break kept in the 9×9 pool: the broad
 * `>=30` tier (101 sovereign, 9+ in every continent) is the only one that can
 * back 9-distinct-per-cell against a continent; the rest carry
 * `ultimateEligible: false`. Dense, so like elevation it IS 9×9-eligible.
 *
 * Counts are tuned against flags/metrics/forest.json; a 0-count tier is dropped
 * by `buildMetricTierItems` so it never reaches a surface.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const FOREST_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 30, ultimate: true },
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
 * No `ultimate: true` break: oil is geographically concentrated (Oceania has
 * essentially only Australia, sub-Saharan Africa a handful), so `oil >= N ×
 * continent` can't reach 9 distinct. Every break carries `ultimateEligible:
 * false`, keeping oil a 3×3-only axis like the crops.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: rice is tropics/subtropics-concentrated and heavily
 * Asian (Europe grows little, Oceania barely any), so `rice >= N × continent`
 * can't reach 9 distinct. Every break carries `ultimateEligible: false`, keeping
 * rice a 3×3-only axis like the other crops.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: coal is extremely concentrated (China dwarfs all,
 * whole continents mine essentially none), so `coal >= N × continent` can't reach
 * 9 distinct. Every break carries `ultimateEligible: false`, keeping coal a
 * 3×3-only axis like oil and the crops.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: the distribution is one Falkland outlier over a
 * thin tail, so `sheepPerCapita >= N × continent` can't reach 9 distinct. Every
 * break stays `ultimateEligible: false` (via the pool builder), keeping this a
 * 3×3-only axis like the crops.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: the distribution is one Uruguay peak over a thin
 * tail, so `cattlePerCapita >= N × continent` can't reach 9 distinct. Every
 * break stays `ultimateEligible: false` (via the pool builder), a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
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
 * No `ultimate: true` break: beer is `absence: 'unknown'` (73 real places carry
 * no value), so it cannot back a dense 9×9 axis. Every break stays
 * `ultimateEligible: false` (via the pool builder), a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const BEER_PER_CAPITA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 50 },
  { op: '>=', n: 100 },
];

/**
 * Tea-production-threshold Categories (green-tea-leaf tonnes). Sparse like
 * coffee, so `>=`-only: only ~46 countries grow tea, and a `<=` tier would just
 * collect the ~180 non-growers sitting at 0 (via `absence: 'zero'`). The FAOSTAT
 * green-leaf series runs large (China ~13.8M t), so the breaks scale up one
 * decade from coffee, matching apple's `10K / 100K / 1M` (24 / 17 / 6 real
 * places). `exclusiveGroup: 'tea'`.
 *
 * No `ultimate: true` break — like the other sparse crops, tea is too
 * concentrated to back a 9×9 cell (whole continents grow essentially none), so
 * every break carries `ultimateEligible: false`, keeping it a 3×3-only axis.
 *
 * @type {Array<{ op: '>=' | '<=', n: number, ultimate?: boolean }>}
 */
export const TEA_BREAKS_FOR_RANDOM = [
  { op: '>=', n: 10_000 },
  { op: '>=', n: 100_000 },
  { op: '>=', n: 1_000_000 },
];

/** Motifs the random puzzle generator (3×3 and 9×9 ticTacToe) is allowed
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function population(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
  return cat;
}

/**
 * Population-density-threshold Category factory (people per km²). Reads the
 * denormalized `country.density` field (`attachDensities`). `exclusiveGroup:
 * 'density'`. The label bakes a plain integer (`over 100 people/km²`).
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function density(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function area(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function gdp(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
  return cat;
}

/**
 * GDP-per-capita-threshold Category factory (nominal current US$ per person).
 * Reads the denormalized `country.gdpPerCapita` field (`attachGdpPerCapitas`).
 * `exclusiveGroup: 'gdpPerCapita'`.
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function gdpPerCapita(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function coffee(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function wine(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function cocoa(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function banana(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function apple(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function elevation(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function coastline(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function forest(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function oil(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function rice(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function coal(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function sheepPerCapita(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function cattlePerCapita(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
  return cat;
}

/**
 * Beer-per-capita-threshold Category factory (litres of beer per person per year).
 * Reads the denormalized `country.beerPerCapita` field (`attachBeerPerCapitas`, an
 * `absence: 'unknown'` metric, so the predicate must guard on the field being a
 * number: a place WHO does not measure has none and never matches). `exclusiveGroup:
 * 'beerPerCapita'`. The break list is `>=`-only (see BEER_PER_CAPITA_BREAKS_FOR_RANDOM),
 * but the `<=` branch is kept for symmetry so a `beerPerCapita:<=N` id would still
 * rehydrate. The label bakes a plain integer (`over 50 litres of beer per person`).
 *
 * @param {'>=' | '<='} op
 * @param {number} n
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function beerPerCapita(op, n, opts = {}) {
  const label =
    op === '>=' ? `over ${n} litres of beer per person` : `under ${n} litres of beer per person`;
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 * @param {{ ultimateEligible?: boolean }} [opts]
 * @returns {Category}
 */
export function tea(op, n, opts = {}) {
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
  if (opts.ultimateEligible === false) cat.ultimateEligible = false;
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
 *   `breaks`         the `<KEY>_BREAKS_FOR_RANDOM` tiers (op/n, optional ultimate)
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
 * @property {ReadonlyArray<{ op: '>=' | '<=', n: number, ultimate?: boolean }>} breaks
 * @property {(op: '>=' | '<=', n: number, opts?: { ultimateEligible?: boolean }) => Category} factory
 * @property {string} prefixFallback
 * @property {string} field
 * @property {string} family  Co-occurrence family for TTT puzzle composition:
 *   two categories in the same family never share a puzzle (so `gdp` +
 *   `gdpPerCapita`, both the "gdp" family, can't both appear, since they'd
 *   read as two "GDP" questions). Usually equals the key; only closely-related metrics
 *   share one. Filters are unaffected: you can still filter by both at once.
 * @property {(c: Country) => boolean} has
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
    prefixFallback: 'Beer per capita',
    field: 'beerPerCapita',
    family: 'beerPerCapita',
    has: (c) => typeof c.beerPerCapita === 'number',
    labelFor: (op, n, translate) => {
      if (op === '>=') return translate(`beerPerCapita.atLeast.${n}`, `over ${n} litres of beer per person`);
      return translate(`beerPerCapita.atMost.${n}`, `under ${n} litres of beer per person`);
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
};

/** The registered threshold-metric keys, in registry (display) order. */
export const METRIC_KEYS = Object.keys(THRESHOLD_METRICS);

/**
 * Decode a `<metric>:<op><n>` id suffix into `{ op, n }`, or null if it isn't a
 * valid threshold token (`>=`/`<=` prefix, positive integer, canonical form).
 * Shared by `categoryFromId`, `translateCategoryLabel`, and the filter DSL so
 * every metric parses its suffix identically.
 *
 * @param {string} suffix
 * @returns {{ op: '>=' | '<=', n: number } | null}
 */
export function parseThreshold(suffix) {
  /** @type {'>=' | '<=' | null} */
  let op = null;
  if (suffix.startsWith('>=')) op = '>=';
  else if (suffix.startsWith('<=')) op = '<=';
  if (!op) return null;
  const nStr = suffix.slice(2);
  const n = Number.parseInt(nStr, 10);
  if (Number.isInteger(n) && n > 0 && String(n) === nStr) return { op, n };
  return null;
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
    const parsed = parseThreshold(value);
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
  // generic decode over THRESHOLD_METRICS. Rehydrated categories drop
  // `ultimateEligible` — it only steers pool building, never a live category.
  const colon = id.indexOf(':');
  if (colon > 0) {
    const metric = THRESHOLD_METRICS[id.slice(0, colon)];
    if (metric) {
      const parsed = parseThreshold(id.slice(colon + 1));
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
      m.breaks.map(({ op, n, ultimate }) =>
        m.factory(op, n, { ultimateEligible: ultimate === true }))),
  ];
}

/**
 * Subset of the 3×3 pool that can back a 9×9 Ultimate puzzle. Drops any
 * category marked `ultimateEligible: false` — currently the stripesOnly
 * pair, whose answer sets are too narrow to satisfy 9-distinct-per-cell.
 *
 * @returns {Category[]}
 */
export function buildUltimateCategoryPool() {
  return buildRandomCategoryPool().filter((cat) => cat.ultimateEligible !== false);
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
 * @param {() => number} [rng]
 * @param {Category[]} [pool] Defaults to the full 3×3 random pool. Pass
 *   `buildUltimateCategoryPool()` to draw only from categories whose
 *   answer set can support 9-per-cell.
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
 * Find a complete 81-distinct country assignment for an Ultimate (9×9)
 * puzzle, respecting any sub-cells already populated in `preFilled`.
 *
 * Returns the 3×3×3×3 grid of countries (indexed `[bigRow][bigCol][r][c]`)
 * or null if no consistent assignment exists. Uses backtracking with the
 * MRV (most-constrained-first) heuristic; each cell's candidate list is
 * shuffled with `rng` so repeat calls produce different solutions.
 *
 * Generation guarantees an 81-distinct solution exists on an empty board
 * (via `hasUltimatePuzzleSolution`), so this returns non-null for the
 * give-up-on-empty case. With claimed cells the result can be null if
 * the player has steered the puzzle into an infeasible state — callers
 * must handle that.
 *
 * Bounded by `maxBacktracks`. The solver is plain DFS with MRV ordering
 * and no constraint propagation, so adversarial candidate orderings can
 * still trigger long search trees on tight pools (the synthetic
 * denseSquarePool tests hit this). The cap turns "could hang for
 * minutes" into "returns null after a fixed amount of work" — give-up
 * callers already fall back to a greedy reveal on null, so this never
 * loses the player the reveal, just trades a slow exact answer for a
 * fast best-effort one. Default headroom is far above what any healthy
 * production puzzle needs.
 *
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][][][]} preFilled 3×3×3×3 of claimed countries (or null when empty).
 * @param {Country[]} countries
 * @param {() => number} [rng]
 * @param {number} [maxBacktracks] Cap on backtrack-tree nodes visited; returns null if exceeded.
 * @returns {Country[][][][] | null}
 */
export function findUltimateAssignment(puzzle, preFilled, countries, rng = Math.random, maxBacktracks = 100_000) {
  /** @type {(Country | null)[][][][]} */
  const result = preFilled.map((bigRow) =>
    bigRow.map((board) => board.map((row) => row.slice())),
  );
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {Array<{ br: number, bc: number, r: number, c: number, candidates: Country[] }>} */
  const empties = [];

  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const rowCat = puzzle.rows[br];
      const colCat = puzzle.cols[bc];
      // Every sub-cell of small board (br, bc) sees the same candidate
      // pool initially — the (row × col) predicate is identical across
      // the 9 sub-cells of one small board.
      const valid = countries.filter(
        (co) => rowCat.predicate(co) && colCat.predicate(co),
      );
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const claimed = preFilled[br][bc][r][c];
          if (claimed) {
            used.add(claimed.code);
          } else {
            empties.push({ br, bc, r, c, candidates: shuffleInPlace(valid.slice(), rng) });
          }
        }
      }
    }
  }

  // Drop already-claimed countries from each empty cell's domain. MRV
  // sort favours the most-constrained empty cells first — without it,
  // the search blows up on thin (row × col) pairs because we'd try
  // wide-pool cells first, burn through countries needed elsewhere, and
  // dead-end deep in the tree.
  for (const e of empties) {
    e.candidates = e.candidates.filter((co) => !used.has(co.code));
  }
  empties.sort((a, b) => a.candidates.length - b.candidates.length);

  let steps = 0;
  /** @param {number} i */
  function backtrack(i) {
    if (++steps > maxBacktracks) return false;
    if (i === empties.length) return true;
    const { br, bc, r, c, candidates } = empties[i];
    for (const co of candidates) {
      if (used.has(co.code)) continue;
      result[br][bc][r][c] = co;
      used.add(co.code);
      if (backtrack(i + 1)) return true;
      used.delete(co.code);
      result[br][bc][r][c] = null;
    }
    return false;
  }

  if (!backtrack(0)) return null;
  return /** @type {Country[][][][]} */ (result);
}

/**
 * Fisher–Yates shuffle in place. Internal helper for randomizing
 * candidate orderings inside backtracking solvers.
 *
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
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
 * @param {{ rng?: () => number, minPerCell?: number, maxAttempts?: number }} [options]
 * @returns {Puzzle}
 */
export function generateRandomPuzzle(countries, options = {}) {
  const { rng = Math.random, minPerCell = 2, maxAttempts = 200 } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const puzzle = randomPuzzle(rng);
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

/**
 * Hall-marriage check for 9×9 (Ultimate) playability: returns true iff there
 * exist 81 distinct countries (or `perCell × 9` in general) that satisfy
 * every (row × col) cell, with `perCell` distinct countries assigned per cell
 * and no country shared between cells.
 *
 * Proof of correctness — Hall's defect theorem (the b-matching generalization):
 * a perfect assignment respecting per-cell demand exists iff for every
 * non-empty subset S of cells, the union of their candidate countries
 * (the countries that match at least one cell in S) has size ≥
 * perCell × |S|. With only 9 cells there are 2^9 − 1 = 511 subsets to check —
 * cheap enough to run inside a puzzle-generation loop.
 *
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @param {number} [perCell] Slots per cell — defaults to 9 (the small-board size).
 * @returns {boolean}
 */
export function hasUltimatePuzzleSolution(puzzle, countries, perCell = 9) {
  /** @type {Set<string>[]} 9 cells in row-major order, each holding the codes of every country that fits its (row × col) predicate. */
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      /** @type {Set<string>} */
      const set = new Set();
      for (const co of countries) {
        if (puzzle.rows[r].predicate(co) && puzzle.cols[c].predicate(co)) {
          set.add(co.code);
        }
      }
      cells.push(set);
    }
  }
  for (let mask = 1; mask < (1 << 9); mask++) {
    let size = 0;
    /** @type {Set<string>} */
    const union = new Set();
    for (let i = 0; i < 9; i++) {
      if (mask & (1 << i)) {
        size++;
        for (const code of cells[i]) union.add(code);
      }
    }
    if (union.size < size * perCell) return false;
  }
  return true;
}

/**
 * Random-search the category space for a puzzle that admits a full 81-distinct
 * country assignment (i.e. one valid country per sub-cell across all 9 small
 * boards). Pulls candidate puzzles via `randomPuzzle`, skips axis conflicts,
 * and gates on `hasUltimatePuzzleSolution`. The stronger constraint thins out
 * the eligible category space — observed ~55 attempts on average — so the
 * default attempt budget is higher than `generateRandomPuzzle`'s.
 *
 * @param {Country[]} countries
 * @param {{ rng?: () => number, maxAttempts?: number }} [options]
 * @returns {Puzzle}
 */
export function generateUltimateRandomPuzzle(countries, options = {}) {
  const { rng = Math.random, maxAttempts = 500 } = options;
  const pool = buildUltimateCategoryPool();
  for (let i = 0; i < maxAttempts; i++) {
    const puzzle = randomPuzzle(rng, pool);
    if (axesConflict(puzzle.rows, puzzle.cols)) continue;
    if (metricGroupRepeated(puzzle.rows, puzzle.cols)) continue;
    if (axesImpliedPair(puzzle.rows, puzzle.cols, countries)) continue;
    if (hasUltimatePuzzleSolution(puzzle, countries)) {
      return puzzle;
    }
  }
  throw new Error(
    `Could not generate a 9×9-solvable puzzle after ${maxAttempts} attempts`,
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
  return allCountries
    .filter((c) => {
      if (excludeCodes.has(c.code)) return false;
      if (foldDiacritics(c.name).includes(q)) return true;
      if (c.aliases) {
        for (const a of c.aliases) {
          if (foldDiacritics(a).includes(q)) return true;
        }
      }
      return false;
    })
    .slice(0, limit);
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

