import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMetricHub } from './metricHub.js';
import { METRIC_FILES } from './metrics/index.js';

/** Synthetic width for the fill-to-fit layout: text length driven, so the
 * tests exercise the same "labels change widths" behaviour the browser has. */
const widthOf = (/** @type {any} */ el) => ((el && el.textContent) || '').length * 7 + 30;
/** A row width that fits every chip (fill-to-fit hides the more button). */
const WIDE = { avail: () => 100000, measure: widthOf };
/** A row width that forces an overflow. */
const NARROW = { avail: () => 400, measure: widthOf };

/**
 * Stub document, just enough surface for the hub: className / classList,
 * children with an innerHTML-set-clears-them contract (matching the real
 * DOM behaviour renderPanel relies on), attributes, click handlers.
 */
function makeDoc() {
  function makeEl(/** @type {string} */ tag) {
    /** @type {string[]} */
    const classes = [];
    /** @type {Record<string, string>} */
    const attrs = {};
    /** @type {Record<string, Array<() => void>>} */
    const handlers = {};
    let html = '';
    /** @type {any} */
    const el = {
      tag,
      textContent: '',
      hidden: false,
      children: /** @type {any[]} */ ([]),
      style: {
        /** @type {Record<string, string>} */
        props: {},
        setProperty(/** @type {string} */ k, /** @type {string} */ v) { this.props[k] = v; },
      },
      get className() { return classes.join(' '); },
      set className(/** @type {string} */ v) { classes.length = 0; classes.push(...v.split(' ').filter(Boolean)); },
      classList: {
        toggle(/** @type {string} */ c, /** @type {boolean} */ force) {
          const has = classes.includes(c);
          const want = force === undefined ? !has : force;
          if (want && !has) classes.push(c);
          if (!want && has) classes.splice(classes.indexOf(c), 1);
        },
        contains(/** @type {string} */ c) { return classes.includes(c); },
      },
      get innerHTML() { return html; },
      set innerHTML(/** @type {string} */ v) { html = v; if (v === '') el.children.length = 0; },
      appendChild(/** @type {any} */ c) { el.children.push(c); return c; },
      setAttribute(/** @type {string} */ k, /** @type {string} */ v) { attrs[k] = v; },
      getAttribute(/** @type {string} */ k) { return k in attrs ? attrs[k] : null; },
      addEventListener(/** @type {string} */ type, /** @type {() => void} */ fn) {
        (handlers[type] = handlers[type] || []).push(fn);
      },
      click() { for (const fn of handlers.click || []) fn(); },
    };
    return el;
  }
  return /** @type {any} */ ({ createElement: makeEl });
}

/** Identity translator: always the fallback. */
const t = (/** @type {string} */ _k, /** @type {string} */ fallback) => fallback;

/** Find descendants by class name in the stub tree. */
function byClass(/** @type {any} */ root, /** @type {string} */ cls) {
  /** @type {any[]} */
  const out = [];
  (function walk(/** @type {any} */ node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.className === 'string' && node.className.split(' ').includes(cls)) out.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(root);
  return out;
}

const TIERS = {
  population: [
    { value: '>=100000000', op: /** @type {'>='} */ ('>='), n: 100000000, count: 15 },
    { value: '>=10000000', op: /** @type {'>='} */ ('>='), n: 10000000, count: 98 },
  ],
  coffee: [
    { value: '>=100000', op: /** @type {'>='} */ ('>='), n: 100000, count: 17 },
  ],
};

/** A hub over the real registry with a controllable filter map. Wide fit by
 * default so every chip is visible unless a test narrows the row. */
function makeHub(/** @type {Partial<import('./metricHub.js').MetricHubOptions>} */ overrides = {}) {
  /** @type {Record<string, { op: '>=' | '<=', n: number } | null>} */
  const filter = {};
  /** @type {Array<string | null>} */
  const toggles = [];
  const hub = createMetricHub({
    doc: makeDoc(),
    t,
    metrics: METRIC_FILES,
    tierItems: (key) => /** @type {any} */ (TIERS)[key] || [],
    getTier: (key) => filter[key] || null,
    onTierChange: (key, tier) => { filter[key] = tier; },
    onPanelToggle: (key) => toggles.push(key),
    fit: WIDE,
    ...overrides,
  });
  return { hub, filter, toggles };
}

function chipFor(/** @type {any} */ hub, /** @type {string} */ key) {
  return byClass(hub.el, 'mhub-chip').find((c) => c.getAttribute('data-metric') === key);
}

test('renders one chip per registered metric; a wide row shows all, no more button', () => {
  const { hub } = makeHub();
  const chips = byClass(hub.el, 'mhub-chip');
  assert.equal(chips.length, METRIC_FILES.length);
  assert.equal(chips.filter((c) => c.hidden).length, 0);
  assert.equal(byClass(hub.el, 'mhub-more')[0].hidden, true);
});

test('a narrow row fits what it can and the more button carries the honest remainder', () => {
  const { hub } = makeHub({ fit: NARROW });
  const visible = byClass(hub.el, 'mhub-chip').filter((c) => !c.hidden).length;
  assert.ok(visible >= 1 && visible < METRIC_FILES.length, `visible=${visible}`);
  const more = byClass(hub.el, 'mhub-more')[0];
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, `+ ${METRIC_FILES.length - visible} more`);
});

