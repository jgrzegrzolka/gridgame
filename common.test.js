import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableBurgerIfEmpty } from './common.js';

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
