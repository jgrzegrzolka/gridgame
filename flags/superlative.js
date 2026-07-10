import { parseFilterString } from './findFlag.js';
import { matchesFilters } from './flagsFilter.js';
import { flagsGamePool, CONTINENTS } from './group.js';

/**
 * Superlative daily-puzzle resolver. Pure logic; no DOM, no fetch.
 *
 * A superlative puzzle is "the top-N countries by a world metric, in a scope,
 * optionally intersected with a flag filter" — e.g. "the 10 most populous
 * countries" or "the 5 most populous European flags with white". This is
 * architecturally distinct from a filter puzzle: a filter is a *per-flag*
 * predicate (`matchesFilters(country, ...)`), while a superlative is
 * *set-relative* — the answer depends on ranking the whole scope, so it can
 * never be one more DSL token. The mechanic is therefore "reuse the flag DSL to
 * narrow the pool, then rank the survivors by the metric and take N."
 *
 * Frozen-answers contract (same as manual entries): a shipped superlative
 * entry stores its resolved codes and the catalog never re-derives them
 * against the live metric — `population.json` refreshes yearly and released
 * daily puzzles are immutable (daily rule 1), so a live recompute would break
 * a past puzzle after a data refresh with no legal fix. `resolveSuperlative`
 * is what the authoring generator / audit call at draft time to *compute* the
 * roster (and to warn on drift for still-editable future-dated drafts), not a
 * live catalog validator.
 *
 * @typedef {Object} SuperlativeSpec
 * @property {string} metric   metric key (e.g. 'population'); informational for
 *                             the resolver — the caller passes the matching
 *                             `values` map, so the resolver never fetches.
 * @property {string} scope    'world' or a continent name ('Europe', 'Asia', …).
 * @property {'most' | 'least'} direction  rank from the top or the bottom.
 * @property {number} topN     how many to take.
 * @property {string} [filter] optional flag DSL filter (same grammar as the
 *                             findFlag chooser / daily filter entries) that
 *                             pre-narrows the ranking pool. Sovereign-only.
 */

/** Scopes a superlative may rank within: the whole (sovereign) world or one
 * continent. Antarctica is dropped — no sovereign states, no metric values. */
export const SUPERLATIVE_SCOPES = ['world', ...CONTINENTS.filter((c) => c !== 'Antarctica')];

/**
 * Is `scope` a scope the resolver understands? Exported so the catalog
 * validator and the generator share one definition.
 * @param {string} scope
 * @returns {boolean}
 */
export function isValidScope(scope) {
  return SUPERLATIVE_SCOPES.includes(scope);
}

/**
 * Resolve a superlative spec to its ordered list of sovereign country codes,
 * highest-ranked first (or lowest first when `direction: 'least'`).
 *
 * Pool: sovereign countries (`flagsGamePool(_, false)`) that carry a value in
 * `values`, restricted to `scope`, then optionally narrowed by the flag
 * filter. Ranked by metric value; ties broken by code ascending so the order
 * is deterministic (mirrors `flags/metrics.js` `ranked`). Returns fewer than
 * `topN` codes when the pool is smaller, and `[]` when the params are unusable
 * (bad `topN`, unknown scope, unparseable filter).
 *
 * `colorField` is threaded to `matchesFilters` so the primary-clean audit can
 * resolve the same spec under `'primaryColors'` and compare — the daily's
 * onboarding trust rule (rule 5) applies to a superlative's flag-filter part
 * exactly as it does to a filter entry.
 *
 * @param {SuperlativeSpec} spec
 * @param {import('./group.js').Country[]} countries
 * @param {Record<string, number>} values  the metric's `values` map (code → number)
 * @param {{ colorField?: 'colors' | 'primaryColors' }} [options]
 * @returns {string[]}
 */
export function resolveSuperlative(spec, countries, values, options = {}) {
  const { scope, direction, topN, filter } = spec;
  if (!Number.isInteger(topN) || topN < 1) return [];
  if (!isValidScope(scope)) return [];
  if (direction !== 'most' && direction !== 'least') return [];

  let pool = flagsGamePool(countries, false).filter(
    (c) => typeof values[c.code] === 'number',
  );
  if (scope !== 'world') pool = pool.filter((c) => c.continent === scope);
  if (filter) {
    const parsed = parseFilterString(filter);
    if (!parsed) return [];
    pool = pool.filter((c) => matchesFilters(c, parsed, options));
  }

  const sign = direction === 'least' ? 1 : -1;
  pool.sort(
    (a, b) => sign * (values[a.code] - values[b.code]) || (a.code < b.code ? -1 : 1),
  );
  return pool.slice(0, topN).map((c) => c.code);
}
