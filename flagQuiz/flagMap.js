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
 * Radius (in SVG viewBox units) of the visible pink-ring marker that
 * doubles as the click target for each microstate. Sized in viewBox
 * units so it scales with the displayed viewBox.
 */
const HIT_TARGET_RADIUS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ISO2_PATTERN = /^[a-z]{2}$/;

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
 * `scopeCodes` (optional) limits which countries get the microstate
 * treatment (pink-ring overlay). Defaults to all `.map-country`
 * elements — fine for Europe, which only carries European countries in
 * its asset. For the world map used by Asia we want to suppress overlays
 * on Caribbean / Pacific / African microstates that aren't in the
 * Asian quiz pool. Caller passes the active variant's codes.
 *
 * @param {{
 *   container: HTMLElement,
 *   url: string,
 *   cropCodes?: string[] | null,
 *   scopeCodes?: string[] | null,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<SVGElement | null>}
 */
export async function mountFlagMap({
  container, url, cropCodes = null, scopeCodes = null,
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
    cropToCountries(/** @type {any} */ (svg), cropCodes);
  }
  const threshold = smallCountryThreshold(/** @type {any} */ (svg));
  const scope = Array.isArray(scopeCodes)
    ? new Set(scopeCodes.map((c) => (typeof c === 'string' ? c.toLowerCase() : '')))
    : null;
  tagSmallPaths(svg, threshold, scope);
  addHitTargets(svg);
  return /** @type {SVGElement} */ (svg);
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
 * Set the SVG's viewBox to the bounding-box union of the named country
 * paths, plus 5% padding on each side. Used to focus a world map on a
 * specific continent without shipping a per-region asset. No-op when
 * `getBBox` isn't available (test env) or no codes resolve.
 *
 * @param {{ querySelector(sel: string): any, setAttribute(name: string, value: string): void }} svg
 * @param {string[]} codes
 */
export function cropToCountries(svg, codes) {
  if (!svg || typeof svg.querySelector !== 'function') return;
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
  if (!Number.isFinite(minX)) return;
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.05;
  const padY = h * 0.05;
  svg.setAttribute(
    'viewBox',
    `${minX - padX} ${minY - padY} ${w + 2 * padX} ${h + 2 * padY}`,
  );
}

/**
 * "Small enough to be invisible at native render" threshold in viewBox
 * units. 1.2% of the larger viewBox dimension catches both microstates
 * in a focused Europe map (viewBox 680×520 → ~8 units) and small
 * islands in a wider crop (viewBox 1035×531 → ~12 units). Falls back to
 * 6 when the viewBox is missing.
 *
 * @param {{ getAttribute(name: string): string | null }} svg
 */
function smallCountryThreshold(svg) {
  const vb = typeof svg.getAttribute === 'function' ? svg.getAttribute('viewBox') : null;
  if (!vb) return 6;
  const parts = vb.split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return 6;
  const largestDim = Math.max(parts[2], parts[3]);
  return Math.max(2, largestDim * 0.012);
}

/**
 * Append an invisible `<circle class="map-hit-target">` over each
 * microstate so the click area is comfortably wide regardless of the
 * underlying path's geometry. Inherits the same answered / wrong
 * classes via `markCountry` so the click handler treats path and
 * overlay identically. Appended last so it draws over neighbouring
 * countries — a click in the overlay claims the microstate even if
 * the pixel sits in a neighbour's territory.
 *
 * @param {Element | SVGElement} svg
 */
function addHitTargets(svg) {
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
    const path = smalls[i];
    if (!path || !path.id) continue;
    if (typeof path.getBBox !== 'function') continue;
    let bbox;
    try { bbox = path.getBBox(); } catch { continue; }
    if (!bbox || (bbox.width === 0 && bbox.height === 0)) continue;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const circle = doc.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(HIT_TARGET_RADIUS));
    circle.setAttribute('data-hit-for', path.id);
    circle.setAttribute('class', 'map-hit-target');
    circle.setAttribute('fill', 'transparent');
    svg.appendChild(circle);
  }
}

/**
 * Mark every country path that's too small to be visible at native
 * render with `.is-small` — CSS uses this to give them a pink-ring
 * marker so they're still legible as a click target.
 *
 * Two passes:
 *
 *   1. **SVG-author hint** — the Europe SVG tags microstates with
 *      `class="k"`. Promote each into our `.is-small`. No-op on the
 *      world map asset, which doesn't carry `.k`.
 *   2. **Bounding-box auto-detect** — `.map-country` elements whose
 *      bbox is narrower OR shorter than `threshold` get tagged.
 *      Caller passes a threshold scaled to the displayed viewBox.
 *
 * `scope` (optional Set of lowercase ISO2 codes) gates BOTH passes —
 * when present, only countries in scope get tagged. Used by the world
 * map so we don't decorate every Caribbean / Pacific microstate when
 * the active variant is Asia.
 *
 * Both passes silently no-op on failure (missing `getBBox`, missing
 * `classList`) — the map remains usable even if the visibility boost
 * doesn't land.
 *
 * @param {Element | SVGElement} svg
 * @param {number} threshold  in viewBox units
 * @param {Set<string> | null} [scope]
 */
function tagSmallPaths(svg, threshold, scope = null) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  const inScope = (/** @type {any} */ node) =>
    !scope || (typeof node.id === 'string' && scope.has(node.id));
  try {
    const kPaths = svg.querySelectorAll('.k');
    for (let i = 0; i < kPaths.length; i++) {
      const node = /** @type {any} */ (kPaths[i]);
      if (!inScope(node)) continue;
      if (node.classList) node.classList.add('is-small');
    }
  } catch { /* ignore */ }
  try {
    const all = svg.querySelectorAll('.map-country');
    for (let i = 0; i < all.length; i++) {
      const node = /** @type {any} */ (all[i]);
      if (!inScope(node)) continue;
      if (!node.classList || typeof node.getBBox !== 'function') continue;
      try {
        const bbox = node.getBBox();
        if (!bbox) continue;
        if (bbox.width < threshold || bbox.height < threshold) {
          node.classList.add('is-small');
        }
      } catch { /* skip this path */ }
    }
  } catch { /* ignore */ }
}
