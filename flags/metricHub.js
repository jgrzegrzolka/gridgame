/**
 * Metric hub, the shared "world facts" control: one icon chip per metric
 * (a primary handful visible, the rest behind "+ N more"), and a single
 * inline panel that opens under the row when a chip is tapped, holding that
 * metric's threshold tier pills (plus any consumer-supplied extras, e.g.
 * flagsdata's Highest / Lowest sort).
 *
 * Two consumers, one component (the reason it lives in flags/):
 *   - /flagsdata/ filter bar: panel open doubles as "lens on" via
 *     `onPanelToggle`, extras add the sort control, no tier counts.
 *   - /findFlag/ "Make a puzzle" chooser: plain tier picking with live
 *     match counts, no lens.
 *
 * The hub owns presentation state only (which panel is open, whether the
 * overflow is expanded). Filter state stays in the page's `Filters` object,
 * read through `getTier` / written through `onTierChange`, so the hub can't
 * drift from what `matchesFilters` actually applies.
 *
 * `doc` is injectable so the component is unit-testable with a stub document
 * (same pattern as flagFactsRender).
 */

import { pillLabel } from './findFlag.js';
import { METRIC_HUES, METRIC_SHORT, metricIconSpan } from './metricVisuals.js';
import { fitChipRow, rowGap } from './chipRowFit.js';

/** @typedef {{ op: '>=' | '<=', n: number }} Tier */
/** @typedef {import('./metricTiers.js').MetricTierItem} MetricTierItem */

/** Fallback for the chip row's flex gap when there's no layout to read it
 * from (tests, an unattached row). Must track .mhub-chips in metricHub.css. */
const GAP_FALLBACK = 6;

/**
 * @typedef {Object} MetricHubOptions
 * @property {(key: string, fallback: string) => string} t
 * @property {Array<{ key: string, label: string }>} metrics registry entries
 *   (METRIC_FILES shape); `label` is the English full-name fallback behind
 *   the `metric.<key>` i18n key, used for the panel lead.
 * @property {(key: string) => MetricTierItem[]} tierItems counted tiers for a
 *   metric (buildMetricTierItems against the page's country set).
 * @property {(key: string) => (Tier | null)} getTier the applied tier.
 * @property {(key: string, tier: Tier | null) => void} onTierChange apply /
 *   clear a tier. The hub repaints itself afterwards; the consumer re-runs
 *   its own filter pipeline.
 * @property {(key: string | null) => void} [onPanelToggle] fired after the
 *   open panel changes (`null` = closed). flagsdata drives its lens off this.
 * @property {(key: string) => Element[]} [panelExtras] consumer controls
 *   rendered between the panel lead and the tier pills, rebuilt per open.
 * @property {(key: string) => string} [resolveKey] map a CHIP key to the metric
 *   key its panel currently represents (default: identity). flagsdata passes
 *   this so one chip can stand for a metric and its normalised cut — "GDP" the
 *   chip reads `gdp` or `gdpPerCapita` depending on the cut chosen inside the
 *   panel (see flags/metricCuts.js). Everything that treats a key as DATA goes
 *   through it — the panel's hue, its title, its tiers and the tier
 *   get/set — while the chip's own identity, icon and label stay on its own
 *   key. Consumers that change what it returns must call `refreshPanel()`.
 * @property {boolean} [showCounts] render each tier's match count (findFlag).
 * @property {boolean} [moreButton] render the hub's own "+ N more" / "less"
 *   toggle (default true). flagsdata passes false: its single bar
 *   toggle drives the hub through `setExpanded` instead, so filters and
 *   world facts expand and collapse as one.
 * @property {boolean} [expandAll] pin the row fully expanded: every chip is
 *   shown (the row wraps), the fill-to-fit collapse is skipped, and no
 *   "+ N more" toggle renders (default false). findFlag passes true so the
 *   World-facts chips read like its other filter sections, which all show
 *   every option, rather than collapsing behind a "+ N more" that reads oddly
 *   in a stacked, room-to-wrap section.
 * @property {{ avail?: () => number, measure?: (el: any) => number }} [fit]
 *   measurement overrides for the fill-to-fit layout: `avail` returns the
 *   row width to fill, `measure` an element's width. Defaults read the live
 *   DOM; tests inject synthetic widths.
 * @property {{ key: string, fallback: string }} [label] optional row label
 *   leading the chips ("World facts"); flagsdata's filter bar uses it,
 *   findFlag brings its own section heading instead. Carries data-i18n so
 *   the upstream applyStringsToDocument re-translates it.
 * @property {Document} [doc]
 */

