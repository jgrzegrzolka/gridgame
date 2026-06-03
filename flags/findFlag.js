/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Category} Category */

import { categoryFromId as gridCategoryFromId } from './grid.js';
import { readBoolSetting, writeBoolSetting } from './group.js';

// Re-exported so existing findFlag callers don't need to update their import.
// The implementation lives in grid.js next to the category factories.
export const categoryFromId = gridCategoryFromId;

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

/**
 * Confetti rule for the find-flag page: a clean sweep (found === total)
 * always celebrates, even if a previous faster sweep means there's no
 * new record; a new record (better partial result than before) also
 * fires, so a give-up that still beat your previous best feels rewarded.
 *
 * @param {{ found: number, total: number, isNew: boolean }} params
 * @returns {boolean}
 */
export function shouldFireFindFlagConfetti({ found, total, isNew }) {
  return found === total || isNew;
}
