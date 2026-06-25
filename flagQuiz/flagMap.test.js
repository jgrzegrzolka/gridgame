import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markCountry, resetMap, mountFlagMap, tagCountryPaths, cropToCountries,
  offsetHitTargetCenter,
} from './flagMap.js';

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

/* mountFlagMap — fetch + inline + viewBox patch.
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

test('mountFlagMap inlines fetched SVG and adds viewBox from width/height', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('<svg width="680" height="520"><path id="es"/></svg>');
  const svg = await mountFlagMap({ container, url: '/x.svg', fetchImpl });
  assert.ok(svg, 'returns the svg root');
  assert.equal(svg.getAttribute('viewBox'), '0 0 680 520');
  assert.equal(svg.getAttribute('width'), null, 'width attribute stripped');
  assert.equal(svg.getAttribute('height'), null, 'height attribute stripped');
});

test('mountFlagMap preserves an existing viewBox instead of rebuilding it', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('<svg viewBox="0 0 100 80" width="100" height="80"></svg>');
  const svg = await mountFlagMap({ container, url: '/x.svg', fetchImpl });
  assert.ok(svg);
  assert.equal(svg.getAttribute('viewBox'), '0 0 100 80');
});

test('mountFlagMap returns null on fetch failure (network error)', async () => {
  const container = fakeContainer();
  const fetchImpl = async () => { throw new Error('boom'); };
  const svg = await mountFlagMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(svg, null);
});

test('mountFlagMap returns null on non-ok HTTP response', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('whatever', { ok: false });
  const svg = await mountFlagMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(svg, null);
});

test('mountFlagMap returns null when the payload has no <svg> root', async () => {
  const container = fakeContainer();
  const fetchImpl = fakeFetch('<html>not an svg</html>');
  const svg = await mountFlagMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(svg, null);
});

test('mountFlagMap with a missing container is a safe no-op', async () => {
  const fetchImpl = fakeFetch('<svg width="100" height="100"></svg>');
  const svg = await mountFlagMap({
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

test('mountFlagMap tags curated microstates via the hardcoded set', async () => {
  // Test setup mimics the asset query — querySelector('#va') returns
  // the Vatican stub etc.
  const stubs = ['va', 'mc', 'es'].map((id) => {
    const classes = new Set();
    return {
      _id: id,
      classList: { add: (c) => classes.add(c), has: (c) => classes.has(c) },
    };
  });
  const byId = new Map(stubs.map((s) => [s._id, s]));
  const container = {
    set innerHTML(_v) {},
    querySelector: (sel) => {
      if (sel === 'svg') return {
        getAttribute: () => null,
        setAttribute: () => {},
        removeAttribute: () => {},
        querySelectorAll: () => [],
        querySelector: (s) => byId.get(s.slice(1)) || null,
      };
      return null;
    },
  };
  const fetchImpl = fakeFetch('<svg width="680" height="520"></svg>');
  await mountFlagMap({ container, url: '/x.svg', fetchImpl });
  assert.equal(stubs.find((s) => s._id === 'va').classList.has('is-small'), true);
  assert.equal(stubs.find((s) => s._id === 'mc').classList.has('is-small'), true);
  assert.equal(stubs.find((s) => s._id === 'es').classList.has('is-small'), false);
});

// ---- tagCountryPaths ----
//
// Lean stub root that only models `querySelectorAll('[id]')` (the
// single selector tagCountryPaths uses). Each node carries an `id`
// string + a classList Set.

function fakeSvgWithIds(ids) {
  const nodes = ids.map((id) => {
    const classes = new Set();
    return {
      id,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        has: (c) => classes.has(c),
      },
      _classes: classes,
    };
  });
  return {
    querySelectorAll: (sel) => (sel === '[id]' ? nodes : []),
    _nodes: nodes,
  };
}

test('tagCountryPaths adds .map-country only to ISO2-shaped ids', () => {
  const svg = fakeSvgWithIds([
    'es',           // ISO2 — yes
    'fr',           // ISO2 — yes
    'cn',           // ISO2 — yes
    'dk_kingdom',   // composite grouping — no
    'svg1',         // SVG root — no
    'style1',       // style block — no
    'st0',          // Adobe-generated class id — no
    'a',            // single letter — no
    'esp',          // 3-letter — no
    '',             // empty — no
  ]);
  tagCountryPaths(svg);
  const tagged = svg._nodes
    .filter((n) => n.classList.has('map-country'))
    .map((n) => n.id);
  assert.deepEqual(tagged, ['es', 'fr', 'cn']);
});

test('tagCountryPaths tolerates a null svg', () => {
  assert.doesNotThrow(() => tagCountryPaths(/** @type {any} */ (null)));
});