/**
 * @param {MetricHubOptions} opts
 */
export function createMetricHub(opts) {
  const {
    t,
    metrics,
    tierItems,
    getTier,
    onTierChange,
    onPanelToggle,
    panelExtras,
    resolveKey = (key) => key,
    showCounts = false,
    moreButton = true,
    expandAll = false,
    fit = {},
    label,
    doc = document,
  } = opts;

  /** @type {string | null} The metric whose panel is open. */
  let openKey = null;
  /** Whether the row is expanded to every chip (multi-line) via "+ N more".
   * `expandAll` pins this true for the whole life of the hub. */
  let expanded = expandAll;

  const el = doc.createElement('div');
  el.className = 'mhub';

  const chipsRow = doc.createElement('div');
  chipsRow.className = 'mhub-chips';
  el.appendChild(chipsRow);

  /** @type {HTMLElement | null} */
  let labelEl = null;
  if (label) {
    labelEl = doc.createElement('span');
    labelEl.className = 'mhub-label';
    labelEl.setAttribute('data-i18n', label.key);
    labelEl.textContent = t(label.key, label.fallback);
    chipsRow.appendChild(labelEl);
  }

  /** @type {Array<{ key: string, btn: HTMLElement, labelSpan: HTMLElement }>} */
  const chips = [];
  metrics.forEach((m) => {
    const btn = doc.createElement('button');
    /** @type {any} */ (btn).type = 'button';
    btn.className = 'pill mhub-chip';
    btn.setAttribute('data-metric', m.key);
    btn.style.setProperty('--mc', METRIC_HUES[m.key] || 'currentColor');
    btn.appendChild(metricIconSpan(m.key, 'mhub-ic', doc));
    const labelSpan = doc.createElement('span');
    labelSpan.className = 'mhub-chip-label';
    labelSpan.textContent = shortLabel(m.key);
    btn.appendChild(labelSpan);
    btn.addEventListener('click', () => togglePanel(m.key));
    chipsRow.appendChild(btn);
    chips.push({ key: m.key, btn, labelSpan });
  });

  // "+ N more" / "less" toggle, last in the row so it reads as the row's
  // continuation. How many chips it hides is decided by refit() (fill-to-fit
  // against the live row width), never by a hardcoded count: fixed counts
  // kept wrapping the button onto its own line in one language or another.
  // Omitted when a consumer drives the expansion externally (setExpanded).
  /** @type {HTMLElement | null} */
  let moreBtn = null;
  if (moreButton && !expandAll) {
    moreBtn = doc.createElement('button');
    /** @type {any} */ (moreBtn).type = 'button';
    moreBtn.className = 'pill mhub-more';
    moreBtn.addEventListener('click', () => setExpanded(!expanded));
    chipsRow.appendChild(moreBtn);
  }

  /**
   * Expand to every chip / collapse back to the fitted line. Folding does
   * NOT close an open metric's panel: on flagsdata the whole hub hides with
   * the fold anyway, and keeping the state means the lens (values on the
   * tiles) survives the fold and the panel is where you left it on
   * re-expand. Jan's call: collapsing must not clear the population/GDP
   * numbers off the flags.
   * @param {boolean} open
   */
  function setExpanded(open) {
    expanded = open;
    refit();
  }

  const panel = doc.createElement('div');
  panel.className = 'mhub-panel';
  panel.hidden = true;
  el.appendChild(panel);

  /** @param {string} key */
  function shortLabel(key) {
    const s = METRIC_SHORT[key];
    return s ? t(s.key, s.fallback) : key;
  }

  /** An element's width for the fit. Injectable; the default needs layout. */
  const measure = fit.measure || ((el) => el.getBoundingClientRect().width);
  /** The chip row width to fill, minus the leading label's slice of it. */
  function availWidth() {
    const row = fit.avail ? fit.avail() : /** @type {any} */ (chipsRow).clientWidth || 0;
    if (!labelEl) return row;
    return row - measure(labelEl) - rowGap(chipsRow, GAP_FALLBACK);
  }

  /**
   * Fill-to-fit pass over the chip row. Collapsed: show as many chips as the
   * current width allows, "+ N more" ends the same line with the honest
   * remainder (hidden entirely when everything fits). Expanded: every chip
   * shows (the row wraps) and the button reads "less". Re-run on the toggle,
   * on resize, and on a language switch (labels change widths).
   */
  function refit() {
    if (expanded || expandAll) {
      for (const c of chips) c.btn.hidden = false;
      if (moreBtn) {
        moreBtn.hidden = false;
        moreBtn.textContent = t('metricHub.less', 'less');
      }
      return;
    }
    // Measure against the widest label the button can carry (the full chip
    // total), then write the real remainder over it.
    if (moreBtn) moreBtn.textContent = `+ ${chips.length} ${t('metricHub.more', 'more')}`;
    const shown = fitChipRow({
      items: chips.map((c) => c.btn),
      moreBtn,
      avail: availWidth(),
      gap: rowGap(chipsRow, GAP_FALLBACK),
      measure,
      // An applied metric's chip is the ONLY representation of its state
      // (there is no chips row), so it is pinned always-visible; same for
      // the open panel's chip, which anchors the panel.
      pinned: chips.map((c) => getTier(c.key) !== null || openKey === c.key),
    });
    if (moreBtn && shown < chips.length) {
      moreBtn.textContent = `+ ${chips.length - shown} ${t('metricHub.more', 'more')}`;
    }
  }

  /** @param {string} key */
  function togglePanel(key) {
    setOpen(openKey === key ? null : key);
  }

  /** @param {string | null} key */
  function setOpen(key) {
    if (openKey === key) return;
    openKey = key;
    renderPanel();
    update();
    if (onPanelToggle) onPanelToggle(openKey);
  }

  /** Rebuild the panel for the open metric (or empty it when closed).
   * Tiers are re-counted on every open so a consumer whose country set
   * changed (findFlag's scope toggle) never shows stale counts. */
  function renderPanel() {
    panel.innerHTML = '';
    panel.hidden = openKey === null;
    if (openKey === null) return;
    // The chip that is open vs the metric it currently reads. They differ only
    // for a consumer using `resolveKey` (flagsdata's cuts); `chipKey` stays the
    // identity the extras and the toggle speak, `key` is the data.
    const chipKey = openKey;
    const key = resolveKey(chipKey);
    panel.style.setProperty('--mc', METRIC_HUES[key] || 'currentColor');

    // Lead: icon + full metric name, so a unitless tier ("over 100K tonnes")
    // is never ambiguous about which fact it belongs to.
    const lead = doc.createElement('span');
    lead.className = 'mhub-panel-lead';
    lead.appendChild(metricIconSpan(key, 'mhub-ic', doc));
    const title = doc.createElement('span');
    title.className = 'mhub-panel-title';
    title.textContent = fullLabel(key);
    lead.appendChild(title);
    panel.appendChild(lead);

    // Extras are the consumer's own controls, so they get the CHIP key: on
    // flagsdata the cut control is what decides which metric `key` resolved to,
    // and handing it the resolved key would make it argue with itself.
    if (panelExtras) {
      for (const extra of panelExtras(chipKey)) panel.appendChild(extra);
    }

    const tiersWrap = doc.createElement('div');
    tiersWrap.className = 'mhub-tiers';
    for (const it of tierItems(key)) {
      const btn = doc.createElement('button');
      /** @type {any} */ (btn).type = 'button';
      btn.className = 'pill';
      btn.setAttribute('data-value', it.value);
      const labelSpan = doc.createElement('span');
      labelSpan.className = 'pill-label';
      labelSpan.textContent = pillLabel(/** @type {any} */ (key), it.value, 'include', t);
      btn.appendChild(labelSpan);
      if (showCounts) {
        const countSpan = doc.createElement('span');
        countSpan.className = 'pill-count';
        countSpan.textContent = String(it.count);
        btn.appendChild(countSpan);
      }
      btn.addEventListener('click', () => {
        const cur = getTier(key);
        const isSame = cur !== null && cur.op === it.op && cur.n === it.n;
        // Single-select scalar: tapping the active tier clears it, tapping
        // any other replaces it (two thresholds can never both apply).
        onTierChange(key, isSame ? null : { op: it.op, n: it.n });
        update();
      });
      tiersWrap.appendChild(btn);
    }
    panel.appendChild(tiersWrap);
  }

  /** @param {string} key */
  function fullLabel(key) {
    const m = metrics.find((x) => x.key === key);
    return t(`metric.${key}`, m ? m.label : key);
  }

  /**
   * Repaint active states from filter state: a chip is "on" when its panel is
   * open or its tier is applied; a tier pill is "active" when it IS the
   * applied tier. Call after any external filter change (chip-row ×, Clear).
   */
  function update() {
    for (const c of chips) {
      const on = openKey === c.key || getTier(resolveKey(c.key)) !== null;
      c.btn.classList.toggle('on', on);
      c.btn.setAttribute('aria-pressed', String(on));
      c.btn.classList.toggle('is-open', openKey === c.key);
    }
    const tier = openKey !== null ? getTier(resolveKey(openKey)) : null;
    for (const btn of /** @type {HTMLElement[]} */ (childrenOf(panel, 'mhub-tiers'))) {
      const value = btn.getAttribute('data-value');
      const active = tier !== null && value === `${tier.op}${tier.n}`;
      btn.classList.toggle('active', active);
    }
    // Applied/open state drives the fit's pinning, so every state repaint
    // re-fits the row (cheap: one measure pass over the chips).
    refit();
  }

  /**
   * The tier-pill buttons inside the panel's tiers wrap (empty when closed).
   * Walked via childNodes-free references so a stub document (no live
   * querySelectorAll) can drive tests.
   * @param {HTMLElement} root @param {string} wrapClass
   * @returns {Element[]}
   */
  function childrenOf(root, wrapClass) {
    /** @type {Element[]} */
    const out = [];
    const kids = /** @type {any} */ (root).children || [];
    for (const kid of kids) {
      if (typeof kid.className === 'string' && kid.className.split(' ').includes(wrapClass)) {
        for (const btn of /** @type {any} */ (kid).children || []) out.push(btn);
      }
    }
    return out;
  }

  /** Re-translate every label the hub painted with t(). Tier pills and the
   * panel lead rebuild via renderPanel (labels only; open state kept); the
   * refit re-measures because translated labels change chip widths. */
  function refreshI18n() {
    for (const c of chips) c.labelSpan.textContent = shortLabel(c.key);
    renderPanel();
    update();
    refit();
  }

  update();
  // The consumer appends `el` right after this constructor returns, so at
  // update()'s refit above there was no layout to measure (min-1 fallback). Run
  // a real pass on the next frame, and keep the row one line across window
  // resizes. Browser-only wiring; tests inject `fit` and drive refit()
  // synchronously instead.
  if (typeof requestAnimationFrame === 'function' && !fit.avail) {
    requestAnimationFrame(refit);
  }
  if (typeof window !== 'undefined' && window.addEventListener && !fit.avail) {
    /** @type {number} */
    let raf = 0;
    window.addEventListener('resize', () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refit);
    });
  }

  return {
    el,
    update,
    refreshI18n,
    refit,
    setExpanded,
    /** How many chips the collapsed fit hid (for an external toggle's count). */
    hiddenChipCount() { return chips.filter((c) => c.btn.hidden).length; },
    /** Close the panel (fires onPanelToggle(null) if it was open). */
    closePanel() { setOpen(null); },
    /**
     * Rebuild the open panel in place, without closing it or re-firing
     * onPanelToggle. For a consumer whose `resolveKey` changed under the same
     * chip (flagsdata switching a metric's cut): the title, hue and tier pills
     * all describe the resolved metric, so they must be re-read, but the panel
     * never blinks shut and the lens stays on.
     */
    refreshPanel() { renderPanel(); update(); },
    /** @returns {string | null} */
    getOpenKey() { return openKey; },
  };
}
