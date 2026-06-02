/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Category} Category */

import { continent, hasColor, hasMotif } from './grid.js';
import { readBoolSetting, writeBoolSetting } from './group.js';

const FIND_INCLUDE_ALL_KEY = 'gridgame.flagfind.includeAll';

/**
 * @param {{ getItem(key: string): string | null } | null | undefined} [store]
 */
export function isFindIncludeAll(store) {
  return readBoolSetting(store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null), FIND_INCLUDE_ALL_KEY);
}

/**
 * @param {{ setItem(key: string, value: string): void, removeItem(key: string): void }} store
 * @param {boolean} value
 */
export function setFindIncludeAll(store, value) {
  writeBoolSetting(store, FIND_INCLUDE_ALL_KEY, value);
}

/**
 * @param {string | null | undefined} id
 * @returns {Category | null}
 */
export function categoryFromId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('continent:')) return continent(id.slice('continent:'.length));
  if (id.startsWith('hasColor:')) return hasColor(id.slice('hasColor:'.length));
  if (id.startsWith('hasMotif:')) return hasMotif(id.slice('hasMotif:'.length));
  return null;
}

/**
 * @param {Country[]} allCountries
 * @param {Category} category
 * @returns {Country[]}
 */
export function findTargets(allCountries, category) {
  return allCountries.filter((c) => category.predicate(c));
}

/**
 * Pass-through; kept so callers have a stable export to use even though
 * we no longer apply an engine-level scope filter — scope is decided at
 * the page level via flagsGamePool.
 * @param {Country[]} allCountries
 * @returns {Country[]}
 */
export function findPool(allCountries) {
  return allCountries;
}

/**
 * @typedef {Object} FindState
 * @property {Set<string>} targetCodes
 * @property {Set<string>} foundCodes
 */

/**
 * @typedef {{ kind: 'match' | 'duplicate' | 'wrong-category' | 'unknown' }} GuessOutcome
 */

/**
 * @param {FindState} state
 * @param {Country | null | undefined} country
 * @returns {GuessOutcome}
 */
export function classifyGuess(state, country) {
  if (!country) return { kind: 'unknown' };
  const inTargets = state.targetCodes.has(country.code);
  if (inTargets && !state.foundCodes.has(country.code)) {
    return { kind: 'match' };
  }
  if (inTargets) {
    return { kind: 'duplicate' };
  }
  return { kind: 'wrong-category' };
}

/**
 * Returns the country to auto-submit when the user has typed an exact full
 * country name and the suggestion list has no ambiguity; otherwise null.
 *
 * Ambiguity check is matches.length === 1 — so typing "Niger" while both
 * Niger and Nigeria match the substring waits for a deliberate pick rather
 * than guessing for the user.
 *
 * @template {{ name: string }} T
 * @param {T[]} matches
 * @param {string} query
 * @returns {T | null}
 */
export function exactSingleMatch(matches, query) {
  if (matches.length !== 1) return null;
  const typed = query.trim().toLowerCase();
  if (!typed) return null;
  if (matches[0].name.toLowerCase() !== typed) return null;
  return matches[0];
}

/**
 * @typedef {Object} FindBest
 * @property {number} time
 * @property {number} found
 * @property {number} total
 */

/**
 * @param {string} categoryId
 * @param {boolean} [includeAll]
 * @returns {string}
 */
export function bestKey(categoryId, includeAll = false) {
  const base = `findflag.best.${categoryId}`;
  return includeAll ? `${base}.all` : base;
}

/**
 * @param {{ getItem(key: string): string | null }} store
 * @param {string} categoryId
 * @param {boolean} [includeAll]
 * @returns {FindBest | null}
 */
export function loadBest(store, categoryId, includeAll = false) {
  try {
    const raw = store.getItem(bestKey(categoryId, includeAll));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.time === 'number' &&
      typeof parsed.found === 'number' &&
      typeof parsed.total === 'number'
    ) {
      return { time: parsed.time, found: parsed.found, total: parsed.total };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {string} categoryId
 * @param {FindBest} best
 * @param {boolean} [includeAll]
 */
export function saveBest(store, categoryId, best, includeAll = false) {
  try {
    store.setItem(bestKey(categoryId, includeAll), JSON.stringify(best));
  } catch {
    // localStorage may throw in private mode / zero quota; degrade silently.
  }
}

/**
 * @param {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} store
 * @param {string} categoryId
 * @param {FindBest} current
 * @param {boolean} [includeAll]
 * @returns {{ best: FindBest, isNew: boolean }}
 */
export function recordFindResult(store, categoryId, current, includeAll = false) {
  const prev = loadBest(store, categoryId, includeAll);
  const isNew =
    !prev ||
    current.found > prev.found ||
    (current.found === prev.found && current.time < prev.time);
  if (isNew) saveBest(store, categoryId, current, includeAll);
  return { best: isNew ? current : prev ?? current, isNew };
}
