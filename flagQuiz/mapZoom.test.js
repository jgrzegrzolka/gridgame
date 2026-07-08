import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zoomViewBox,
  wheelZoomScale,
  clampZoomScale,
  panViewBox,
  clampViewBox,
  parseViewBox,
  formatViewBox,
  screenToSvg,
  regionalFrame,
  easeInOutCubic,
} from './mapZoom.js';

// ---- zoomViewBox ----

test('zoomViewBox shrinks the viewBox by `scale` when zooming in', () => {
  const vb = { x: 0, y: 0, width: 100, height: 80 };
  const pivot = { x: 50, y: 40 };  // dead-center pivot
  const out = zoomViewBox(vb, pivot, 2);
  assert.equal(out.width, 50);
  assert.equal(out.height, 40);
});

test('zoomViewBox keeps the pivot anchored — center stays at the pivot', () => {
  const vb = { x: 0, y: 0, width: 100, height: 80 };
  const pivot = { x: 50, y: 40 };
  const out = zoomViewBox(vb, pivot, 2);
  // After 2× zoom around center, the new viewBox is 50×40 centered
  // on (50, 40), so x = 25, y = 20.
  assert.equal(out.x, 25);
  assert.equal(out.y, 20);
});

test('zoomViewBox at off-center pivot keeps that pivot fixed', () => {
  const vb = { x: 0, y: 0, width: 100, height: 100 };
  const pivot = { x: 25, y: 75 };  // top-left-ish
  const out = zoomViewBox(vb, pivot, 2);
  // Pivot relative position before: 25% / 75% of viewBox
  // After 2× zoom (viewBox 50×50), pivot must still be at 25%/75%:
  //   pivotX = newX + 0.25 × newW → 25 = newX + 12.5 → newX = 12.5
  //   pivotY = newY + 0.75 × newH → 75 = newY + 37.5 → newY = 37.5
  assert.equal(out.x, 12.5);
  assert.equal(out.y, 37.5);
});

test('zoomViewBox with scale<1 zooms out (expands the viewBox)', () => {
  const vb = { x: 0, y: 0, width: 50, height: 50 };
  const out = zoomViewBox(vb, { x: 25, y: 25 }, 0.5);
  assert.equal(out.width, 100);
  assert.equal(out.height, 100);
});

test('zoomViewBox no-ops on zero/negative/non-finite scale', () => {
  const vb = { x: 0, y: 0, width: 100, height: 80 };
  const pivot = { x: 50, y: 40 };
  assert.deepEqual(zoomViewBox(vb, pivot, 0), vb);
  assert.deepEqual(zoomViewBox(vb, pivot, -1), vb);
  assert.deepEqual(zoomViewBox(vb, pivot, NaN), vb);
  assert.deepEqual(zoomViewBox(vb, pivot, Infinity), vb);
});

// ---- wheelZoomScale ----

test('wheelZoomScale zooms in on scroll-up (negative deltaY) and out on scroll-down', () => {
  assert.ok(wheelZoomScale(-100) > 1, 'scroll up zooms in');
  assert.ok(wheelZoomScale(100) < 1, 'scroll down zooms out');
  assert.equal(wheelZoomScale(0), 1, 'no scroll → no zoom');
});

test('wheelZoomScale is proportional to scroll distance — a small delta zooms less than a big one', () => {
  const small = wheelZoomScale(-10) - 1;
  const big = wheelZoomScale(-100) - 1;
  assert.ok(small > 0 && big > 0);
  assert.ok(small < big, 'a 10px nudge zooms less than a 100px notch');
});

test('wheelZoomScale composes: N small trackpad events ≈ one mouse notch of the same total scroll', () => {
  // A trackpad emits ~10 small (-10px) events for a gesture that a mouse
  // sends as one -100px notch. Because the scale is exponential, the
  // products must match: e^(-a)·…(10×) = e^(-10a) = e^(-100·k).
  let trackpad = 1;
  for (let i = 0; i < 10; i++) trackpad *= wheelZoomScale(-10);
  const oneNotch = wheelZoomScale(-100);
  assert.ok(Math.abs(trackpad - oneNotch) < 1e-9,
    `trackpad total ${trackpad} should equal one notch ${oneNotch}`);
});

test('wheelZoomScale clamps a single event so a momentum spike cannot lurch', () => {
  // Beyond the per-event clamp, more delta produces no more zoom.
  const clamped = wheelZoomScale(-100000);
  const atClamp = wheelZoomScale(-120); // WHEEL_MAX_STEP_PX
  assert.equal(clamped, atClamp);
});

