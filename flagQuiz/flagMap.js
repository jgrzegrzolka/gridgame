/**
 * Per-variant flag-quiz contour map.
 *
 * Two assets ship today:
 *
 *   - `europeMap.svg` (CC BY-SA 3.0) — Europe-focused, ID'd by ISO 3166-1
 *     alpha-2 lowercase. Used for the Europe variant.
 *   - `worldMap.svg` (CC BY-SA 4.0) — world map, ID'd by ISO 3166-1
 *     alpha-2. Used for Asia (with a runtime viewBox crop) and any
 *     future continent variant.
 *
 * This module is the surface the page wiring talks to. It doesn't know
 * about quiz state, just "paint country X correct" / "paint country X
 * wrong" / "mount this URL into that host" / "crop the viewBox to these
 * countries."
 *
 * Pure DOM, no fetch unless explicitly via `mountFlagMap`. The page
 * mounts the SVG once (inlined into a host element so CSS can reach
 * into it), then calls `markCountry` on each answer.
 *
 * Codes not present in the SVG (e.g. `ax`, `sj`, the EU/CEFTA regional
 * codes the quiz pool also surfaces) silently no-op — they just don't
 * paint, the rest of the round continues unchanged.
 *
 * Status classes on a tagged country element:
 *   - `is-correct` → green fill
 *   - `is-wrong`   → red fill
 *   - neither      → default grey fill (CSS rules in `flagQuiz/index.css`)
 *
 * A second pick at the same country (only possible across a play-again)
 * would re-mark it; `markCountry` clears both classes before setting
 * the new one so the latest answer wins. resetMap clears every marked
 * country at once — used on play-again to start fresh.
 */

const STATUS_CLASSES = ['is-correct', 'is-wrong'];

/**
 * Radius of the visible pink-ring marker, expressed as a fraction of
 * the displayed viewBox's larger dimension. Tuned by eye: small
 * enough that microstate markers don't overwhelm their neighbouring
 * countries on the rendered map, big enough to remain a comfortable
 * click target.
 */
const HIT_TARGET_FRACTION = 0.007;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ISO2_PATTERN = /^[a-z]{2}$/;

/**
 * Curated set of ISO 3166-1 alpha-2 codes whose countries are tiny
 * enough on the rendered map to need the pink-ring marker treatment.
 * Hardcoded rather than auto-detected via getBBox because the world-
 * map asset wraps each country in a `<g>` containing a tiny `<path>`
 * AND a hidden `<circle r=6>` locator — getBBox on the `<g>` returns
 * the inflated union, which misses true microstates (the locator
 * dominates the bbox so Singapore looks 12 units wide and dodges the
 * threshold).
 *
 * Adding a country here makes it get a pink-ring overlay AND become
 * a comfortable click target. List covers both Europe + Asia variants
 * today; extend when adding new continent maps.
 */
const MICROSTATE_CODES = new Set([
  // Europe — Vatican, Monaco, San Marino, Andorra, Liechtenstein, Malta.
  // Luxembourg is intentionally NOT here: at ~2600 km² it's visible-
  // sized as a country path on the Europe map and doesn't need a ring.
  'va', 'mc', 'sm', 'ad', 'li', 'mt',
  // British isles + Crown Dependencies
  'gg', 'je', 'im', 'fo',
  // Asia microstates — only countries whose paths are tinier than
  // the pink ring itself (smaller-than-ring marker would be pointless,
  // e.g. Bhutan / Lebanon / Cyprus are already visible-sized as
  // country paths and don't need a ring on top).
  'sg', 'bh', 'mv', 'bn', 'qa', 'kw', 'hk', 'mo', 'ps',
  // Africa microstates / island nations — same "tinier than the ring"
  // criterion. Cabo Verde, Comoros, Mauritius, Seychelles, São Tomé.
  'cv', 'km', 'mu', 'sc', 'st',
  // Americas — almost all Caribbean island nations + territories, plus
  // Bermuda and the Falklands. Big mainland Caribbean / Central American
  // countries (Cuba, Dominican Republic, Haiti, Jamaica, Trinidad) are
  // visible-sized and don't need rings.
  'ag', 'ai', 'aw', 'bb', 'bl', 'bm', 'bq', 'dm', 'gd', 'gp',
  'kn', 'ky', 'lc', 'mf', 'mq', 'ms', 'sx', 'tc', 'vc', 'vg', 'vi',
  'fk',
  // Oceania — Pacific island nations and territories that are tinier
  // than the pink ring would be. Australia / NZ / PNG / New Caledonia /
  // Fiji / Vanuatu / Solomon Islands / French Polynesia are big enough
  // as drawn paths and don't need rings.
  'as', 'cc', 'ck', 'cx', 'fm', 'gu', 'ki', 'mh', 'mp', 'nf',
  'nr', 'nu', 'pn', 'pw', 'tk', 'to', 'tv', 'wf', 'ws',
]);