test('the more button expands to every chip and collapses back to the fit', () => {
  const { hub } = makeHub({ fit: NARROW });
  const fitted = byClass(hub.el, 'mhub-chip').filter((c) => !c.hidden).length;
  const more = byClass(hub.el, 'mhub-more')[0];
  more.click();
  assert.equal(byClass(hub.el, 'mhub-chip').filter((c) => c.hidden).length, 0);
  assert.equal(more.textContent, 'less');
  more.click();
  assert.equal(byClass(hub.el, 'mhub-chip').filter((c) => !c.hidden).length, fitted);
});

test('growing the row width reveals more chips on refit (resize path)', () => {
  let avail = 400;
  const { hub } = makeHub({ fit: { avail: () => avail, measure: widthOf } });
  const countVisible = () => byClass(hub.el, 'mhub-chip').filter((c) => !c.hidden).length;
  const narrow = countVisible();
  avail = 900;
  hub.refit();
  assert.ok(countVisible() > narrow, `${countVisible()} should exceed ${narrow}`);
});

test('chip click opens the panel with lead + tier pills and fires onPanelToggle', () => {
  const { hub, toggles } = makeHub();
  chipFor(hub, 'population').click();
  const panel = byClass(hub.el, 'mhub-panel')[0];
  assert.equal(panel.hidden, false);
  assert.equal(byClass(panel, 'mhub-panel-title')[0].textContent, 'Population');
  const pills = byClass(panel, 'pill-label').map((s) => s.textContent);
  assert.deepEqual(pills, ['over 100M people', 'over 10M people']);
  assert.deepEqual(toggles, ['population']);
  assert.equal(hub.getOpenKey(), 'population');
});

test('tapping the open chip again closes the panel', () => {
  const { hub, toggles } = makeHub();
  chipFor(hub, 'population').click();
  chipFor(hub, 'population').click();
  assert.equal(byClass(hub.el, 'mhub-panel')[0].hidden, true);
  assert.deepEqual(toggles, ['population', null]);
  assert.equal(hub.getOpenKey(), null);
});

test('tier pills single-select: pick applies, re-pick clears, other replaces', () => {
  const { hub, filter } = makeHub();
  chipFor(hub, 'population').click();
  const panel = byClass(hub.el, 'mhub-panel')[0];
  const [t100m, t10m] = byClass(panel, 'mhub-tiers')[0].children;
  t100m.click();
  assert.deepEqual(filter.population, { op: '>=', n: 100000000 });
  assert.ok(t100m.classList.contains('active'));
  t10m.click();
  assert.deepEqual(filter.population, { op: '>=', n: 10000000 });
  assert.ok(!t100m.classList.contains('active'));
  assert.ok(t10m.classList.contains('active'));
  t10m.click();
  assert.equal(filter.population, null);
  assert.ok(!t10m.classList.contains('active'));
});

test('a chip stays on after its panel closes while its tier is applied', () => {
  const { hub, filter } = makeHub();
  chipFor(hub, 'population').click();
  byClass(hub.el, 'mhub-tiers')[0].children[0].click();
  chipFor(hub, 'population').click(); // close panel, tier stays
  assert.deepEqual(filter.population, { op: '>=', n: 100000000 });
  assert.ok(chipFor(hub, 'population').classList.contains('on'));
  assert.ok(!chipFor(hub, 'population').classList.contains('is-open'));
  // external clear (the page's Clear button) + update() drops the chip state
  filter.population = null;
  hub.update();
  assert.ok(!chipFor(hub, 'population').classList.contains('on'));
});

test('opening a second metric swaps the panel in place', () => {
  const { hub, toggles } = makeHub();
  chipFor(hub, 'population').click();
  chipFor(hub, 'coffee').click();
  const panel = byClass(hub.el, 'mhub-panel')[0];
  assert.equal(byClass(panel, 'mhub-panel-title')[0].textContent, 'Coffee production');
  assert.deepEqual(toggles, ['population', 'coffee']);
});

