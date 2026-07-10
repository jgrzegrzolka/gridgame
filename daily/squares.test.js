import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchiveSquare, refreshSquareCriteria } from './squares.js';
import { _seedCacheForTests, _resetCacheForTests } from '../i18n.js';

// Minimal `doc.createElement`-style fake — just enough surface for
// renderArchiveSquare to build its tree, AND for refreshSquareCriteria
// to walk that tree afterwards (querySelectorAll on the doc,
// querySelector on a link). The shape tracks the real DOM closely
// enough that a passing test means the data-attribute contract is
// real, not a renderer that forgot to set things.
function fakeDoc() {
  /** @type {any[]} */
  const allElements = [];
  function makeEl(tag) {
    const el = /** @type {any} */ ({
      tagName: tag.toUpperCase(),
      className: '',
      classList: {
        _set: new Set(),
        add(/** @type {string} */ k) { el.classList._set.add(k); el.className = [...el.classList._set, ...el.className.split(' ').filter(Boolean)].join(' '); },
        toggle(/** @type {string} */ k, /** @type {boolean} */ on) { if (on) el.classList.add(k); },
      },
      style: {},
      dataset: /** @type {Record<string,string>} */ ({}),
      _attrs: /** @type {Record<string,string>} */ ({}),
      _children: /** @type {any[]} */ ([]),
      textContent: '',
      setAttribute(/** @type {string} */ k, /** @type {string} */ v) { el._attrs[k] = v; },
      getAttribute(/** @type {string} */ k) { return el._attrs[k] ?? null; },
      appendChild(/** @type {any} */ child) { el._children.push(child); return child; },
      querySelector(/** @type {string} */ sel) {
        for (const c of el._children) {
          if (c.className && (' ' + c.className + ' ').includes(' ' + sel.replace(/^\./, '') + ' ')) return c;
          const nested = c.querySelector?.(sel);
          if (nested) return nested;
        }
        return null;
      },
    });
    allElements.push(el);
    return el;
  }
  return {
    documentElement: { lang: 'en' },
    createElement: (/** @type {string} */ tag) => makeEl(tag),
    querySelectorAll: (/** @type {string} */ sel) => {
      // Selector mirrors the one in refreshSquareCriteria. Filter entries
      // are matched by data-filter; manual entries by data-title.
      if (sel !== '.archive-square-link[data-filter], .archive-square-link[data-title]') return [];
      return allElements.filter(
        (e) => e.className.includes('archive-square-link') && (e.dataset.filter !== undefined || e.dataset.title !== undefined),
      );
    },
  };
}

// `refreshSquareCriteria` is the soft-language-switch path for archive
// squares — what keeps the hover overlay (`.archive-square-criteria`)
// and the link's `aria-label` in the active language after the user
// flips the lang toggle on `/daily/archive.html`,
// `/daily/backlog/`, or `/daily/ideas/`. Without it, both stay frozen
// in the page's boot-time language and Jan sees stale text on hover.

function fakeSquareDoc(squareSpecs, lang = 'en') {
  /** @type {any[]} */
  const allLinks = [];
  for (const spec of squareSpecs) {
    const criteriaEl = {
      textContent: spec.initialCriteria ?? '',
    };
    /** @type {Record<string,string>} */
    const dataset = {
      ariaPrefix: spec.ariaPrefix ?? '',
      n: spec.n ?? '',
    };
    if (spec.title !== undefined) dataset.title = JSON.stringify(spec.title);
    else dataset.filter = spec.filter ?? '';
    const link = {
      dataset,
      _attrs: { 'aria-label': spec.initialAriaLabel ?? '' },
      setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
        this._attrs[k] = v;
      },
      getAttribute(/** @type {string} */ k) {
        return this._attrs[k];
      },
      querySelector: (/** @type {string} */ sel) => (sel === '.archive-square-criteria' ? criteriaEl : null),
    };
    allLinks.push({ link, criteriaEl, key: spec.filter ?? spec.title });
  }
  return {
    documentElement: { lang },
    link: (/** @type {any} */ key) => allLinks.find((x) => JSON.stringify(x.key) === JSON.stringify(key))?.link,
    criteria: (/** @type {any} */ key) => allLinks.find((x) => JSON.stringify(x.key) === JSON.stringify(key))?.criteriaEl,
    querySelectorAll: (/** @type {string} */ sel) => {
      if (sel !== '.archive-square-link[data-filter], .archive-square-link[data-title]') return [];
      return allLinks.map((x) => x.link);
    },
  };
}

