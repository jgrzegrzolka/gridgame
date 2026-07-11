/** @typedef {import('./group.js').Country} Country */

import { POPULATION_BREAKS_FOR_RANDOM, population } from './engine.js';

/**
 * Registry of the world metrics that surface as *threshold tier pills* — the
 * curated breakpoints (`>=100M`, `<=1M`, …) that the TTT random pool, the
 * findFlag "Make a puzzle" chooser, and the flagsdata filter bar all offer as
 * a single-select filter. Each entry pairs the metric's breakpoint list with
 * its category factory so one definition of a tier drives every surface and
 * they can't drift.
 *
 * A tier is an *absolute* per-flag predicate (`c.population >= n`), NOT the
 * set-relative rank/tier the metric *lens* computes (`createMetric().tierOf`).
 * That's why it can live in the shared filter path (`matchesFilters`) while the
 * lens can't — the same split Feature DE's design drew. The predicate reads a
 * denormalized `Country` field (population copied on at load via
 * `attachPopulations`), so it composes with `matchesFilters` with no data
 * threading.
 *
 * Onboarding a second metric (area / GDP / …): add its `<KEY>_BREAKS_FOR_RANDOM`
 * list + `<key>(op, n)` factory in `engine.js` (already required for the TTT
 * threshold family), then add one line here. Both the findFlag chooser and the
 * flagsdata filter bar light up its tier pills for free.
 *
 * @type {Record<string, {
 *   breaks: ReadonlyArray<{ op: '>=' | '<=', n: number }>,
 *   factory: (op: '>=' | '<=', n: number) => { predicate: (c: Country) => boolean },
 * }>}
 */
export const METRIC_TIER_REGISTRY = {
  population: { breaks: POPULATION_BREAKS_FOR_RANDOM, factory: population },
};

/** @typedef {{ value: string, op: '>=' | '<=', n: number, count: number }} MetricTierItem */

/**
 * Build the offerable tier pills for a metric against a country set: one item
 * per breakpoint, counted via the metric's own canonical predicate (never a
 * re-inlined `c.field >= n`), with 0-count tiers dropped so a surface only ever
 * offers a playable filter. `value` is the `${op}${n}` id suffix that
 * `pillLabel(metricKey, value, …)` decodes and that the `filter[metricKey]`
 * token serializes — so the same string flows from pill to filter to URL.
 *
 * @param {string} metricKey — a key of METRIC_TIER_REGISTRY.
 * @param {Country[]} countries — the scope to count tiers against.
 * @returns {MetricTierItem[]} tiers with at least one match, breakpoint order.
 */
export function buildMetricTierItems(metricKey, countries) {
  const entry = METRIC_TIER_REGISTRY[metricKey];
  if (!entry) return [];
  return entry.breaks
    .map(({ op, n }) => ({
      value: `${op}${n}`,
      op,
      n,
      count: countries.filter(entry.factory(op, n).predicate).length,
    }))
    .filter((it) => it.count > 0);
}
