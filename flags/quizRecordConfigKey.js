/**
 * Canonical configKey for a flagQuiz personal-best entry. Mirrors the
 * client-side localStorage split done by `bestKey()` in quiz.js: a
 * (variant, mode, includeAll) triple maps to a unique PB slot so a
 * "with-territories" sweep doesn't clobber a "sovereign-only" sweep
 * of the same variant/mode.
 *
 * Shape: `"<variant>:<mode>:<sov|all>"`.
 *   - sov = sovereign-only pool (includeAll = false)
 *   - all = sovereign + territories (includeAll = true)
 *
 * Examples:
 *   countries:60s:sov     — all-countries 60s, sovereign-only
 *   africa:all:sov        — Africa endurance, sovereign-only
 *   countries:60s:all     — all-countries 60s, with territories
 *
 * The shape regex + length cap live server-side in
 * api/src/lib/quizRecordKey.js — that's the only consumer that needs to
 * gate incoming strings. The client just builds and sends.
 *
 * @param {string} variantKey
 * @param {string} modeKey
 * @param {boolean} includeAll
 * @returns {string}
 */
export function quizRecordConfigKey(variantKey, modeKey, includeAll) {
  return `${variantKey}:${modeKey}:${includeAll ? 'all' : 'sov'}`;
}
