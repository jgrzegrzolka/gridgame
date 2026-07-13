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
 *   'decimal1' → one decimal place for the readable range (135.1 / 4.5 / 0.1),
 *                but a genuine zero renders as a bare "0", and a tiny nonzero
 *                value (below 0.05, which one decimal would flatten to "0.0")
 *                keeps 2 significant figures instead. That matters for a
 *                top-heavy rate like sheep-per-capita: Poland's real 0.0074 must
 *                read as 0.0074, not as an indistinguishable-from-empty "0.0".
 *   'plain'    → exact integer with thousands separators (8,849), for metrics
 *                like elevation where the precise figure IS the point and
 *                compact would collapse 8,849 / 8,611 / 8,586 to "8.6K"
 *   'sig2'     → 2 significant figures, but never rounding away the whole
 *                integer part, with trailing zeros stripped. For a rate that
 *                spans orders of magnitude (sheep-per-capita: 135 down to
 *                0.0074), a fixed decimal count is wrong at one end or the other:
 *                one decimal flattens the tail to "0.0", four clutters the top.
 *                So: 135.135 → "135", 7.035 → "7", 4.535 → "4.5", 0.9 → "0.9",
 *                0.046 → "0.046", 0.0074 → "0.0074", and a true 0 → "0".
 * @param {number} value
 * @param {string} [format]
 * @returns {string}
 */
export function formatValue(value, format) {
  if (format === 'decimal1') {
    if (value === 0) return '0'; // a true zero, not a rounded-down tiny value
    // Below 0.05, toFixed(1) would print "0.0" and hide a real (if small) value;
    // show 2 significant figures instead (Number(...) drops any trailing zeros).
    if (Math.abs(value) < 0.05) return Number(value.toPrecision(2)).toString();
    return value.toFixed(1);
  }
  if (format === 'sig2') {
    if (value === 0) return '0';
    const abs = Math.abs(value);
    // Precision = 2 sig figs, or the integer-part length when that is larger, so
    // a big value keeps its whole part (135, not a 2-sig-fig "140"). Number(...)
    // then strips the trailing zeros a small value's toPrecision leaves (7.0 → 7).
    const intDigits = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 0;
    return Number(value.toPrecision(Math.max(2, intDigits))).toString();
  }
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
