import test from 'node:test';
import assert from 'node:assert/strict';
import { markCountry, resetMap, mountEuropeMap } from './europeMap.js';

/**
 * Tiny fake of the SVG host root: maps ID → path-like object with a
 * classList API. querySelector parses the `#id` selector; querySelectorAll
 * parses a comma-list of class selectors (`.a, .b`) — enough surface for
 * the two callers in europeMap.js.
 */
function fakeRoot(ids) {
  const paths = new Map();
  for (const id of ids) {
    const classes = new Set();
    paths.set(id, {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        has: (c) => classes.has(c),
        _set: classes,
      },
    });
  }
  return {
    querySelector(sel) {
      if (!sel.startsWith('#')) return null;
      return paths.get(sel.slice(1)) || null;
    },
    querySelectorAll(sel) {
      const classNames = sel.split(',').map((s) => s.trim().replace(/^\./, ''));
      const out = [];
      for (const p of paths.values()) {
        if (classNames.some((c) => p.classList.has(c))) out.push(p);
      }
      return out;
    },
    _get(id) { return paths.get(id); },
  };
}

test('markCountry paints correct → is-correct class', () => {
  const root = fakeRoot(['es', 'fr']);
  markCountry(root, 'es', 'correct');
  assert.equal(root._get('es').classList.has('is-correct'), true);
  assert.equal(root._get('es').classList.has('is-wrong'), false);
});

test('markCountry paints wrong → is-wrong class', () => {
  const root = fakeRoot(['de']);
  markCountry(root, 'de', 'wrong');
  assert.equal(root._get('de').classList.has('is-wrong'), true);
  assert.equal(root._get('de').classList.has('is-correct'), false);
});

test('markCountry lowercases the code before lookup', () => {
  const root = fakeRoot(['fr']);
  markCountry(root, 'FR', 'correct');
  assert.equal(root._get('fr').classList.has('is-correct'), true);
});

test('markCountry clears prior status before re-painting (latest answer wins)', () => {
  const root = fakeRoot(['it']);
  markCountry(root, 'it', 'wrong');
  markCountry(root, 'it', 'correct');
  assert.equal(root._get('it').classList.has('is-correct'), true);
  assert.equal(root._get('it').classList.has('is-wrong'), false);
});

test('markCountry with state=clear removes both classes', () => {
  const root = fakeRoot(['gb']);
  markCountry(root, 'gb', 'correct');
  markCountry(root, 'gb', 'clear');
  assert.equal(root._get('gb').classList.has('is-correct'), false);
  assert.equal(root._get('gb').classList.has('is-wrong'), false);
});

test('markCountry silently no-ops when the code is not in the SVG', () => {
  const root = fakeRoot(['es']);
  // 'ax' (Åland) and 'sj' (Svalbard) are real ISO codes that the bundled
  // SVG doesn't carry — must not throw.
  assert.doesNotThrow(() => markCountry(root, 'ax', 'correct'));
  assert.doesNotThrow(() => markCountry(root, 'sj', 'wrong'));
});

test('markCountry no-ops on the compound regional codes the pool surfaces', () => {
  const root = fakeRoot(['es', 'gb']);
  // `es-pv` (Basque flag), `gb-eng` (England flag) etc. are in the quiz
  // pool but don't have a country path of their own. Caller doesn't have
  // to filter them out — we silently drop on the lookup.
  assert.doesNotThrow(() => markCountry(root, 'es-pv', 'correct'));
  assert.doesNotThrow(() => markCountry(root, 'gb-eng', 'wrong'));
  // The base countries (es, gb) stay untouched.
  assert.equal(root._get('es').classList.has('is-correct'), false);
  assert.equal(root._get('gb').classList.has('is-wrong'), false);
});

