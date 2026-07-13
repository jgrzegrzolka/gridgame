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
 * Which items show on one line of `avail` width.
 *
 * Items are laid left to right with `gap` between neighbours. A PINNED item
 * (an applied filter: its pill is the only representation of its state, so
 * it must always be on screen) is always visible; unpinned items fill the
 * remaining budget in natural order, each acceptance reserving room for the
 * pinned items still ahead AND for the more-button UNLESS everything else
 * also fits (no button needed then). `alwaysMore` keeps the button
 * reservation even when everything fits, for rows whose button exists
 * regardless (the filter preview's "+ N more" opens the groups, it never
 * disappears).
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
 *   pinned?: boolean[],
 *   alwaysMore?: boolean,
 * }} opts
 * @returns {boolean[]} visibility per item, natural order preserved
 */
export function computeFitVisible({ avail, widths, moreWidth, gap, pinned, alwaysMore = false }) {
  const isPinned = (/** @type {number} */ i) => !!(pinned && pinned[i]);
  // Room the pinned items still ahead of the cursor will claim.
  let pinnedAhead = 0;
  for (let i = 0; i < widths.length; i++) {
    if (isPinned(i)) pinnedAhead += widths[i] + gap;
  }
  /** @type {boolean[]} */
  const visible = [];
  let used = 0;
  let shownAny = false;
  // Once one unpinned item is rejected, every later unpinned item is too:
  // the visible run must stay a clean prefix (plus pinned survivors) so the
  // more-button reads as "the rest", not as a gap in the middle of the line.
  let stopped = false;
  for (let i = 0; i < widths.length; i++) {
    const withGap = widths[i] + (shownAny ? gap : 0);
    if (isPinned(i)) {
      pinnedAhead -= widths[i] + gap;
      visible.push(true);
      used += withGap;
      shownAny = true;
      continue;
    }
    const anyLeftAfter = i < widths.length - 1;
    const reserve = anyLeftAfter || alwaysMore ? gap + moreWidth : 0;
    if (stopped || (shownAny && used + withGap + pinnedAhead + reserve > avail)) {
      visible.push(false);
      stopped = true;
      continue;
    }
    visible.push(true);
    used += withGap;
    shownAny = true;
  }
  return visible;
}

/**
 * How many leading items fit on one line (no pinning). Kept as the simple
 * counting face of {@link computeFitVisible}.
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
  return computeFitVisible({ avail, widths, moreWidth, gap, alwaysMore })
    .filter(Boolean).length;
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
 *   pinned?: boolean[],
 *   alwaysMore?: boolean,
 * }} opts elements need only a writable `hidden` (real DOM or test stubs).
 * @returns {number} the visible item count
 */
export function fitChipRow({ items, moreBtn, avail, gap, measure, pinned, alwaysMore = false }) {
  for (const el of items) el.hidden = false;
  if (moreBtn) moreBtn.hidden = false;
  const widths = items.map(measure);
  const moreWidth = moreBtn ? measure(moreBtn) : 0;
  const visible = computeFitVisible({ avail, widths, moreWidth, gap, pinned, alwaysMore });
  items.forEach((el, i) => { el.hidden = !visible[i]; });
  const shown = visible.filter(Boolean).length;
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
