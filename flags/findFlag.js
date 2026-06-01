/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Category} Category */

import { continent, hasColor, hasMotif } from './grid.js';

/**
 * Reconstruct a `Category` from its stable `id` string. Useful for
 * round-tripping a category through a URL: the chooser page links to
 * `/findFlag/?cat=continent:Africa`, and the game page parses that
 * back into the same Category object the chooser produced.
 *
 * Returns null when the id doesn't match a known prefix — caller is
 * expected to surface "unknown category" to the player rather than
 * silently bouncing back to the chooser, so they understand why.
 *
 * @param {string | null | undefined} id e.g. 'continent:Africa', 'hasColor:red', 'hasMotif:weapon'
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
 * Countries that match the category. Find Flag always excludes the
 * non-country `category === 'other'` entries (EU, ASEAN, Arab League,
 * etc.) so the targets list is unambiguously "sovereign-ish countries
 * and territories" — keeps the game focused and avoids weird
 * autocomplete picks for supranational bodies.
 *
 * Order is preserved from the input array so callers can present a
 * stable order in the end-game "missed" reveal.
 *
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
 * The pool that autocomplete draws from — every country in `allCountries`
 * with `category === 'country'`. Includes flags that DON'T match the
 * current category, because typing the wrong flag is a learning
 * moment (we tell the player "X isn't in this category"). 'other' entries
 * are excluded everywhere — see findTargets.
 *
 * @param {Country[]} allCountries
 * @returns {Country[]}
 */
export function findPool(allCountries) {
  return allCountries.filter((c) => c.category !== 'other');
}

/**
 * @typedef {Object} FindState
 * @property {Set<string>} targetCodes  codes the player needs to name
 * @property {Set<string>} foundCodes   codes the player has correctly named
 */

/**
 * Outcome of attempting a single guess.
 *
 * - 'match' — country is in targets and the player hasn't named it yet
 * - 'duplicate' — country is in targets but already named (no penalty)
 * - 'wrong-category' — country exists in the pool but doesn't satisfy
 *   the category predicate (counts as a "wrong" — fuels the teaching
 *   reveal)
 * - 'unknown' — caller passed null (autocomplete didn't resolve the
 *   typed text to any country); UI typically just shakes the input
 *
 * @typedef {{ kind: 'match' | 'duplicate' | 'wrong-category' | 'unknown' }} GuessOutcome
 */

/**
 * Classify a guess. Does not mutate the state — the caller updates
 * `state.foundCodes` on 'match'. Keeping this pure lets us test all four
 * outcomes without setting up DOM or storage.
 *
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
 * Per-category best record persisted in localStorage. We track found /
 * total so the stats page can show "12 / 13 in 1:23.4" rather than just
 * a time — a partial finish (player gave up) is still worth recording
 * because it's the best they've done so far on that category.
 *
 * @typedef {Object} FindBest
 * @property {number} time   ms elapsed at end of round
 * @property {number} found  number of targets named correctly
 * @property {number} total  size of the target set
 */

/**
 * @param {string} categoryId
 * @returns {string}
 */
export function bestKey(categoryId) {
  return `findflag.best.${categoryId}`;
}

/**
 * Read the best record for a category. Returns null when the slot is
 * empty or the stored shape doesn't look right; never throws.
 *
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
 * Persist a best record. Silently no-ops if the store throws — matches
 * the defensive style used by Grid/Quiz so private-mode browsers don't
 * crash the page.
 *
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {string} categoryId
 * @param {FindBest} best
 */
export function saveBest(store, categoryId, best) {
  try {
    store.setItem(bestKey(categoryId), JSON.stringify(best));
  } catch {
    // storage disabled / full
  }
}

/**
 * Decide whether `current` beats the stored best and persist if so.
 *
 * Tie-breaker: higher `found` wins. On equal `found`, lower `time`
 * wins. Matters because a partial finish (player gave up after 8 / 13)
 * is the current best until they come back and find a 9th — at which
 * point the longer time is still an improvement.
 *
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