test('tagCountryPaths is idempotent — a re-call doesn\'t add a second class', () => {
  const svg = fakeSvgWithIds(['es']);
  tagCountryPaths(svg);
  tagCountryPaths(svg);
  // classList is a Set; .has returns one boolean. We just confirm the
  // double tag didn't throw and the class remains.
  assert.equal(svg._nodes[0].classList.has('map-country'), true);
});

// ---- cropToCountries ----
//
// Stub root supporting `querySelector('#code')` returning a node with
// `getBBox()`. setAttribute is recorded so we can assert the viewBox.

function fakeSvgWithBboxes(boxes) {
  const byId = new Map();
  for (const [id, bb] of Object.entries(boxes)) {
    byId.set(id, { id, getBBox: () => bb });
  }
  let viewBox = null;
  return {
    querySelector: (sel) => {
      if (sel.startsWith('#')) return byId.get(sel.slice(1)) || null;
      return null;
    },
    setAttribute: (k, v) => { if (k === 'viewBox') viewBox = String(v); },
    _viewBox: () => viewBox,
  };
}

test('cropToCountries sets viewBox to the bbox union plus 5% padding', () => {
  const svg = fakeSvgWithBboxes({
    cn: { x: 100, y: 50, width: 60, height: 40 },
    jp: { x: 180, y: 60, width: 30, height: 30 },
    in: { x: 60,  y: 90, width: 40, height: 50 },
  });
  cropToCountries(svg, ['cn', 'jp', 'in']);
  // Union bbox: minX=60, minY=50, maxX=210, maxY=140
  //   → width 150, height 90 → 5% padding = 7.5, 4.5
  // viewBox = `${60-7.5} ${50-4.5} ${150+15} ${90+9}` = "52.5 45.5 165 99"
  assert.equal(svg._viewBox(), '52.5 45.5 165 99');
});

test('cropToCountries silently skips codes whose elements are missing', () => {
  const svg = fakeSvgWithBboxes({
    cn: { x: 100, y: 50, width: 60, height: 40 },
  });
  cropToCountries(svg, ['cn', 'missingcode', 'jp']);
  // Only cn resolves; viewBox is its bbox + 5% pad.
  // bbox: 100/50/60/40 → padX=3, padY=2
  assert.equal(svg._viewBox(), '97 48 66 44');
});

test('cropToCountries rejects non-ISO2 codes without throwing', () => {
  const svg = fakeSvgWithBboxes({
    cn: { x: 0, y: 0, width: 10, height: 10 },
  });
  cropToCountries(svg, ['cn', 'dk_kingdom', '', 'CN', 'esp']);
  // Only 'cn' is allowed — others fail the ISO2 regex. viewBox still set.
  assert.ok(svg._viewBox() !== null);
});

test('cropToCountries no-ops when no codes resolve', () => {
  const svg = fakeSvgWithBboxes({});
  cropToCountries(svg, ['cn', 'jp']);
  assert.equal(svg._viewBox(), null);
});

test('cropToCountries skips degenerate bboxes (width AND height both 0)', () => {
  const svg = fakeSvgWithBboxes({
    cn: { x: 5, y: 5, width: 0, height: 0 },
    jp: { x: 100, y: 100, width: 20, height: 20 },
  });
  cropToCountries(svg, ['cn', 'jp']);
  // Only jp's real bbox contributes — cn is skipped.
  // jp bbox: 100/100/20/20 → padX=1, padY=1
  assert.equal(svg._viewBox(), '99 99 22 22');
});

test('cropToCountries tolerates a null svg', () => {
  assert.doesNotThrow(() => cropToCountries(/** @type {any} */ (null), ['cn']));
});

// ---- offsetHitTargetCenter ----
//
// Pins the co-located-pair table. mf and sx share one Caribbean
// island (~9 km across); their inner-path bboxes sit ~0.3 viewBox
// units apart, so without this offset the default bbox-center rule
// produced two rings stacked on top of each other and only the top
// one was clickable. Any future co-located ISO pair would slot a
// new entry into the same table.

