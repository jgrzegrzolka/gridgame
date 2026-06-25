/**
 * Pan + zoom for the flagQuiz contour map.
 *
 * Three interactions:
 *   - **Wheel** (desktop) — scroll up = zoom in at cursor, scroll
 *     down = zoom out. The point under the cursor stays fixed in
 *     screen space, so the user zooms toward what they're looking at.
 *   - **One-finger drag** (touch) — pan the map.
 *   - **Two-finger pinch** (touch) — zoom in/out around the pinch
 *     midpoint. Same "pivot stays fixed" semantics as wheel zoom.
 *   - **Double-tap** (touch) — reset to the original viewBox.
 *
 * The pure viewBox math lives at the top — zoomViewBox / panViewBox /
 * clampViewBox / parse / format. The DOM glue (`attachZoomPan`) is
 * a thin shell over those. Pure functions are unit-tested in
 * mapZoom.test.js; the DOM glue is verified by hand in the browser.
 *
 * Why scratch instead of a library: the project ships zero npm runtime
 * dependencies (pure browser ES modules, no bundler). Dropping in
 * svg-pan-zoom would force a vendoring step that adds more weight
 * than this ~200-line file.
 */

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} ViewBox
 * @typedef {{ x: number, y: number }} Point
 */

/** Max zoom-in level relative to the original viewBox. */
const MAX_ZOOM_IN = 24;
/** Max zoom-out level relative to the original viewBox. > 1 means the
 * viewBox can grow LARGER than the asset's natural bounds — used in
 * fullscreen so the player can pinch out to see the whole map even
 * when slice mode would otherwise crop it on portrait phones. */
const MAX_ZOOM_OUT = 3;
/** Wheel zoom factor per notch. ~10% per tick — comfortable feel. */
const WHEEL_SCALE_STEP = 1.1;
/** Two taps within this window count as a double-tap (ms). */
const DOUBLE_TAP_MS = 300;

/**
 * Return a new viewBox after zooming by `scale` around a pivot point.
 * Pivot stays anchored in screen space — i.e. the SVG coord under the
 * pivot before zoom is the same coord after zoom. Scale > 1 zooms in
 * (shrinks viewBox dimensions); scale < 1 zooms out.
 *
 * @param {ViewBox} vb
 * @param {Point} pivot  in SVG user coords
 * @param {number} scale
 * @returns {ViewBox}
 */
export function zoomViewBox(vb, pivot, scale) {
  if (!Number.isFinite(scale) || scale <= 0) return vb;
  return {
    x: pivot.x - (pivot.x - vb.x) / scale,
    y: pivot.y - (pivot.y - vb.y) / scale,
    width: vb.width / scale,
    height: vb.height / scale,
  };
}

/**
 * Translate a viewBox by (dx, dy) in SVG user coords.
 *
 * @param {ViewBox} vb
 * @param {number} dx
 * @param {number} dy
 * @returns {ViewBox}
 */
export function panViewBox(vb, dx, dy) {
  return { x: vb.x + dx, y: vb.y + dy, width: vb.width, height: vb.height };
}

/**
 * Clamp a viewBox so it never zooms out past `original` (the natural
 * crop) and never zooms in past `original / maxZoomIn`. Also clamp
 * the position so the VISIBLE window (after the SVG's preserveAspect-
 * Ratio fit) stays inside `original` — the user can't pan the map off
 * the edge, but every part of `original` IS reachable.
 *
 * `overhang` carries how much the viewBox sticks out past the visible
 * window on each axis (per side). This matters in `preserveAspectRatio
 * = slice` mode — used in fullscreen on portrait phones, where the
 * SVG scales to FILL the viewport and the longer axis is cropped, so
 * the visible viewBox window is narrower than the viewBox attribute.
 * Without an overhang allowance, the position clamp would refuse to
 * let the viewBox center reach the asset's leftmost / rightmost /
 * topmost / bottommost x/y — Portugal at x≈119 in Europe's 680-wide
 * viewBox couldn't be centered on a phone because the clamp held
 * viewBox.x ≥ 0 and the slice cropped everything left of ≈220 vbu
 * (Jan, 2026-06-25). With `overhang.x = (viewBox.width - visible
 * window width) / 2`, the clamp lets viewBox.x go as low as
 * `original.x - overhang.x`, which lets the visible window's left
 * edge reach original.x. Symmetric on the right / top / bottom.
 *
 * In meet mode (default) or any aspect-matching render the overhang
 * is 0 and this collapses to the historical "viewBox stays inside
 * original" rule.
 *
 * @param {ViewBox} vb
 * @param {ViewBox} original
 * @param {number} [maxZoomIn]
 * @param {number} [maxZoomOut]
 * @param {{ x?: number, y?: number }} [overhang]
 * @returns {ViewBox}
 */