test('wheelZoomScale normalizes deltaMode: lines and pages scroll further than raw pixels', () => {
  // Same raw deltaY of 3, but line-mode (×33) and page-mode (×800) mean
  // more scroll → more zoom-out than pixel-mode.
  const px = wheelZoomScale(3, 0);
  const lines = wheelZoomScale(3, 1);
  const pages = wheelZoomScale(3, 2);
  assert.ok(lines < px, 'line-mode scrolls further than pixel-mode');
  assert.ok(pages <= lines, 'page-mode scrolls at least as far as line-mode');
});

test('wheelZoomScale tolerates non-finite input (no-op)', () => {
  assert.equal(wheelZoomScale(NaN), 1);
  assert.equal(wheelZoomScale(Infinity), 1);
});

// ---- clampZoomScale ----

const ORIG = { x: 0, y: 0, width: 100, height: 100 };

test('clampZoomScale leaves an in-range scale untouched', () => {
  // At natural width, a modest zoom-in or zoom-out is well within limits.
  assert.equal(clampZoomScale(1.1, 100, ORIG, 24, 3), 1.1);
  assert.equal(clampZoomScale(0.9, 100, ORIG, 24, 3), 0.9);
});

test('clampZoomScale returns 1 (no-op) when already at the zoom-out cap', () => {
  // currentWidth === maxWidth (100 * 3). A further zoom-out (scale < 1) would
  // grow the width past the cap AND drift the map — clamp the scale to 1 so
  // zoomViewBox is the identity and the map stops dead.
  const s = clampZoomScale(0.85, 300, ORIG, 24, 3);
  assert.equal(s, 1);
});

test('clampZoomScale floors a zoom-out that would overshoot the cap', () => {
  // currentWidth 270, maxWidth 300 → the last legal zoom-out is 270/300 = 0.9.
  // A stronger 0.5 request is floored to 0.9 (lands exactly on the cap).
  const s = clampZoomScale(0.5, 270, ORIG, 24, 3);
  assert.equal(s, 0.9);
  assert.equal(270 / s, 300); // new width == maxWidth
});

test('clampZoomScale ceilings a zoom-in that would overshoot the max zoom-in', () => {
  // minWidth = 100/24. currentWidth already there → any zoom-in clamps to 1.
  assert.equal(clampZoomScale(1.3, 100 / 24, ORIG, 24, 3), 1);
});

test('clampZoomScale guards bad input', () => {
  assert.equal(clampZoomScale(NaN, 100, ORIG), 1);
  assert.equal(clampZoomScale(0, 100, ORIG), 1);
  assert.equal(clampZoomScale(1.1, 0, ORIG), 1);
});

// ---- panViewBox ----

test('panViewBox shifts x/y but not width/height', () => {
  const vb = { x: 10, y: 20, width: 100, height: 80 };
  const out = panViewBox(vb, 5, -3);
  assert.deepEqual(out, { x: 15, y: 17, width: 100, height: 80 });
});

test('panViewBox with zero delta is a no-op (returns equal values)', () => {
  const vb = { x: 10, y: 20, width: 100, height: 80 };
  assert.deepEqual(panViewBox(vb, 0, 0), vb);
});

// ---- clampViewBox ----

test('clampViewBox caps zoom-out at the original viewBox', () => {
  const original = { x: 0, y: 0, width: 100, height: 100 };
  // Try to zoom out to 200 wide — should clamp back to 100.
  const out = clampViewBox({ x: -50, y: -50, width: 200, height: 200 }, original);
  assert.equal(out.width, 100);
  assert.equal(out.height, 100);
});

test('clampViewBox caps zoom-in at original / maxZoomIn', () => {
  const original = { x: 0, y: 0, width: 100, height: 100 };
  // Try to zoom way too far in — should clamp to 100/8 = 12.5
  const out = clampViewBox({ x: 0, y: 0, width: 1, height: 1 }, original, 8);
  assert.equal(out.width, 12.5);
  assert.equal(out.height, 12.5);
});

