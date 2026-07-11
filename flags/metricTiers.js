/** @typedef {import('./group.js').Country} Country */

import { POPULATION_BREAKS_FOR_RANDOM, population, AREA_BREAKS_FOR_RANDOM, area } from './engine.js';

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
 * `has(country)` answers "does this country carry a value for the metric?" —
 * the metric map is sparse (population omits uninhabited territories and the
 * org "flags"), and a threshold predicate silently fails a country with no
 * value. TTT reads this to disable such a guess with a "no data" label so a
 * data gap can't cost the player a cell (see `metricDataGap`).
 *
 * @type {Record<string, {
 *   breaks: ReadonlyArray<{ op: '>=' | '<=', n: number }>,
 *   factory: (op: '>=' | '<=', n: number) => { predicate: (c: Country) => boolean },
 *   has: (c: Country) => boolean,
 * }>}
 */
export const METRIC_TIER_REGISTRY = {
  population: {
    breaks: POPULATION_BREAKS_FOR_RANDOM,
    factory: population,
    has: (c) => typeof c.population === 'number',
  },
  area: {
    breaks: AREA_BREAKS_FOR_RANDOM,
    factory: area,
    has: (c) => typeof c.area === 'number',
  },
};

/**
 * The registered metric a category keys on, or null. Prefers `exclusiveGroup`
 * (present on full offline Category objects), and falls back to the `id` prefix
 * (`population:>=10000000` → `population`). The fallback matters online: the
 * puzzle crosses a WebSocket as JSON, so the predicate is gone and only string
 * fields survive — `id` is always sent (label rendering needs it) but
 * `exclusiveGroup` may not be. By convention the factory sets both to the metric
 * name, so either source resolves to the same key.
 *
 * @param {{ exclusiveGroup?: string, id?: string } | null | undefined} cat
 * @returns {string | null}
 */
export function metricKeyOfCategory(cat) {
  if (!cat) return null;
  if (cat.exclusiveGroup && METRIC_TIER_REGISTRY[cat.exclusiveGroup]) return cat.exclusiveGroup;
  if (typeof cat.id === 'string') {
    const i = cat.id.indexOf(':');
    const prefix = i > 0 ? cat.id.slice(0, i) : '';
    if (prefix && METRIC_TIER_REGISTRY[prefix]) return prefix;
  }
  return null;
}

/**
 * A TTT cell keys on two categories (its row + col). If either is a
 * threshold-metric axis (e.g. `population`) for which `country` carries no
 * value, that country can never satisfy the cell — but the player has no way to
 * know our data lacks the value, so letting them pick it would cost a cell to a
 * data gap, not a wrong guess. This returns the offending metric key so the
 * picker can show the suggestion disabled with a "no data" label; `null` when
 * the country is a fair guess (it has data for every metric axis, or the cell
 * has no metric axis).
 *
 * Metric-general by construction: any future threshold metric added to
 * `METRIC_TIER_REGISTRY` (with its `has`) is covered with no change here.
 *
 * @param {ReadonlyArray<{ exclusiveGroup?: string, id?: string } | null | undefined>} categories
 * @param {Country} country
 * @returns {string | null} the metric key with no data, or null
 */
export function metricDataGap(categories, country) {
  for (const cat of categories) {
    const key = metricKeyOfCategory(cat);
    if (key && !METRIC_TIER_REGISTRY[key].has(country)) return key;
  }
  return null;
}

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
