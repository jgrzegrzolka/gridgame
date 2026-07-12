/**
 * @typedef {'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Antarctica'} Continent
 *
 * @typedef {'sovereign' | 'non_un' | 'territory' | 'other'} Sovereignty
 *
 * @typedef {Object} Country
 * @property {string} code
 * @property {string} name
 * @property {number} [nameScore]
 * @property {'country' | 'other'} category
 * @property {Continent | null} continent
 * @property {string | null} [statehood]
 * @property {string[]} primaryColors
 * @property {string[]} additionalColors
 * @property {string[]} colors  Computed getter — union of primaryColors + additionalColors. Non-enumerable: hidden from JSON.stringify and Object.keys so it can't accidentally end up in PartyKit messages or serialised state.
 * @property {number} [population]  Denormalized from `flags/metrics/population.json` by `attachPopulations` at TTT load time so the `population` threshold predicates can read it off the country like any other field. Absent when the country has no value in the (sparse) metric. Not stored in countries.json — the metric stays the single source.
 * @property {number} [area]  Denormalized from `flags/metrics/area.json` by `attachAreas`, same pattern as `population`, so the `area` threshold predicates read it off the country. Absent only for non-places (orgs).
 * @property {number} [density]  Denormalized from `flags/metrics/density.json` by `attachDensities` (people per km²). Absent only for non-places.
 * @property {number} [gdp]  Denormalized from `flags/metrics/gdp.json` by `attachGdps` (nominal current US$). Absent only for non-places.
 * @property {number} [gdpPerCapita]  Denormalized from `flags/metrics/gdpPerCapita.json` by `attachGdpPerCapitas` (nominal current US$ per person). Absent only for non-places.
 * @property {number} [coffee]  Denormalized from `flags/metrics/coffee.json` by `attachCoffees` (green-coffee tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [wine]  Denormalized from `flags/metrics/wine.json` by `attachWines` (wine tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-maker defaults to 0); absent only for non-places (orgs).
 * @property {number} [cocoa]  Denormalized from `flags/metrics/cocoa.json` by `attachCocoas` (cocoa-bean tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [banana]  Denormalized from `flags/metrics/banana.json` by `attachBananas` (banana tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [elevation]  Denormalized from `flags/metrics/elevation.json` by `attachElevations` (metres above sea level of the highest point). Dense, same pattern as `area`; absent only for non-places (orgs).
 * @property {number[]} [ambiguousColorCount]  Plausible counts a careful player could give when the count is contested (shade splits, disputed palette colours). Consumed by the TTT colorCount predicate to accept any plausible read, and by `ambiguityAudit.js` to veto daily puzzles that straddle the ambiguity.
 * @property {string[]} [ambiguousColors]  Colours whose presence on the flag is itself disputed. Palette entries drive `ambiguityAudit.js`'s membership veto; non-palette tokens (e.g. "gold") are documentation-only and trigger no veto.
 * @property {string[]} [motifs]
 * @property {'horizontal' | 'vertical' | null} [stripesOnly]
 * @property {string[]} [aliases]
 */

/**
 * Attach the computed `colors` getter to a raw country object. The two
 * stored buckets — `primaryColors` (visible across a room) and
 * `additionalColors` (COA-only) — are disjoint by construction; the
 * union is "every colour anywhere on the flag" and is what most callers
 * want (`hasColor` predicates, the findFlag browse UI, etc.). The getter
 * is non-enumerable so `JSON.stringify(country)` produces only the two
 * canonical buckets — no derived data leaking into PartyKit messages,
 * debug logs, or the countries.json round-trip. That means any clone
 * pattern (e.g. `withLocalizedAliases`) has to re-run createCountry to
 * re-attach the getter on the result; a raw spread silently drops it
 * and breaks downstream `c.colors` reads. We also strip a stale
 * `colors` field if the input already carries one (e.g. from a prior
 * stringify-then-parse round), so the result is always canonical.
 *
 * @param {any} raw
 * @returns {Country}
 */
export function createCountry(raw) {
  /** @type {any} */
  const c = { ...raw };
  delete c.colors;
  if (!Array.isArray(c.primaryColors)) c.primaryColors = [];
  if (!Array.isArray(c.additionalColors)) c.additionalColors = [];
  Object.defineProperty(c, 'colors', {
    get() { return [...this.primaryColors, ...this.additionalColors]; },
    enumerable: false,
    configurable: false,
  });
  return c;
}

/**
 * Turn the raw JSON array (parsed from countries.json) into Country
 * objects with the computed `colors` getter attached. Every load site
 * goes through here — direct `JSON.parse` of countries.json without
 * this step yields plain objects where `c.colors` is undefined.
 *
 * @param {any[]} rawArray
 * @returns {Country[]}
 */
