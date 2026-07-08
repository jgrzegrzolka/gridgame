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
 * viewBox can grow LARGER than the asset's natural bounds — the player can
 * pinch/scroll out to see the whole map smaller-with-margins (in-page and
 * in fullscreen alike), then free-pan it anywhere (see FREE_PAN_KEEP). */
const MAX_ZOOM_OUT = 3;
/**
 * Free-pan: how much of the map must stay on screen while dragging, as a
 * fraction of the VISIBLE WINDOW (not the map). Measuring against the window
 * makes the limit a constant fraction of the *screen* at every zoom level —
 * so panning feels the same at rest as when zoomed out. (Measuring against
 * the map's fixed width instead made 1x feel guarded — 15% of the map filled
 * 15% of the screen — while zoomed out the same 15% of the map was a tiny
 * screen sliver, so the map cleared freely. Jan, 2026-07-06.) Never lost
 * off-screen; double-tap still resets. 0.1 = keep at least 10% of the
 * viewport covered by the map.
 */
const FREE_PAN_KEEP = 0.1;
/**
 * Rubber-band overscroll: how far a zoomed-in pan may stretch PAST the edge
 * clamp, as a fraction of the visible viewBox dimension. The offset eases toward
 * this cap with growing resistance (see rubberBandOffset) and springs back on
 * release (see springHome / endPanGesture), so the edge gives a little instead
 * of dead-stopping ("hitting a wall"). Only applies zoomed in — zoomed out
 * already free-pans (FREE_PAN_KEEP), no wall to soften. Jan, 2026-07-08.
 */
const MAX_OVERSCROLL = 0.12;
/** Spring-back duration (ms) easing a released pan from overscroll to the edge. */
const SPRING_MS = 260;
/** Overscroll (vbu) below which a released pan counts as settled — no spring. */
const SPRING_EPS = 0.01;
/**
 * Wheel-zoom sensitivity: zoom scale = e^(-normalizedDeltaPx × this).
 * Tuned so a classic mouse notch (~100 px of deltaY) zooms ~10% — the
 * same feel the old fixed 1.1-per-event step had — while a trackpad or
 * smooth/momentum wheel (a *stream* of small deltas) accumulates the
 * same total scroll into the same total zoom instead of firing a full
 * 10% step per event. The old fixed step ignored deltaY magnitude, so a
 * single two-finger trackpad swipe (~10 events) zoomed 1.1^10 ≈ 2.6× and
 * kept drifting on momentum — the "jumpy / laggy" zoom.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.001;
/**
 * Per-event scroll clamp (normalized px). A momentum spike or a coarse
 * page-mode delta can't zoom more than one comfortable notch in a single
 * event, so the map never lurches.
 */
const WHEEL_MAX_STEP_PX = 120;
/** deltaMode === 1 (lines): px-per-line used to normalize to pixels. */
const WHEEL_LINE_PX = 33;
/** deltaMode === 2 (pages): px-per-page used to normalize to pixels. */
const WHEEL_PAGE_PX = 800;
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
 * Map one wheel event to a zoom scale, proportional to how far the wheel
 * actually scrolled. Normalizes `deltaMode` (pixels / lines / pages) to
 * pixels, clamps a single event's contribution so a momentum spike can't
 * lurch, then maps to an exponential scale so repeated small events
 * compose smoothly (e^a · e^b = e^(a+b)) — a trackpad swipe of N small
 * deltas zooms the same total as one mouse notch of the same distance.
 *
 * Scroll up (deltaY < 0) → scale > 1 (zoom in); scroll down → scale < 1.
 *
 * @param {number} deltaY     wheel event deltaY
 * @param {number} [deltaMode] wheel event deltaMode (0 px, 1 lines, 2 pages)
 * @returns {number} zoom scale for `zoomViewBox`
 */
export function wheelZoomScale(deltaY, deltaMode = 0) {
  if (!Number.isFinite(deltaY)) return 1;
  let px = deltaY;
  if (deltaMode === 1) px *= WHEEL_LINE_PX;
  else if (deltaMode === 2) px *= WHEEL_PAGE_PX;
  if (px > WHEEL_MAX_STEP_PX) px = WHEEL_MAX_STEP_PX;
  else if (px < -WHEEL_MAX_STEP_PX) px = -WHEEL_MAX_STEP_PX;
  return Math.exp(-px * WHEEL_ZOOM_SENSITIVITY);
}

