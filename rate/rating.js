/**
 * Pure state machine for the country-rating tool. No DOM, no fetch, no
 * localStorage — all of that lives in page.js. This file only knows about
 * an index into a countries list and a `code -> score` map.
 *
 * @typedef {{ code: string, name: string }} CountryLike
 * @typedef {{ index: number, ratings: Record<string, number> }} RatingState
 */

/** @returns {RatingState} */
export function emptyState() {
  return { index: 0, ratings: {} };
}

/**
 * Record a 1..5 score for the country at the current index and advance.
 * Invalid scores are silently ignored so the UI doesn't have to guard.
 *
 * @param {RatingState} state
 * @param {CountryLike[]} countries
 * @param {number} score
 * @returns {RatingState}
 */
export function rate(state, countries, score) {
  if (state.index >= countries.length) return state;
  if (!Number.isInteger(score) || score < 1 || score > 5) return state;
  const c = countries[state.index];
  return {
    index: state.index + 1,
    ratings: { ...state.ratings, [c.code]: score },
  };
}

/**
 * Advance without recording a rating.
 * @param {RatingState} state
 * @param {CountryLike[]} countries
 * @returns {RatingState}
 */
export function skip(state, countries) {
  if (state.index >= countries.length) return state;
  return { ...state, index: state.index + 1 };
}

/**
 * Step back one. Existing ratings are *not* cleared — the user sees what
 * they had so they can change their mind by pressing another number.
 *
 * @param {RatingState} state
 * @returns {RatingState}
 */
export function undo(state) {
  if (state.index <= 0) return state;
  return { ...state, index: state.index - 1 };
}

/**
 * @template {CountryLike} C
 * @param {RatingState} state
 * @param {C[]} countries
 * @returns {C | null}
 */
export function currentCountry(state, countries) {
  if (state.index >= countries.length) return null;
  return countries[state.index];
}

/**
 * @param {RatingState} state
 * @param {CountryLike[]} countries
 */
export function isDone(state, countries) {
  return state.index >= countries.length;
}

/**
 * Position vs. ratings-count are tracked separately because skipping
 * advances position without adding a rating.
 *
 * @param {RatingState} state
 * @param {CountryLike[]} countries
 */
export function progress(state, countries) {
  return {
    position: Math.min(state.index, countries.length),
    total: countries.length,
    rated: Object.keys(state.ratings).length,
  };
}

/**
 * Jump to the first country in the list that hasn't been rated yet. Useful
 * for "resume where I left off" after a session break — auto-advances past
 * anything already done.
 *
 * @param {RatingState} state
 * @param {CountryLike[]} countries
 * @returns {RatingState}
 */
export function jumpToFirstUnrated(state, countries) {
  for (let i = 0; i < countries.length; i++) {
    if (!(countries[i].code in state.ratings)) {
      return { ...state, index: i };
    }
  }
  return { ...state, index: countries.length };
}