/**
 * @typedef {{
 *   querySelector(selector: string): { classList: { add(c: string): void, remove(c: string): void } } | null,
 *   querySelectorAll(selector: string): ArrayLike<{ classList: { add(c: string): void, remove(c: string): void } }>,
 * }} MapRoot
 */

/**
 * Set (or clear) the answer status on one country's SVG element.
 *
 * @param {MapRoot} root
 * @param {string} code
 * @param {'correct' | 'wrong' | 'clear'} state
 */
export function markCountry(root, code, state) {
  if (!root || typeof code !== 'string' || code.length === 0) return;
  const id = code.toLowerCase();
  const safeId = id.replace(/[^a-z0-9_-]/g, '');
  if (safeId !== id || safeId.length === 0) return;
  /** @type {Array<{ classList: { add(c: string): void, remove(c: string): void } }>} */
  const targets = [];
  const path = root.querySelector(`#${safeId}`);
  if (path) targets.push(path);
  const hits = root.querySelectorAll(`[data-hit-for="${safeId}"]`);
  for (let i = 0; i < hits.length; i++) targets.push(hits[i]);
  if (targets.length === 0) return;
  for (const t of targets) {
    for (const c of STATUS_CLASSES) t.classList.remove(c);
    if (state === 'correct') t.classList.add('is-correct');
    else if (state === 'wrong') t.classList.add('is-wrong');
  }
}

/**
 * Replace the set of `.is-selected` countries with a new one — used
 * by flagsdata to keep the map in sync with the active filter pills.
 * Walks every `.map-country` element + every `.map-hit-target` overlay
 * and toggles the class based on whether the country code is in the
 * `codes` set. Codes are lowercased before comparison.
 *
 * Single function instead of per-country mark/unmark calls because
 * filter changes invalidate the whole set; batching is one O(n) pass
 * vs O(n) toggle calls.
 *
 * @param {MapRoot} root
 * @param {Iterable<string>} codes
 */
export function setSelectedCountries(root, codes) {
  if (!root) return;
  /** @type {Set<string>} */
  const set = new Set();
  for (const c of codes || []) {
    if (typeof c === 'string') set.add(c.toLowerCase());
  }
  const countries = root.querySelectorAll('.map-country');
  for (let i = 0; i < countries.length; i++) {
    /** @type {any} */
    const el = countries[i];
    if (!el.id || !el.classList) continue;
    if (set.has(el.id)) el.classList.add('is-selected');
    else el.classList.remove('is-selected');
  }
  const hits = root.querySelectorAll('.map-hit-target');
  for (let i = 0; i < hits.length; i++) {
    /** @type {any} */
    const el = hits[i];
    if (!el.classList) continue;
    const code = typeof el.getAttribute === 'function' ? el.getAttribute('data-hit-for') : null;
    if (code && set.has(code)) el.classList.add('is-selected');
    else el.classList.remove('is-selected');
  }
}

/**
 * Strip every status class from every marked country — used on
 * play-again so a replayed round starts with a blank silhouette.
 *
 * @param {MapRoot} root
 */
export function resetMap(root) {
  if (!root) return;
  const paths = root.querySelectorAll('.is-correct, .is-wrong');
  for (let i = 0; i < paths.length; i++) {
    for (const c of STATUS_CLASSES) paths[i].classList.remove(c);
  }
}