/**
 * Clamp a zoom scale so the resulting width stays within the zoom limits.
 *
 * Without this, zooming at the cap still moves the map: zoomViewBox anchors
 * the pivot, and at the zoom-out limit a scale < 1 magnifies the (off-centre)
 * pivot's distance from the viewBox centre — so the centre drifts even though
 * clampViewBox caps the width back down, and freePan's generous range doesn't
 * catch it. Clamping the scale so `currentWidth / scale` never crosses
 * [minWidth, maxWidth] means that once you hit a limit the effective scale is
 * exactly 1 (zoomViewBox is the identity), so the map stops dead instead of
 * sliding around as you keep scrolling.
 *
 * @param {number} scale         requested zoom factor (>1 in, <1 out)
 * @param {number} currentWidth  the viewBox width the scale applies to
 * @param {ViewBox} original     natural viewBox (defines the width limits)
 * @param {number} [maxZoomIn]
 * @param {number} [maxZoomOut]
 * @returns {number} the scale, clamped so the new width stays in bounds
 */
export function clampZoomScale(scale, currentWidth, original, maxZoomIn = MAX_ZOOM_IN, maxZoomOut = MAX_ZOOM_OUT) {
  if (!Number.isFinite(scale) || scale <= 0 || !(currentWidth > 0)) return 1;
  const minScale = currentWidth / (original.width * maxZoomOut); // zoom-out floor
  const maxScale = currentWidth / (original.width / maxZoomIn);  // zoom-in ceiling
  if (scale < minScale) return minScale;
  if (scale > maxScale) return maxScale;
  return scale;
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
 * `freePan` (fullscreen) relaxes the zoomed-OUT position rule: when the
 * viewBox is larger than the map, instead of locking it dead-centre (so a
 * drag does nothing), let the player park the map anywhere in the viewport,
 * stopping only once `FREE_PAN_KEEP` of it would leave the screen. The
 * zoomed-IN rule (visible window stays inside the map) is unchanged — no
 * void while exploring. Off in the in-page map, which never zooms past its
 * natural viewBox anyway.
 *
 * @param {ViewBox} vb
 * @param {ViewBox} original
 * @param {number} [maxZoomIn]
 * @param {number} [maxZoomOut]
 * @param {{ x?: number, y?: number }} [overhang]
 * @param {boolean} [freePan]
 * @returns {ViewBox}
 */
export function clampViewBox(vb, original, maxZoomIn = MAX_ZOOM_IN, maxZoomOut = 1, overhang = { x: 0, y: 0 }, freePan = false) {
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
  if (freePan && width >= original.width) {
    // The map floats inside the viewport. Let it be dragged anywhere, keeping
    // at least FREE_PAN_KEEP of the *visible window* covered by the map — a
    // constant screen fraction at every zoom, so 1x pans as freely as
    // zoomed-out (keep is `width`-relative, not `original.width`-relative).
    const keep = width * FREE_PAN_KEEP;
    const minX = original.x + keep - width + ox;
    const maxX = original.x + original.width - keep - ox;
    if (x < minX) x = minX;
    if (x > maxX) x = maxX;
  } else if (ox === 0 && width >= original.width) {
    x = original.x + (original.width - width) / 2;
  } else {
    const minX = original.x - ox;
    const maxX = original.x + original.width - width + ox;
    if (x < minX) x = minX;
    if (x > maxX) x = maxX;
  }
  if (freePan && height >= original.height) {
    const keep = height * FREE_PAN_KEEP;
    const minY = original.y + keep - height + oy;
    const maxY = original.y + original.height - keep - oy;
    if (y < minY) y = minY;
    if (y > maxY) y = maxY;
  } else if (oy === 0 && height >= original.height) {
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
 * Frame a single country for the "zoom to the answer" fly-in. Centres a
 * viewBox on the country's bbox, sized to show the country plus a
 * comfortable ring of surrounding context — regional, not a tight crop.
 * Capped both ways: a tiny country (Vatican) zooms to `maxZoom` rather
 * than an extreme close-up, and a huge one (Brazil) still gets a modest
 * zoom-in instead of nothing. The result is pre-clamp — `attachZoomPan`'s
 * `apply()` re-clamps to the asset bounds and aspect-fits it, so callers
 * hand the raw frame straight to `animateTo`.
 *
 * @param {ViewBox} bbox      country bbox in viewBox units
 * @param {ViewBox} original  the asset's natural (mounted) viewBox
 * @param {{ pad?: number, maxZoom?: number }} [opts]
 *   pad — multiply the country's own size for surrounding context.
 *   maxZoom — cap zoom-in relative to `original` (sets the min frame size).
 * @returns {ViewBox}
 */
export function regionalFrame(bbox, original, opts = {}) {
  const pad = typeof opts.pad === 'number' ? opts.pad : 2.5;
  const maxZoom = typeof opts.maxZoom === 'number' ? opts.maxZoom : 6;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const minW = original.width / maxZoom;
  const minH = original.height / maxZoom;
  const width = Math.min(Math.max(bbox.width * pad, minW), original.width);
  const height = Math.min(Math.max(bbox.height * pad, minH), original.height);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * Cubic ease-in-out, the timing curve for the answer fly-in. Symmetric
 * accel/decel so the camera starts and stops gently. t ∈ [0, 1].
 *
 * @param {number} t
 * @returns {number}
 */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Cubic ease-OUT: fast start, gentle stop. The timing curve for the rubber-band
 * spring-back, so a released overscroll decelerates into the edge like a
 * relaxing elastic rather than starting slow. t ∈ [0, 1].
 *
 * @param {number} t
 * @returns {number}
 */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Rubber-band overscroll offset. Maps how far past a pan limit the finger wants
 * to go (`overshoot`, signed vbu — 0 when within bounds) to a damped offset
 * that eases toward a cap of `dim × MAX_OVERSCROLL` with growing resistance: a
 * small overshoot moves nearly 1:1, a hard yank asymptotes to the cap and never
 * exceeds it. That growing stiffness is the "give" at the edge; `springHome`
 * eases the result back to 0 on release.
 *
 * @param {number} overshoot  signed vbu past the clamp (negative = past the low edge)
 * @param {number} dim        the viewBox dimension on that axis (width or height)
 * @returns {number} signed offset, strictly within ±(dim × MAX_OVERSCROLL)
 */
export function rubberBandOffset(overshoot, dim) {
  if (!overshoot || !(dim > 0)) return 0;
  const max = dim * MAX_OVERSCROLL;
  const d = Math.abs(overshoot);
  return Math.sign(overshoot) * max * (1 - 1 / (1 + d / max));
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
 *   - `animateTo(vb, opts)` — smoothly ease the viewBox to `vb` over
 *     `opts.durationMs` (default 480), firing `opts.onDone` at the end.
 *     Honours `prefers-reduced-motion` (snaps instead) and no-ops the
 *     tween when `requestAnimationFrame` is absent (test env). A running
 *     animation is cancelled by the next `animateTo`/`animateReset` or by
 *     any user gesture (wheel / touch / drag), so the player always wins.
 *   - `animateReset(opts)` — animate back to the mounted viewBox.
 *   - `getOriginal()` — a copy of the viewBox the SVG was mounted with.
 *   - `reset()` — back to the original viewBox the SVG was mounted with.
 *   - `teardown()` — remove event listeners (for an unmount path).
 *
 * @param {SVGElement} svg
 * @returns {{
 *   setView: (vb: { x: number, y: number, width: number, height: number }) => void,
 *   animateTo: (vb: { x: number, y: number, width: number, height: number }, opts?: { durationMs?: number, onDone?: () => void }) => void,
 *   animateReset: (opts?: { durationMs?: number, onDone?: () => void }) => void,
 *   getOriginal: () => { x: number, y: number, width: number, height: number },
 *   reset: () => void,
 *   teardown: () => void,
 * }}
 */
export function attachZoomPan(svg, opts = {}) {
  // Fired (synchronously) with the settled viewBox every time the map comes to
  // rest — after a gesture commits or an animateTo lands. The quiz uses it to
  // re-throttle the flag reveal when the finished map is re-zoomed. Runs inside
  // the same synchronous block that removes `.is-interacting`, so a handler can
  // re-tint before the browser paints (no image flash).
  const onSettle = typeof opts.onSettle === 'function' ? opts.onSettle : null;
  const noopHandle = {
    setView: () => {},
    animateTo: () => {},
    animateReset: () => {},
    getOriginal: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    reset: () => {},
    teardown: () => {},
  };
  if (!svg) return noopHandle;
  const initialAttr = svg.getAttribute('viewBox');
  const original = parseViewBox(initialAttr || '');
  if (!original) return noopHandle;

  /** The live target view — what the player should be looking at. Written
   *  straight to the element every frame (during a gesture and at rest). */
  /** @type {ViewBox} */
  let current = { ...original };

  /**
   * Write a viewBox to the element and rescale the hit-target rings. Used on
   * every gesture frame, on settle, and on the programmatic paths.
   * @param {ViewBox} vb  already clamped
   */
  function setViewBoxNow(vb) {
    svg.setAttribute('viewBox', formatViewBox(vb));
    rescaleHitTargets();
  }

  /**
   * Clamp `next` and commit it as a plain viewBox change, cancelling any
   * in-progress gesture transform. Programmatic path (setView / reset /
   * fly-in frames) — always a sharp, flag-filled render.
   * @param {ViewBox} next
   */
  function apply(next) {
    // Same zoom-out + free-pan freedom in-page and in fullscreen: the player
    // can pinch/scroll out past the asset's natural viewBox (MAX_ZOOM_OUT)
    // and drag the shrunk map anywhere (freePan). clampViewBox keeps at
    // least a sliver on screen so it's never lost, and double-tap resets.
    current = clampViewBox(next, original, MAX_ZOOM_IN, MAX_ZOOM_OUT, sliceOverhang(next), true);
    endGesture();
    setViewBoxNow(current);
  }

  /**
   * Clamp a live PAN frame. Same hard clamp as `apply`, except a zoomed-in pan
   * is allowed to overscroll past the edge with rubber-band resistance
   * (rubberBandOffset) rather than dead-stopping at the wall. The released
   * overscroll springs back in `endPanGesture`. Zoomed out (width ≥ original)
   * keeps the plain free-pan clamp — there's no edge wall there to soften.
   * @param {ViewBox} next
   * @returns {ViewBox}
   */
  function clampPanFrame(next) {
    const hard = clampViewBox(next, original, MAX_ZOOM_IN, MAX_ZOOM_OUT, sliceOverhang(next), true);
    if (hard.width >= original.width) return hard;
    return {
      x: hard.x + rubberBandOffset(next.x - hard.x, hard.width),
      y: hard.y + rubberBandOffset(next.y - hard.y, hard.height),
      width: hard.width,
      height: hard.height,
    };
  }

  // --- Gesture layer ---------------------------------------------------
  // While the player pans / zooms, we re-render the real `viewBox` once per
  // frame (input is coalesced to one flush per rAF, below). The SVG also
  // carries `.is-interacting`, which drops flag fills to a flat colour wash
  // (see flags/flagMap.css) — that's what keeps the per-frame repaint cheap:
  // no <image> patterns to re-raster, just contours + solid fills (~2-8 ms on
  // a mid-range phone, measured, well inside frame budget). On settle (~140 ms
  // after the last input) we drop `.is-interacting` so the flags snap back to
  // their images: one sharp repaint, while stopped.
  //
  // We render the actual viewBox each frame instead of sliding a cached GPU
  // layer with `style.transform`, so a pan always paints the region it moves
  // INTO. A transform can only move already-painted pixels, so panning past
  // the start-of-gesture view left a blank strip that only filled on settle
  // (Jan, 2026-07-08). The image-raster cost that once justified the transform
  // is gone during a move — the `.is-interacting` wash means there are no flag
  // images to re-raster while the map is moving.
  const SETTLE_MS = 140;
  let interacting = false;
  /** setTimeout handle for the settle-commit, or 0 when idle. */
  let settleTimer = 0;

  function beginGesture() {
    if (interacting) return;
    interacting = true;
    if (svg.classList) svg.classList.add('is-interacting');
  }
  function clearSettle() {
    if (settleTimer && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(settleTimer);
    }
    settleTimer = 0;
  }
  function scheduleSettle() {
    clearSettle();
    const setT = globalThis.setTimeout;
    if (typeof setT !== 'function') { commitGesture(); return; }
    settleTimer = /** @type {number} */ (/** @type {unknown} */ (setT(commitGesture, SETTLE_MS)));
  }
  // Settle: the viewBox is already at `current` (re-rendered each frame), so
  // this just drops `.is-interacting` to restore the flag images and fires
  // onSettle. The viewBox re-write is a harmless no-op that keeps the path
  // uniform with the programmatic `apply()`.
  function commitGesture() {
    if (!interacting) return;
    setViewBoxNow(current);
    endGesture();
    if (onSettle) onSettle({ ...current });
  }
  /** Drop the gesture simplify class and stop the settle timer. */
  function endGesture() {
    clearSettle();
    if (!interacting) return;
    interacting = false;
    // Keep the class if an answer fly-in is still easing (it owns the tint now).
    if (svg.classList && !flying) svg.classList.remove('is-interacting');
  }

  // --- Input coalescing -------------------------------------------------
  // Continuous input (wheel notches, drag mousemoves, pinch, momentum)
  // fires far faster than the display refreshes — a 1000 Hz mouse or a
  // trackpad emits ~16 events per 60 Hz frame. Each event compounds its
  // delta onto `pendingViewBox`; the queued flush runs ONCE per frame,
  // routing through the gesture layer (transform, or per-frame viewBox in
  // fullscreen).
  /** @type {ViewBox | null} */
  let pendingViewBox = null;
  /** Whether the pending frame is a pan (rubber-band eligible) vs a zoom. */
  let pendingPan = false;
  /** rAF handle for the queued input flush, or 0 when idle. */
  let inputRaf = 0;
  function flushInput() {
    inputRaf = 0;
    const next = pendingViewBox;
    const isPan = pendingPan;
    pendingViewBox = null;
    pendingPan = false;
    if (!next) return;
    // Pans may rubber-band past the edge (clampPanFrame); zoom stays hard-clamped.
    current = isPan
      ? clampPanFrame(next)
      : clampViewBox(next, original, MAX_ZOOM_IN, MAX_ZOOM_OUT, sliceOverhang(next), true);
    beginGesture();
    setViewBoxNow(current);   // grey simplify + per-frame viewBox render
    scheduleSettle();
  }
  /**
   * Queue a viewBox to show on the next animation frame, coalescing
   * multiple same-frame events into one update. Falls back to a direct
   * flush when rAF is unavailable (test env).
   * @param {ViewBox} next
   * @param {boolean} [isPan]  true for a drag-pan (rubber-band eligible)
   */
  function scheduleInput(next, isPan = false) {
    pendingViewBox = next;
    pendingPan = isPan;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== 'function') { flushInput(); return; }
    if (!inputRaf) inputRaf = raf(flushInput);
  }
  /**
   * Base viewBox the next input delta builds on: the queued-but-unapplied
   * target if one is pending this frame, else the live `current`. Lets
   * same-frame events compound (two wheel notches zoom twice, a drag's
   * mousemoves accumulate) instead of each starting from `current`.
   * @returns {ViewBox}
   */
  function inputBase() { return pendingViewBox || current; }
  /** Drop any queued input — used by discrete resets (double-tap). */
  function cancelInput() {
    pendingViewBox = null;
    if (inputRaf && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(inputRaf);
    }
    inputRaf = 0;
  }
  // Pivot (screen px → SVG coords) and pan scale (SVG units per px) read the
  // element's live CTM / bounding rect directly: with per-frame viewBox
  // rendering there's no `transform` polluting the CTM, so `screenToSvg` /
  // `svgUnitsPerPixel` are exact. (Under the old transform path these needed a
  // cached, untransformed gesture box to undo the CTM the transform added.)

  /** rAF handle for an in-flight `animateTo`, or 0 when idle. */
  let animRaf = 0;
  /**
   * True while an answer fly-in is easing. Like a gesture, the fly-in rewrites
   * the viewBox every frame, so we carry `.is-interacting` through it to drop
   * flags to their cheap dominant-colour tint — otherwise every already-flagged
   * country re-rasterises its <image> per frame, which is what janks the 60s /
   * all-flags run once the map fills up. Tracked separately from the gesture
   * `interacting` flag so whichever of the two ends last clears the class
   * (see endGesture / animateTo).
   */
  let flying = false;
  function cancelAnim() {
    if (animRaf && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(animRaf);
    }
    animRaf = 0;
    // The fly is being stopped (interrupted or superseded); drop its claim on
    // the tint. The class itself is left for the interrupting gesture to keep
    // (no add/remove flash) or for the branch below to clear.
    flying = false;
  }

  /**
   * Ease the viewBox from its current position to `target` over
   * `opts.durationMs`. The end point is clamped once up front; each
   * frame interpolates start→end and re-`apply()`s (which re-clamps and
   * rescales the hit-target rings). Snaps immediately — no tween — when
   * reduced-motion is requested or `requestAnimationFrame` is missing
   * (Node test env), so the map still lands on the right view either way.
   *
   * @param {ViewBox} target
   * @param {{ durationMs?: number, onDone?: () => void }} [opts]
   */
  function animateTo(target, opts = {}) {
    const duration = typeof opts.durationMs === 'number' ? opts.durationMs : 480;
    const raf = globalThis.requestAnimationFrame;
    const end = clampViewBox(target, original, MAX_ZOOM_IN, MAX_ZOOM_OUT, sliceOverhang(target), true);
    cancelAnim();
    if (typeof raf !== 'function' || duration <= 0 || prefersReducedMotion()) {
      apply(end);
      // Snapped, not animated: make sure no leftover fly tint lingers.
      if (!interacting && svg.classList) svg.classList.remove('is-interacting');
      if (onSettle) onSettle({ ...end });
      if (opts.onDone) opts.onDone();
      return;
    }
    // Ride the gesture tint through the flight so cost stays flat regardless of
    // how many countries are already flagged; flags resolve to images on settle.
    flying = true;
    if (svg.classList) svg.classList.add('is-interacting');
    const start = { ...current };
    let startTs = 0;
    /** @param {number} ts */
    function frame(ts) {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / duration);
      const e = easeInOutCubic(p);
      apply({
        x: start.x + (end.x - start.x) * e,
        y: start.y + (end.y - start.y) * e,
        width: start.width + (end.width - start.width) * e,
        height: start.height + (end.height - start.height) * e,
      });
      if (p < 1) {
        animRaf = raf(frame);
      } else {
        animRaf = 0;
        flying = false;
        // Camera settled: restore real flag images (unless a gesture now owns
        // the class).
        if (!interacting && svg.classList) svg.classList.remove('is-interacting');
        if (onSettle) onSettle({ ...end });
        if (opts.onDone) opts.onDone();
      }
    }
    animRaf = raf(frame);
  }

  /**
   * End a one-finger / mouse pan. If it overscrolled past the edge (rubber-band
   * stretch), spring back to the clamped edge; otherwise commit where it rests.
   * Flushes any last queued frame first so a move-then-immediate-lift still
   * springs from the true final position rather than a stale one.
   */
  function endPanGesture() {
    if (pendingViewBox) flushInput();
    const home = clampViewBox(current, original, MAX_ZOOM_IN, MAX_ZOOM_OUT, sliceOverhang(current), true);
    if (Math.abs(home.x - current.x) > SPRING_EPS || Math.abs(home.y - current.y) > SPRING_EPS) {
      springHome(home);
    } else {
      commitGesture();
    }
  }

  /**
   * Ease the viewBox from its current (overscrolled) position back to `home`
   * over SPRING_MS with an ease-out decel — the elastic snap-back. Writes each
   * frame straight to the element (NOT via `apply`, which would clamp the
   * overscroll away on frame one and kill the animation). Carries
   * `.is-interacting` through so flags stay the cheap wash until it lands, then
   * restores the images and fires onSettle. Snaps immediately under
   * reduced-motion / no-rAF (test env).
   * @param {ViewBox} home  the clamped edge position to settle at
   */
  function springHome(home) {
    const raf = globalThis.requestAnimationFrame;
    cancelAnim();
    clearSettle();
    interacting = false;              // the drag gesture itself is over
    if (typeof raf !== 'function' || prefersReducedMotion()) {
      current = { ...home };
      setViewBoxNow(current);
      if (svg.classList && !flying) svg.classList.remove('is-interacting');
      if (onSettle) onSettle({ ...current });
      return;
    }
    flying = true;                    // owns the tint so the wash stays on
    if (svg.classList) svg.classList.add('is-interacting');
    const start = { ...current };
    let startTs = 0;
    /** @param {number} ts */
    function frame(ts) {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / SPRING_MS);
      const e = easeOutCubic(p);
      // Only x / y differ; width / height are already the clamped values.
      current = {
        x: start.x + (home.x - start.x) * e,
        y: start.y + (home.y - start.y) * e,
        width: home.width,
        height: home.height,
      };
      setViewBoxNow(current);
      if (p < 1) { animRaf = raf(frame); return; }
      animRaf = 0;
      flying = false;
      current = { ...home };
      setViewBoxNow(current);
      if (!interacting && svg.classList) svg.classList.remove('is-interacting');
      if (onSettle) onSettle({ ...current });
    }
    animRaf = raf(frame);
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
   *
   * `.flag-flash` is included so a microstate's answer tint overlay (a
   * `<circle>` clone of the ring, made by flagMap's `paintCountryFlag`)
   * tracks the ring's radius on zoom — it copies the ring's `data-base-r`,
   * so the same formula keeps the two in lockstep. Flag-flash clones of
   * big countries are `<path>`s with no `data-base-r`; the guard below
   * skips them (their geometry scales with the viewBox like any path).
   */
  function rescaleHitTargets() {
    const scale = current.width / original.width;
    const hits = svg.querySelectorAll('.map-hit-target, .flag-flash, .map-island-dot');
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
    cancelAnim();
    const pivot = screenToSvg(svg, e.clientX, e.clientY);
    if (!pivot) return;
    const base = inputBase();
    const scale = clampZoomScale(wheelZoomScale(e.deltaY, e.deltaMode), base.width, original);
    scheduleInput(zoomViewBox(base, pivot, scale));
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
    cancelAnim();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const now = Date.now();
      if (now - lastTapAt < DOUBLE_TAP_MS) {
        cancelInput();
        apply({ ...original });
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
      const base = inputBase();
      const factor = svgUnitsPerPixel(svg, base);
      scheduleInput(panViewBox(base, -dx * factor, -dy * factor), true);
      touchState.lastX = t.clientX;
      touchState.lastY = t.clientY;
    } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const newDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const prev = touchState.distance || 0;
      if (prev === 0) return;
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const pivot = screenToSvg(svg, midX, midY);
      const base = inputBase();
      const scale = clampZoomScale(newDistance / prev, base.width, original);
      if (pivot) scheduleInput(zoomViewBox(base, pivot, scale));
      touchState.distance = newDistance;
    }
  }

  function onTouchEnd() {
    const wasPan = touchState !== null && touchState.mode === 'pan';
    touchState = null;
    dragStartScreen = null;
    if (wasPan) endPanGesture();
  }

  /** @param {MouseEvent} e */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    cancelAnim();
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
    const base = inputBase();
    const factor = svgUnitsPerPixel(svg, base);
    scheduleInput(panViewBox(base, -dx * factor, -dy * factor), true);
    mouseState.lastX = e.clientX;
    mouseState.lastY = e.clientY;
  }

  function onMouseUp() {
    const wasDrag = mouseState !== null && mouseState.dragging;
    if (wasDrag) suppressNextClick = true;
    mouseState = null;
    if (wasDrag) endPanGesture();
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
    animateTo,
    animateReset: (opts) => animateTo({ ...original }, opts),
    getOriginal: () => ({ ...original }),
    reset: () => apply({ ...original }),
    teardown: () => {
      cancelAnim();
      cancelInput();
      endGesture();
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
 * True when the viewer has asked the OS to minimise motion. The answer
 * fly-in snaps to its destination instead of easing when this is set —
 * same final view, no travel. Guarded for non-browser (test) envs.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  const mm = globalThis.matchMedia;
  if (typeof mm !== 'function') return false;
  try {
    return !!mm('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
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