export function clampViewBox(vb, original, maxZoomIn = MAX_ZOOM_IN, maxZoomOut = 1, overhang = { x: 0, y: 0 }) {
  // Capture the input's center BEFORE any adjustments — when a tiny
  // bbox (single small country) is expanded up to the minimum size,
  // OR when a non-aspect-matching bbox (tall + narrow) is widened to
  // match the asset's aspect ratio, we want the result centered on
  // the input's middle, not pinned to the input's (x, y) corner.
  const centerX = vb.x + vb.width / 2;
  const centerY = vb.y + vb.height / 2;
  let width = vb.width;
  let height = vb.height;
  // Aspect-ratio fit: EXPAND the smaller dimension so the input fits
  // inside the result, never shrink.
  const targetAspect = original.width / original.height;
  const inputAspect = width / height;
  if (inputAspect > targetAspect) {
    height = width / targetAspect;
  } else if (inputAspect < targetAspect) {
    width = height * targetAspect;
  }
  // Cap at the zoom-out limit. Default `maxZoomOut: 1` matches the
  // historical "can't zoom past natural viewBox" rule. Fullscreen
  // passes a larger value (e.g. 3) so the player can pinch out to
  // see the whole map smaller-with-margins, even when slice mode
  // would otherwise crop it on portrait phones.
  const maxWidth = original.width * maxZoomOut;
  if (width > maxWidth) {
    width = maxWidth;
    height = original.height * maxZoomOut;
  }
  // Bump up to min (no zoom-in past max). Same aspect-locked pair.
  const minWidth = original.width / maxZoomIn;
  if (width < minWidth) {
    width = minWidth;
    height = original.height / maxZoomIn;
  }
  // Re-derive x / y from the captured center so the result stays
  // centered on its original middle.
  let x = centerX - width / 2;
  let y = centerY - height / 2;
  // Position clamp. When viewBox is SMALLER than original, keep the
  // VISIBLE window (viewBox − overhang on each side) inside original
  // bounds — can't pan off the map, but in slice mode the viewBox
  // itself is allowed to extend past `original.x` / `original.right`
  // by the overhang amount so the visible window's edges still reach
  // the asset's edges. When LARGER than original, the viewBox
  // naturally encompasses everything — center it on the original's
  // middle so the asset's content sits in the middle of the cropped
  // viewport.
  const ox = (overhang && overhang.x) || 0;
  const oy = (overhang && overhang.y) || 0;
  // Allowed pan range = "visible window must overlap original by at
  // least its full extent" on each axis. Expressed as bounds on
  // viewBox.x / viewBox.y, that's:
  //   minX = original.x - overhang.x          (visible-left  touches original.left)
  //   maxX = original.x + original.width - width + overhang.x  (visible-right touches original.right)
  // The two branches (width >= original.width vs width < original.width)
  // converge when ox == 0: the old behaviour centred the viewBox when
  // width >= original.width (no panning), but with positive overhang
  // the user CAN still pan because the visible window is narrower
  // than the viewBox itself. Slice mode at 1x zoom on portrait phones
  // is exactly that case — Portugal at Europe's western edge was
  // unreachable until this branch unified.
  if (ox === 0 && width >= original.width) {
    x = original.x + (original.width - width) / 2;
  } else {
    const minX = original.x - ox;
    const maxX = original.x + original.width - width + ox;
    if (x < minX) x = minX;
    if (x > maxX) x = maxX;
  }
  if (oy === 0 && height >= original.height) {
    y = original.y + (original.height - height) / 2;
  } else {
    const minY = original.y - oy;
    const maxY = original.y + original.height - height + oy;
    if (y < minY) y = minY;
    if (y > maxY) y = maxY;
  }
  return { x, y, width, height };
}

