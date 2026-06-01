/**
 * @typedef {'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Antarctica'} Continent
 *
 * @typedef {'sovereign' | 'non_un' | 'territory' | 'other'} Sovereignty
 *
 * @typedef {Object} Country
 * @property {string} code
 * @property {string} name
 * @property {'country' | 'other'} category
 * @property {Continent | null} continent
 * @property {string | null} [statehood]
 * @property {string[]} [colors]
 * @property {string[]} [motifs]
 */

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
