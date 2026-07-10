import { CONTOUR_CODE_SET } from '../contourPool.js';

/**
 * The "map pick" round: "Which outline is X?" — the mirror of flag-pick. The
 * prompt names the target country, the options are four country codes, and the
 * answer is the target's own code; the page renders each option as a contour
 * silhouette (`flags/contours/<code>.svg`) instead of a flag. Same data shape as
 * `flagPick`, so the room and scoring stay round-agnostic.
 *
 * A country can only be a map question if it produced a recognizable contour
 * (see `flags/contourPool.js`), so `generate` first narrows the incoming pool to
 * `CONTOUR_CODE_SET`. That keeps the map round self-contained: hand it any pool
 * of `{ code }` entries and it draws only from the ones with an asset.
 *
 * MVP distractors are four random distinct codes — shape-lookalike distractors
 * ("which of these similar outlines…") are a later tuning pass; flag-lookalike
 * logic doesn't transfer to shapes.
 */

/** @typedef {{ code: string }} PoolEntry */
/** @typedef {{ prompt: string, options: string[], answer: string }} Question */

export const id = 'mapPick';

/**
 * Fisher-Yates over a copy, using an injectable RNG so tests are deterministic.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * @param {PoolEntry[]} pool  any pool of country entries; narrowed to the ones
 *   with a contour asset before use.
 * @param {Set<string>} [exclude] answer codes already used this game, so a round
 *   doesn't repeat a country. Falls back to the full contour set if excluding
 *   would leave too few to build a question.
 * @param {() => number} [rng] injectable for tests; defaults to `Math.random`.
 * @returns {Question}
 */
export function generate(pool, exclude, rng = Math.random) {
  const withContour = pool.filter((c) => CONTOUR_CODE_SET.has(c.code));
  const usable = exclude && exclude.size ? withContour.filter((c) => !exclude.has(c.code)) : withContour;
  const src = usable.length >= 4 ? usable : withContour;
  // Four distinct codes; the first is the answer (already uniformly random
  // since the draw is shuffled), then shuffle again so its tile position varies.
  const picked = shuffle(src, rng).slice(0, 4);
  const answer = picked[0].code;
  const options = shuffle(picked.map((c) => c.code), rng);
  return { prompt: answer, options, answer };
}

/**
 * @param {{ answer: string }} question
 * @param {string} choice the chosen option's country code
 * @returns {boolean}
 */
export function isCorrect(question, choice) {
  return choice === question.answer;
}
