import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zoomViewBox,
  panViewBox,
  clampViewBox,
  parseViewBox,
  formatViewBox,
  screenToSvg,
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

test('clampViewBox preserves the original aspect ratio after clamping', () => {
  const original = { x: 0, y: 0, width: 200, height: 100 };  // 2:1
  // Try zooming in but with a slightly off width — height should
  // re-derive from width × aspect ratio.
  const out = clampViewBox({ x: 0, y: 0, width: 50, height: 999 }, original);
  assert.equal(out.width, 50);
  assert.equal(out.height, 25);  // 50 × (100/200) = 25
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
