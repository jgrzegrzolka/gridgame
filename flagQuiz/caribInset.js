// Caribbean-microstate inset for the flag map.
//
// Four islands sit piled on top of one another in worldMap.svg: Anguilla (ai),
// Saint-Martin (mf), Sint Maarten (sx) and Saint-Barthélemy (bl). At world
// scale they're 0.4–1.4 map units across and only 1–3 units apart, so in place
// they're invisible specks whose enlarged marker rings overlap almost
// completely — you can't see them and a click is a coin-flip between them.
//
// This inset redraws the four from real Natural Earth 10m coastlines (public
// domain, no attribution) at ~380 units/degree, in open ocean, where each is a
// real, separate, clickable island. mf and sx are the French and Dutch halves
// of one physical island, so they render as a single shape split by the border
// and clicking each half resolves to its own country. The caller suppresses
// the same four in place (see flagsdata/page.js) so nothing is duplicated.
//
// Local coords: viewBox 0 0 175 182. Pure geometry + DOM injection, no fetch.
// Covered by caribInset.test.js.

const SVGNS = 'http://www.w3.org/2000/svg';

/** Inset artwork bounds (local coords). */
export const CARIB_INSET_W = 175;
export const CARIB_INSET_H = 182;

/** Country codes drawn in the inset, north-to-south draw order. */
export const CARIB_INSET_CODES = ['ai', 'mf', 'sx', 'bl'];

/** @type {Record<string, string>} local-coord SVG path per country. */
const CARIB_INSET_PATHS = {
  ai: 'M65.5,40.1 L42.0,54.1 L40.9,52.5 L38.3,50.7 L36.5,48.9 L27.8,55.2 L22.6,56.8 L16.0,56.7 L25.8,45.7 L28.7,43.5 L33.1,42.0 L42.8,40.3 L47.2,38.3 L54.0,31.2 L58.8,24.4 L65.3,19.3 L77.0,17.3 L85.9,16.0 L90.2,16.2 L90.1,18.7 L82.5,31.0 L79.6,34.6 L75.4,37.3 L65.5,40.1 Z',
  mf: 'M73.1,108.4 L47.1,98.8 L39.1,97.4 L39.1,97.4 L39.1,95.6 L36.0,96.2 L30.2,98.2 L28.7,98.4 L25.1,96.5 L24.0,94.3 L25.2,92.9 L36.5,92.7 L43.3,91.1 L47.9,87.6 L49.7,81.5 L52.8,79.2 L60.0,76.6 L67.8,74.7 L73.1,74.6 L73.0,82.8 L75.6,94.2 L75.7,105.5 L73.1,108.4 L73.1,108.4 Z',
  sx: 'M73.1,108.4 L68.1,113.8 L42.7,107.4 L37.2,104.7 L34.6,101.5 L39.1,98.4 L39.1,97.4 L47.1,98.8 L73.1,108.4 Z',
  bl: 'M141.0,165.9 L136.4,162.7 L132.5,157.0 L130.2,151.3 L130.7,148.0 L134.0,149.5 L158.9,153.2 L156.2,157.3 L151.9,162.0 L146.7,165.4 L141.0,165.9 Z',
};

/**
 * Inject the Caribbean-microstate inset into a mounted flag-map `<svg>`.
 *
 * Each island path carries `data-hit-for="<code>"`, so the map's existing
 * click delegation resolves a click straight to that country and
 * `flagFillTargets` picks it up for filter highlighting — no bespoke wiring.
 * The group is appended last so the inset paints over ocean, and it's placed
 * and scaled by the caller in map coords.
 *
 * @param {any} svg mounted `<svg>` root (needs `ownerDocument` + `appendChild`)
 * @param {{ x: number, y: number, scale: number, title?: string,
 *   connectTo?: { x: number, y: number } }} opts
 *   top-left placement + zoom in map coords, an optional inset title, and an
 *   optional real map location to draw a pointer line + anchor dot to (so the
 *   inset visibly belongs to the spot the islands actually occupy).
 * @returns {any} the inserted `<g class="carib-inset">`, or null if svg invalid
 */
export function mountCaribInset(svg, opts) {
  if (!svg || !svg.ownerDocument || typeof svg.appendChild !== 'function') return null;
  const doc = svg.ownerDocument;
  const { x, y, scale, title, connectTo } = opts;

  // Pointer line from the real Caribbean location to the inset's left edge,
  // ending in a tiny dot on the exact spot. Drawn first, so the inset frame
  // paints over the line's end.
  if (connectTo) {
    const link = doc.createElementNS(SVGNS, 'line');
    link.setAttribute('class', 'carib-inset-link');
    link.setAttribute('x1', String(connectTo.x));
    link.setAttribute('y1', String(connectTo.y));
    link.setAttribute('x2', String(x));
    link.setAttribute('y2', String(y + (CARIB_INSET_H * scale) / 2));
    svg.appendChild(link);
    // The anchor dot is a zero-length round-capped line, not a circle, so it
    // renders at a fixed pixel size (non-scaling-stroke) a hair wider than the
    // pointer line — a circle radius would grow with map zoom and drift out of
    // proportion with the line.
    const dot = doc.createElementNS(SVGNS, 'line');
    dot.setAttribute('class', 'carib-inset-anchor');
    dot.setAttribute('x1', String(connectTo.x));
    dot.setAttribute('y1', String(connectTo.y));
    dot.setAttribute('x2', String(connectTo.x));
    dot.setAttribute('y2', String(connectTo.y));
    svg.appendChild(dot);
  }

  const g = doc.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'carib-inset');
  g.setAttribute('transform', `translate(${x},${y}) scale(${scale})`);

  const frame = doc.createElementNS(SVGNS, 'rect');
  frame.setAttribute('class', 'carib-inset-frame');
  frame.setAttribute('x', '0');
  frame.setAttribute('y', '0');
  frame.setAttribute('width', String(CARIB_INSET_W));
  frame.setAttribute('height', String(CARIB_INSET_H));
  g.appendChild(frame);

  if (title) {
    const t = doc.createElementNS(SVGNS, 'text');
    t.setAttribute('class', 'carib-inset-title');
    t.setAttribute('x', String(CARIB_INSET_W / 2));
    // Bottom margin — the islands crowd the top (Anguilla) and mid, and the
    // bottom-right (St-Barthélemy) leaves the bottom-centre clear.
    t.setAttribute('y', String(CARIB_INSET_H - 6));
    t.textContent = title;
    g.appendChild(t);
  }

  for (const code of CARIB_INSET_CODES) {
    const p = doc.createElementNS(SVGNS, 'path');
    p.setAttribute('class', 'carib-island');
    p.setAttribute('data-hit-for', code);
    p.setAttribute('d', CARIB_INSET_PATHS[code]);
    g.appendChild(p);
  }

  svg.appendChild(g);
  return g;
}
