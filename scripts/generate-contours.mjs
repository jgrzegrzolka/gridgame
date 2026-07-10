/**
 * Generate normalized country-contour silhouettes for the Flag Party "map"
 * round (PARTY.md, iteration 4). For each sovereign country with usable
 * geometry in `flagQuiz/worldMap.svg`, this writes a tile-ready
 * `flags/contours/<code>.svg` — a single silhouette cropped to the country's
 * mainland (largest area-weighted proximity cluster, so far-flung territories
 * like French Guiana / Alaska / the Azores don't blow up the bounding box,
 * while genuine archipelagos like Indonesia stay whole) and squared to a
 * padded viewBox so every contour fits the same 2×2 grid tile.
 *
 * The set of codes it emits IS the map round's pool (`flags/contourPool.js`),
 * so a country only becomes a map question if it produced a recognizable
 * contour here — microstates that render as unreadable dots are skipped.
 *
 * Offline authoring tool (needs a browser for getBBox); not shipped runtime.
 * Run: `node scripts/generate-contours.mjs`
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { sovereignPool } from '../flags/flagPools.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CONTOUR_DIR = `${ROOT}/flags/contours`;
const MAP_SVG = `${ROOT}/flagQuiz/worldMap.svg`;
const FLY_CLUSTER_GAP = 40;   // same as flagMap.js — map-unit gap that clusters islands
const MIN_SIDE = 12;          // mainland bbox shorter than this reads as a dot at tile size → skip
const MIN_COMPONENT = 10;     // biggest single landmass must clear this, so scattered-dot island
                              // nations (Tonga, São Tomé, Fiji…) drop out while real archipelagos
                              // (Indonesia, Philippines — one large main island) stay in

/**
 * Hand-excluded after eyeballing the full render — cases the geometry can't
 * represent recognizably, so they'd be bad "which outline is X?" questions:
 *   - ru: crosses the antimeridian, so the mainland cluster renders as an
 *         unrecognizable horizontal smear.
 *   - fj / sb: scattered island specks whose largest landmass clears the size
 *         gate but still reads as a handful of dots, not a country.
 * (These still appear in the flag-pick rounds — only their contour is dropped.)
 */
const EXCLUDE = new Set(['ru', 'fj', 'sb']);

const countries = JSON.parse(readFileSync(`${ROOT}/flags/countries.json`, 'utf8'));
const svgText = readFileSync(MAP_SVG, 'utf8');
const sovereignCodes = sovereignPool(countries).map((c) => c.code).sort();

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(`<!doctype html><div id="src">${svgText}</div>`);

