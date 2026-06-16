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
 * Single source of truth for how each entry is classified.
 *
 *   sovereign — UN member or UN observer (195: the "games pool")
 *   non_un    — partially-recognised states (currently Kosovo, Taiwan)
 *   territory — overseas territory / dependency / autonomous region
 *   other     — organisations, sub-national flags (EU, ASEAN, Wales, …)
 *
 * @param {Country} c
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