export function loadCountries(rawArray) {
  return rawArray.map(createCountry);
}

/**
 * Denormalize a population map (`{ code: number }`, the `values` object of
 * `flags/metrics/population.json`) onto the given Country objects as a
 * `population` field, mutating and returning the same array. This is what lets
 * the TTT `population` threshold predicates read the number straight off the
 * country — the metric file stays the single source of truth, this only copies
 * the value onto the in-memory Country at load time.
 *
 * Sparse by contract: a country absent from the map (most territories, every
 * non-place flag) is left without the field, and the predicates treat a
 * missing value as "matches neither >= nor <=".
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachPopulations(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.population = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/area.json` values onto each Country as `.area`,
 * so the `area` threshold predicates read it off the country. Twin of
 * `attachPopulations`. Area is dense (every real place has a value), so only
 * non-place flags (orgs) are left without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachAreas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.area = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/density.json` values onto each Country as
 * `.density` (people per km²). Twin of `attachPopulations` / `attachAreas`.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachDensities(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.density = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/gdp.json` values onto each Country as `.gdp`
 * (nominal current US$). Twin of `attachPopulations` / `attachAreas`.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachGdps(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.gdp = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/gdpPerCapita.json` values onto each Country as
 * `.gdpPerCapita` (nominal current US$ per person). Twin of the above.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachGdpPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.gdpPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/elevation.json` values onto each Country as
 * `.elevation` (metres above sea level of the highest point). Twin of
 * `attachAreas`. Elevation is dense (every real place has a value), so only
 * non-place flags (orgs) are left without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachElevations(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.elevation = v;
  }
  return countries;
}

/**
 * Denormalizer for a *sparse* metric whose absence means zero (coffee, and any
 * future crop / output metric with `absence: 'zero'`). A producer listed in the
 * metric map gets its value; every real place (`category !== 'other'`) the map
 * omits produces none and gets 0; only non-place org flags are left without the
 * field. That upholds the data contract's "every real place has a value, so 'no
 * data' means exactly 'not a place'" invariant — which the TTT no-data guard
 * (`metricDataGap`) leans on — without the metric JSON having to spell out ~180
 * explicit zeros. Dense metrics (population, area, GDP) use the plain
 * `attach<Key>s` twins instead: for them absence is genuinely "no value".
 *
 * `assign` writes the value onto the country's own field (kept as an explicit
 * `c.field =` closure so the denormalized field stays statically typed, rather
 * than a dynamic `c[field]` that JSDoc can't check).
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values — producers only (the sparse map).
 * @param {(c: Country, v: number) => void} assign
 * @returns {Country[]}
 */
