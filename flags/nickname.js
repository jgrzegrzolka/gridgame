/**
 * Friendly display-name resolver for any device, anywhere on the site.
 *
 * Two functions:
 *   - `defaultNickname(deviceId)`  — deterministic two-word name derived
 *                                    from the deviceId. Same id, same name,
 *                                    everywhere, forever.
 *   - `displayNickname(deviceId, savedNickname)` — saved wins if it's a
 *                                    non-empty string; otherwise the default.
 *
 * Used by every place a name appears: the burger menu link, the /profile/
 * page, and (incoming) daily community stats + the TTT lobby. No server
 * fetch is needed for the default — every viewer computes the same name
 * from a deviceId they already have, so we never have to write a row to
 * Cosmos just to give someone a label.
 *
 * Why deterministic (vs. random + cache): a viewer rendering the daily
 * stats panel sees a list of contributing deviceIds belonging to other
 * users. The viewer needs to label each one. If defaults were random-per-
 * device-then-cached, the viewer couldn't reproduce the label without a
 * server lookup. Hashing the deviceId means every viewer derives the
 * same default for every other deviceId — no network, no row.
 *
 * Why FNV-1a (vs. a cryptographic hash): we just need a stable 32-bit
 * spread for two array lookups. FNV-1a is ~5 lines of pure JS, dependency-
 * free, and produces a well-distributed hash for arbitrary strings.
 * Cryptographic strength is overkill for picking adjectives.
 */

/**
 * 50 PG, single-word adjectives. Curated for "friendly game personality"
 * tone — no political, judgemental, or visual-impairment-coded words.
 * The pool is frozen so a stray `.push()` or `.sort()` somewhere doesn't
 * silently drift the determinism. Modifying this list re-keys every
 * default name, so do it intentionally.
 */
export const ADJECTIVES = Object.freeze([
  'Brave', 'Quiet', 'Wandering', 'Curious', 'Sleepy', 'Bright', 'Lively', 'Calm',
  'Swift', 'Patient', 'Sunny', 'Misty', 'Bold', 'Gentle', 'Cheerful', 'Witty',
  'Steady', 'Eager', 'Plucky', 'Mellow', 'Restless', 'Drowsy', 'Polite', 'Sharp',
  'Quirky', 'Dapper', 'Jolly', 'Merry', 'Snappy', 'Spry', 'Wise', 'Lucky',
  'Cosy', 'Tidy', 'Pensive', 'Modest', 'Nimble', 'Hearty', 'Tranquil', 'Cheery',
  'Daring', 'Faithful', 'Friendly', 'Gracious', 'Honest', 'Kind', 'Loyal', 'Noble',
  'Sturdy', 'Mighty',
]);

/**
 * 50 PG single-word nouns. Mostly birds, mammals, and natural-landscape
 * features — matches the gridgame tone (flag puzzles, animals, places)
 * and stays culturally neutral. Avoid country-bound or political nouns.
 */
export const NOUNS = Object.freeze([
  'Albatross', 'Falcon', 'Otter', 'Mountain', 'River', 'Stork', 'Heron', 'Robin',
  'Lynx', 'Meadow', 'Fox', 'Hawk', 'Badger', 'Sparrow', 'Owl', 'Hare',
  'Crane', 'Pebble', 'Forest', 'Willow', 'Cedar', 'Cove', 'Lantern', 'Comet',
  'Harbour', 'Glacier', 'Maple', 'Beacon', 'Lighthouse', 'Boulder', 'Cavern', 'Reef',
  'Orchid', 'Daisy', 'Clover', 'Thistle', 'Pine', 'Birch', 'Aspen', 'Hazel',
  'Marten', 'Stoat', 'Beaver', 'Puffin', 'Kestrel', 'Magpie', 'Wren', 'Finch',
  'Marlin', 'Dolphin',
]);

/**
 * FNV-1a 32-bit. Stable, deterministic, dependency-free. Same input always
 * produces the same unsigned 32-bit integer, regardless of platform or
 * runtime. Used to seed both pool picks below.
 *
 * @param {string} str
 * @returns {number}
 */
export function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic friendly name for a deviceId. Always returns
 * `"${Adjective} ${Noun}"`. The hash is spread across both array
 * picks so two deviceIds that share their low bits don't collide
 * on the noun while differing only on the adjective.
 *
 * @param {string} deviceId
 * @returns {string}
 */
export function defaultNickname(deviceId) {
  const h = fnv1a(typeof deviceId === 'string' ? deviceId : '');
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  // `>>> 0` keeps the math unsigned after the division, since JS does it
  // in 64-bit floats — without it `Math.floor(h / ADJECTIVES.length)`
  // would still work, but this is explicit about staying 32-bit-clean.
  const nounIdx = (Math.floor(h / ADJECTIVES.length) >>> 0) % NOUNS.length;
  return `${adj} ${NOUNS[nounIdx]}`;
}

/**
 * The single source of truth for "what to display for this deviceId".
 * Used by the burger menu link, the /profile/ page, and every read-side
 * surface that shows a name (daily stats, TTT lobby, etc.).
 *
 * Non-empty saved string wins. `null` / `undefined` / empty / whitespace-
 * only saved → fall back to the default. This is the same contract the
 * server-side validator enforces on writes (`null` or trimmed 1..24), so
 * the read and write sides agree.
 *
 * @param {string} deviceId
 * @param {string | null | undefined} savedNickname
 * @returns {string}
 */
export function displayNickname(deviceId, savedNickname) {
  if (typeof savedNickname === 'string') {
    const trimmed = savedNickname.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return defaultNickname(deviceId);
}
