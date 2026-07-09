import { sovereigntyOf } from './group.js';

/** @typedef {import('./group.js').Country} Country */

/**
 * Flag pools for the game modes that pick from a *scope* of the world rather
 * than the whole set. Today: the sovereign pool (195 UN members + the couple
 * of widely-recognised sovereigns) and the non-sovereign pool (territories,
 * dependencies, quasi-states, and subnational regions).
 *
 * Pure filters over a loaded country list. `flags/group.js` `flagsGamePool`
 * already covers "sovereign vs everything"; this module adds the curated
 * *non-sovereign* pool, which needs the exclusion below to stay playable.
 */

/**
 * Non-sovereign codes whose flag reads as their parent sovereign's flag, so a
 * "Which flag is X?" round would be unanswerable (the flag doesn't identify
 * the place). Verified by eye against `flags/svg/*.svg`, not just the
 * `quiz.js` LOOKALIKES list — that list omits Heard & McDonald (Australia's
 * flag) and the US Minor Outlying Islands (the Stars and Stripes).
 *
 *   - French tricolor: Réunion, Clipperton, Guadeloupe, St Martin, St Pierre
 *     & Miquelon, Wallis & Futuna, French Guiana, Mayotte, St Barthélemy
 *   - Norway's flag: Svalbard & Jan Mayen, Bouvet Island
 *   - US flag: US Minor Outlying Islands
 *   - Australia's flag: Heard Island & McDonald Islands
 *
 * @type {Set<string>}
 */
export const SHARED_PARENT_FLAG = new Set([
  're', 'cp', 'gp', 'mf', 'pm', 'wf', 'gf', 'yt', 'bl',
  'sj', 'bv',
  'um',
  'hm',
]);

/**
 * The sovereign flag pool — UN members and recognised sovereign states.
 * @param {Country[]} countries
 * @returns {Country[]}
 */
export function sovereignPool(countries) {
  return countries.filter((c) => sovereigntyOf(c) === 'sovereign');
}

/**
 * The non-sovereign flag pool: territories, dependencies, quasi-states, and
 * subnational regions — everything that is *not* sovereign but is a place with
 * its own identifying flag. Organizations (EU, UN, ASEAN, …) are dropped via
 * the `category === 'country'` filter, and parent-flag duplicates via
 * {@link SHARED_PARENT_FLAG}.
 *
 * @param {Country[]} countries
 * @returns {Country[]}
 */
export function nonSovereignPool(countries) {
  return countries.filter((c) =>
    sovereigntyOf(c) !== 'sovereign' &&
    c.category === 'country' &&
    !SHARED_PARENT_FLAG.has(c.code));
}
