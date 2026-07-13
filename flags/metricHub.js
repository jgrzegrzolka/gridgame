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
import { METRIC_ICONS, METRIC_HUES, METRIC_SHORT } from './metricVisuals.js';

/** @typedef {{ op: '>=' | '<=', n: number }} Tier */
/** @typedef {import('./metricTiers.js').MetricTierItem} MetricTierItem */

/** How many chips show before the "+ N more" toggle. Four keeps the row
 * (label + chips + the "+ N more" button) on ONE line inside flagsdata's
 * 756px column IN BOTH LANGUAGES; a wrapped button reads as a stray element
 * rather than the row's continuation. Five fit in English but Polish labels
 * run longer ("PKB na mieszkańca", "+ 14 więcej") and pushed the button onto
 * its own line, the exact bug the earlier six-chip cut had in English. */
export const DEFAULT_PRIMARY_COUNT = 4;

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
 * @property {boolean} [showCounts] render each tier's match count (findFlag).
 * @property {number} [primaryCount]
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
    showCounts = false,
    primaryCount = DEFAULT_PRIMARY_COUNT,
    label,
    doc = document,
  } = opts;

  /** @type {string | null} The metric whose panel is open. */
  let openKey = null;
  /** Whether the overflow chips (beyond primaryCount) are shown. */
  let expanded = false;

  const el = doc.createElement('div');
  el.className = 'mhub';

  const chipsRow = doc.createElement('div');
  chipsRow.className = 'mhub-chips';
  el.appendChild(chipsRow);

  if (label) {
    const labelEl = doc.createElement('span');
    labelEl.className = 'mhub-label';
    labelEl.setAttribute('data-i18n', label.key);
    labelEl.textContent = t(label.key, label.fallback);
    chipsRow.appendChild(labelEl);
  }

  /** @type {Array<{ key: string, btn: HTMLElement, labelSpan: HTMLElement, overflow: boolean }>} */
  const chips = [];
  metrics.forEach((m, i) => {
    const btn = doc.createElement('button');
    /** @type {any} */ (btn).type = 'button';
    btn.className = 'pill mhub-chip';
    btn.setAttribute('data-metric', m.key);
    btn.style.setProperty('--mc', METRIC_HUES[m.key] || 'currentColor');
    const ic = doc.createElement('span');
    ic.className = 'mhub-ic';
    ic.innerHTML = METRIC_ICONS[m.key] || '';
    btn.appendChild(ic);
    const labelSpan = doc.createElement('span');
    labelSpan.className = 'mhub-chip-label';
    labelSpan.textContent = shortLabel(m.key);
    btn.appendChild(labelSpan);
    const overflow = i >= primaryCount;
    if (overflow) btn.hidden = true;
    btn.addEventListener('click', () => togglePanel(m.key));
    chipsRow.appendChild(btn);
    chips.push({ key: m.key, btn, labelSpan, overflow });
  });

  // "+ N more" / "less" toggle, only when there IS an overflow. Sits last in
  // the row so it reads as the row's continuation either way.
  const overflowCount = Math.max(0, metrics.length - primaryCount);
  /** @type {HTMLElement | null} */
  let moreBtn = null;
  if (overflowCount > 0) {
    moreBtn = doc.createElement('button');
    /** @type {any} */ (moreBtn).type = 'button';
    moreBtn.className = 'pill mhub-more';
    moreBtn.textContent = moreLabel();
    moreBtn.addEventListener('click', () => {
      expanded = !expanded;
      // Collapsing while an overflow metric's panel is open would leave the
      // panel orphaned from a hidden chip, so close it: open always has a
      // visible chip to anchor to.
      if (!expanded && openKey && chips.some((c) => c.key === openKey && c.overflow)) {
        setOpen(null);
      }
      paintOverflow();
    });
    chipsRow.appendChild(moreBtn);
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

  function moreLabel() {
    return expanded
      ? t('metricHub.less', 'less')
      : `+ ${overflowCount} ${t('metricHub.more', 'more')}`;
  }

  function paintOverflow() {
    for (const c of chips) {
      if (c.overflow) c.btn.hidden = !expanded;
    }
    if (moreBtn) moreBtn.textContent = moreLabel();
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
    const key = openKey;
    panel.style.setProperty('--mc', METRIC_HUES[key] || 'currentColor');

    // Lead: icon + full metric name, so a unitless tier ("over 100K tonnes")
    // is never ambiguous about which fact it belongs to.
    const lead = doc.createElement('span');
    lead.className = 'mhub-panel-lead';
    const ic = doc.createElement('span');
    ic.className = 'mhub-ic';
    ic.innerHTML = METRIC_ICONS[key] || '';
    lead.appendChild(ic);
    const title = doc.createElement('span');
    title.className = 'mhub-panel-title';
    title.textContent = fullLabel(key);
    lead.appendChild(title);
    panel.appendChild(lead);

    if (panelExtras) {
      for (const extra of panelExtras(key)) panel.appendChild(extra);
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
      const on = openKey === c.key || getTier(c.key) !== null;
      c.btn.classList.toggle('on', on);
      c.btn.setAttribute('aria-pressed', String(on));
      c.btn.classList.toggle('is-open', openKey === c.key);
    }
    const tier = openKey !== null ? getTier(openKey) : null;
    for (const btn of /** @type {HTMLElement[]} */ (childrenOf(panel, 'mhub-tiers'))) {
      const value = btn.getAttribute('data-value');
      const active = tier !== null && value === `${tier.op}${tier.n}`;
      btn.classList.toggle('active', active);
    }
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
   * panel lead rebuild via renderPanel (labels only; open state kept). */
  function refreshI18n() {
    for (const c of chips) c.labelSpan.textContent = shortLabel(c.key);
    if (moreBtn) moreBtn.textContent = moreLabel();
    renderPanel();
    update();
  }

  update();

  return {
    el,
    update,
    refreshI18n,
    /** Close the panel (fires onPanelToggle(null) if it was open). */
    closePanel() { setOpen(null); },
    /** @returns {string | null} */
    getOpenKey() { return openKey; },
  };
}
