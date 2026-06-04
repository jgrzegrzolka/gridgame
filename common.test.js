import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableBurgerIfEmpty, wireBurgerDismiss } from './common.js';

/**
 * Fake burger element that tracks both the native `disabled` property and the
 * `aria-disabled` attribute. The helper must keep these in sync — see the
 * test below for why. The shape mirrors only what the helper touches.
 */
function fakeBurger() {
  /** @type {Record<string, string>} */
  const attrs = {};
  return /** @type {any} */ ({
    disabled: false,
    /** @param {string} k @param {string} v */
    setAttribute: (k, v) => { attrs[k] = v; },
    /** @param {string} k */
    getAttribute: (k) => attrs[k] ?? null,
  });
}

test('disableBurgerIfEmpty: disables the burger when the menu has no items', () => {
  const burger = fakeBurger();
  const menu = /** @type {any} */ ({ children: { length: 0 } });
  disableBurgerIfEmpty(burger, menu);
  assert.equal(burger.disabled, true);
});

test('disableBurgerIfEmpty: ALSO sets aria-disabled — common.css keys off it for the greyed-out visual', () => {
  // Regression test: when only burger.disabled was set, the button blocked
  // clicks but kept its active visual style (no aria-disabled meant the
  // CSS rules for the disabled appearance never matched). Empty-menu pages
  // looked like a broken interaction rather than an inert affordance.
  const burger = fakeBurger();
  const menu = /** @type {any} */ ({ children: { length: 0 } });
  disableBurgerIfEmpty(burger, menu);
  assert.equal(burger.getAttribute('aria-disabled'), 'true');
});

test('disableBurgerIfEmpty: leaves the burger enabled when the menu has items', () => {
  const burger = fakeBurger();
  const menu = /** @type {any} */ ({ children: { length: 2 } });
  disableBurgerIfEmpty(burger, menu);
  assert.equal(burger.disabled, false);
  assert.equal(burger.getAttribute('aria-disabled'), null);
});

/**
 * Minimal fake DOM for wireBurgerDismiss tests. Tracks the listeners
 * registered on the document so the tests can drive synthetic click and
 * keydown events without spinning up a real DOM.
 */
function fakeBurgerDom({ panelHidden = true } = {}) {
  /** @type {Record<string, string>} */
  const burgerAttrs = { 'aria-expanded': panelHidden ? 'false' : 'true' };
  /** @type {any} */
  const burger = {
    dataset: { labelOpen: 'Open menu', labelClose: 'Close menu' },
    /** @param {any} t */
    contains: (t) => t === burger,
    /** @param {string} k */ getAttribute: (k) => burgerAttrs[k] ?? null,
    /** @param {string} k @param {string} v */ setAttribute: (k, v) => { burgerAttrs[k] = v; },
    focusCount: 0,
    focus() { this.focusCount++; },
  };
  /** @type {any} */
  const panel = {
    hidden: panelHidden,
    /** @param {any} t */
    contains: (t) => t === panel,
  };
  /** @type {Record<string, Array<(e: any) => void>>} */
  const listeners = {};
  const outside = { contains: () => false };
  const doc = {
    /** @param {string} sel */
    querySelector: (sel) => (sel === '.burger' ? burger : sel === '#burger-panel' ? panel : null),
    /** @param {string} type @param {(e: any) => void} fn */
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] ?? []).push(fn);
    },
  };
  /** @param {string} type @param {any} evt */
  const fire = (type, evt) => {
    for (const fn of listeners[type] ?? []) fn(evt);
  };
  return { doc, burger, panel, outside, fire, burgerAttrs };
}

test('wireBurgerDismiss: clicking outside both burger and panel closes the panel', () => {
  const env = fakeBurgerDom({ panelHidden: false });
  wireBurgerDismiss({ doc: /** @type {any} */ (env.doc) });
  env.fire('click', { target: env.outside });
  assert.equal(env.panel.hidden, true);
  assert.equal(env.burgerAttrs['aria-expanded'], 'false');
  assert.equal(env.burgerAttrs['aria-label'], 'Open menu');
});

test('wireBurgerDismiss: clicking on the burger itself is ignored — the inline onclick already toggles', () => {
  const env = fakeBurgerDom({ panelHidden: false });
  wireBurgerDismiss({ doc: /** @type {any} */ (env.doc) });
  env.fire('click', { target: env.burger });
  assert.equal(env.panel.hidden, false, 'should not have closed');
});

test('wireBurgerDismiss: clicking inside the panel is ignored — menu links etc. must still work', () => {
  const env = fakeBurgerDom({ panelHidden: false });
  wireBurgerDismiss({ doc: /** @type {any} */ (env.doc) });
  env.fire('click', { target: env.panel });
  assert.equal(env.panel.hidden, false);
});

test('wireBurgerDismiss: an outside click while the panel is already closed is a no-op', () => {
  const env = fakeBurgerDom({ panelHidden: true });
  wireBurgerDismiss({ doc: /** @type {any} */ (env.doc) });
  env.fire('click', { target: env.outside });
  assert.equal(env.panel.hidden, true);
});

test('wireBurgerDismiss: Escape closes the panel and returns focus to the burger', () => {
  const env = fakeBurgerDom({ panelHidden: false });
  wireBurgerDismiss({ doc: /** @type {any} */ (env.doc) });
  env.fire('keydown', { key: 'Escape' });
  assert.equal(env.panel.hidden, true);
  assert.equal(env.burger.focusCount, 1);
});

test('wireBurgerDismiss: non-Escape keydown is a no-op', () => {
  const env = fakeBurgerDom({ panelHidden: false });
  wireBurgerDismiss({ doc: /** @type {any} */ (env.doc) });
  env.fire('keydown', { key: 'Enter' });
  assert.equal(env.panel.hidden, false);
});

test('wireBurgerDismiss: pages without a burger panel are safe (no-op, no throw)', () => {
  const doc = {
    querySelector: () => null,
    addEventListener: () => { throw new Error('should not register'); },
  };
  // Must not throw and must not register listeners.
  wireBurgerDismiss({ doc: /** @type {any} */ (doc) });
});