test('clampViewBox expands (never shrinks) to preserve aspect — wider input keeps height-driven width', () => {
  const original = { x: 0, y: 0, width: 200, height: 100 };  // 2:1
  // Input is taller-than-target (50/999 ≪ 2.0). Result must EXPAND
  // width so the full height fits — chopping the input's top/bottom
  // would lose countries (Germany north of Algeria, etc.). Width
  // ends up at height × targetAspect = 999 × 2 = 1998 → capped at
  // the original max of 200, with height then locked at 100.
  const out = clampViewBox({ x: 0, y: 0, width: 50, height: 999 }, original);
  assert.equal(out.width, 200);
  assert.equal(out.height, 100);
});

test('clampViewBox expands height for a wider-than-target input', () => {
  const original = { x: 0, y: 0, width: 200, height: 100 };  // 2:1
  // Input is wider-than-target (300/50 = 6, target = 2). Height
  // expands to width / targetAspect = 300/2 = 150, then both cap.
  const out = clampViewBox({ x: 0, y: 0, width: 300, height: 50 }, original);
  assert.equal(out.width, 200);
  assert.equal(out.height, 100);
});

test('clampViewBox handles a tall-but-fitting input by widening to aspect', () => {
  // Bigger original so the result doesn't cap. Input is taller than
  // target (40/80 = 0.5, target = 2). Width expands to height × 2
  // = 160, height stays 80. Result is 160 × 80 = aspect 2 ✓.
  const original = { x: 0, y: 0, width: 1000, height: 500 };
  const out = clampViewBox({ x: 100, y: 50, width: 40, height: 80 }, original);
  assert.equal(out.width, 160);
  assert.equal(out.height, 80);
  // Centered on the original input center (120, 90).
  assert.equal(out.x + out.width / 2, 120);
  assert.equal(out.y + out.height / 2, 90);
});

test('clampViewBox keeps the viewBox inside the original bounds', () => {
  const original = { x: 0, y: 0, width: 100, height: 100 };
  // Zoomed-in viewBox positioned way off to the right — clamp x back.
  const out = clampViewBox({ x: 200, y: 200, width: 20, height: 20 }, original);
  assert.equal(out.x, 80);  // 100 - 20
  assert.equal(out.y, 80);
});

test('clampViewBox accepts a viewBox already inside bounds unchanged', () => {
  const original = { x: 0, y: 0, width: 100, height: 100 };
  const vb = { x: 30, y: 40, width: 50, height: 50 };
  assert.deepEqual(clampViewBox(vb, original), vb);
});

test('clampViewBox recenters around the input bbox center when width is bumped up', () => {
  // Singapore-shaped case: a tiny country at SVG coord (2095, 687)
  // with a 2-unit-wide bbox. Without the recenter, the expanded
  // viewBox would have the country at its (0, 0) corner.
  const original = { x: 0, y: 0, width: 2754, height: 1398 };
  const vb = { x: 2094, y: 686, width: 2, height: 2 };  // center (2095, 687)
  const out = clampViewBox(vb, original, 8);
  // Min width = 2754 / 8 ≈ 344.25. Aspect ratio preserved → height ≈ 174.75.
  // After recenter, the country center (2095, 687) should still sit
  // at the new bbox's center.
  const newCenterX = out.x + out.width / 2;
  const newCenterY = out.y + out.height / 2;
  assert.equal(newCenterX, 2095);
  assert.equal(newCenterY, 687);
});

test('clampViewBox lets viewBox.x extend past original by the overhang amount in slice mode', () => {
  // Europe asset at portrait phone in fullscreen slice mode: viewBox 680×520,
  // viewport 414×900 → slice scale 1.731, visible-x-window 239 vbu wide. The
  // viewBox overhangs the visible window by (680 - 239) / 2 ≈ 220.5 vbu per
  // side. Without that allowance, the pan clamp pins viewBox.x ≥ 0 and the
  // visible window center can never reach Portugal at x ≈ 138. The overhang
  // arg lets the clamp accept viewBox.x as low as -220.5.
  const original = { x: 0, y: 0, width: 680, height: 520 };
  const overhang = { x: 220.5, y: 0 };
  // Try to pan WAY past original.x (the user dragging hard to the right) —
  // the clamp now permits viewBox.x = -220.5 instead of snapping back to 0.
  const out = clampViewBox(
    { x: -500, y: 100, width: 226.67, height: 173.33 },
    original, 8, 1, overhang,
  );
  assert.equal(out.x, -220.5);
});

