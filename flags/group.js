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
 * @property {number} [temperature]  Denormalized from `flags/metrics/temperature.json` by `attachTemperatures` (average annual air temperature, °C, may be negative). Dense metric: every real place has a value, absent only for non-places (orgs).
 * @property {number} [happiness]  Denormalized from `flags/metrics/happiness.json` by `attachHappinesses` (World Happiness Report ladder score, 0-10). Sparse `absence: 'unknown'` survey metric: the ~115 unsurveyed real places carry no value (read "no data"), not 0. Absent for those and non-places.
 * @property {number} [corruption]  Denormalized from `flags/metrics/corruption.json` by `attachCorruptions` (Transparency International CPI, 0-100, higher = cleaner; displayed as "Government integrity"). Sparse `absence: 'unknown'` survey metric: the states TI does not score carry no value (read "no data"), not 0. Absent for those and non-places.
 * @property {number} [gdp]  Denormalized from `flags/metrics/gdp.json` by `attachGdps` (nominal current US$). Absent only for non-places.
 * @property {number} [gdpPerCapita]  Denormalized from `flags/metrics/gdpPerCapita.json` by `attachGdpPerCapitas` (nominal current US$ per person). Absent only for non-places.
 * @property {number} [coffee]  Denormalized from `flags/metrics/coffee.json` by `attachCoffees` (green-coffee tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [wine]  Denormalized from `flags/metrics/wine.json` by `attachWines` (wine tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-maker defaults to 0); absent only for non-places (orgs).
 * @property {number} [cocoa]  Denormalized from `flags/metrics/cocoa.json` by `attachCocoas` (cocoa-bean tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [banana]  Denormalized from `flags/metrics/banana.json` by `attachBananas` (banana tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [apple]  Denormalized from `flags/metrics/apple.json` by `attachApples` (apple tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [elevation]  Denormalized from `flags/metrics/elevation.json` by `attachElevations` (metres above sea level of the highest point). Dense, same pattern as `area`; absent only for non-places (orgs).
 * @property {number} [coastline]  Denormalized from `flags/metrics/coastline.json` by `attachCoastlines` (kilometres of coastline). Dense, same pattern as `area`: every real place has a value (a landlocked place carries 0), absent only for non-places (orgs).
 * @property {number} [forest]  Denormalized from `flags/metrics/forest.json` by `attachForests` (forest area as a percentage of land area). Dense, same pattern as `area`: every real place has a value (a treeless desert/ice sheet carries 0.0), absent only for non-places (orgs).
 * @property {number} [oil]  Denormalized from `flags/metrics/oil.json` by `attachOils` (oil production, terawatt-hours). Sparse `absence: 'zero'` metric: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [rice]  Denormalized from `flags/metrics/rice.json` by `attachRices` (rice paddy tonnes). Sparse `absence: 'zero'` metric: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [coal]  Denormalized from `flags/metrics/coal.json` by `attachCoals` (coal production, terawatt-hours). Sparse `absence: 'zero'` metric: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [sheepPerCapita]  Denormalized from `flags/metrics/sheepPerCapita.json` by `attachSheepPerCapitas` (sheep head per person). Dense derived metric like `density` / `gdpPerCapita`: every real place has a value (a place with no sheep, or an uninhabited one, carries 0), absent only for non-places (orgs).
 * @property {number} [cattlePerCapita]  Denormalized from `flags/metrics/cattlePerCapita.json` by `attachCattlePerCapitas` (cattle head per person). Dense derived metric like `sheepPerCapita`: every real place has a value (a place with no cattle, or an uninhabited one, carries 0), absent only for non-places (orgs).
 * @property {number} [beerPerCapita]  Denormalized from `flags/metrics/beerPerCapita.json` by `attachBeerPerCapitas` (litres of beer per person per year). `absence: 'unknown'` metric (the first): WHO measures ~189 sovereign states but not sub-national parts or small territories, so a real place WHO does not cover is genuinely unknown (NOT 0) and is left without the field, reading "no data". Absent for both those ~73 places and non-places (orgs).
 * @property {number} [tea]  Denormalized from `flags/metrics/tea.json` by `attachTeas` (green-tea-leaf tonnes). Sparse `absence: 'zero'` metric like coffee: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [sugarcane]  Denormalized from `flags/metrics/sugarcane.json` by `attachSugarcanes` (tonnes of cane). Sparse `absence: 'zero'` metric like coffee: every real place gets a value (a non-grower defaults to 0); absent only for non-places (orgs).
 * @property {number} [gold]  Denormalized from `flags/metrics/gold.json` by `attachGolds` (tonnes of mined gold). Sparse `absence: 'zero'` metric like coffee: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [oliveOil]  Denormalized from `flags/metrics/oliveOil.json` by `attachOliveOils` (tonnes of olive oil). Sparse `absence: 'zero'` metric like coffee: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [honey]  Denormalized from `flags/metrics/honey.json` by `attachHoneys` (tonnes of natural honey). Sparse `absence: 'zero'` metric like coffee: every real place gets a value (a non-producer defaults to 0); absent only for non-places (orgs).
 * @property {number} [alcoholPerCapita]  Denormalized from `flags/metrics/alcoholPerCapita.json` by `attachAlcoholPerCapitas` (litres of pure alcohol per person per year). `absence: 'unknown'` metric like `beerPerCapita`: WHO does not measure sub-national parts or small territories, so a real place it does not cover is genuinely unknown (NOT 0) and left without the field, reading "no data". Absent for those places and non-places (orgs).
 * @property {number} [meatPerCapita]  Denormalized from `flags/metrics/meatPerCapita.json` by `attachMeatPerCapitas` (kg of meat per person per year). `absence: 'unknown'` metric like the drink metrics: a real place the source does not cover is genuinely unknown (NOT 0) and left without the field. Absent for those places and non-places (orgs).
 * @property {number} [borders]  Denormalized from `flags/metrics/borders.json` by `attachBorders` (number of countries sharing a land border). Dense, same pattern as `area`: every real place has a value (an island carries a true 0), absent only for non-places (orgs).
 * @property {number} [tourismPerCapita]  Denormalized from `flags/metrics/tourismPerCapita.json` by `attachTourismPerCapitas` (international tourist arrivals per resident per year). `absence: 'unknown'` metric like the drink metrics: a real place the World Bank has no arrivals figure for carries no value (read "no data"), NOT 0. Absent for those and non-places (orgs).
 * @property {number} [electricityPerCapita]  Denormalized from `flags/metrics/electricityPerCapita.json` by `attachElectricityPerCapitas` (electric power consumption, kWh per person per year). `absence: 'unknown'` metric like the drink metrics: a real place the World Bank does not meter carries no value (read "no data"), NOT 0. Absent for those and non-places (orgs).
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
 * Denormalize `flags/metrics/sheepPerCapita.json` values onto each Country as
 * `.sheepPerCapita` (sheep head per person). Twin of `attachDensities` /
 * `attachGdpPerCapitas`: a dense derived metric, so every real place carries a
 * value (a place with no sheep, or an uninhabited one, is a real 0) and only
 * non-place flags (orgs) are left without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachSheepPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.sheepPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/cattlePerCapita.json` values onto each Country as
 * `.cattlePerCapita` (cattle head per person). Twin of `attachSheepPerCapitas`:
 * a dense derived metric, so every real place carries a value (a place with no
 * cattle, or an uninhabited one, is a real 0) and only non-place flags (orgs)
 * are left without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachCattlePerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.cattlePerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/beerPerCapita.json` values onto each Country as
 * `.beerPerCapita` (litres of beer per person per year). `absence: 'unknown'`,
 * so this is a plain set-if-present (NOT `attachZeroFilledMetric`): a real place
 * WHO does not measure is left without the field on purpose, so it reads "no
 * data" rather than a false 0. Same shape as `attachGdps`, different meaning of
 * the gap (there GDP is dense; here the gap is real).
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachBeerPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.beerPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/alcoholPerCapita.json` values onto each Country as
 * `.alcoholPerCapita` (litres of pure alcohol per person per year). `absence:
 * 'unknown'`, so this is a plain set-if-present (like `attachBeerPerCapitas`): a
 * real place WHO does not measure is left without the field on purpose, reading
 * "no data" rather than a false 0.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachAlcoholPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.alcoholPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/meatPerCapita.json` values onto each Country as
 * `.meatPerCapita` (kg of meat per person per year). `absence: 'unknown'` like the
 * drink metrics, so a plain set-if-present: a real place the source does not cover
 * is left without the field, reading "no data" rather than a false 0.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachMeatPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.meatPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/tourismPerCapita.json` values onto each Country as
 * `.tourismPerCapita` (international tourist arrivals per resident per year).
 * `absence: 'unknown'` like the drink / meat metrics, so a plain set-if-present: a
 * real place the World Bank has no arrivals figure for is left without the field,
 * reading "no data" rather than a false 0 (a country does receive tourists, we
 * just have no figure).
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachTourismPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.tourismPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/electricityPerCapita.json` values onto each Country as
 * `.electricityPerCapita` (electric power consumption, kWh per person per year).
 * `absence: 'unknown'` like the drink / meat metrics, so a plain set-if-present: a
 * real place the World Bank does not meter (micro-states, small territories) is left
 * without the field, reading "no data" rather than a false 0.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachElectricityPerCapitas(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.electricityPerCapita = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/borders.json` values onto each Country as `.borders`
 * (number of countries sharing a land border). Twin of `attachAreas`. Borders is
 * dense (every real place has a value; an island carries a true 0), so only
 * non-place flags (orgs) are left without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachBorders(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.borders = v;
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
 * Denormalize `flags/metrics/coastline.json` values onto each Country as
 * `.coastline` (kilometres of coastline). Twin of `attachElevations` /
 * `attachAreas`. Coastline is dense (every real place has a value; a landlocked
 * place carries 0), so only non-place flags (orgs) are left without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachCoastlines(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.coastline = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/forest.json` values onto each Country as `.forest`
 * (forest area as a percentage of land area). Twin of `attachCoastlines` /
 * `attachAreas`. Forest cover is dense (every real place has a value; a treeless
 * desert or ice sheet carries 0.0), so only non-place flags (orgs) are left
 * without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachForests(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.forest = v;
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
 * Denormalize `flags/metrics/tea.json` onto each Country as `.tea`
 * (green-tea-leaf tonnes). Sparse `absence: 'zero'` metric like coffee: growers
 * get their tonnage, every other real place gets 0, orgs stay without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachTeas(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.tea = v;
  });
}

/**
 * Denormalize `flags/metrics/sugarcane.json` onto each Country as `.sugarcane`
 * (tonnes of cane). Sparse `absence: 'zero'` metric like coffee: growers get
 * their tonnage, every other real place gets 0, orgs stay without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachSugarcanes(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.sugarcane = v;
  });
}

/**
 * Denormalize `flags/metrics/gold.json` onto each Country as `.gold`
 * (tonnes of mined gold). Sparse `absence: 'zero'` metric like coffee: producers
 * get their tonnage, every other real place gets 0, orgs stay without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachGolds(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.gold = v;
  });
}

/**
 * Denormalize `flags/metrics/oliveOil.json` onto each Country as `.oliveOil`
 * (tonnes of olive oil). Sparse `absence: 'zero'` metric like coffee: producers
 * get their tonnage, every other real place gets 0, orgs stay without the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachOliveOils(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.oliveOil = v;
  });
}

/**
 * Denormalize `flags/metrics/honey.json` onto each Country as `.honey`
 * (tonnes of natural honey). Sparse `absence: 'zero'` metric like coffee:
 * producers get their tonnage, every other real place gets 0, orgs stay bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachHoneys(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.honey = v;
  });
}

/**
 * Denormalize `flags/metrics/temperature.json` onto each Country as
 * `.temperature` (average annual air temperature, degrees Celsius, may be
 * negative). Dense metric: every real place has a value, so the plain
 * set-if-present pattern (like the physical-fact metrics elevation / coastline)
 * fills every real place and leaves only orgs bare. A `typeof v === 'number'`
 * guard, not `v > 0`, so sub-zero climate normals attach correctly.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachTemperatures(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.temperature = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/happiness.json` onto each Country as `.happiness`
 * (World Happiness Report Cantril-ladder score, 0-10). Sparse `absence:
 * 'unknown'` survey metric like `beerPerCapita`: the ~115 real places the Gallup
 * poll does not survey carry no value and are left bare (they read "no data"),
 * NOT 0 (0 is a real ladder score, not a gap). Plain set-if-present, so only the
 * ~147 covered places get the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachHappinesses(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.happiness = v;
  }
  return countries;
}

/**
 * Denormalize `flags/metrics/corruption.json` onto each Country as `.corruption`
 * (Transparency International CPI, 0-100, higher = cleaner; displayed as
 * "Government integrity"). Sparse `absence: 'unknown'` survey metric like
 * `beerPerCapita`: the states TI does not score carry no value and are left bare
 * (they read "no data"), NOT 0 (0 is "highly corrupt", a real score, not a gap).
 * Plain set-if-present, so only the ~181 scored places get the field.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachCorruptions(countries, values) {
  for (const c of countries) {
    const v = values[c.code];
    if (typeof v === 'number') c.corruption = v;
  }
  return countries;
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
 * Denormalize `flags/metrics/apple.json` onto each Country as `.apple`
 * (apple tonnes). Sparse `absence: 'zero'` metric like the other crops:
 * producers get their tonnage, every other real place gets 0, orgs stay bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachApples(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.apple = v;
  });
}

/**
 * Denormalize `flags/metrics/oil.json` onto each Country as `.oil`
 * (oil production, terawatt-hours). Sparse `absence: 'zero'` metric like the
 * crops: producers get their output, every other real place gets 0, orgs stay
 * bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachOils(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.oil = v;
  });
}

/**
 * Denormalize `flags/metrics/rice.json` onto each Country as `.rice`
 * (rice paddy tonnes). Sparse `absence: 'zero'` metric like the other crops:
 * growers get their tonnage, every other real place gets 0, orgs stay bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachRices(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.rice = v;
  });
}

/**
 * Denormalize `flags/metrics/coal.json` onto each Country as `.coal`
 * (coal production, terawatt-hours). Sparse `absence: 'zero'` metric like oil
 * and the crops: producers get their output, every other real place gets 0,
 * orgs stay bare.
 *
 * @param {Country[]} countries
 * @param {Record<string, number>} values
 * @returns {Country[]}
 */
export function attachCoals(countries, values) {
  return attachZeroFilledMetric(countries, values, (c, v) => {
    c.coal = v;
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
  apple: attachApples,
  elevation: attachElevations,
  coastline: attachCoastlines,
  forest: attachForests,
  oil: attachOils,
  rice: attachRices,
  coal: attachCoals,
  sheepPerCapita: attachSheepPerCapitas,
  cattlePerCapita: attachCattlePerCapitas,
  beerPerCapita: attachBeerPerCapitas,
  tea: attachTeas,
  sugarcane: attachSugarcanes,
  gold: attachGolds,
  alcoholPerCapita: attachAlcoholPerCapitas,
  meatPerCapita: attachMeatPerCapitas,
  borders: attachBorders,
  oliveOil: attachOliveOils,
  honey: attachHoneys,
  temperature: attachTemperatures,
  happiness: attachHappinesses,
  corruption: attachCorruptions,
  tourismPerCapita: attachTourismPerCapitas,
  electricityPerCapita: attachElectricityPerCapitas,
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
