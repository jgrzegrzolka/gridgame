import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchConfetti, launchFireworks } from './confetti.js';

/**
 * Minimal Document stand-in: enough surface area for launchConfetti to
 * build elements, set CSS custom properties, append to body, and time out
 * the removal. Element children are tracked so .remove() unhooks them
 * from the parent (the real DOM does this, jsdom-free node:test does not).
 */
function fakeDoc({ reducedMotion = false } = {}) {
  function makeEl() {
    /** @type {any[]} */
    const children = [];
    const style = {
      _props: /** @type {Record<string, string>} */ ({}),
      background: '',
      /** @param {string} key @param {string} value */
      setProperty(key, value) { this._props[key] = value; },
    };
    const el = /** @type {any} */ ({
      style,
      className: '',
      parent: /** @type {any} */ (null),
      /** @param {any} child */
      appendChild(child) { children.push(child); child.parent = el; return child; },
      /** @param {string} name @param {string} value */
      setAttribute(name, value) { el[`attr_${name}`] = value; },
      remove() {
        if (el.parent) {
          const i = el.parent._children.indexOf(el);
          if (i >= 0) el.parent._children.splice(i, 1);
          el.parent = null;
        }
      },
      get _children() { return children; },
    });
    return el;
  }
  const body = makeEl();
  return {
    body,
    defaultView: {
      matchMedia: (/** @type {string} */ query) => ({
        matches: reducedMotion && query.includes('reduce'),
      }),
    },
    createElement: () => makeEl(),
  };
}

// `encore: false` on the existing assertions keeps each test in a
// single tick — the encore wave is verified separately below.
test('launchConfetti appends a container with the requested number of pieces', () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 17, duration: 0, encore: false });
  assert.ok(result);
  assert.equal(doc.body._children.length, 1);
  assert.equal(doc.body._children[0]._children.length, 17);
});

test('launchConfetti sets per-piece CSS custom properties and a background color', () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 1, rng: () => 0.5, duration: 0, encore: false });
  assert.ok(result);
  const piece = doc.body._children[0]._children[0];
  // 0.5 RNG keeps the math predictable and lets us assert the wiring is correct.
  assert.equal(piece.style._props['--start-left'], '50vw');
  assert.equal(piece.style._props['--drift'], '0px');
  assert.equal(piece.style._props['--rot'], '0deg');
  assert.equal(piece.style._props['--dur'], '3300ms');
  assert.equal(piece.style._props['--delay'], '3400ms');
  assert.notEqual(piece.style.background, '');
});

test('launchConfetti is a no-op when prefersReducedMotion is true', () => {
  const doc = fakeDoc({ reducedMotion: true });
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 50, encore: false });
  assert.equal(result, null);
  assert.equal(doc.body._children.length, 0);
});

test('launchConfetti also reads the prefers-reduced-motion media query directly', () => {
  const doc = fakeDoc({ reducedMotion: true });
  // No explicit override — should fall through to defaultView.matchMedia.
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 1, encore: false });
  assert.equal(result, null);
});

test('launchConfetti removes the container after the duration elapses', async () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 5, duration: 20, encore: false });
  assert.ok(result);
  assert.equal(doc.body._children.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(doc.body._children.length, 0);
});

test('launchConfetti cancel() tears down the container before the timer fires', () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 5, duration: 60_000, encore: false });
  assert.ok(result);
  result.cancel();
  assert.equal(doc.body._children.length, 0);
});

test('launchConfetti schedules an encore wave after encoreDelay', async () => {
  const doc = fakeDoc();
  const result = launchConfetti({
    doc: /** @type {any} */ (doc),
    count: 5,
    duration: 60_000,
    encoreCount: 3,
    encoreDelay: 20,
    encoreDuration: 60_000,
  });
  assert.ok(result);
  // First wave is on body immediately, encore not yet.
  assert.equal(doc.body._children.length, 1);
  assert.equal(doc.body._children[0]._children.length, 5);
  await new Promise((resolve) => setTimeout(resolve, 40));
  // Encore fired — second container appended with `encoreCount` pieces.
  assert.equal(doc.body._children.length, 2);
  assert.equal(doc.body._children[1]._children.length, 3);
  result.cancel();
});