test('clampViewBox lets viewBox.x extend past the right edge by overhang too', () => {
  // Symmetric — the right edge of the asset must be reachable when the
  // user pans to the rightmost position in slice mode.
  const original = { x: 0, y: 0, width: 680, height: 520 };
  const overhang = { x: 220.5, y: 0 };
  const out = clampViewBox(
    { x: 1000, y: 100, width: 226.67, height: 173.33 },
    original, 8, 1, overhang,
  );
  // max viewBox.x = original.right - width + overhang = 680 - 226.67 + 220.5 = 673.83
  assert.ok(Math.abs(out.x - 673.83) < 0.01, `expected ~673.83, got ${out.x}`);
});

test('clampViewBox with overhang=0 keeps the historical "viewBox stays inside original" behavior', () => {
  // Default overhang is { x:0, y:0 } — meet mode (or matching aspect)
  // has no slice extension, so the existing pre-fix rule still applies.
  const original = { x: 0, y: 0, width: 680, height: 520 };
  const out = clampViewBox({ x: -500, y: 100, width: 226.67, height: 173.33 }, original);
  assert.equal(out.x, 0);
});

test('clampViewBox lets you pan even at 1x zoom (width === original.width) when overhang > 0', () => {
  // Slice mode on a portrait phone at 1x zoom: viewBox equals original
  // in both width and height, but the visible window is still narrower
  // (the slice crops). Before unifying the branches, this case took
  // the "width >= original.width → center, no pan" path and the user
  // couldn't reach Portugal at all without zooming in. After the fix:
  // overhang > 0 forces the branch with positive panning range.
  const original = { x: 0, y: 0, width: 680, height: 520 };
  const overhang = { x: 220.5, y: 0 };
  const out = clampViewBox(
    { x: -1000, y: 0, width: 680, height: 520 },
    original, 8, 1, overhang,
  );
  // Allowed range: x ∈ [-220.5, 220.5]. Hard left = -220.5.
  assert.equal(out.x, -220.5);
});

test('clampViewBox still centres a zoomed-out viewBox when freePan is off', () => {
  // Fullscreen zoom-out (viewBox larger than the map) with the default
  // freePan=false: the map stays locked dead-centre — the historical rule.
  const original = { x: 0, y: 0, width: 100, height: 100 };
  const out = clampViewBox(
    { x: -80, y: -80, width: 200, height: 200 }, // dragged, 2× zoomed out
    original, 24, 3,
  );
  assert.equal(out.x, -50); // centred: (100 - 200)/2
  assert.equal(out.y, -50);
});

test('clampViewBox freePan lets you drag a zoomed-out map off-centre', () => {
  // Same zoomed-out viewBox, but freePan on. The player drags the map far
  // up-left; the clamp permits it, stopping once only FREE_PAN_KEEP (10%) of
  // the visible window is still covered by the map.
  const original = { x: 0, y: 0, width: 100, height: 100 };
  const out = clampViewBox(
    { x: -500, y: -500, width: 200, height: 200 },
    original, 24, 3, { x: 0, y: 0 }, true,
  );
  // keep = width × 0.1 = 20. minX = 0 + 20 - 200 = -180. Dragged past it →
  // clamped to -180, NOT recentred to -50. So the map really moved.
  assert.equal(out.x, -180);
  assert.equal(out.y, -180);
  assert.notEqual(out.x, -50);
});

test('clampViewBox freePan keeps the map from leaving the screen entirely', () => {
  const original = { x: 0, y: 0, width: 100, height: 100 };
  // Drag hard the OTHER way.
  const out = clampViewBox(
    { x: 900, y: 900, width: 200, height: 200 },
    original, 24, 3, { x: 0, y: 0 }, true,
  );
  // keep = width × 0.1 = 20. maxX = original.x + original.width - keep = 80.
  assert.equal(out.x, 80);
  assert.equal(out.y, 80);
});

test('clampViewBox freePan does not change the zoomed-IN rule (no void while exploring)', () => {
  // Zoomed in (viewBox smaller than the map): even with freePan on, the
  // visible window still stays inside the map — same as without freePan.
  const original = { x: 0, y: 0, width: 100, height: 100 };
  const vb = { x: 200, y: 200, width: 20, height: 20 };
  const free = clampViewBox(vb, original, 24, 3, { x: 0, y: 0 }, true);
  const locked = clampViewBox(vb, original, 24, 3, { x: 0, y: 0 }, false);
  assert.deepEqual(free, locked);
  assert.equal(free.x, 80); // 100 - 20, still pinned to the map edge
});

