/**
 * Bar geometry for Flag Party's world-facts reveal chart. Pure — no DOM.
 *
 * Split out of `flagParty/page.js` because it is real arithmetic with a
 * correctness property worth pinning, not rendering glue: it decides how long
 * each country's bar is, and getting it wrong is silent (a bar of the wrong
 * length still looks like a bar).
 */

/**
 * Bar length for each ranked option, as a fraction in [0, 1].
 *
 * Normalised across the quartet's own range rather than `value / max`. Some
 * metrics go negative — temperature bottoms out at -49C — and `value / max`
 * yields a negative width there, which renders as no bar at all rather than as
 * an obviously wrong one. Anchoring the floor at `min(0, smallest)` keeps the
 * natural "share of the biggest" reading for the all-positive metrics, which is
 * nearly all of them: when nothing is negative the floor is 0 and this reduces
 * exactly to `value / max`.
 *
 * A missing or non-numeric value counts as 0 rather than throwing. The reveal
 * carries values for every option it ranks, so a gap means a stale or partial
 * server payload, and a short bar beats a broken chart.
 *
 * @param {string[]} ranking  option codes, best-first in the question's direction
 * @param {Record<string, number> | null | undefined} values  raw metric value per code
 * @returns {number[]} one fraction per entry of `ranking`, in the same order
 */
export function barFractions(ranking, values) {
  const codes = Array.isArray(ranking) ? ranking : [];
  if (codes.length === 0) return [];
  const src = values || {};
  const nums = codes.map((c) => {
    const v = src[c];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  });
  const hi = Math.max(...nums);
  const lo = Math.min(0, ...nums);
  // Every value identical (including all-zero) leaves no range to normalise
  // against; a full bar each is the honest reading of "these are the same".
  const span = hi - lo || 1;
  return nums.map((n) => {
    const frac = (n - lo) / span;
    return Math.max(0, Math.min(1, frac));
  });
}