test('launchConfetti cancel() also clears the pending encore timer', async () => {
  const doc = fakeDoc();
  const result = launchConfetti({
    doc: /** @type {any} */ (doc),
    count: 5,
    duration: 60_000,
    encoreCount: 3,
    encoreDelay: 20,
    encoreDuration: 60_000,
  });
  assert.ok(result);
  result.cancel();
  await new Promise((resolve) => setTimeout(resolve, 40));
  // Encore must NOT have fired — cancel cleared the pending timer.
  assert.equal(doc.body._children.length, 0);
});

test('launchConfetti scales main + encore counts by intensity between floor and ceiling', async () => {
  const doc = fakeDoc();
  // intensity 0.5 with count=100/floor=20 → 20 + 0.5*(100-20) = 60.
  // encoreCount=40/floor=10 → 10 + 0.5*(40-10) = 25.
  const result = launchConfetti({
    doc: /** @type {any} */ (doc),
    count: 100,
    minCount: 20,
    encoreCount: 40,
    minEncoreCount: 10,
    encoreDelay: 20,
    duration: 60_000,
    encoreDuration: 60_000,
    intensity: 0.5,
  });
  assert.ok(result);
  assert.equal(doc.body._children[0]._children.length, 60,
    'main wave halfway between floor (20) and ceiling (100) at intensity 0.5');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(doc.body._children[1]._children.length, 25,
    'encore halfway between floor (10) and ceiling (40) at intensity 0.5');
  result.cancel();
});

test('launchConfetti at intensity 0 collapses to the floor, not zero particles', () => {
  // A 1/50 finish still deserves *some* visible recognition — the floor
  // is what guarantees that, instead of the celebration silently
  // shrinking to a single sad piece of confetti.
  const doc = fakeDoc();
  const result = launchConfetti({
    doc: /** @type {any} */ (doc),
    count: 100,
    minCount: 20,
    duration: 0,
    encore: false,
    intensity: 0,
  });
  assert.ok(result);
  assert.equal(doc.body._children[0]._children.length, 20);
});

test('launchConfetti at intensity 1 (default) honours the caller-supplied count exactly', () => {
  // Default intensity must be a true no-op vs. the pre-intensity behavior,
  // so existing callers (and tests) don't pick up an unexpected floor.
  const doc = fakeDoc();
  const result = launchConfetti({
    doc: /** @type {any} */ (doc),
    count: 100,
    minCount: 20,
    duration: 0,
    encore: false,
  });
  assert.ok(result);
  assert.equal(doc.body._children[0]._children.length, 100);
});

test('launchFireworks appends a single container that gets populated over the burst schedule', async () => {
  const doc = fakeDoc();
  const result = launchFireworks({
    doc: /** @type {any} */ (doc),
    bursts: 3,
    particlesPerBurst: 4,
    burstInterval: 10,
    particleDuration: 60_000,
  });
  assert.ok(result);
  assert.equal(doc.body._children.length, 1);
  // First burst happens at delay 0 → fires after the current tick.
  // Wait long enough for all three bursts (3 × 10ms = 30ms) and then some.
  await new Promise((resolve) => setTimeout(resolve, 60));
  // Each burst spawns 1 central flash + N particles, so 3 bursts × (1+4)
  // = 15 children. The flash is what reads as the "ignition" pulse at
  // the burst centre; counting it here pins the contract that every
  // burst gets one.
  assert.equal(doc.body._children[0]._children.length, 15);
  result.cancel();
});

test('launchFireworks is a no-op when prefersReducedMotion is true', () => {
  const doc = fakeDoc({ reducedMotion: true });
  const result = launchFireworks({ doc: /** @type {any} */ (doc), bursts: 2, particlesPerBurst: 4 });
  assert.equal(result, null);
  assert.equal(doc.body._children.length, 0);
});

test('launchFireworks cancel() stops pending bursts from firing', async () => {
  const doc = fakeDoc();
  const result = launchFireworks({
    doc: /** @type {any} */ (doc),
    bursts: 3,
    particlesPerBurst: 4,
    burstInterval: 20,
    particleDuration: 60_000,
  });
  assert.ok(result);
  result.cancel();
  await new Promise((resolve) => setTimeout(resolve, 80));
  // Container removed; pending bursts never landed particles.
  assert.equal(doc.body._children.length, 0);
});