/**
 * Fetch the SVG, inline it into `container`, and patch the root `<svg>`
 * element so it scales responsively. Returns the inlined `<svg>` root.
 *
 * `cropCodes` (optional) focuses the viewBox to the bounding-box union
 * of those country paths — used by Asia (which mounts the world map and
 * crops to Asia). Europe keeps the asset's natural viewBox.
 *
 * `cropPad` (optional, SVG units) extends the cropped viewBox after
 * the bbox union. Used when one variant's natural bbox excludes a
 * specific region we still want visible (e.g. NA's crop excludes US
 * to avoid the antimeridian wrap, then pads west to include Alaska).
 *
 * `scopeCodes` (optional) limits which countries get the microstate
 * treatment (pink-ring overlay). Defaults to all `.map-country`
 * elements — fine for Europe, which only carries European countries in
 * its asset. For the world map used by Asia we want to suppress overlays
 * on Caribbean / Pacific / African microstates that aren't in the
 * Asian quiz pool. Caller passes the active variant's codes.
 *
 * `fullscreenLabel` is the already-translated string used as the
 * fullscreen button's `aria-label`. Caller passes
 * `t('menu.fullscreen', 'Toggle fullscreen')`.
 *
 * @param {{
 *   container: HTMLElement,
 *   url: string,
 *   cropCodes?: string[] | null,
 *   cropPad?: { left?: number, right?: number, top?: number, bottom?: number },
 *   scopeCodes?: string[] | null,
 *   fullscreenLabel?: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<SVGElement | null>}
 */
export async function mountFlagMap({
  container, url, cropCodes = null, cropPad, scopeCodes = null,
  fullscreenLabel = 'Toggle fullscreen',
  fetchImpl = globalThis.fetch,
}) {
  if (!container || !url) return null;
  let res;
  try {
    res = await fetchImpl(url);
  } catch {
    return null;
  }
  if (!res || !res.ok) return null;
  let text;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  container.innerHTML = text;
  const svg = container.querySelector('svg');
  if (!svg) return null;
  if (!svg.getAttribute('viewBox')) {
    const w = svg.getAttribute('width') || '680';
    const h = svg.getAttribute('height') || '520';
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  tagCountryPaths(svg);
  if (Array.isArray(cropCodes) && cropCodes.length > 0) {
    cropToCountries(/** @type {any} */ (svg), cropCodes, cropPad);
  }
  const scope = Array.isArray(scopeCodes)
    ? new Set(scopeCodes.map((c) => (typeof c === 'string' ? c.toLowerCase() : '')))
    : null;
  tagMicrostates(svg, scope);
  addHitTargets(svg, hitTargetRadius(/** @type {any} */ (svg)));
  addFullscreenButton(container, fullscreenLabel);
  return /** @type {SVGElement} */ (svg);
}

/**
 * Append a small "enter fullscreen" button to the section, anchored
 * top-right. Click toggles the browser Fullscreen API on the section
 * itself, so the SVG fills the viewport (browser chrome hidden).
 * Escape exits, same as any other fullscreen surface. Webkit-prefixed
 * fallbacks for older Safari.
 *
 * `label` is the already-translated aria-label string — caller passes
 * `t('menu.fullscreen', 'Toggle fullscreen')`.
 *
 * @param {HTMLElement} container
 * @param {string} label
 */
function addFullscreenButton(container, label) {
  if (!container || typeof container.appendChild !== 'function') return;
  const doc = container.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'map-fullscreen-btn';
  btn.setAttribute('aria-label', label || 'Toggle fullscreen');
  // "Expand to corners" glyph. Tiny, no font dependency beyond what
  // any system sans-serif covers.
  btn.textContent = '⛶';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen(container);
  });
  container.appendChild(btn);
  // While in fullscreen, force preserveAspectRatio=slice so the SVG
  // content fills both viewport dimensions (cropping the longer axis)
  // instead of letterboxing. User can pinch-zoom + drag-pan to
  // navigate within the filled view. On exit, remove the attribute
  // so the default `meet` returns for the normal in-page render.
  const sync = () => {
    /** @type {any} */
    const d = globalThis.document;
    const current = d.fullscreenElement || d.webkitFullscreenElement || null;
    const svg = container.querySelector('svg');
    if (!svg) return;
    if (current === container) svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    else svg.removeAttribute('preserveAspectRatio');
  };
  /** @type {any} */
  const d = globalThis.document;
  if (d && typeof d.addEventListener === 'function') {
    d.addEventListener('fullscreenchange', sync);
    d.addEventListener('webkitfullscreenchange', sync);
  }
}

