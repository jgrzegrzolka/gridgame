import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  markCountry, resetMap, mountFlagMap, tagCountryPaths, cropToCountries,
  offsetHitTargetCenter, paintCountryFlag, clearCountryFlag, settleFlagToTint,
  revealFlagImage, computeMainlandBbox,
} from './flagMap.js';
import { FLAG_TINTS } from '../flags/flagTints.js';

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
  // 'sj' (Svalbard) is a real ISO code the bundled maps don't carry;
  // 'ax' (Åland) isn't in this minimal fakeRoot. Neither must throw.
  assert.doesNotThrow(() => markCountry(root, 'ax', 'correct'));
  assert.doesNotThrow(() => markCountry(root, 'sj', 'wrong'));
});

test('the world map carries an injected Åland (ax) element', () => {
  // Åland is an autonomous territory the source map omits; we inject an
  // `ax` <g> + locator so flagsdata rings it and it's clickable in the
  // Europe crop. `ax` is also listed in MICROSTATE_CODES. Pin the SVG
  // presence so a future asset re-import can't silently drop it.
  const world = readFileSync(new URL('./worldMap.svg', import.meta.url), 'utf8');
  assert.match(world, /id="ax"/, 'worldMap.svg must carry an ax element');
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

/* paintCountryFlag — flag-into-contour fill + green/red outline + flash.
 *
 * Hand-rolled SVG fake: enough surface for the function — a document
 * that creates element-like nodes, a country `<g>` with two child paths
 * (one a real sub-country to be skipped), and a microstate ring overlay.
 * Nodes can act as parents (`insertBefore` / `children`) and clone
 * themselves (`cloneNode`) so the answer-flash overlay path is exercised.
 */
function makeNode(tag) {
  const attrs = new Map();
  const classes = new Set();
  const children = [];
  // Minimal CSSStyleDeclaration: direct `style.fill = …` plus setProperty /
  // getPropertyValue for custom props like `--flag-tint`. Methods are
  // non-enumerable so cloneNode's Object.keys copy skips them.
  const style = {};
  Object.defineProperty(style, 'setProperty', {
    value: (k, v) => { style[k] = String(v); },
  });
  Object.defineProperty(style, 'getPropertyValue', {
    value: (k) => style[k] || '',
  });
  const node = {
    tagName: tag,
    style,
    children,
    parentNode: null,
    nextSibling: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      _set: classes,
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    setAttributeNS: (_ns, k, v) => attrs.set(k.replace(/^.*:/, ''), String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: (k) => attrs.delete(k),
    appendChild: (c) => { children.push(c); c.parentNode = node; return c; },
    insertBefore: (c) => { children.push(c); c.parentNode = node; return c; },
    removeChild: (c) => {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    addEventListener: () => {},
    cloneNode: () => {
      const clone = makeNode(tag);
      for (const k of Object.keys(node.style)) clone.style[k] = node.style[k];
      return clone;
    },
    _attrs: attrs,
  };
  return node;
}

function fakeFlagSvg(code = 'es') {
  const doc = { createElementNS: (_ns, tag) => makeNode(tag) };
  let defs = null;
  // The country element returned by `#es` — a <g> wrapper that carries the
  // status outline class and exposes its inner paths via querySelectorAll.
  const group = makeNode('g');
  const innerPath = makeNode('path');
  innerPath.parentNode = group;
  const subCountry = makeNode('path');       // e.g. French Guiana inside <g id="fr">
  subCountry.classList.add('map-country');
  subCountry.parentNode = group;
  group.querySelectorAll = (sel) => (sel === 'path' ? [innerPath, subCountry] : []);
  const hit = makeNode('circle');
  // Ring overlays live in their own layer in the real asset; give it a
  // parent so the flash overlay's `insertBefore` has somewhere to land.
  const hitLayer = makeNode('g');
  hitLayer.appendChild(hit);
  const allNodes = [innerPath, subCountry, hit, group];
  const hasAnyClass = (n, classes) => classes.some((c) => n.classList._set.has(c));
  // Flash clones carry class "flag-flash" via setAttribute('class', ...)
  // — collect every node under group/hitLayer whose class attr says so.
  const collectFlashes = () => [group, hitLayer]
    .flatMap((p) => p.children)
    .filter((c) => c.getAttribute('class') === 'flag-flash');
  const svg = {
    ownerDocument: doc,
    firstChild: null,
    insertBefore: (node) => { defs = node; },
    querySelector: (sel) => {
      // `#flagfill-xx image` — the pattern's <image> (for swapFlagDetail).
      const patImg = sel.match(/^#(flagfill-\w+) image$/);
      if (patImg) {
        const pat = defs && defs.children.find((c) => c.getAttribute('id') === patImg[1]);
        return pat ? pat.children.find((c) => c.tagName === 'image') || null : null;
      }
      if (sel.startsWith('#flagfill-')) {
        if (!defs) return null;
        return defs.children.find((c) => c.getAttribute('id') === sel.slice(1)) || null;
      }
      if (sel === 'defs') return defs;
      if (sel === '#' + code) return group;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('map-hit-target')) return [hit];
      if (sel === '.flag-flash') return collectFlashes();
      if (sel.includes('is-flag')) {
        const classes = sel.split(',').map((s) => s.trim().replace(/^\./, ''));
        return allNodes.filter((n) => hasAnyClass(n, classes));
      }
      if (sel === '.is-correct, .is-wrong') return [];
      return [];
    },
    _refs: { innerPath, subCountry, hit, group, hitLayer, collectFlashes, get defs() { return defs; } },
  };
  return svg;
}

test('paintCountryFlag fills the country path + microstate ring with a flag pattern at 90%', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  const { innerPath, hit } = svg._refs;
  assert.equal(innerPath.style.fill, 'url(#flagfill-es)');
  assert.equal(innerPath.style.fillOpacity, '0.9');
  assert.equal(innerPath.classList.contains('is-flagged'), true);
  assert.equal(hit.style.fill, 'url(#flagfill-es)');
  assert.equal(hit.style.fillOpacity, '0.9');
  assert.equal(hit.classList.contains('is-flagged'), true);
});

test('paintCountryFlag records the answer status so the settled wash can read it', () => {
  const correct = fakeFlagSvg('es');
  paintCountryFlag(correct, 'es', '../flags/svg/', 'correct');
  assert.equal(correct._refs.innerPath.classList.contains('is-flag-correct'), true);
  assert.equal(correct._refs.hit.classList.contains('is-flag-correct'), true);
  const wrong = fakeFlagSvg('es');
  paintCountryFlag(wrong, 'es', '../flags/svg/', 'wrong');
  assert.equal(wrong._refs.innerPath.classList.contains('is-flag-wrong'), true);
});

test('settleFlagToTint tags the painted path + ring with is-tinted, skipping the sub-country', () => {
  const svg = fakeFlagSvg('es');
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  settleFlagToTint(svg, 'es');
  const { innerPath, hit, subCountry } = svg._refs;
  assert.equal(innerPath.classList.contains('is-tinted'), true);
  assert.equal(hit.classList.contains('is-tinted'), true);
  // The inner sub-country (its own country, e.g. French Guiana) is skipped —
  // same carve-out flagFillTargets makes when painting.
  assert.equal(subCountry.classList.contains('is-tinted'), false);
});

test('revealFlagImage drops is-tinted so the real flag shows again (keeps is-flagged)', () => {
  const svg = fakeFlagSvg('es');
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  settleFlagToTint(svg, 'es');
  assert.equal(svg._refs.innerPath.classList.contains('is-tinted'), true);
  revealFlagImage(svg, 'es');
  assert.equal(svg._refs.innerPath.classList.contains('is-tinted'), false);
  assert.equal(svg._refs.hit.classList.contains('is-tinted'), false);
  // Still an image fill, just no longer the settled wash.
  assert.equal(svg._refs.innerPath.classList.contains('is-flagged'), true);
});

test('settleFlagToTint ignores non-ISO2 codes', () => {
  const svg = fakeFlagSvg('es');
  settleFlagToTint(svg, 'ESP');
  settleFlagToTint(svg, '');
  assert.equal(svg._refs.innerPath.classList.contains('is-tinted'), false);
});

test('clearCountryFlag removes the is-tinted demotion along with is-flagged', () => {
  const svg = fakeFlagSvg('es');
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  settleFlagToTint(svg, 'es');
  clearCountryFlag(svg, 'es');
  const { innerPath, hit } = svg._refs;
  assert.equal(innerPath.classList.contains('is-tinted'), false);
  assert.equal(hit.classList.contains('is-tinted'), false);
  assert.equal(innerPath.classList.contains('is-flagged'), false);
  assert.equal(innerPath.classList.contains('is-flag-correct'), false);
});

test('paintCountryFlag drops a green tint overlay on top of the flag (correct)', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  const flashes = svg._refs.collectFlashes();
  // One clone over the inner country path, one over the ring.
  assert.equal(flashes.length, 2);
  assert.ok(flashes.every((f) => f.style.fill === '#2a8a3a'));
  assert.ok(flashes.every((f) => f.getAttribute('class') === 'flag-flash'));
});

test('paintCountryFlag tint overlay is red for a wrong answer', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'wrong');
  assert.ok(svg._refs.collectFlashes().every((f) => f.style.fill === '#c0392b'));
});