test('folding keeps the open panel state; open and applied chips stay pinned', () => {
  const { hub, filter, toggles } = makeHub({ fit: NARROW });
  const more = byClass(hub.el, 'mhub-more')[0];
  more.click(); // expand
  chipFor(hub, 'beerPerCapita').click(); // last metric, never fits at 400px unpinned
  more.click(); // collapse: the panel state SURVIVES (the lens must not clear)
  assert.equal(hub.getOpenKey(), 'beerPerCapita');
  assert.notEqual(toggles[toggles.length - 1], null);
  assert.equal(chipFor(hub, 'beerPerCapita').hidden, false); // open pins it
  // Closing the panel explicitly demotes the (unapplied) chip to overflow.
  chipFor(hub, 'beerPerCapita').click();
  assert.equal(chipFor(hub, 'beerPerCapita').hidden, true);
  // An applied tier pins the chip visible even while collapsed.
  filter.beerPerCapita = { op: '>=', n: 50 };
  hub.update();
  assert.equal(chipFor(hub, 'beerPerCapita').hidden, false);
});

test('tier counts render only when showCounts is set', () => {
  const withCounts = makeHub({ showCounts: true });
  chipFor(withCounts.hub, 'population').click();
  assert.deepEqual(
    byClass(withCounts.hub.el, 'pill-count').map((s) => s.textContent),
    ['15', '98'],
  );
  const without = makeHub();
  chipFor(without.hub, 'population').click();
  assert.equal(byClass(without.hub.el, 'pill-count').length, 0);
});

test('panelExtras render between the lead and the tier pills', () => {
  const doc = makeDoc();
  const extra = doc.createElement('span');
  extra.className = 'my-extra';
  const { hub } = makeHub({ doc, panelExtras: () => [extra] });
  chipFor(hub, 'population').click();
  const panel = byClass(hub.el, 'mhub-panel')[0];
  const classes = panel.children.map((/** @type {any} */ c) => c.className);
  assert.deepEqual(classes, ['mhub-panel-lead', 'my-extra', 'mhub-tiers']);
});

test('refreshI18n relabels chips, the more button, and the open panel', () => {
  const { hub } = makeHub();
  chipFor(hub, 'population').click();
  hub.refreshI18n();
  assert.equal(byClass(hub.el, 'mhub-panel-title')[0].textContent, 'Population');
  assert.equal(chipFor(hub, 'population').children[1].textContent, 'Population');
  assert.equal(hub.getOpenKey(), 'population'); // open state survives the refresh
});

test('moreButton:false omits the toggle; setExpanded drives the row externally', () => {
  const { hub, toggles } = makeHub({ fit: NARROW, moreButton: false });
  assert.equal(byClass(hub.el, 'mhub-more').length, 0);
  const fitted = byClass(hub.el, 'mhub-chip').filter((c) => !c.hidden).length;
  assert.ok(hub.hiddenChipCount() > 0);
  assert.equal(hub.hiddenChipCount(), METRIC_FILES.length - fitted);
  hub.setExpanded(true);
  assert.equal(hub.hiddenChipCount(), 0);
  // Collapsing externally keeps the open panel's state (the lens survives);
  // the open chip stays pinned, so one fewer unpinned chip fits.
  chipFor(hub, 'beerPerCapita').click();
  hub.setExpanded(false);
  assert.equal(hub.getOpenKey(), 'beerPerCapita');
  assert.equal(toggles[toggles.length - 1], 'beerPerCapita');
  assert.ok(hub.hiddenChipCount() > 0);
});

test('expandAll shows every chip with no more button, even on a narrow row', () => {
  // NARROW would normally collapse the row behind "+ N more"; expandAll pins
  // it fully open (findFlag's stacked section wraps instead of collapsing).
  const { hub } = makeHub({ fit: NARROW, expandAll: true });
  assert.equal(byClass(hub.el, 'mhub-more').length, 0);
  const chips = byClass(hub.el, 'mhub-chip');
  assert.equal(chips.length, METRIC_FILES.length);
  assert.equal(chips.filter((c) => c.hidden).length, 0);
  assert.equal(hub.hiddenChipCount(), 0);
});

test('an optional label leads the chip row with a data-i18n hook', () => {
  const { hub } = makeHub({ label: { key: 'metricHub.title', fallback: 'World facts' } });
  const labelEl = byClass(hub.el, 'mhub-label')[0];
  assert.equal(labelEl.textContent, 'World facts');
  assert.equal(labelEl.getAttribute('data-i18n'), 'metricHub.title');
});

test('closePanel closes from the outside (flagsdata\'s hide-values path)', () => {
  const { hub, toggles } = makeHub();
  chipFor(hub, 'population').click();
  hub.closePanel();
  assert.equal(hub.getOpenKey(), null);
  assert.deepEqual(toggles, ['population', null]);
});
