/**
 * Canonical configKey for a flagQuiz personal-best entry. Mirrors the
 * client-side localStorage split done by `bestKey()` in quiz.js: a
 * (variant, mode) pair maps to a unique PB slot.
 *
 * Shape: `"<variant>:<mode>"`.
 *
 * Examples:
 *   countries:60s   — all-countries, 60s
 *   africa:all      — Africa, endurance
 *   weird:60s       — the non-sovereign deck, 60s
 *
 * The third `<sov|all>` segment is gone (Feature V). It only ever existed to
 * separate the "include territories" toggle's two pools, and that toggle was
 * replaced by the `weird` deck — which is a variant, so it lands in the first
 * segment like every other. The server still *accepts* the old 3-part shape
 * (see api/src/lib/quizRecordKey.js) because browsers with cached JS keep
 * sending it; nothing emits it any more.
 *
 * The shape regex + length cap live server-side in
 * api/src/lib/quizRecordKey.js — that's the only consumer that needs to
 * gate incoming strings. The client just builds and sends. That gate does not
 * enumerate variants, so new decks need no server change at all.
 *
 * @param {string} variantKey
 * @param {string} modeKey
 * @returns {string}
 */
export function quizRecordConfigKey(variantKey, modeKey) {
  return `${variantKey}:${modeKey}`;
}
