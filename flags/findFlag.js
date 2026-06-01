/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Category} Category */

import { continent, hasColor, hasMotif } from './grid.js';

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
  return allCountries.filter(
    (c) => c.category !== 'other' && category.predicate(c),
  );
}

/**
 * @param {Country[]} allCountries
 * @returns {Country[]}
 */
export function findPool(allCountries) {
  return allCountries.filter((c) => c.category !== 'other');
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
 * @returns {string}
 */
export function bestKey(categoryId) {
  return `findflag.best.${categoryId}`;
}

/**
 * @param {{ getItem(key: string): string | null }} store
 * @param {string} categoryId
 * @returns {FindBest | null}
 */
export function loadBest(store, categoryId) {
  try {
    const raw = store.getItem(bestKey(categoryId));
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
 */
export function saveBest(store, categoryId, best) {
  try {
    store.setItem(bestKey(categoryId), JSON.stringify(best));
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
 * @returns {{ best: FindBest, isNew: boolean }}
 */
export function recordFindResult(store, categoryId, current) {
  const prev = loadBest(store, categoryId);
  const isNew =
    !prev ||
    current.found > prev.found ||
    (current.found === prev.found && current.time < prev.time);
  if (isNew) saveBest(store, categoryId, current);
  return { best: isNew ? current : prev ?? current, isNew };
}