/**
 * Cross-browser Fullscreen API toggle. Handles webkit-prefixed
 * variants for older Safari. No-op when the browser doesn't support
 * fullscreen (very old browsers).
 *
 * @param {HTMLElement} el
 */
function toggleFullscreen(el) {
  /** @type {any} */
  const doc = globalThis.document;
  const current = doc.fullscreenElement || doc.webkitFullscreenElement || null;
  if (current) {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) exit.call(doc);
    return;
  }
  /** @type {any} */
  const elAny = el;
  const enter = elAny.requestFullscreen || elAny.webkitRequestFullscreen;
  if (enter) enter.call(elAny);
}


/**
 * Hit-target radius in viewBox units, scaled to whatever viewBox is
 * currently set. Read AFTER cropToCountries so the size matches the
 * displayed crop, not the asset's natural viewBox.
 *
 * @param {{ getAttribute(name: string): string | null }} svg
 * @returns {number}
 */
function hitTargetRadius(svg) {
  const vb = typeof svg.getAttribute === 'function' ? svg.getAttribute('viewBox') : null;
  if (!vb) return 6;
  const parts = vb.split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return 6;
  return Math.max(2, Math.max(parts[2], parts[3]) * HIT_TARGET_FRACTION);
}

/**
 * Tag every element whose `id` is a 2-letter ISO 3166-1 alpha-2 code
 * with `.map-country`. Works on both Europe (`<path id="es">`) and the
 * world map (`<g id="cn">`) so the CSS targets one class regardless of
 * how the asset structures its countries. Composite ids like
 * `dk_kingdom` or Adobe-generated `st0` aren't tagged — the regex
 * rejects anything that isn't exactly two lowercase letters.
 *
 * @param {Element | SVGElement} svg
 */
export function tagCountryPaths(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  try {
    const all = svg.querySelectorAll('[id]');
    for (let i = 0; i < all.length; i++) {
      /** @type {any} */
      const el = all[i];
      if (typeof el.id === 'string' && ISO2_PATTERN.test(el.id) && el.classList) {
        el.classList.add('map-country');
      }
    }
  } catch { /* ignore */ }
}

/**
 * Compute the bounding-box union of the named country paths, plus 5%
 * padding on each side and any `extra` (left/right/top/bottom)
 * directional padding. Returns the viewBox as `{ x, y, width, height }`
 * or `null` when no codes resolved (test env, no matches, etc.).
 *
 * Pure read-only — doesn't touch the SVG attribute. `cropToCountries`
 * is the side-effect wrapper that calls this + setAttribute.
 *
 * @param {{ querySelector(sel: string): any }} svg
 * @param {string[]} codes
 * @param {{ left?: number, right?: number, top?: number, bottom?: number }} [extra]
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function computeCountriesBbox(svg, codes, extra) {
  if (!svg || typeof svg.querySelector !== 'function') return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const code of codes) {
    if (typeof code !== 'string' || !ISO2_PATTERN.test(code)) continue;
    const el = svg.querySelector(`#${code}`);
    if (!el || typeof el.getBBox !== 'function') continue;
    try {
      const bb = el.getBBox();
      if (!bb || (bb.width === 0 && bb.height === 0)) continue;
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
      if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
    } catch { /* skip */ }
  }
  if (!Number.isFinite(minX)) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.05;
  const padY = h * 0.05;
  const extraLeft = (extra && extra.left) || 0;
  const extraRight = (extra && extra.right) || 0;
  const extraTop = (extra && extra.top) || 0;
  const extraBottom = (extra && extra.bottom) || 0;
  return {
    x: minX - padX - extraLeft,
    y: minY - padY - extraTop,
    width: w + 2 * padX + extraLeft + extraRight,
    height: h + 2 * padY + extraTop + extraBottom,
  };
}

/**
 * Set the SVG's viewBox to the bounding-box union of the named country
 * paths, plus padding. Used to focus a world map on a specific
 * continent without shipping a per-region asset. No-op when no codes
 * resolve.
 *
 * @param {{ querySelector(sel: string): any, setAttribute(name: string, value: string): void }} svg
 * @param {string[]} codes
 * @param {{ left?: number, right?: number, top?: number, bottom?: number }} [extra]
 */
