/**
 * Registry of world metrics. Explicit imports (not a glob) so a missing or
 * malformed metric file fails loudly at the entry point — same rule the API's
 * function registry follows. Add a metric: drop `<key>.json` in this folder and
 * add one line here.
 *
 * Each value is raw MetricData ({ key, label, unit, source, year, values }).
 * Wrap it with createMetric(metric, countries) from ../metrics.js to get the
 * ranked/tiered/compare surface.
 */

import population from './population.json' with { type: 'json' };

/** @type {Record<string, import('../metrics.js').MetricData>} */
export const METRICS = {
  population,
};