test('offsetHitTargetCenter shifts mf north and sx south-southwest of the shared island', () => {
  // Same input — represents the (near-identical) bbox center of the
  // shared landmass. mf goes pure north; sx skews south-southwest so
  // its ring clears Saint Kitts & Nevis (which sits SE of the island
  // and would collide with a pure-south push).
  const sharedCx = 826.5;
  const sharedCy = 542.3;
  const mf = offsetHitTargetCenter('mf', sharedCx, sharedCy);
  const sx = offsetHitTargetCenter('sx', sharedCx, sharedCy);
  // mf is the northern (French) half — keep cx, push y up.
  assert.equal(mf.cx, sharedCx);
  assert.ok(mf.cy < sharedCy, `mf should shift north (smaller y), got ${mf.cy}`);
  // sx is the southern (Dutch) half — push y down AND skew west to
  // dodge Saint Kitts & Nevis. The skew is the whole reason this
  // case fails with a naive pure-S offset, so pin both axes.
  assert.ok(sx.cy > sharedCy, `sx should shift south (larger y), got ${sx.cy}`);
  assert.ok(sx.cx < sharedCx, `sx should also skew west to clear kn, got cx=${sx.cx}`);
  // The pair must end up separated enough that at the NA continent
  // crop (ring radius ~2.4 vbu), both rings clear every neighbour
  // ring by positive ring-edge gap. Pin at >= 14 vbu of 2D distance
  // as the regression guard: anything smaller starts grazing
  // neighbours like Anguilla and Saint Barthélemy.
  const dist = Math.hypot(sx.cx - mf.cx, sx.cy - mf.cy);
  assert.ok(dist >= 14, `mf/sx 2D separation collapsed to ${dist.toFixed(2)}`);
});

test('offsetHitTargetCenter is the identity for any country not in the table', () => {
  // The whole point of the targeted approach is "ONLY mf and sx
  // shift" — every other microstate's ring center comes through
  // untouched. PR #612's generic overlap-resolver violated this by
  // cascading across the Caribbean cluster and pushing Bahamas /
  // Lesser Antilles off into open water.
  for (const code of ['ai', 'bl', 'ag', 'bs', 'kn', 'lc', 'vg', 'vi', 'tc', 'va', 'mc']) {
    const out = offsetHitTargetCenter(code, 100, 200);
    assert.deepEqual(out, { cx: 100, cy: 200 }, `${code} should not shift`);
  }
});

test('offsetHitTargetCenter no-ops on unknown / malformed ids', () => {
  // Defensive: callers feed the country's id straight in. The bbox-
  // center path shouldn't care if the id happens to be empty / a
  // composite / non-string — return inputs unchanged so the circle
  // still gets drawn at the bbox center.
  assert.deepEqual(offsetHitTargetCenter('', 1, 2), { cx: 1, cy: 2 });
  assert.deepEqual(offsetHitTargetCenter('not-iso', 3, 4), { cx: 3, cy: 4 });
  assert.deepEqual(offsetHitTargetCenter(/** @type {any} */ (null), 5, 6), { cx: 5, cy: 6 });
});

// ---- addHitTargets integration via mountFlagMap ----
//
// Verifies the offset actually propagates to the appended <circle>'s
// cx/cy. The existing fakeContainerWithPaths doesn't model getBBox or
// createElementNS, so this builds a slightly richer fake that does —
// enough surface for addHitTargets to create circles and set attrs.