const results = await page.evaluate(({ codes, GAP, MIN_SIDE, MIN_COMPONENT, EXCLUDE }) => {
  const src = document.getElementById('src');
  const NS = 'http://www.w3.org/2000/svg';
  const SEL = 'path, polygon, polyline';
  const gap = (a, b) => {
    const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
    const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    return Math.hypot(dx, dy);
  };
  // The land geometry is sometimes the matched element itself (a bare
  // `<path id="af">`) and sometimes its descendants (`<g id="it">` of coastline
  // paths, or `<g id="fr"><g id="frx"><path>`). Handle both, and measure the
  // ATTACHED elements — getBBox returns 0 on a detached clone.
  const geomEls = (el) => (el.matches && el.matches(SEL) ? [el] : Array.from(el.querySelectorAll(SEL)));
  function mainlandBox(els) {
    const boxes = [];
    for (const p of els) {
      let b; try { b = p.getBBox(); } catch { continue; }
      if (!b || (b.width === 0 && b.height === 0)) continue;
      boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, area: b.width * b.height });
    }
    if (boxes.length === 0) return null;
    if (boxes.length === 1) { const b = boxes[0]; return { x: b.x, y: b.y, w: b.w, h: b.h, maxComponent: Math.max(b.w, b.h) }; }
    const parent = boxes.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
      if (gap(boxes[i], boxes[j]) <= GAP) parent[find(i)] = find(j);
    const areaByRoot = new Map();
    for (let i = 0; i < boxes.length; i++) { const r = find(i); areaByRoot.set(r, (areaByRoot.get(r) || 0) + boxes[i].area); }
    let bestRoot = -1, bestArea = -1;
    for (const [r, a] of areaByRoot) if (a > bestArea) { bestArea = a; bestRoot = r; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxComponent = 0;
    for (let i = 0; i < boxes.length; i++) { if (find(i) !== bestRoot) continue; const b = boxes[i];
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      maxComponent = Math.max(maxComponent, b.w, b.h); }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, maxComponent };
  }
  const out = [];
  for (const code of codes) {
    if (EXCLUDE.includes(code)) { out.push({ code, ok: false, reason: 'excluded' }); continue; }
    const el = src.querySelector('[id="' + code + '"]');
    if (!el) { out.push({ code, ok: false, reason: 'no-group' }); continue; }
    const els = geomEls(el);
    if (els.length === 0) { out.push({ code, ok: false, reason: 'no-geometry' }); continue; }
    const bb = mainlandBox(els);
    if (!bb) { out.push({ code, ok: false, reason: 'no-geometry' }); continue; }
    const clone = el.cloneNode(true);
    clone.querySelectorAll('circle, title').forEach((c) => c.remove());
    const side = Math.max(bb.w, bb.h);
    if (side < MIN_SIDE) { out.push({ code, ok: false, reason: 'too-small', side: +side.toFixed(1) }); continue; }
    if (bb.maxComponent < MIN_COMPONENT) { out.push({ code, ok: false, reason: 'scattered', maxComponent: +bb.maxComponent.toFixed(1) }); continue; }
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2, pad = side * 0.08;
    const vb = [cx - side / 2 - pad, cy - side / 2 - pad, side + 2 * pad, side + 2 * pad]
      .map((n) => +n.toFixed(2)).join(' ');
    // strip map classes so the file doesn't depend on worldMap's stylesheet
    clone.removeAttribute('class');
    clone.querySelectorAll('[class]').forEach((n) => n.removeAttribute('class'));
    clone.querySelectorAll('[style], [fill]').forEach((n) => { n.removeAttribute('style'); n.removeAttribute('fill'); });
    clone.setAttribute('fill', '#2B1D24');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('viewBox', vb);
    svg.appendChild(clone);
    out.push({ code, ok: true, side: +side.toFixed(1), svg: svg.outerHTML });
  }
  return out;
}, { codes: sovereignCodes, GAP: FLY_CLUSTER_GAP, MIN_SIDE, MIN_COMPONENT, EXCLUDE: [...EXCLUDE] });

await browser.close();

// Rewrite the contours directory from scratch so removed codes don't linger.
if (existsSync(CONTOUR_DIR)) rmSync(CONTOUR_DIR, { recursive: true, force: true });
mkdirSync(CONTOUR_DIR, { recursive: true });

const included = [];
const skipped = [];
for (const r of results) {
  if (r.ok) {
    writeFileSync(`${CONTOUR_DIR}/${r.code}.svg`, `${r.svg}\n`);
    included.push(r.code);
  } else {
    skipped.push(r);
  }
}
included.sort();

const poolFile = `// GENERATED by scripts/generate-contours.mjs — do not edit by hand.
// The sovereign countries with a recognizable contour in flags/contours/,
// which IS the Flag Party map-round pool. Regenerate after touching the
// generator or worldMap.svg.

/** @type {readonly string[]} */
export const CONTOUR_CODES = ${JSON.stringify(included)};

/** @type {ReadonlySet<string>} */
export const CONTOUR_CODE_SET = new Set(CONTOUR_CODES);
`;
writeFileSync(`${ROOT}/flags/contourPool.js`, poolFile);

console.log(`included: ${included.length}`);
console.log(`skipped: ${skipped.length}`);
console.log(JSON.stringify(skipped.sort((a, b) => (a.reason < b.reason ? -1 : 1)), null, 0));
// Smallest included, to sanity-check the MIN_SIDE threshold.
const smallest = results.filter((r) => r.ok).sort((a, b) => a.side - b.side).slice(0, 12);
console.log('smallest included:', smallest.map((r) => `${r.code}:${r.side}`).join(' '));
