import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableBurgerIfEmpty } from './common.js';

test('disableBurgerIfEmpty: disables the burger when the menu has no items', () => {
  const burger = /** @type {any} */ ({ disabled: false });
  const menu = /** @type {any} */ ({ children: { length: 0 } });
  disableBurgerIfEmpty(burger, menu);
  assert.equal(burger.disabled, true);
});

test('disableBurgerIfEmpty: leaves the burger enabled when the menu has items', () => {
  const burger = /** @type {any} */ ({ disabled: false });
  const menu = /** @type {any} */ ({ children: { length: 2 } });
  disableBurgerIfEmpty(burger, menu);
  assert.equal(burger.disabled, false);
});
