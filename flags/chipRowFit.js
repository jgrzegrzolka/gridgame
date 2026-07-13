/**
 * Fill-to-fit for a one-line chip row: show as many leading chips as the
 * available width allows, with a "+ N more" button always ending the SAME
 * line. Replaces hardcoded visible-chip counts, which kept breaking (six
 * wrapped in English, five wrapped in Polish, four wasted wide screens and
 * would break on the next long label).
 *
 * Two layers so the arithmetic is unit-testable without a DOM:
 *   - computeFitCount: pure. Widths in, visible count out.
 *   - fitChipRow: the thin DOM applier. Measures, calls the pure core,
 *     toggles `hidden` on the overflow.
 *
 * Consumers: the metric hub's chip row (flags/metricHub.js, both pages) and
 * flagsdata's teaser filter row.
 */

/**
 * How many leading items fit on one line of `avail` width.
 *
 * Items are laid left to right with `gap` between neighbours. Accepting an
 * item reserves room for the more-button after it UNLESS every remaining
 * item also fits (no button needed then), so the button can never be pushed
 * to a second line. `alwaysMore` keeps the reservation even when everything
 * fits, for rows whose button exists regardless (the teaser row's "+ N
 * more" opens the filter groups, it never disappears).
 *
 * At least one item is always shown: a row that can't even hold its first
 * chip plus the button may overflow (and flex-wrap), which beats rendering
 * a row of nothing but "+ 19 more".
 *
 * @param {{
 *   avail: number,
 *   widths: number[],
 *   moreWidth: number,
 *   gap: number,
 *   alwaysMore?: boolean,
 * }} opts
 * @returns {number} how many leading items to show (0 only for empty input)
 */
export function computeFitCount({ avail, widths, moreWidth, gap, alwaysMore = false }) {
  let used = 0;
  let shown = 0;
  for (let i = 0; i < widths.length; i++) {
    const withGap = widths[i] + (shown > 0 ? gap : 0);
    const anyLeftAfter = i < widths.length - 1;
    const reserve = anyLeftAfter || alwaysMore ? gap + moreWidth : 0;
    if (shown > 0 && used + withGap + reserve > avail) break;
    used += withGap;
    shown++;
  }
  return shown;
}

/**
 * Apply fill-to-fit to a live row: unhide everything, measure, hide the
 * overflow. The caller owns the more-button's label; because the label's
 * width depends on the count it reports, set it to its WIDEST plausible text
 * before calling (e.g. the full item total) and to the real text after.
 *
 * `measure` / `avail` are injectable so a stub-document test can drive the
 * layout with synthetic widths.
 *
 * @param {{
 *   items: any[],
 *   moreBtn: any,
 *   avail: number,
 *   gap: number,
 *   measure: (el: any) => number,
 *   alwaysMore?: boolean,
 * }} opts elements need only a writable `hidden` (real DOM or test stubs).
 * @returns {number} the visible item count
 */
export function fitChipRow({ items, moreBtn, avail, gap, measure, alwaysMore = false }) {
  for (const el of items) el.hidden = false;
  if (moreBtn) moreBtn.hidden = false;
  const widths = items.map(measure);
  const moreWidth = moreBtn ? measure(moreBtn) : 0;
  const shown = computeFitCount({ avail, widths, moreWidth, gap, alwaysMore });
  items.forEach((el, i) => { el.hidden = i >= shown; });
  if (moreBtn && !alwaysMore) moreBtn.hidden = shown >= items.length;
  return shown;
}

/**
 * The row's horizontal gap from its computed style, for callers that lay
 * chips out with CSS `gap`. Falls back when there's no layout (tests, an
 * unattached row).
 *
 * @param {any} el @param {number} fallback
 * @returns {number}
 */
export function rowGap(el, fallback) {
  if (typeof getComputedStyle !== 'function') return fallback;
  const g = parseFloat(getComputedStyle(el).columnGap);
  return Number.isFinite(g) ? g : fallback;
}