test('paintCountryFlag frames the answered country with a thin green outline (correct)', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  const { innerPath, hit } = svg._refs;
  for (const el of [innerPath, hit]) {
    assert.equal(el.style.stroke, '#2a8a3a');
    assert.equal(el.style.strokeWidth, '1.5');
    assert.equal(el.style.strokeOpacity, '0.6');
    // non-scaling-stroke keeps the outline a constant hairline at every zoom.
    assert.equal(el.style.vectorEffect, 'non-scaling-stroke');
  }
});

test('paintCountryFlag outline is red for a wrong answer', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'wrong');
  assert.equal(svg._refs.innerPath.style.stroke, '#c0392b');
});

test('paintCountryFlag does not outline inner sub-country paths', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  // French-Guiana-style sub-path stays unframed along with unpainted.
  assert.equal(svg._refs.subCountry.style.stroke, undefined);
});

test('paintCountryFlag flash clone carries no outline (border lives on the country, not the wash)', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  assert.ok(svg._refs.collectFlashes().every((f) => f.style.stroke === 'none'));
});

test('paintCountryFlag skips inner paths that are themselves countries', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  // The .map-country sub-path (French-Guiana-style) must stay unpainted.
  assert.equal(svg._refs.subCountry.style.fill, undefined);
  assert.equal(svg._refs.subCountry.classList.contains('is-flagged'), false);
});