test('refreshSquareCriteria: re-translates the hover overlay text + aria-label per active lang', () => {
  // Seed enough of the i18n cache for filterTitle to produce a
  // Polish-shaped label. `filterTitle` reads the continent + colour +
  // motif tokens through `t()`, so we cover the keys it asks for.
  // Cache is keyed by the dotted key paths `pillLabel` builds:
  // continent → `variant.europe`, color → `color.red`. Anything not
  // seeded falls through to the English fallback, which is fine for
  // this test — we only need to prove that filterTitle re-runs and
  // picks up the cache values that ARE seeded.
  _seedCacheForTests({
    variant: { europe: 'Europa' },
    color: { red: 'czerwony' },
  });
  const doc = fakeSquareDoc([
    {
      filter: 'continent:Europe,color:red',
      ariaPrefix: 'Daily',
      n: '5',
      initialAriaLabel: 'Daily #5 — Europe · red',
      initialCriteria: 'Europe · red',
    },
  ]);
  refreshSquareCriteria(/** @type {any} */ (doc));
  const link = doc.link('continent:Europe,color:red');
  const criteria = doc.criteria('continent:Europe,color:red');
  // Whatever filterTitle's Polish output is for this filter, both the
  // criteria text and the aria-label must agree on it. The point of
  // the test is "they re-run filterTitle and stay in sync" — not the
  // exact wording (which lives in flags/findFlag.js).
  assert.match(criteria.textContent, /Europa/, 'criteria text should pick up Polish continent name');
  assert.match(link.getAttribute('aria-label'), /Europa/);
  assert.match(link.getAttribute('aria-label'), /Daily #5/, 'aria-label preserves prefix + number');
  _resetCacheForTests();
});

test('refreshSquareCriteria: falls back to the raw filter when parsing fails', () => {
  // A typo or future-DSL-token in the filter shouldn't crash the
  // refresh — same fallback as initial render in squares.js.
  const doc = fakeSquareDoc([
    {
      filter: 'totally:bogus:thing',
      ariaPrefix: 'Daily',
      n: '7',
    },
  ]);
  refreshSquareCriteria(/** @type {any} */ (doc));
  const criteria = doc.criteria('totally:bogus:thing');
  assert.equal(criteria.textContent, 'totally:bogus:thing');
});

test('renderArchiveSquare stamps the data attributes refreshSquareCriteria walks for', () => {
  // The contract: data-filter / data-aria-prefix / data-n must land on
  // the link element. The walker reads exactly these three to rebuild
  // the criteria label + aria-label. If the renderer ever stops setting
  // them, the walker silently no-ops and the user sees stale labels on
  // hover — exactly the bug this whole module exists to fix.
  const doc = fakeDoc();
  const entry = /** @type {any} */ ({ n: 3, filter: 'continent:Europe,motif:cross', answers: ['ch'] });
  const li = renderArchiveSquare(entry, { href: './?n=3', ariaPrefix: 'Daily', isToday: true }, /** @type {any} */ (doc));
  const link = li._children[0];
  assert.equal(link.dataset.filter, 'continent:Europe,motif:cross');
  assert.equal(link.dataset.ariaPrefix, 'Daily');
  assert.equal(link.dataset.n, '3');
  assert.match(link.getAttribute('aria-label'), /Daily #3/);
});

test('renderArchiveSquare + refreshSquareCriteria round-trip: lang switch repaints what render put down', () => {
  // End-to-end pin: render with English fallbacks, flip the cache,
  // walk, and assert the criteria text + aria-label tracked the
  // change. Catches the regression mode where renderer and walker
  // drift apart on the data-attribute schema.
  _resetCacheForTests();
  const doc = fakeDoc();
  const entry = /** @type {any} */ ({ n: 9, filter: 'continent:Europe,color:red', answers: ['pl'] });
  const li = renderArchiveSquare(entry, { href: './?n=9', ariaPrefix: 'Daily' }, /** @type {any} */ (doc));
  const link = li._children[0];
  const criteriaEl = link.querySelector('.archive-square-criteria');
  // English-fallback: filterTitle has no cache, falls through to the raw
  // tokens. Specific wording isn't load-bearing; what matters is that the
  // refresh step changes it.
  const initialCriteria = criteriaEl.textContent;
  const initialAria = link.getAttribute('aria-label');
  _seedCacheForTests({ variant: { europe: 'Europa' }, color: { red: 'czerwony' } });
  refreshSquareCriteria(/** @type {any} */ (doc));
  assert.notEqual(criteriaEl.textContent, initialCriteria, 'criteria text should change after lang switch');
  assert.notEqual(link.getAttribute('aria-label'), initialAria, 'aria-label should change after lang switch');
  assert.match(criteriaEl.textContent, /Europa/);
  assert.match(criteriaEl.textContent, /czerwony/);
  _resetCacheForTests();
});

// --- Manual entries (kind: 'manual') -----------------------------------
//
// Regression pin. Before #413's follow-up fix, renderArchiveSquare
// called `parseFilterString(entry.filter)` unconditionally — passing
// undefined to a function whose first line is `s.split(',')`. The whole
// backlog index page (`/daily/backlog/`) crashed the moment a manual
// entry landed in the list. Same shape regression in
// `daily/difficulty.js`'s `scoreEntry` (covered in difficulty.test.js).
// These tests prove the renderer + walker tolerate a missing filter.

test('renderArchiveSquare: manual entry renders title as criteria label (no throw on missing filter)', () => {
  // The bug was a hard throw inside parseFilterString — so the
  // first-order assertion is "renderArchiveSquare does not throw on a
  // manual entry." We also pin the user-visible part: the title text
  // lands in the criteria span + aria-label.
  _seedCacheForTests({});
  const doc = fakeDoc();
  doc.documentElement.lang = 'en';
  const entry = /** @type {any} */ ({
    n: 72,
    kind: 'manual',
    answers: ['cu', 'cz'],
    title: { en: 'Triangle from hoist', pl: 'Trójkąt z drzewca' },
  });
  const li = renderArchiveSquare(entry, { href: './play.html?n=72', ariaPrefix: 'Backlog' }, /** @type {any} */ (doc));
  const link = li._children[0];
  // Filter attr must NOT be set on a manual entry — that's how the
  // walker tells the two paths apart.
  assert.equal(link.dataset.filter, undefined);
  // Title attr is stashed as JSON so refreshSquareCriteria can re-look
  // up the active language on a soft language switch.
  assert.equal(link.dataset.title, JSON.stringify({ en: 'Triangle from hoist', pl: 'Trójkąt z drzewca' }));
  const criteriaEl = link.querySelector('.archive-square-criteria');
  assert.equal(criteriaEl.textContent, 'Triangle from hoist');
  assert.match(link.getAttribute('aria-label'), /Backlog #72 — Triangle from hoist/);
  _resetCacheForTests();
});

test('renderArchiveSquare: superlative entry renders its title as criteria label (title path, filter ignored)', () => {
  // A superlative carries a pool-narrowing `filter`, but the square must
  // show its hand-written title (the title path), NOT parse the filter.
  _seedCacheForTests({});
  const doc = fakeDoc();
  doc.documentElement.lang = 'en';
  const entry = /** @type {any} */ ({
    n: 80,
    kind: 'superlative',
    metric: 'population',
    scope: 'Europe',
    direction: 'most',
    topN: 5,
    filter: 'color:white',
    answers: ['ru', 'gb', 'fr', 'it', 'es'],
    title: { en: '5 most populous white flags of Europe', pl: '5 najludniejszych białych flag Europy' },
  });
  const li = renderArchiveSquare(entry, { href: './play.html?n=80', ariaPrefix: 'Backlog' }, /** @type {any} */ (doc));
  const link = li._children[0];
  // Title path: no data-filter (would send the walker down the parse
  // branch and show the pool-narrowing filter instead of the title).
  assert.equal(link.dataset.filter, undefined);
  assert.equal(link.dataset.title, JSON.stringify(entry.title));
  const criteriaEl = link.querySelector('.archive-square-criteria');
  assert.equal(criteriaEl.textContent, '5 most populous white flags of Europe');
  _resetCacheForTests();
});

test('renderArchiveSquare: a backlog list mixing filter + manual entries renders both without throwing', () => {
  // End-to-end regression — the actual failure mode was the backlog
  // index iterating its entries and crashing on the manual one. This
  // test runs the same shape: a mixed list, no throws, both squares
  // emerge with their correct criteria label.
  const doc = fakeDoc();
  const filterEntry = /** @type {any} */ ({ n: 71, filter: 'continent:Asia,color:red', answers: ['jp'] });
  const manualEntry = /** @type {any} */ ({
    n: 72,
    kind: 'manual',
    answers: ['cu', 'cz'],
    title: { en: 'Triangle from hoist', pl: 'X' },
  });
  // The bug: if either of these threw, the page boot died at the for-loop.
  assert.doesNotThrow(() => renderArchiveSquare(filterEntry, { href: './a', ariaPrefix: 'A' }, /** @type {any} */ (doc)));
  assert.doesNotThrow(() => renderArchiveSquare(manualEntry, { href: './b', ariaPrefix: 'B' }, /** @type {any} */ (doc)));
});

test('refreshSquareCriteria: re-translates manual-entry title via entry.title[lang]', () => {
  // Manual entries also need the soft-language-switch path — their
  // title is per-language too. The walker reads documentElement.lang
  // and looks up the matching key in the stashed JSON map.
  const doc = fakeSquareDoc(
    [
      {
        title: { en: 'Triangle from hoist', pl: 'Trójkąt z drzewca' },
        ariaPrefix: 'Backlog',
        n: '72',
      },
    ],
    'pl',
  );
  refreshSquareCriteria(/** @type {any} */ (doc));
  const key = { en: 'Triangle from hoist', pl: 'Trójkąt z drzewca' };
  const criteria = doc.criteria(key);
  const link = doc.link(key);
  assert.equal(criteria.textContent, 'Trójkąt z drzewca');
  assert.match(link.getAttribute('aria-label'), /Backlog #72 — Trójkąt z drzewca/);
});

test('refreshSquareCriteria: manual entry falls back to en when active lang has no title', () => {
  const doc = fakeSquareDoc(
    [{ title: { en: 'Triangle from hoist' }, ariaPrefix: 'Backlog', n: '72' }],
    'de',
  );
  refreshSquareCriteria(/** @type {any} */ (doc));
  const criteria = doc.criteria({ en: 'Triangle from hoist' });
  assert.equal(criteria.textContent, 'Triangle from hoist');
});

test('refreshSquareCriteria: ignores links without data-filter or data-title (foreign / unregistered)', () => {
  // The selector scopes the walk to links that carry one of the two
  // recognised data attributes (data-filter for filter entries,
  // data-title for manual entries). This smoke-tests that an unrelated
  // link with the class but neither attribute is left alone.
  const doc = {
    documentElement: { lang: 'en' },
    querySelectorAll: (/** @type {string} */ sel) =>
      sel === '.archive-square-link[data-filter], .archive-square-link[data-title]' ? [] : ['DO NOT WALK ME'],
  };
  // Just asserting it doesn't throw on an empty list.
  refreshSquareCriteria(/** @type {any} */ (doc));
});
