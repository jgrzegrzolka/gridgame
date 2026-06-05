/**
 * Pure helpers for the country-rating tool. State is just a plain
 * `{ code: score }` map — no current-index navigation, no skip/undo, since
 * the UI lays out all countries as a grid where the user clicks directly
 * on the score they want. Kept here (rather than inlined in page.js) so
 * the clamp/normalize rules stay under unit tests.
 *
 * @typedef {Record<string, number>} Ratings
 */

/** @returns {Ratings} */
export function emptyRatings() {
  return {};
}

/**
 * Set a 1..6 score for a country code. Invalid scores or empty codes are
 * silently ignored so click handlers don't have to guard. (7 is reserved
 * as the non-sovereign default, set directly by the export path; the UI
 * never assigns it.)
 *
 * @param {Ratings} ratings
 * @param {string} code
 * @param {number} score
 * @returns {Ratings}
 */
export function setRating(ratings, code, score) {
  if (!code) return ratings;
  if (!Number.isInteger(score) || score < 1 || score > 6) return ratings;
  return { ...ratings, [code]: score };
}

/**
 * @param {Ratings} ratings
 */
export function ratedCount(ratings) {
  return Object.keys(ratings).length;
}
