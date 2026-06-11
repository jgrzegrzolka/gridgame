import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameMenuItem, NICKNAME_STORAGE_KEY } from './common.js';
import { defaultNickname } from './flags/nickname.js';

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

// ---------------------------------------------------------------------------
// mountNicknameMenuItem — Feature H2.5 "Nick: ..." link into the burger
// ---------------------------------------------------------------------------

/**
 * Minimal element fake. Records appendChild + insertBefore + setAttribute
 * so the assertions can inspect the resulting tree without a real DOM.
 *
 * @param {string} tag
 * @returns {any}
 */
function makeMenuElement(tag) {
  /** @type {any[]} */
  const children = [];
  /** @type {Record<string, string>} */
  const attrs = {};
  return {
    tagName: tag.toUpperCase(),
    children,
    /** Mimics Node.firstChild for the helper's insertBefore branch. */
    get firstChild() { return children[0]; },
    attrs,
    className: '',
    textContent: '',
    appendChild(/** @type {any} */ c) { children.push(c); return c; },
    insertBefore(/** @type {any} */ c, /** @type {any} */ ref) {
      const i = children.indexOf(ref);
      if (i === -1) children.unshift(c);
      else children.splice(i, 0, c);
      return c;
    },
    setAttribute(/** @type {string} */ k, /** @type {string} */ v) { attrs[k] = v; },
    getAttribute(/** @type {string} */ k) { return attrs[k] ?? null; },
  };
}

/**
 * @param {{ cachedNickname?: string | null, existingItems?: number }} [opts]
 */
function fakeMenuDom(opts = {}) {
  const cachedNickname = opts.cachedNickname ?? null;
  /** @type {Map<string, string>} */
  const data = new Map();
  if (cachedNickname !== null) data.set(NICKNAME_STORAGE_KEY, cachedNickname);
  const storage = {
    /** @param {string} k */
    getItem: (k) => (data.has(k) ? /** @type {string} */ (data.get(k)) : null),
  };
  const doc = {
    /** @param {string} tag */
    createElement: makeMenuElement,
    /** @param {string} text */
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
  const rootEl = makeMenuElement('ul');
  // Optionally pre-populate with existing menu items so the
  // "insert as first child" behaviour can be verified.
  for (let i = 0; i < (opts.existingItems ?? 0); i++) {
    const li = makeMenuElement('li');
    li.textContent = `existing-${i}`;
    rootEl.appendChild(li);
  }
  return { doc, rootEl, storage };
}

test('mountNicknameMenuItem: no-op when rootEl is missing', () => {
  const result = mountNicknameMenuItem(/** @type {any} */ ({ rootEl: null, profileHref: '/profile/' }));
  assert.equal(result, null);
});

test('mountNicknameMenuItem: renders a single <li> with <a href={profileHref}> containing label + value', () => {
  const env = fakeMenuDom();
  const li = /** @type {any} */ (mountNicknameMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    profileHref: 'profile/',
    getDeviceId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  })));
  assert.ok(li);
  assert.equal(env.rootEl.children.length, 1);
  assert.equal(li.tagName, 'LI');
  const a = li.children[0];
  assert.equal(a.tagName, 'A');
  assert.equal(a.getAttribute('href'), 'profile/');
  // [label, ': ' textNode, strong]
  assert.equal(a.children.length, 3);
  assert.equal(a.children[0].getAttribute('data-i18n'), 'nickname.yourName');
  assert.equal(a.children[2].tagName, 'STRONG');
});

test('mountNicknameMenuItem: cached nickname wins over the default', () => {
  const env = fakeMenuDom({ cachedNickname: 'Alice' });
  const li = /** @type {any} */ (mountNicknameMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    profileHref: 'profile/',
    getDeviceId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  })));
  const strong = li.children[0].children[2];
  assert.equal(strong.textContent, 'Alice');
});

test('mountNicknameMenuItem: no cache → renders the deterministic default (matches flags/nickname.js)', () => {
  const env = fakeMenuDom();
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const li = /** @type {any} */ (mountNicknameMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    profileHref: 'profile/',
    getDeviceId: () => id,
  })));
  const strong = li.children[0].children[2];
  assert.equal(strong.textContent, defaultNickname(id));
});

test('mountNicknameMenuItem: inserted as the FIRST child of the menu (above existing nav items)', () => {
  const env = fakeMenuDom({ existingItems: 3 });
  const li = /** @type {any} */ (mountNicknameMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    profileHref: 'profile/',
    getDeviceId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  })));
  assert.equal(env.rootEl.children[0], li, 'nickname item must be first');
  assert.equal(env.rootEl.children.length, 4, 'existing 3 items still present');
});

test('mountNicknameMenuItem: pageIsProfile=true marks the link with aria-current="page"', () => {
  const env = fakeMenuDom();
  const li = /** @type {any} */ (mountNicknameMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    profileHref: './',
    pageIsProfile: true,
    getDeviceId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  })));
  assert.equal(li.children[0].getAttribute('aria-current'), 'page');
});

test('mountNicknameMenuItem: storage.getItem throwing (private mode) falls back to the default', () => {
  const doc = {
    createElement: makeMenuElement,
    /** @param {string} t */
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  };
  const rootEl = makeMenuElement('ul');
  const storage = {
    /** @param {string} _k */
    getItem: (_k) => { throw new Error('private mode'); },
  };
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const li = /** @type {any} */ (mountNicknameMenuItem(/** @type {any} */ ({
    rootEl,
    doc,
    storage,
    profileHref: 'profile/',
    getDeviceId: () => id,
  })));
  assert.equal(li.children[0].children[2].textContent, defaultNickname(id));
});
