/**
 * Pure view logic for the flagsdata metric lens: given the active metric (a
 * createMetric instance, or null for "no lens") and the list of countries,
 * decide the display order and the per-tile overlay. No DOM — the page applies
 * the result. Kept here (not in the page) so the ordering + sparse rules are
 * unit-tested; the page stays thin glue.
 *
 * Rank is taken in 'sovereign' scope — only the 195 sovereign states get a
 * number, so "#12" reads as "12th country" and isn't diluted by territories or
 * partially-recognised states. Non-sovereign places (territories, non-UN states,
 * org flags) still show their value, just without a rank. Countries the metric
 * doesn't cover ("no data") always sink to the bottom of a sorted view and are
 * flagged so the page can dim them.
 */

/**
 * Format a metric value for the compact tile overlay.
 *   'compact'  → 27.81T / 1.44B / 336.8M / 552.7K / 800
 *   'decimal1' → one decimal place (small per-capita rates)
 *   'plain'    → exact integer with thousands separators (8,849), for metrics
 *                like elevation where the precise figure IS the point and
 *                compact would collapse 8,849 / 8,611 / 8,586 to "8.6K"
 * @param {number} value
 * @param {string} [format]
 * @returns {string}
 */
export function formatValue(value, format) {
  if (format === 'decimal1') return value.toFixed(1);
  // Deterministic thousands grouping (no locale dependence across Node/browser).
  if (format === 'plain') {
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const abs = Math.abs(value);
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + 'T'; // GDP reaches trillions
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return String(value);
}

/**
 * @typedef {Object} MetricLike
 * @property {(code: string) => boolean} has
 * @property {(code: string) => (number | undefined)} valueOf
 * @property {(code: string, scope: string) => (number | null)} rankOf
 * @property {string} [format]
 */

/**
 * @typedef {Object} LensCell
 * @property {boolean} hasData
 * @property {number | null} value
 * @property {string} display   formatted value, or '' when no data
 * @property {number | null} rank  1-based rank among sovereign states, or null
 *   for a non-sovereign place (it has a value but sits outside the ranking)
 */

/**
 * @param {MetricLike | null} metric
 * @param {{ code: string }[]} items
 * @param {{ sort?: 'default' | 'desc' | 'asc' }} [opts]
 * @returns {{ order: number[], cells: LensCell[] }}
 */
export function computeLensView(metric, items, opts = {}) {
  const sort = opts.sort || 'default';

  /** @type {LensCell[]} */
  const cells = items.map((c) => {
    if (!metric || !metric.has(c.code)) {
      return { hasData: false, value: null, display: '', rank: null };
    }
    const value = /** @type {number} */ (metric.valueOf(c.code));
    return {
      hasData: true,
      value,
      display: formatValue(value, metric.format),
      rank: metric.rankOf(c.code, 'sovereign'),
    };
  });

  const order = items.map((_, i) => i);
  if (metric && sort !== 'default') {
    order.sort((a, b) => {
      const ca = cells[a];
      const cb = cells[b];
      if (ca.hasData !== cb.hasData) return ca.hasData ? -1 : 1; // no-data sinks
      if (!ca.hasData) return a - b; // keep original order among no-data
      const va = /** @type {number} */ (ca.value);
      const vb = /** @type {number} */ (cb.value);
      return sort === 'asc' ? va - vb : vb - va;
    });
  }
  return { order, cells };
}
