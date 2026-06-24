/**
 * Europe contour map for flagQuiz all-mode.
 *
 * The SVG (`europeMap.svg`, CC BY-SA 3.0 — see `europeMap.LICENSE`) ships
 * with one `<path>` per country, ID'd by ISO 3166-1 alpha-2 in lowercase
 * (e.g. `id="es"` for Spain). This module is the surface the page wiring
 * talks to: it doesn't know about quiz state, just "paint country X
 * correct" / "paint country X wrong".
 *
 * Pure DOM, no fetch. The page mounts the SVG once (inline into a host
 * element so CSS can reach into it), then calls `markCountry` on each
 * answer. Codes not present in the SVG (e.g. `ax`, `sj`, the EU/CEFTA
 * regional codes the quiz pool also surfaces) silently no-op — they just
 * don't paint, the rest of the round continues unchanged.
 *
 * Status classes on the country path:
 *   - `is-correct` → green fill
 *   - `is-wrong`   → red fill
 *   - neither      → default grey fill (CSS rules in `flagQuiz/index.css`)
 *
 * A second pick at the same country (only possible across a
 * play-again) would re-mark it; `markCountry` clears both classes before
 * setting the new one so the latest answer wins. resetMap clears every
 * marked country at once — used on play-again to start fresh.
 */

const STATUS_CLASSES = ['is-correct', 'is-wrong'];

/**
 * Radius (in SVG viewBox units) of the visible pink-ring marker that
 * doubles as the click target for each microstate. The 680×520 viewBox
 * renders at ~680 px on desktop, so 10 units ≈ a 20-px ring —
 * comfortable click target on mouse and thumb, small enough that
 * adjacent microstates (Italy's cluster of Vatican / San Marino /
 * Monaco) don't overlap. The ring spills onto neighbouring territory
 * by design: an intentional tradeoff so the marker is unmistakable.
 */
const HIT_TARGET_RADIUS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @typedef {{
 *   querySelector(selector: string): { classList: { add(c: string): void, remove(c: string): void } } | null,
 *   querySelectorAll(selector: string): ArrayLike<{ classList: { add(c: string): void, remove(c: string): void } }>,
 * }} MapRoot
 */

/**
 * Set (or clear) the answer status on one country's SVG path. The code
 * is lowercased before lookup because the SVG IDs are lowercase but the
 * quiz pool may carry mixed-case ISO2 codes — caller doesn't have to
 * remember.
 *
 * @param {MapRoot} root
 * @param {string} code
 * @param {'correct' | 'wrong' | 'clear'} state
 */
