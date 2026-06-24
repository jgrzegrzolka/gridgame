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
const MAX_ZOOM_IN = 8;
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
 * the position so the viewBox stays inside the original bounds —
 * the user can't pan the map off the edge.
 *
 * @param {ViewBox} vb
 * @param {ViewBox} original
 * @param {number} [maxZoomIn]
 * @returns {ViewBox}
 */
export function clampViewBox(vb, original, maxZoomIn = MAX_ZOOM_IN) {
  let width = vb.width;
  let height = vb.height;
  // Smaller width = more zoomed in. Cap at original (no zoom-out
  // past natural) and at original/maxZoomIn (no zoom-in past max).
  if (width > original.width) width = original.width;
  const minWidth = original.width / maxZoomIn;
  if (width < minWidth) width = minWidth;
  // Preserve original aspect ratio: height scales with width.
  height = width * (original.height / original.width);
  // Now clamp position so the viewBox stays inside `original`.
  let x = vb.x;
  let y = vb.y;
  const maxX = original.x + original.width - width;
  const maxY = original.y + original.height - height;
  if (x < original.x) x = original.x;
  if (x > maxX) x = maxX;
  if (y < original.y) y = original.y;
  if (y > maxY) y = maxY;
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
 * mounted SVG. Returns a teardown function (no callers use it today,
 * but the contract is there for a future re-mount path).
 *
 * @param {SVGElement} svg
 * @returns {() => void}
 */
export function attachZoomPan(svg) {
  const noop = () => {};
  if (!svg) return noop;
  const initialAttr = svg.getAttribute('viewBox');
  const original = parseViewBox(initialAttr || '');
  if (!original) return noop;

  /** @type {ViewBox} */
  let current = { ...original };

  /** @param {ViewBox} next */
  function apply(next) {
    current = clampViewBox(next, original);
    svg.setAttribute('viewBox', formatViewBox(current));
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

  return () => {
    svg.removeEventListener('wheel', onWheel);
    svg.removeEventListener('touchstart', onTouchStart);
    svg.removeEventListener('touchmove', onTouchMove);
    svg.removeEventListener('touchend', onTouchEnd);
    svg.removeEventListener('touchcancel', onTouchEnd);
    svg.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    svg.removeEventListener('click', onClickCapture, true);
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