test('mountFlagMap produces distinct mf and sx hit-target centers from a shared bbox', async () => {
  // mf and sx are wrapped in <g> with a single inner <path>; their
  // bboxes overlap completely in this fake (same x/y/w/h) — the worst
  // case the offset table has to defend against. A neighbour ('ai',
  // Anguilla) ships an unrelated bbox so we can pin "not in the table"
  // behaviour at the same time.
  const sharedBbox = { x: 826.4, y: 542.0, width: 0.5, height: 0.4 };
  const aiBbox = { x: 825.8, y: 541.4, width: 0.6, height: 0.5 };

  /** @param {string} id @param {{x:number,y:number,width:number,height:number}} bb */
  const groupWithPath = (id, bb) => {
    const classes = new Set();
    const inner = { tagName: 'path', getBBox: () => bb };
    return {
      id,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        has: (c) => classes.has(c),
      },
      querySelector: (sel) => (sel === 'path' ? inner : null),
      getBBox: () => bb,
      _classes: classes,
    };
  };

  const byId = new Map([
    ['mf', groupWithPath('mf', sharedBbox)],
    ['sx', groupWithPath('sx', sharedBbox)],
    ['ai', groupWithPath('ai', aiBbox)],
  ]);

  /** @type {Array<{ tagName: string, attrs: Map<string, string>, parent: any }>} */
  const appended = [];
  const fakeDoc = {
    createElementNS: (ns, tag) => {
      const attrs = new Map();
      return {
        tagName: tag,
        setAttribute: (k, v) => { attrs.set(k, String(v)); },
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        _attrs: attrs,
      };
    },
  };

  const allNodes = Array.from(byId.values());
  const fakeSvgAttrs = new Map();
  const fakeSvg = {
    ownerDocument: fakeDoc,
    getAttribute: (k) => (fakeSvgAttrs.has(k) ? fakeSvgAttrs.get(k) : null),
    setAttribute: (k, v) => { fakeSvgAttrs.set(k, String(v)); },
    removeAttribute: (k) => { fakeSvgAttrs.delete(k); },
    querySelector: (sel) => {
      if (sel.startsWith('#')) return byId.get(sel.slice(1)) || null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '[id]') return allNodes;
      if (sel === '.is-small') return allNodes.filter((n) => n.classList.has('is-small'));
      return [];
    },
    appendChild: (child) => { appended.push(child); return child; },
  };

  const container = {
    set innerHTML(_v) { fakeSvgAttrs.clear(); },
    get innerHTML() { return ''; },
    querySelector: (sel) => (sel === 'svg' ? fakeSvg : null),
    appendChild: () => {},
    ownerDocument: fakeDoc,
  };

  const fetchImpl = async () => ({
    ok: true,
    text: async () => '<svg width="2754" height="1398"></svg>',
  });
  await mountFlagMap({ container, url: '/x.svg', fetchImpl });

  // For mf/sx specifically the appended children should include BOTH a
  // leader <line> and a hit-target <circle> per country — the line goes
  // first (so the ring sits visually on top of it) and points from the
  // shared island's bbox center out to the offset ring center.
  // Neighbour 'ai' has no offset, so no leader line should be appended.
  const mfCircle = appended.find((n) => n.tagName === 'circle' && n._attrs.get('data-hit-for') === 'mf');
  const sxCircle = appended.find((n) => n.tagName === 'circle' && n._attrs.get('data-hit-for') === 'sx');
  const aiCircle = appended.find((n) => n.tagName === 'circle' && n._attrs.get('data-hit-for') === 'ai');
  const mfLeader = appended.find((n) => n.tagName === 'line' && n._attrs.get('data-hit-for') === 'mf');
  const sxLeader = appended.find((n) => n.tagName === 'line' && n._attrs.get('data-hit-for') === 'sx');
  const aiLeader = appended.find((n) => n.tagName === 'line' && n._attrs.get('data-hit-for') === 'ai');
  assert.ok(mfCircle, 'mf hit-target circle was appended');
  assert.ok(sxCircle, 'sx hit-target circle was appended');
  assert.ok(aiCircle, 'ai hit-target circle was appended');
  assert.ok(mfLeader, 'mf leader line was appended (offset → island)');
  assert.ok(sxLeader, 'sx leader line was appended (offset → island)');
  assert.equal(aiLeader, undefined, 'ai has no offset → no leader line');
  // Leader endpoints: (x1,y1) is the island bbox center, (x2,y2) is the
  // ring center. Pins the direction so a future "swap endpoints" edit
  // (which would put the line endpoint outside the ring instead of
  // hidden beneath it) gets caught.
  assert.equal(parseFloat(mfLeader._attrs.get('x1')), sharedBbox.x + sharedBbox.width / 2);
  assert.equal(parseFloat(mfLeader._attrs.get('y1')), sharedBbox.y + sharedBbox.height / 2);
  assert.equal(parseFloat(mfLeader._attrs.get('x2')), parseFloat(mfCircle._attrs.get('cx')));
  assert.equal(parseFloat(mfLeader._attrs.get('y2')), parseFloat(mfCircle._attrs.get('cy')));
  // DOM order: leader BEFORE the circle so the ring renders on top.
  const mfLeaderIdx = appended.indexOf(mfLeader);
  const mfCircleIdx = appended.indexOf(mfCircle);
  assert.ok(mfLeaderIdx < mfCircleIdx, 'leader appended before circle so the ring renders on top');

  const bboxCx = sharedBbox.x + sharedBbox.width / 2;
  const bboxCy = sharedBbox.y + sharedBbox.height / 2;
  // mf and sx must NOT both sit at the bbox center — that's the bug.
  const mfCy = parseFloat(mfCircle._attrs.get('cy'));
  const sxCy = parseFloat(sxCircle._attrs.get('cy'));
  assert.notEqual(mfCy, sxCy, 'mf and sx must not share a y center');
  assert.ok(mfCy < bboxCy, 'mf shifted north of the shared bbox center');
  assert.ok(sxCy > bboxCy, 'sx shifted south of the shared bbox center');

  // ai (not in the offset table) must keep the exact bbox center.
  const aiBboxCx = aiBbox.x + aiBbox.width / 2;
  const aiBboxCy = aiBbox.y + aiBbox.height / 2;
  assert.equal(parseFloat(aiCircle._attrs.get('cx')), aiBboxCx);
  assert.equal(parseFloat(aiCircle._attrs.get('cy')), aiBboxCy);
});