test('markCountry also classes the data-hit-for overlay alongside the country path', () => {
  // Microstate setup: path #va plus a sibling overlay circle that
  // claims the larger click area. markCountry must paint both so the
  // big invisible disk reflects answered state too.
  const root = (() => {
    const pathClasses = new Set();
    const overlayClasses = new Set();
    const pathNode = {
      classList: {
        add: (c) => pathClasses.add(c),
        remove: (c) => pathClasses.delete(c),
        has: (c) => pathClasses.has(c),
      },
      _kind: 'path',
      _classes: pathClasses,
    };
    const overlayNode = {
      classList: {
        add: (c) => overlayClasses.add(c),
        remove: (c) => overlayClasses.delete(c),
        has: (c) => overlayClasses.has(c),
      },
      _kind: 'overlay',
      _classes: overlayClasses,
    };
    return {
      querySelector(sel) {
        if (sel === '#va') return pathNode;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '[data-hit-for="va"]') return [overlayNode];
        return [];
      },
      _pathClasses: pathClasses,
      _overlayClasses: overlayClasses,
    };
  })();
  markCountry(root, 'va', 'correct');
  assert.equal(root._pathClasses.has('is-correct'), true);
  assert.equal(root._overlayClasses.has('is-correct'), true);
});

test('markCountry rejects malformed input without throwing', () => {
  const root = fakeRoot(['es']);
  assert.doesNotThrow(() => markCountry(root, '', 'correct'));
  assert.doesNotThrow(() => markCountry(root, /** @type {any} */ (null), 'correct'));
  assert.doesNotThrow(() => markCountry(root, /** @type {any} */ (undefined), 'correct'));
  assert.doesNotThrow(() => markCountry(/** @type {any} */ (null), 'es', 'correct'));
});

test('resetMap clears every marked country in one call', () => {
  const root = fakeRoot(['es', 'fr', 'de', 'it']);
  markCountry(root, 'es', 'correct');
  markCountry(root, 'fr', 'correct');
  markCountry(root, 'de', 'wrong');
  // it stays untouched
  resetMap(root);
  assert.equal(root._get('es').classList.has('is-correct'), false);
  assert.equal(root._get('fr').classList.has('is-correct'), false);
  assert.equal(root._get('de').classList.has('is-wrong'), false);
});

test('resetMap is a no-op when nothing is painted', () => {
  const root = fakeRoot(['es']);
  assert.doesNotThrow(() => resetMap(root));
});

test('resetMap tolerates a null root', () => {
  assert.doesNotThrow(() => resetMap(/** @type {any} */ (null)));
});

/* mountEuropeMap — fetch + inline + viewBox patch.
 *
 * We fake `fetch` and use a minimal `container` whose innerHTML setter
 * builds a tiny DOM stand-in. Node has no DOM, but we only need the
 * surface the function actually touches: container.innerHTML setter,
 * container.querySelector('svg'), and the svg element's getAttribute /
 * setAttribute / removeAttribute. Hand-rolling that fake is simpler
 * than booting jsdom for one test. */

function fakeContainer() {
  /** @type {Map<string, string>} */
  const svgAttrs = new Map();
  const svgEl = {
    getAttribute: (k) => (svgAttrs.has(k) ? svgAttrs.get(k) : null),
    setAttribute: (k, v) => { svgAttrs.set(k, String(v)); },
    removeAttribute: (k) => { svgAttrs.delete(k); },
    _attrs: svgAttrs,
  };
  let lastInner = '';
  return {
    get innerHTML() { return lastInner; },
    set innerHTML(v) {
      lastInner = String(v);
      svgAttrs.clear();
      // Parse the width / height we care about out of the inlined text —
      // mirrors a browser's actual SVG parse for our two attributes of
      // interest without dragging in a full XML parser.
      const w = /<svg\b[^>]*\bwidth="([^"]+)"/.exec(lastInner);
      const h = /<svg\b[^>]*\bheight="([^"]+)"/.exec(lastInner);
      const vb = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(lastInner);
      if (w) svgAttrs.set('width', w[1]);
      if (h) svgAttrs.set('height', h[1]);
      if (vb) svgAttrs.set('viewBox', vb[1]);
    },
    querySelector(sel) {
      if (sel === 'svg' && lastInner.includes('<svg')) return svgEl;
      return null;
    },
    _svg: svgEl,
  };
}

function fakeFetch(body, { ok = true } = {}) {
  return async () => ({
    ok,
    text: async () => body,
  });
}

