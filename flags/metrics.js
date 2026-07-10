/**
 * Pure helpers over a single world-metric (population today; area, GDP, coffee
 * production, … as more metric files land under flags/metrics/).
 *
 * No fetch, no DOM — same discipline as engine.js. The caller loads the metric
 * JSON and countries.json and passes both in; tests pass fixtures. Every ranked
 * view is derived here from the raw `values`, so metric files store numbers
 * only and never a baked-in rank (see DATA_FEATURE.md "Feature DD").
 *
 * A metric is sparse by contract: `values` lists only the countries the metric
 * applies to. Ranks and tiers are always computed within a *scope*:
 *   'world'       — every country that has a value
 *   'un_member'   — UN member states only
 *   <continent>   — one continent by name ('Europe', 'Asia', …)
 */

/**
 * @typedef {Object} MetricData
 * @property {string} key
 * @property {string} label
 * @property {string} unit
 * @property {string} [format] display hint: 'compact' (1.4B) or 'decimal1' (4.2)
 * @property {string} source
 * @property {number} year
 * @property {Record<string, number>} values
 */

/**
 * @typedef {Object} CountryLike
 * @property {string} code
 * @property {string} continent
 * @property {string} statehood
 * @property {string} [category]
 */

/**
 * @typedef {Object} Ranked
 * @property {string} code
 * @property {number} value
 */

/**
 * Build the helper surface for one metric.
 * @param {MetricData} metric
 * @param {CountryLike[]} countries
 */
export function createMetric(metric, countries) {
  const values = metric.values || {};
  /** @type {Map<string, CountryLike>} */
  const byCode = new Map();
  for (const c of countries) byCode.set(c.code, c);

  /** @param {string} code */
  const has = (code) => Object.prototype.hasOwnProperty.call(values, code);

  /** @param {string} code */
  const valueOf = (code) => (has(code) ? values[code] : undefined);

  /**
   * Is `code` inside `scope` and does it carry a value?
   * @param {string} code
   * @param {string} scope
   */
  function inScope(code, scope) {
    if (!has(code)) return false;
    if (scope === 'world') return true;
    const co = byCode.get(code);
    if (!co) return false;
    if (scope === 'un_member') return co.statehood === 'un_member';
    return co.continent === scope;
  }

  /**
   * Every country in `scope` with a value, highest value first. Ties broken by
   * code so ordering is deterministic.
   * @param {string} scope
   * @returns {Ranked[]}
   */
  function ranked(scope) {
    return Object.keys(values)
      .filter((code) => inScope(code, scope))
      .map((code) => ({ code, value: values[code] }))
      .sort((a, b) => b.value - a.value || (a.code < b.code ? -1 : 1));
  }

  /**
   * The `n` highest in `scope`, highest first.
   * @param {string} scope
   * @param {number} n
   */
  const topN = (scope, n) => ranked(scope).slice(0, n);

  /**
   * The `n` lowest in `scope`, lowest first.
   * @param {string} scope
   * @param {number} n
   */
  function bottomN(scope, n) {
    const all = ranked(scope);
    return all.slice(Math.max(0, all.length - n)).reverse();
  }

  /**
   * 1-based rank of `code` within `scope` (1 = highest), or null if it has no
   * value or falls outside the scope.
   * @param {string} code
   * @param {string} scope
   */
  function rankOf(code, scope) {
    if (!inScope(code, scope)) return null;
    const list = ranked(scope);
    const i = list.findIndex((r) => r.code === code);
    return i === -1 ? null : i + 1;
  }

  /**
   * Tertile of `code` within `scope`: 'high' (top third), 'mid', or 'low'
   * (bottom third). null if `code` has no value or is out of scope.
   * @param {string} code
   * @param {string} scope
   * @returns {'high' | 'mid' | 'low' | null}
   */
  function tierOf(code, scope) {
    if (!inScope(code, scope)) return null;
    const list = ranked(scope);
    const i = list.findIndex((r) => r.code === code);
    if (i === -1) return null;
    if (i < list.length / 3) return 'high';
    if (i < (2 * list.length) / 3) return 'mid';
    return 'low';
  }

  /**
   * Compare two countries by value: negative if `a` < `b`, positive if
   * `a` > `b`, 0 if equal, null if either lacks a value. Powers the
   * "which is bigger?" round.
   * @param {string} a
   * @param {string} b
   */
  function compare(a, b) {
    if (!has(a) || !has(b)) return null;
    return Math.sign(values[a] - values[b]);
  }

  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    format: metric.format || 'compact',
    source: metric.source,
    year: metric.year,
    has,
    valueOf,
    ranked,
    topN,
    bottomN,
    rankOf,
    tierOf,
    compare,
  };
}