export function markCountry(root, code, state) {
  if (!root || typeof code !== 'string' || code.length === 0) return;
  const id = code.toLowerCase();
  // Escape just enough for IDs that contain a hyphen (e.g. `es-pv`). The
  // ISO2 path IDs themselves are pure letters, but the quiz pool can
  // carry these compound codes and we want the no-op path to actually
  // be a no-op rather than throw a malformed-selector syntax error.
  const safeId = id.replace(/[^a-z0-9_-]/g, '');
  if (safeId !== id || safeId.length === 0) return;
  /** @type {Array<{ classList: { add(c: string): void, remove(c: string): void } }>} */
  const targets = [];
  const path = root.querySelector(`#${cssIdEscape(safeId)}`);
  if (path) targets.push(path);
  // Microstates also have an invisible `<circle data-hit-for="...">`
  // overlay sibling — class it together with the country path so the
  // bigger click target inherits the same answered/wrong status.
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
 * Strip every status class from every country path — used on play-again
 * so a replayed round starts with a blank silhouette.
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
 * Defensive ID escape: CSS-quote any character outside `[a-z0-9_-]`.
 * Our SVG IDs are pure ISO2 letters so this is normally a pass-through,
 * but the compound codes (`es-pv`, `gb-eng`) the quiz pool surfaces
 * already filtered through `markCountry` would land here as e.g. `es-pv`
 * — the hyphen is selector-safe, no escape needed. Function kept tiny
 * so the contract is obvious and easy to audit.
 *
 * @param {string} id
 */
function cssIdEscape(id) {
  return id;
}

/**
 * Fetch the SVG, inline it into `container`, and patch the root `<svg>`
 * element so it scales responsively. The on-disk file ships with
 * `width="680" height="520"` but no `viewBox`, which would otherwise
 * fix the rendered size and ignore the container's width. We add the
 * viewBox at runtime (rather than editing the file on disk) so the
 * CC BY-SA 3.0 asset stays pristine — no "modifications" to indicate
 * per the license. The SVG file's own attribution metadata survives
 * the inline pass intact.
 *
 * Idempotent on the host: a re-mount (e.g. after a soft language
 * switch that re-bootstraps the page) wipes prior contents first.
 *
 * Returns the inlined `<svg>` root so the caller can pass it back to
 * `markCountry` / `resetMap` without a second querySelector.
 *
 * @param {{
 *   container: HTMLElement,
 *   url: string,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<SVGElement | null>}
 */
export async function mountEuropeMap({ container, url, fetchImpl = globalThis.fetch }) {
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
  // Width / height stay as 680×520 in the file. For responsive rendering
  // we want a viewBox of the same dimensions plus CSS-driven sizing —
  // strip the fixed attributes and add the viewBox so the container's
  // width wins.
  if (!svg.getAttribute('viewBox')) {
    const w = svg.getAttribute('width') || '680';
    const h = svg.getAttribute('height') || '520';
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  tagSmallPaths(svg);
  addHitTargets(svg);
  return /** @type {SVGElement} */ (svg);
}

/**
 * Append an invisible `<circle class="map-hit-target">` over each
 * microstate so the click area is comfortably wide regardless of the
 * underlying path's geometry. Vatican's actual path is ~0.4 SVG units
 * across — even with our stroke boost it's a ~7-px target on desktop,
 * easy to miss. The overlay disk is 15 units (≈ 30 px) and inherits the
 * same answered / wrong / revealed classes via `markCountry` so the
 * click handler treats path and overlay identically.
 *
 * Overlay sits at the path's bounding-box centroid (not the geometric
 * centroid — `getBBox` is cheap and accurate enough for a near-circular
 * microstate). Appended last so it draws over neighbouring countries —
 * a click in the overlay claims Vatican even if the pixel sits inside
 * Italy. That's an intentional UX trade per the player's ask.
 *
 * No-op when `getBBox` is unavailable (test environment) or returns
 * a degenerate bbox.
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
    smalls = svg.querySelectorAll('path.is-small');
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
 * Mark every country path that's too small to be visible at typical
 * render sizes with a `.is-small` class — CSS uses this to give them
 * a thicker stroke so Vatican, Monaco, Andorra etc. read as a clear
 * marker dot rather than an invisible speck.
 *
 * Two passes:
 *
 *   1. **SVG-author hint** — the bundled SVG tags some microstates with
 *      `class="k"` (its own visibility hack). Promote each into our
 *      `.is-small` so the CSS only has to target one class.
 *   2. **Bounding-box auto-detect** — call `getBBox()` on each `.c`
 *      country path and tag anything narrower OR shorter than 6 SVG
 *      user units (the SVG viewBox is 680×520, so 6 units ≈ 1% of
 *      width — small enough to vanish at typical screen sizes). Catches
 *      countries the SVG author missed (Andorra, Malta) without us
 *      having to hardcode a list that drifts when the asset updates.
 *
 * Both passes silently no-op on failure (missing `getBBox` in test
 * environments, missing `classList` on a stray text node, etc.) — the
 * map remains usable even if the visibility boost doesn't land.
 *
 * @param {Element | SVGElement} svg
 */
function tagSmallPaths(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  try {
    const kPaths = svg.querySelectorAll('path.k, path.c.k');
    for (let i = 0; i < kPaths.length; i++) {
      const node = /** @type {Element} */ (kPaths[i]);
      if (node.classList) node.classList.add('is-small');
    }
  } catch { /* ignore */ }
  try {
    const allPaths = svg.querySelectorAll('path.c');
    for (let i = 0; i < allPaths.length; i++) {
      const node = /** @type {any} */ (allPaths[i]);
      if (!node.classList || typeof node.getBBox !== 'function') continue;
      try {
        const bbox = node.getBBox();
        if (!bbox) continue;
        if (bbox.width < 6 || bbox.height < 6) {
          node.classList.add('is-small');
        }
      } catch { /* skip this path */ }
    }
  } catch { /* ignore */ }
}