test('paintCountryFlag points the pattern image at the flag svg', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  const pattern = svg._refs.defs.children[0];
  assert.equal(pattern.getAttribute('id'), 'flagfill-es');
  const image = pattern.children[0];
  assert.equal(image.getAttribute('href'), '../flags/svg/es.svg');
  assert.equal(image.getAttribute('preserveAspectRatio'), 'xMidYMid slice');
});

test('paintCountryFlag sets the dominant-colour tint used while the map moves', () => {
  const svg = fakeFlagSvg('pl');
  paintCountryFlag(svg, 'pl', '../flags/svg/', 'correct');
  // The country path carries --flag-tint = Poland's dominant colour, which CSS
  // fills it with during a gesture (cheap, no flag image to raster).
  assert.equal(svg._refs.innerPath.style.getPropertyValue('--flag-tint'), FLAG_TINTS.pl);
  assert.ok(/^#[0-9a-f]{6}$/.test(FLAG_TINTS.pl));
});

test('paintCountryFlag reuses an existing pattern instead of duplicating it', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  paintCountryFlag(svg, 'es', '../flags/svg/', 'wrong');
  assert.equal(svg._refs.defs.children.length, 1);
});

test('paintCountryFlag lowercases the code and rejects malformed input', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'ES', '../flags/svg/', 'correct');
  assert.equal(svg._refs.innerPath.style.fill, 'url(#flagfill-es)');
  assert.doesNotThrow(() => paintCountryFlag(svg, '', '../flags/svg/', 'correct'));
  assert.doesNotThrow(() => paintCountryFlag(/** @type {any} */ (null), 'es', '../flags/svg/', 'correct'));
  assert.doesNotThrow(() => paintCountryFlag(svg, 'es-pv', '../flags/svg/', 'correct'));
});

test('resetMap clears the flag fills and removes the tint overlays', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'correct');
  assert.equal(svg._refs.collectFlashes().length, 2);
  resetMap(svg);
  const { innerPath, hit } = svg._refs;
  assert.equal(innerPath.style.fill, '');
  assert.equal(innerPath.style.fillOpacity, '');
  // The green / red answer outline is cleared too.
  assert.equal(innerPath.style.stroke, '');
  assert.equal(innerPath.style.strokeOpacity, '');
  assert.equal(innerPath.classList.contains('is-flagged'), false);
  assert.equal(hit.style.fill, '');
  assert.equal(hit.classList.contains('is-flagged'), false);
  // The overlay clones are detached from their parents.
  assert.equal(svg._refs.collectFlashes().length, 0);
});