/**
 * Parse a viewBox attribute string ("x y w h") into a ViewBox object.
 * Returns null on malformed input.
 *
 * @param {string} str
 * @returns {ViewBox | null}
 */
export function parseViewBox(str) {
  if (typeof str !== 'string') return null;
  const parts = str.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/**
 * @param {ViewBox} vb
 * @returns {string}
 */
export function formatViewBox(vb) {
  return `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
}

/**
 * Convert a screen-space point (clientX/clientY from a mouse / touch
 * event) into the SVG's user coordinate system using its current
 * screen CTM. Returns null when the SVG API surface is missing.
 *
 * @param {any} svg
 * @param {number} clientX
 * @param {number} clientY
 * @returns {Point | null}
 */
export function screenToSvg(svg, clientX, clientY) {
  if (!svg || typeof svg.createSVGPoint !== 'function') return null;
  if (typeof svg.getScreenCTM !== 'function') return null;
  const ctm = svg.getScreenCTM();
  if (!ctm || typeof ctm.inverse !== 'function') return null;
  const inv = ctm.inverse();
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const t = pt.matrixTransform(inv);
  return { x: t.x, y: t.y };
}

/**
 * Attach wheel-zoom / pinch-zoom / drag-pan / double-tap-reset to a
 * mounted SVG. Returns a handle with imperative helpers for callers
 * that want to drive the viewBox programmatically (e.g. flagsdata's
 * smart-zoom on filter change). Bare `attachZoomPan(svg)` calls that
 * discard the return still work — the handle just goes unused.
 *
 *   - `setView(vb)` — set viewBox, then re-clamp to original bounds.
 *     Future user gestures pick up from this new position.
 *   - `reset()` — back to the original viewBox the SVG was mounted with.
 *   - `teardown()` — remove event listeners (for an unmount path).
 *
 * @param {SVGElement} svg
 * @returns {{
 *   setView: (vb: { x: number, y: number, width: number, height: number }) => void,
 *   reset: () => void,
 *   teardown: () => void,
 * }}
 */
export function attachZoomPan(svg) {
  const noopHandle = {
    setView: () => {},
    reset: () => {},
    teardown: () => {},
  };
  if (!svg) return noopHandle;
  const initialAttr = svg.getAttribute('viewBox');
  const original = parseViewBox(initialAttr || '');
  if (!original) return noopHandle;

  /** @type {ViewBox} */
  let current = { ...original };

  /** @param {ViewBox} next */
  function apply(next) {
    // In fullscreen, allow zoom-out past the asset's natural viewBox
    // so the player can see the whole map smaller-with-margins, even
    // when slice mode crops the default view on portrait phones.
    // Outside fullscreen, hold the historical "can't zoom past
    // natural" rule (the page CSS already constrains the SVG's
    // rendered size, so there's nowhere useful to zoom-out into).
    const maxOut = isFullscreen() ? MAX_ZOOM_OUT : 1;
    current = clampViewBox(next, original, MAX_ZOOM_IN, maxOut, sliceOverhang(next));
    svg.setAttribute('viewBox', formatViewBox(current));
    rescaleHitTargets();
  }

  /**
   * In `preserveAspectRatio = slice` mode (used in fullscreen on
   * portrait phones), the SVG scales to FILL the viewport — the
   * longer axis gets cropped, so the visible viewBox window is
   * narrower / shorter than the viewBox itself. Compute the per-side
   * overhang so `clampViewBox` can let viewBox.x / viewBox.y extend
   * past the original bounds by that amount, which is what makes the
   * asset's edges reachable in fullscreen (otherwise on a 414×900
   * phone you can never centre the visible window on Portugal at
   * Europe's western edge — the slice always crops it out).
   *
   * Outside slice mode the SVG fits inside its rendered container
   * (preserveAspectRatio defaults to `meet`), so the visible window
   * equals the viewBox and overhang is zero.
   *
   * @param {ViewBox} vb
   */
  function sliceOverhang(vb) {
    /** @type {any} */
    const s = svg;
    const par = typeof s.getAttribute === 'function' ? s.getAttribute('preserveAspectRatio') : null;
    if (!par || !/\bslice\b/.test(par)) return { x: 0, y: 0 };
    if (typeof s.getBoundingClientRect !== 'function') return { x: 0, y: 0 };
    const rect = s.getBoundingClientRect();
    if (!rect.width || !rect.height || !vb.width || !vb.height) return { x: 0, y: 0 };
    // Slice scale = the larger of (viewport.dim / viewBox.dim) on each
    // axis — that's what fills both dimensions.
    const scale = Math.max(rect.width / vb.width, rect.height / vb.height);
    const visibleW = rect.width / scale;
    const visibleH = rect.height / scale;
    return {
      x: Math.max(0, (vb.width - visibleW) / 2),
      y: Math.max(0, (vb.height - visibleH) / 2),
    };
  }

  /**
   * True when the SVG's parent section is the current fullscreen
   * element. Webkit-prefixed fallback for older Safari.
   * @returns {boolean}
   */
  function isFullscreen() {
    /** @type {any} */
    const d = globalThis.document;
    if (!d) return false;
    const current = d.fullscreenElement || d.webkitFullscreenElement || null;
    if (!current) return false;
    return current.contains(svg);
  }

  /**
   * Resize the microstate hit-target rings so they stay roughly the
   * same pixel size as the viewBox crops in. Without this, the rings
   * (fixed at the asset's natural viewBox size) appear enormous when
   * zoomed in — Liechtenstein's ring would visually dwarf Switzerland.
   *
   * Each ring carries two radii in `data-*` attributes:
   *   - `data-base-r` — the constant-on-screen target radius at the
   *     asset's natural viewBox. Multiplied by the current scale to
   *     keep the displayed pixel size constant as the viewBox crops in.
   *   - `data-country-r` — the radius (in vbu) needed to enclose the
   *     country's own bbox plus a small padding. Constant in vbu, so
   *     it doesn't shrink with zoom-in.
   *
   * Final `r` = max(baseR × scale, countryR). At normal continent
   * crops the constant-on-screen value dominates; at deep pinch-zoom,
   * countryR kicks in and the ring grows to keep the visible country
   * inside its outline (otherwise the ring renders smaller than the
   * landmass it's supposed to mark — particularly noticeable on the
   * larger "microstates" like Brunei, Cape Verde, or the spread-out
   * Maldives bbox).
   */
  function rescaleHitTargets() {
    const scale = current.width / original.width;
    const hits = svg.querySelectorAll('.map-hit-target');
    for (let i = 0; i < hits.length; i++) {
      /** @type {any} */
      const el = hits[i];
      if (typeof el.getAttribute !== 'function') continue;
      const base = el.getAttribute('data-base-r');
      if (!base) continue;
      const parsed = parseFloat(base);
      if (!Number.isFinite(parsed)) continue;
      const scaled = parsed * scale;
      const countryAttr = el.getAttribute('data-country-r');
      const countryR = countryAttr ? parseFloat(countryAttr) : 0;
      const finalR = Number.isFinite(countryR) ? Math.max(scaled, countryR) : scaled;
      el.setAttribute('r', String(finalR));
    }
  }

  /** @param {WheelEvent} e */
  function onWheel(e) {
    e.preventDefault();
    const pivot = screenToSvg(svg, e.clientX, e.clientY);
    if (!pivot) return;
    const scale = e.deltaY < 0 ? WHEEL_SCALE_STEP : 1 / WHEEL_SCALE_STEP;
    apply(zoomViewBox(current, pivot, scale));
  }

  /** @type {{ mode: 'pan' | 'pinch', lastX?: number, lastY?: number, distance?: number } | null} */
  let touchState = null;
  let lastTapAt = 0;
  let dragStartScreen = null;

  /** Mouse drag state: tracks whether the player is currently dragging
   * the map with the mouse, plus enough info to differentiate a click
   * (no drag) from a pan (drag moved past the threshold). */
  /** @type {{ lastX: number, lastY: number, downX: number, downY: number, dragging: boolean } | null} */
  let mouseState = null;
  /** Pixels of mouse movement before we treat it as a drag rather than a
   * click. Below this threshold we let the click propagate (so post-game
   * country clicks still open the popup); above it we suppress the
   * follow-up click via a capture-phase listener. */
  const DRAG_THRESHOLD_PX = 5;
  let suppressNextClick = false;

  /** @param {TouchEvent} e */
  function onTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const now = Date.now();
      if (now - lastTapAt < DOUBLE_TAP_MS) {
        apply(original);
        touchState = null;
        lastTapAt = 0;
        return;
      }
      lastTapAt = now;
      touchState = { mode: 'pan', lastX: t.clientX, lastY: t.clientY };
      dragStartScreen = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchState = { mode: 'pinch', distance };
    }
  }

  /** @param {TouchEvent} e */
  function onTouchMove(e) {
    if (!touchState) return;
    if (touchState.mode === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - (touchState.lastX || 0);
      const dy = t.clientY - (touchState.lastY || 0);
      const factor = svgUnitsPerPixel(svg, current);
      apply(panViewBox(current, -dx * factor, -dy * factor));
      touchState.lastX = t.clientX;
      touchState.lastY = t.clientY;
    } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const newDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const prev = touchState.distance || 0;
      if (prev === 0) return;
      const scale = newDistance / prev;
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const pivot = screenToSvg(svg, midX, midY);
      if (pivot) apply(zoomViewBox(current, pivot, scale));
      touchState.distance = newDistance;
    }
  }

  function onTouchEnd() {
    touchState = null;
    dragStartScreen = null;
  }

  /** @param {MouseEvent} e */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    mouseState = {
      lastX: e.clientX, lastY: e.clientY,
      downX: e.clientX, downY: e.clientY,
      dragging: false,
    };
  }

  /** @param {MouseEvent} e */
  function onMouseMove(e) {
    if (!mouseState) return;
    if (!mouseState.dragging) {
      const dx = e.clientX - mouseState.downX;
      const dy = e.clientY - mouseState.downY;
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
      mouseState.dragging = true;
    }
    const dx = e.clientX - mouseState.lastX;
    const dy = e.clientY - mouseState.lastY;
    const factor = svgUnitsPerPixel(svg, current);
    apply(panViewBox(current, -dx * factor, -dy * factor));
    mouseState.lastX = e.clientX;
    mouseState.lastY = e.clientY;
  }

  function onMouseUp() {
    if (mouseState && mouseState.dragging) suppressNextClick = true;
    mouseState = null;
  }

  /**
   * Capture-phase click guard: a mouseup that ended a drag is followed
   * by a click event the browser synthesises from the mousedown/mouseup
   * pair. The country-popup handler in page.js shouldn't fire for
   * those — stop the click before it bubbles. Threshold-gated to clicks
   * (no drag) still get through cleanly.
   *
   * @param {Event} e
   */
  function onClickCapture(e) {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('touchstart', onTouchStart, { passive: true });
  svg.addEventListener('touchmove', onTouchMove, { passive: false });
  svg.addEventListener('touchend', onTouchEnd, { passive: true });
  svg.addEventListener('touchcancel', onTouchEnd, { passive: true });
  svg.addEventListener('mousedown', onMouseDown);
  // mousemove / mouseup on the document so the drag stays alive when
  // the cursor leaves the SVG mid-drag.
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  // Capture phase so we beat the country-click handler in page.js.
  svg.addEventListener('click', onClickCapture, true);

  return {
    setView: apply,
    reset: () => apply({ ...original }),
    teardown: () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('touchstart', onTouchStart);
      svg.removeEventListener('touchmove', onTouchMove);
      svg.removeEventListener('touchend', onTouchEnd);
      svg.removeEventListener('touchcancel', onTouchEnd);
      svg.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      svg.removeEventListener('click', onClickCapture, true);
    },
  };
}

/**
 * SVG user units per CSS pixel — used to convert screen-space drag
 * deltas into viewBox-space deltas.
 *
 * @param {any} svg
 * @param {ViewBox} vb
 * @returns {number}
 */
function svgUnitsPerPixel(svg, vb) {
  if (!svg || typeof svg.getBoundingClientRect !== 'function') return 1;
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return 1;
  return vb.width / rect.width;
}
