import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchConfetti } from './confetti.js';

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

test('launchConfetti appends a container with the requested number of pieces', () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 17, duration: 0 });
  assert.ok(result);
  assert.equal(doc.body._children.length, 1);
  assert.equal(doc.body._children[0]._children.length, 17);
});

test('launchConfetti sets per-piece CSS custom properties and a background color', () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 1, rng: () => 0.5, duration: 0 });
  assert.ok(result);
  const piece = doc.body._children[0]._children[0];
  // 0.5 RNG keeps the math predictable and lets us assert the wiring is correct.
  assert.equal(piece.style._props['--start-left'], '50vw');
  assert.equal(piece.style._props['--drift'], '0px');
  assert.equal(piece.style._props['--rot'], '0deg');
  assert.equal(piece.style._props['--dur'], '3300ms');
  assert.equal(piece.style._props['--delay'], '500ms');
  assert.notEqual(piece.style.background, '');
});

test('launchConfetti is a no-op when prefersReducedMotion is true', () => {
  const doc = fakeDoc({ reducedMotion: true });
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 50 });
  assert.equal(result, null);
  assert.equal(doc.body._children.length, 0);
});

test('launchConfetti also reads the prefers-reduced-motion media query directly', () => {
  const doc = fakeDoc({ reducedMotion: true });
  // No explicit override — should fall through to defaultView.matchMedia.
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 1 });
  assert.equal(result, null);
});

test('launchConfetti removes the container after the duration elapses', async () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 5, duration: 20 });
  assert.ok(result);
  assert.equal(doc.body._children.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(doc.body._children.length, 0);
});

test('launchConfetti cancel() tears down the container before the timer fires', () => {
  const doc = fakeDoc();
  const result = launchConfetti({ doc: /** @type {any} */ (doc), count: 5, duration: 60_000 });
  assert.ok(result);
  result.cancel();
  assert.equal(doc.body._children.length, 0);
});