test('mountEuropeMap inlines fetched SVG and adds viewBox from width/height', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('<svg width="680" height="520"><path id="es"/></svg>');
  const svg = await mountEuropeMap({ container, url: '/x.svg', fetchImpl });
  assert.ok(svg, 'returns the svg root');
  assert.equal(svg.getAttribute('viewBox'), '0 0 680 520');
  assert.equal(svg.getAttribute('width'), null, 'width attribute stripped');
  assert.equal(svg.getAttribute('height'), null, 'height attribute stripped');
});

test('mountEuropeMap preserves an existing viewBox instead of rebuilding it', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('<svg viewBox="0 0 100 80" width="100" height="80"></svg>');
  const svg = await mountEuropeMap({ container, url: '/x.svg', fetchImpl });
  assert.ok(svg);
  assert.equal(svg.getAttribute('viewBox'), '0 0 100 80');
});

test('mountEuropeMap returns null on fetch failure (network error)', async () => {
  const container = fakeContainer();
  const fetchImpl = async () => { throw new Error('boom'); };
  const svg = await mountEuropeMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(svg, null);
});

test('mountEuropeMap returns null on non-ok HTTP response', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('whatever', { ok: false });
  const svg = await mountEuropeMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(svg, null);
});

test('mountEuropeMap returns null when the payload has no <svg> root', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('<html>not an svg</html>');
  const svg = await mountEuropeMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(svg, null);
});

test('mountEuropeMap with a missing container is a safe no-op', async () => {
  const fetchImpl = fakeFetch('<svg width="100" height="100"></svg>');
  const svg = await mountEuropeMap({
    container: /** @type {any} */ (null), url: '/x.svg', fetchImpl,
  });
  assert.equal(svg, null);
});

/* Container fake with enough querySelectorAll surface to test the
 * post-mount `.k → .is-small` promotion. Returns a synthetic svg whose
 * querySelectorAll yields stub path nodes with classList. */

function fakeContainerWithPaths(pathDescriptors) {
  const stubs = pathDescriptors.map((d) => {
    const classes = new Set(d.classes || []);
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        has: (c) => classes.has(c),
        contains: (c) => classes.has(c),
        _set: classes,
      },
      // No getBBox — exercises the "skip when getBBox unavailable" path.
      _id: d.id,
    };
  });
  const svgAttrs = new Map();
  const svgEl = {
    getAttribute: (k) => (svgAttrs.has(k) ? svgAttrs.get(k) : null),
    setAttribute: (k, v) => { svgAttrs.set(k, String(v)); },
    removeAttribute: (k) => { svgAttrs.delete(k); },
    querySelectorAll: (sel) => {
      const wanted = sel.split(',').map((s) => s.trim());
      return stubs.filter((s) => wanted.some((w) => matchesSelector(s, w)));
    },
    _stubs: stubs,
  };
  let inner = '';
  return {
    set innerHTML(v) {
      inner = String(v);
      svgAttrs.clear();
      svgAttrs.set('width', '680');
      svgAttrs.set('height', '520');
    },
    get innerHTML() { return inner; },
    querySelector(sel) {
      if (sel === 'svg' && inner.includes('<svg')) return svgEl;
      return null;
    },
    _svg: svgEl,
  };
}

function matchesSelector(stub, selector) {
  // Trivial selector matcher: "path.k", "path.c.k", "path.c" etc.
  // We treat the leading element name as a pass (all stubs ARE paths
  // in this fake) and require every `.foo` class on the stub.
  const classes = selector.match(/\.[a-zA-Z0-9_-]+/g) || [];
  for (const c of classes) {
    if (!stub.classList.has(c.slice(1))) return false;
  }
  return true;
}

test('mountEuropeMap promotes SVG-tagged .k paths to .is-small', async () => {
  const container = fakeContainerWithPaths([
    { id: 'va', classes: ['c', 'k'] },
    { id: 'mc', classes: ['c', 'k'] },
    { id: 'es', classes: ['c'] },  // not a microstate
  ]);
  const fetchImpl = fakeFetch('<svg width="680" height="520"></svg>');
  await mountEuropeMap({ container, url: '/x.svg', fetchImpl });
  const stubs = container._svg._stubs;
  assert.equal(stubs.find((s) => s._id === 'va').classList.has('is-small'), true);
  assert.equal(stubs.find((s) => s._id === 'mc').classList.has('is-small'), true);
  assert.equal(stubs.find((s) => s._id === 'es').classList.has('is-small'), false);
});