// ---- parseViewBox / formatViewBox ----

test('parseViewBox parses a 4-number space-separated string', () => {
  assert.deepEqual(
    parseViewBox('0 0 680 520'),
    { x: 0, y: 0, width: 680, height: 520 },
  );
});

test('parseViewBox handles negative origins + decimals', () => {
  assert.deepEqual(
    parseViewBox('-10 -5 100.5 75.25'),
    { x: -10, y: -5, width: 100.5, height: 75.25 },
  );
});

test('parseViewBox returns null on malformed input', () => {
  assert.equal(parseViewBox(''), null);
  assert.equal(parseViewBox('not a viewBox'), null);
  assert.equal(parseViewBox('1 2 3'), null);  // too few
  assert.equal(parseViewBox('1 2 3 NaN'), null);
  assert.equal(parseViewBox(/** @type {any} */ (null)), null);
});

test('formatViewBox round-trips through parseViewBox', () => {
  const vb = { x: 100, y: 50, width: 800, height: 600 };
  assert.deepEqual(parseViewBox(formatViewBox(vb)), vb);
});

// ---- screenToSvg ----

test('screenToSvg uses the inverse screen CTM to convert client coords', () => {
  // Identity-shifted-by-(50, 100) CTM — i.e., svg's screen position
  // starts at (50, 100). Inverse subtracts that offset, so a click at
  // client (60, 110) lands at SVG coord (10, 10).
  const fakeSvg = {
    createSVGPoint: () => {
      const p = { x: 0, y: 0, matrixTransform: (m) => m.apply(p) };
      return p;
    },
    getScreenCTM: () => ({
      apply: (p) => ({ x: p.x - 50, y: p.y - 100 }),
      inverse: function () { return this; },
    }),
  };
  assert.deepEqual(screenToSvg(fakeSvg, 60, 110), { x: 10, y: 10 });
});

test('screenToSvg returns null when the SVG API surface is missing', () => {
  assert.equal(screenToSvg(null, 0, 0), null);
  assert.equal(screenToSvg({}, 0, 0), null);
  assert.equal(screenToSvg({ createSVGPoint: () => ({}) }, 0, 0), null);  // no getScreenCTM
});

// ---- regionalFrame ----

const WORLD = { x: 0, y: 0, width: 2000, height: 1000 };

test('regionalFrame centers the viewBox on the country bbox', () => {
  const bbox = { x: 900, y: 400, width: 200, height: 200 };  // center (1000, 500)
  const out = regionalFrame(bbox, WORLD);
  assert.equal(out.x + out.width / 2, 1000);
  assert.equal(out.y + out.height / 2, 500);
});

test('regionalFrame caps zoom-in for a tiny country at maxZoom (not a pinpoint crop)', () => {
  // A speck (Vatican-ish). Without a floor this would zoom absurdly deep;
  // the min frame is original / maxZoom.
  const speck = { x: 1000, y: 500, width: 1, height: 1 };
  const out = regionalFrame(speck, WORLD, { maxZoom: 6 });
  assert.equal(out.width, 2000 / 6);
  assert.equal(out.height, 1000 / 6);
});

test('regionalFrame frames a mid-size country with surrounding context (pad applies)', () => {
  // Country wider than the maxZoom floor: pad multiplier dominates.
  const country = { x: 800, y: 400, width: 400, height: 200 };
  const out = regionalFrame(country, WORLD, { pad: 2.5, maxZoom: 6 });
  assert.equal(out.width, 400 * 2.5);   // 1000, above the 2000/6 floor
  assert.equal(out.height, 200 * 2.5);  // 500
});

test('regionalFrame never exceeds the original viewBox (huge country → no over-zoom-out)', () => {
  const huge = { x: 100, y: 50, width: 1800, height: 900 };
  const out = regionalFrame(huge, WORLD, { pad: 2.5 });
  assert.equal(out.width, 2000);   // capped at original.width
  assert.equal(out.height, 1000);  // capped at original.height
});

// ---- easeInOutCubic ----

test('easeInOutCubic pins the endpoints and passes through the midpoint', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
});

test('easeInOutCubic is monotonic and eases in (slow start)', () => {
  // First quarter covers less ground than a linear ramp would.
  assert.ok(easeInOutCubic(0.25) < 0.25);
  // Symmetric: last quarter covers more (fast approach, gentle stop).
  assert.ok(easeInOutCubic(0.75) > 0.75);
});