test("paintCountryFlag 'select' stamps the flag with no flash clone and no outline", () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'select');
  const { innerPath, hit } = svg._refs;
  // Flag fill is applied (the whole point) at the 90% opacity...
  assert.equal(innerPath.style.fill, 'url(#flagfill-es)');
  assert.equal(innerPath.style.fillOpacity, '0.9');
  assert.equal(hit.style.fill, 'url(#flagfill-es)');
  assert.equal(innerPath.classList.contains('is-flagged'), true);
  // ...but no green / red answer outline and no colour-wash overlay:
  // flagsdata's neutral highlight is just the flag.
  assert.equal(innerPath.style.stroke, undefined);
  assert.equal(svg._refs.collectFlashes().length, 0);
});

test('clearCountryFlag un-stamps exactly one country (paint inverse)', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'select');
  clearCountryFlag(svg, 'es');
  const { innerPath, hit } = svg._refs;
  assert.equal(innerPath.style.fill, '');
  assert.equal(innerPath.style.fillOpacity, '');
  assert.equal(innerPath.classList.contains('is-flagged'), false);
  assert.equal(hit.style.fill, '');
  assert.equal(hit.classList.contains('is-flagged'), false);
});

test('clearCountryFlag lowercases the code and ignores malformed input', () => {
  const svg = fakeFlagSvg();
  paintCountryFlag(svg, 'es', '../flags/svg/', 'select');
  clearCountryFlag(svg, 'ES');
  assert.equal(svg._refs.innerPath.style.fill, '');
  assert.doesNotThrow(() => clearCountryFlag(svg, ''));
  assert.doesNotThrow(() => clearCountryFlag(/** @type {any} */ (null), 'es'));
  assert.doesNotThrow(() => clearCountryFlag(svg, 'es-pv'));
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

// A country whose #code element exposes leaf paths (with getBBox) for the
// clustering in computeMainlandBbox to walk. `paths` is a list of raw bboxes.
function fakeSvgWithPaths(code, paths) {
  const leaves = paths.map((p) => ({ tagName: 'path', getBBox: () => p }));
  // getBBox on the group returns the union of its paths — the single-shape
  // fallback (computeCountriesBbox) reads it.
  const union = () => {
    const minX = Math.min(...paths.map((p) => p.x));
    const minY = Math.min(...paths.map((p) => p.y));
    const maxX = Math.max(...paths.map((p) => p.x + p.width));
    const maxY = Math.max(...paths.map((p) => p.y + p.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };
  const el = { querySelectorAll: () => leaves, getBBox: () => union() };
  return {
    querySelector: (sel) => (sel === `#${code}` ? el : null),
  };
}

test('computeMainlandBbox frames the mainland and drops a far-flung territory', () => {
  // Mainland (a big shape) plus a small territory an ocean away (gap > 40).
  // The territory forms its own cluster and is dropped; we frame the mainland.
  const svg = fakeSvgWithPaths('fr', [
    { x: 1278, y: 259, width: 96, height: 82 },  // metropolitan France
    { x: 883, y: 649, width: 23, height: 31 },   // French Guiana (far SW)
  ]);
  const bb = computeMainlandBbox(svg, 'fr');
  // Mainland only, + 5% pad: padX = 96*0.05 = 4.8, padY = 82*0.05 = 4.1
  assert.equal(bb.x, 1278 - 4.8);
  assert.equal(bb.width, 96 + 9.6);
  assert.equal(bb.height, 82 + 8.2);
});

test('computeMainlandBbox keeps an archipelago whole (all paths within the gap)', () => {
  // Three islands each within 40 units of the next — one chain, kept together.
  const svg = fakeSvgWithPaths('id', [
    { x: 100, y: 100, width: 30, height: 20 },
    { x: 150, y: 105, width: 30, height: 20 }, // 20 from the first
    { x: 200, y: 110, width: 30, height: 20 }, // 20 from the second
  ]);
  const bb = computeMainlandBbox(svg, 'id');
  // Union x:100..230, y:100..130 → w130 h30, +5% pad (6.5, 1.5)
  assert.equal(bb.x, 100 - 6.5);
  assert.equal(bb.width, 130 + 13);
  assert.equal(bb.height, 30 + 3);
});

test('computeMainlandBbox picks the largest-area cluster, not the widest gap', () => {
  // Two clusters: a small one and a big one, far apart. Big one wins.
  const svg = fakeSvgWithPaths('us', [
    { x: 500, y: 300, width: 400, height: 200 }, // mainland (huge area)
    { x: 100, y: 100, width: 120, height: 120 }, // a large-ish but smaller territory, far
  ]);
  const bb = computeMainlandBbox(svg, 'us');
  assert.equal(bb.x, 500 - 400 * 0.05);
  assert.equal(bb.width, 400 + 400 * 0.1);
});

test('computeMainlandBbox rejects non-ISO2 codes and falls back for single shapes', () => {
  assert.equal(computeMainlandBbox(fakeSvgWithPaths('fr', []), 'FRANCE'), null);
  // A single path: nothing to cluster → still returns a padded bbox (union path).
  const svg = fakeSvgWithPaths('dk', [{ x: 0, y: 0, width: 40, height: 40 }]);
  const bb = computeMainlandBbox(svg, 'dk');
  assert.ok(bb && bb.width === 40 + 4);
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

  /**
   * @param {string} id
   * @param {Array<{x:number,y:number,width:number,height:number}>} pathBboxes
   *   One or more inner <path> bboxes. addHitTargets unions them — using
   *   the FIRST only is the bug that put Falkland's ring on a tiny
   *   outlying island instead of the East/West Falkland landmass.
   */
  const groupWithPaths = (id, pathBboxes) => {
    const classes = new Set();
    const paths = pathBboxes.map((bb, i) => ({ tagName: 'path', _i: i, getBBox: () => bb }));
    return {
      id,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        has: (c) => classes.has(c),
      },
      querySelector: (sel) => (sel === 'path' ? paths[0] : null),
      querySelectorAll: (sel) => (sel === 'path' ? paths : []),
      // `<g>`-wrapped countries don't bbox themselves — they have to
      // be unioned from their children. Mirror the real DOM by
      // omitting getBBox; the production code must hit the union
      // path, not the wrapper-bbox fallback.
      _classes: classes,
    };
  };

  // mf & sx still share one tiny path (the Caribbean island they both
  // sit on); ai is its own single path. fk (Falklands) ships a tiny
  // outlying island FIRST in DOM order plus a much bigger East-Falkland
  // path — the union must produce a bbox covering both, not just the
  // first (the historical bug).
  const fkOutlier = { x: 912.7, y: 1145.9, width: 0.5, height: 0.5 };
  const fkEast = { x: 921.5, y: 1147.0, width: 11, height: 2 };
  // ki (Kiribati): path fragments at the FAR WEST (x=99) and FAR EAST
  // (x=2630) of the world map — the country actually straddles the
  // antimeridian. A naive union produces a bbox ~2530 vbu wide; if
  // we used that center we'd plant the ring in the middle of the
  // Indian Ocean, and the data-country-r enclosure rule would inflate
  // the ring to half the map (when fill-painted by is-selected, the
  // whole world goes pink — the bug this test pins). The fix: detect
  // anomalously wide union, fall back to the locator <circle>.
  const kiWestFragment = { x: 99, y: 683, width: 2, height: 2 };
  const kiEastFragment = { x: 2630, y: 681, width: 0.7, height: 0.7 };
  const kiLocator = { x: 2621.5, y: 676.2, width: 12, height: 12 }; // <circle cx=2627.5 cy=682.2 r=6>
  const groupWithPathsAndLocator = (id, pathBboxes, locatorBb) => {
    const node = groupWithPaths(id, pathBboxes);
    const locatorNode = { tagName: 'circle', getBBox: () => locatorBb };
    const origQuerySelector = node.querySelector;
    node.querySelector = (sel) => {
      if (sel === 'circle') return locatorNode;
      return origQuerySelector(sel);
    };
    return node;
  };
  const byId = new Map([
    ['mf', groupWithPaths('mf', [sharedBbox])],
    ['sx', groupWithPaths('sx', [sharedBbox])],
    ['ai', groupWithPaths('ai', [aiBbox])],
    ['fk', groupWithPaths('fk', [fkOutlier, fkEast])],
    ['ki', groupWithPathsAndLocator('ki', [kiWestFragment, kiEastFragment], kiLocator)],
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

  // data-country-r is the minimum-enclosing-circle radius for the
  // country's own bbox (diagonal/2 + 0.5 vbu padding). mapZoom's
  // rescaleHitTargets uses it as a floor so a pinch-zoomed-in ring
  // never renders smaller than the visible country it's marking.
  const expectedAiCountryR = Math.hypot(aiBbox.width, aiBbox.height) / 2 + 0.5;
  assert.ok(
    Math.abs(parseFloat(aiCircle._attrs.get('data-country-r')) - expectedAiCountryR) < 1e-9,
    `ai data-country-r mismatch`,
  );
  // Both mf and sx share the same inner-path bbox in this fake — their
  // country-r must therefore match it too, regardless of how their
  // ring CENTER was offset away from the landmass.
  const expectedSharedCountryR = Math.hypot(sharedBbox.width, sharedBbox.height) / 2 + 0.5;
  assert.ok(
    Math.abs(parseFloat(mfCircle._attrs.get('data-country-r')) - expectedSharedCountryR) < 1e-9,
    `mf data-country-r mismatch`,
  );
  assert.ok(
    Math.abs(parseFloat(sxCircle._attrs.get('data-country-r')) - expectedSharedCountryR) < 1e-9,
    `sx data-country-r mismatch`,
  );

  // Falklands: the ring center MUST sit on the union of the outlier +
  // East Falkland bboxes, not on the first-path-only outlier. Pre-fix
  // the ring landed at ~(912.95, 1146.15); post-fix it centers on the
  // archipelago at ~(923.85, 1146.4). Pinning catches a regression to
  // "first path only".
  const fkCircle = appended.find((n) => n.tagName === 'circle' && n._attrs.get('data-hit-for') === 'fk');
  assert.ok(fkCircle, 'fk hit-target circle was appended');
  const fkMinX = Math.min(fkOutlier.x, fkEast.x);
  const fkMinY = Math.min(fkOutlier.y, fkEast.y);
  const fkMaxX = Math.max(fkOutlier.x + fkOutlier.width, fkEast.x + fkEast.width);
  const fkMaxY = Math.max(fkOutlier.y + fkOutlier.height, fkEast.y + fkEast.height);
  const fkExpectedCx = (fkMinX + fkMaxX) / 2;
  const fkExpectedCy = (fkMinY + fkMaxY) / 2;
  assert.ok(
    Math.abs(parseFloat(fkCircle._attrs.get('cx')) - fkExpectedCx) < 1e-9,
    `fk ring cx should sit at the union center ${fkExpectedCx}, got ${fkCircle._attrs.get('cx')}`,
  );
  assert.ok(
    Math.abs(parseFloat(fkCircle._attrs.get('cy')) - fkExpectedCy) < 1e-9,
    `fk ring cy should sit at the union center ${fkExpectedCy}, got ${fkCircle._attrs.get('cy')}`,
  );
  // And the country-r should reflect the UNION diagonal, big enough to
  // wrap both islands at deep zoom.
  const fkExpectedCountryR = Math.hypot(fkMaxX - fkMinX, fkMaxY - fkMinY) / 2 + 0.5;
  assert.ok(
    Math.abs(parseFloat(fkCircle._attrs.get('data-country-r')) - fkExpectedCountryR) < 1e-9,
    `fk data-country-r should encompass the union, got ${fkCircle._attrs.get('data-country-r')}`,
  );

  // Kiribati (antimeridian-spanning): the union of (99, …) and (2630, …)
  // is ~2530 vbu wide — way past the asset's 0.4 × natural-width
  // threshold. The fix must fall back to the locator <circle>'s
  // bbox center AND set data-country-r to 0 so rescaleHitTargets
  // doesn't inflate the ring to half the map and paint the world
  // pink when the country is selected. Pin both behaviors.
  const kiCircle = appended.find((n) => n.tagName === 'circle' && n._attrs.get('data-hit-for') === 'ki');
  assert.ok(kiCircle, 'ki hit-target circle was appended');
  const kiLocatorCx = kiLocator.x + kiLocator.width / 2;
  const kiLocatorCy = kiLocator.y + kiLocator.height / 2;
  assert.ok(
    Math.abs(parseFloat(kiCircle._attrs.get('cx')) - kiLocatorCx) < 1e-9,
    `ki ring cx should fall back to the locator center ${kiLocatorCx}, got ${kiCircle._attrs.get('cx')}`,
  );
  assert.ok(
    Math.abs(parseFloat(kiCircle._attrs.get('cy')) - kiLocatorCy) < 1e-9,
    `ki ring cy should fall back to the locator center ${kiLocatorCy}, got ${kiCircle._attrs.get('cy')}`,
  );
  assert.equal(
    parseFloat(kiCircle._attrs.get('data-country-r')), 0,
    'ki data-country-r MUST be 0 (no enclosure) so the ring stays the default size',
  );
});

