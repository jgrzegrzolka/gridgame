/**
 * Tiny pure helper for interpreting boolean-flavored env var values.
 *
 * Why strict-match-on-"true" instead of truthy: env vars are strings.
 * `process.env.FOO = "false"` is truthy. `process.env.FOO = "0"` is
 * truthy. Loose truthiness has bitten every project that's relied
 * on it; the strict check makes the intent explicit at the call site.
 *
 * The handler holds the `process.env` access (single place for env
 * policy) and hands the value to this helper.
 */

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isTrueFlag(value) {
  return value === 'true';
}

module.exports = { isTrueFlag };