export function cropToCountries(svg, codes, extra) {
  const bb = computeCountriesBbox(svg, codes, extra);
  if (!bb) return;
  svg.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
}

/**
 * Append a visible pink-ring `<circle class="map-hit-target">` over
 * each microstate so the click area is comfortably wide regardless of
 * the underlying path's geometry. Inherits the same answered / wrong
 * classes via `markCountry` so the click handler treats path and
 * overlay identically. Appended last so it draws over neighbouring
 * countries — a click in the overlay claims the microstate even if
 * the pixel sits in a neighbour's territory.
 *
 * @param {Element | SVGElement} svg
 * @param {number} radius  in viewBox units
 */
function addHitTargets(svg, radius) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  /** @type {Document | null} */
  // @ts-ignore — ownerDocument is on real SVGs, not always on test fakes.
  const doc = svg.ownerDocument || null;
  if (!doc || typeof doc.createElementNS !== 'function') return;
  let smalls;
  try {
    smalls = svg.querySelectorAll('.is-small');
  } catch { return; }
  for (let i = 0; i < smalls.length; i++) {
    /** @type {any} */
    const elem = smalls[i];
    if (!elem || !elem.id) continue;
    // For `<g>`-wrapped microstates (BlankMap-World's structure for
    // Caribbean islands etc.), use the INNER path's bbox — the
    // sibling `<circle class="circlexx">` locator is positioned at a
    // label-friendly offset away from the real island, and including
    // it in the union shifts the ring center off into open water.
    // For direct-path microstates (Europe asset's Vatican etc.),
    // querySelector('path') returns null and we fall back to the
    // element itself.
    /** @type {any} */
    let target = elem;
    if (typeof elem.querySelector === 'function') {
      const innerPath = elem.querySelector('path');
      if (innerPath && typeof innerPath.getBBox === 'function') target = innerPath;
    }
    if (typeof target.getBBox !== 'function') continue;
    let bbox;
    try { bbox = target.getBBox(); } catch { continue; }
    if (!bbox || (bbox.width === 0 && bbox.height === 0)) continue;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const circle = doc.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(radius));
    // `data-hit-for` carries the COUNTRY id (the outer `<g>` / `<path>`
    // with the ISO code), not the inner path-segment id that the bbox
    // came from. e.g. for `<g id="kn"><path id="kn-">...</path></g>`,
    // we want `data-hit-for="kn"` so the click handler resolves
    // correctly via byCode.
    circle.setAttribute('data-hit-for', elem.id);
    // `data-base-r` is the radius at the asset's natural viewBox.
    // mapZoom.js scales the live `r` attribute down as the viewBox
    // crops in, so the ring stays roughly the same on-screen size
    // regardless of zoom level (otherwise Liechtenstein's ring would
    // dwarf Switzerland on a zoomed-in Europe view).
    circle.setAttribute('data-base-r', String(radius));
    circle.setAttribute('class', 'map-hit-target');
    circle.setAttribute('fill', 'transparent');
    svg.appendChild(circle);
  }
}

/**
 * Tag the curated set of microstates with `.is-small` so they pick up
 * the pink-ring marker overlay. We used to auto-detect via getBBox
 * but the world-map asset wraps each country in a `<g>` that also
 * contains a hidden `<circle r=6>` locator. getBBox on the `<g>`
 * returns the inflated union, which dodged true microstates and
 * mis-tagged mid-size ones. A hardcoded list is data, not magic —
 * predictable and easy to extend.
 *
 * `scope` (optional Set of lowercase ISO2 codes) further filters —
 * an Asian round doesn't tag European microstates and vice versa.
 *
 * @param {Element | SVGElement} svg
 * @param {Set<string> | null} [scope]
 */
function tagMicrostates(svg, scope = null) {
  if (!svg || typeof svg.querySelector !== 'function') return;
  for (const code of MICROSTATE_CODES) {
    if (scope && !scope.has(code)) continue;
    /** @type {any} */
    const el = svg.querySelector(`#${code}`);
    if (el && el.classList) el.classList.add('is-small');
  }
}