export function attachZeroFilledMetric(countries, values, assign) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') assign(c, v);
    else if (c.category !== 'other') assign(c, 0);
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/coffee.json` onto each Country as `.coffee`
 * (green-coffee tonnes). Coffee is the first sparse `absence: 'zero'` metric, so
 * this defers to `attachZeroFilledMetric`: growers get their tonnage, every
 * other real place gets 0, orgs stay without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachCoffees(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.coffee = v;
  });
}

/**
 * Denormalize `flags/metrics/wine.json` onto each Country as `.wine`
 * (wine tonnes). Sparse `absence: 'zero'` metric like coffee: makers get their
 * tonnage, every other real place gets 0, orgs stay without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachWines(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.wine = v;
  });
}

/**
 * Denormalize `flags/metrics/cocoa.json` onto each Country as `.cocoa`
 * (cocoa-bean tonnes). Sparse `absence: 'zero'` metric like coffee / wine:
 * growers get their tonnage, every other real place gets 0, orgs stay bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachCocoas(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.cocoa = v;
  });
}

/**
 * Denormalize `flags/metrics/banana.json` onto each Country as `.banana`
 * (banana tonnes). Sparse `absence: 'zero'` metric like the other crops:
 * producers get their tonnage, every other real place gets 0, orgs stay bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachBananas(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.banana = v;
  });
}

/**
 * Registry of the metric denormalizers, keyed by metric key (the same keys as
 * `flags/metrics/index.js`'s METRIC_FILES). This is the single place a new
 * metric registers its loader: add its `attach<Key>s` here next to the others,
 * and every consumer that funnels through {@link attachMetrics} (both TTT pages,
 * the party server, findFlag, flagsdata, the seed-sweep test) picks it up with
 * no per-site edit. Dense and sparse metrics both list their own attacher here;
 * the sparse ones already default to `attachZeroFilledMetric` internally.
 *
 * @type {Record<string, (countries: Country[], values: Record<string, number>) => Country[]>}
 */
const METRIC_ATTACHERS = {
  population: attachPopulations,
  area: attachAreas,
  density: attachDensities,
  gdp: attachGdps,
  gdpPerCapita: attachGdpPerCapitas,
  coffee: attachCoffees,
  wine: attachWines,
  cocoa: attachCocoas,
  banana: attachBananas,
  elevation: attachElevations,
};

/**
 * Denormalize every world metric onto the country pool in one call, so no load
 * site hand-lists the attach calls (the omission that silently empties a metric
 * axis or misfires the TTT no-data guard). `valuesByKey` maps a metric key to
 * its raw `values` map; a key that is missing or null/undefined is skipped (a
 * metric whose fetch failed just leaves its guard off, the prior per-site
 * `if (x) attach…` behaviour). Adding a metric is one `METRIC_ATTACHERS` entry.
 *
 * @param {Country[]} countries
 * @param {Record<string, Record<string, number> | null | undefined>} valuesByKey
 * @returns {Country[]}
 */
export function attachMetrics(countries, valuesByKey) {
  for (const [key, attach] of Object.entries(METRIC_ATTACHERS)) {
    const values = valuesByKey[key];
    if (values) attach(countries, values);
  }
  return countries;
}

/**
 * Single source of truth for how each entry is classified.
 *
 *   sovereign — UN member or UN observer (195: the "games pool")
 *   non_un    — partially-recognised states (currently Kosovo, Taiwan)
 *   territory — any non-sovereign *place*: overseas territory / dependency /
 *               autonomous region, plus constituent or sub-national entities
 *               (Åland, the UK home nations, Catalonia, Basque, …)
 *   other     — flags that aren't places: international organisations
 *               (EU, UN, ASEAN, Arab League, CEFTA, EAC, Pacific Community)
 *
 * Only reads `category` and `statehood`, so it accepts any object carrying
 * those two fields (a full Country, or the lighter CountryLike the metrics
 * layer passes) rather than requiring the whole flag record.
 *
 * @param {{ category?: string, statehood?: string | null }} c
 * @returns {Sovereignty}
 */
export function sovereigntyOf(c) {
  if (c.category === 'other') return 'other';
  if (c.statehood === 'territory') return 'territory';
  if (c.statehood === 'non_un') return 'non_un';
  return 'sovereign';
}

/**
 * Returns the playable flag pool: 195 sovereign states by default, the
 * full 270 when includeAll is true. The toggle itself is owned by each
 * game (different storage keys, different UX placement), so this is a
 * pure pool filter — callers pass the boolean they read.
 *
 * @param {Country[]} countries
 * @param {boolean} includeAll
 * @returns {Country[]}
 */
export function flagsGamePool(countries, includeAll) {
  if (includeAll) return countries;
  return countries.filter((c) => sovereigntyOf(c) === 'sovereign');
}

/**
 * Tiny localStorage helpers for boolean settings — used by the per-game
 * include-all toggles (Quiz, Find).
 *
 * @param {{ getItem(key: string): string | null } | null | undefined} store
 * @param {string} key
 * @returns {boolean}
 */
export function readBoolSetting(store, key) {
  if (!store) return false;
  return store.getItem(key) === 'true';
}

/**
 * @param {{ setItem(key: string, value: string): void, removeItem(key: string): void }} store
 * @param {string} key
 * @param {boolean} value
 */
export function writeBoolSetting(store, key, value) {
  if (value) store.setItem(key, 'true');
  else store.removeItem(key);
}

/** @type {Continent[]} */
export const CONTINENTS = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'Antarctica',
];

/**
 * @param {Country[]} entries
 * @returns {{ countries: Country[], other: Country[] }}
 */
export function splitByCategory(entries) {
  /** @type {Country[]} */
  const countries = [];
  /** @type {Country[]} */
  const other = [];
  for (const e of entries) {
    (e.category === 'country' ? countries : other).push(e);
  }
  return { countries, other };
}

/**
 * @param {Country[]} countries
 * @returns {Record<Continent, Country[]>}
 */
export function groupByContinent(countries) {
  /** @type {Record<Continent, Country[]>} */
  const groups = {
    Africa: [],
    Asia: [],
    Europe: [],
    'North America': [],
    'South America': [],
    Oceania: [],
    Antarctica: [],
  };
  for (const c of countries) {
    if (!c.continent || !(c.continent in groups)) {
      throw new Error(`Unknown continent "${c.continent}" for ${c.code} (${c.name})`);
    }
    groups[c.continent].push(c);
  }
  return groups;
}
