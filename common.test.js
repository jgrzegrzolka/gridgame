import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameField, NICKNAME_STORAGE_KEY } from './common.js';

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
// mountNicknameField — Feature H2 nickname affordance in the burger panel
// ---------------------------------------------------------------------------

/**
 * Build the minimal DOM + storage fakes the helper needs. The element shape
 * mirrors only the surface mountNicknameField touches — same convention as
 * the burger tests above. Element tagName is captured so the assertions can
 * read it without `el.tagName` semantics needing to match the browser.
 *
 * @param {{ cachedNickname?: string | null }} [opts]
 */
function fakeNicknameDom(opts = {}) {
  const cachedNickname = opts.cachedNickname ?? null;
  /** @type {Map<string, string>} */
  const data = new Map();
  if (cachedNickname !== null) data.set(NICKNAME_STORAGE_KEY, cachedNickname);
  const storage = {
    /** @param {string} k */
    getItem: (k) => (data.has(k) ? /** @type {string} */ (data.get(k)) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => { data.set(k, v); },
    /** @param {string} k */
    removeItem: (k) => { data.delete(k); },
    _dump: () => Object.fromEntries(data),
  };

  /**
   * @param {string} tag
   * @returns {any}
   */
  function makeElement(tag) {
    /** @type {any[]} */
    const children = [];
    /** @type {Record<string, string>} */
    const attrs = {};
    /** @type {Set<string>} */
    const classes = new Set();
    /** @type {Record<string, Array<(e: any) => void>>} */
    const listeners = {};
    const el = {
      tagName: tag.toUpperCase(),
      children,
      get childNodes() { return children; },
      attributes: attrs,
      _listeners: listeners,
      classList: {
        add: /** @param {string[]} cls */ (...cls) => cls.forEach((c) => classes.add(c)),
        remove: /** @param {string[]} cls */ (...cls) => cls.forEach((c) => classes.delete(c)),
        contains: /** @param {string} c */ (c) => classes.has(c),
        _all: () => Array.from(classes),
      },
      textContent: '',
      type: '',
      value: '',
      maxLength: 0,
      placeholder: '',
      className: '',
      disabled: false,
      /** @param {string} k @param {string} v */
      setAttribute(k, v) { attrs[k] = v; },
      /** @param {string} k */
      getAttribute(k) { return attrs[k] ?? null; },
      /** @param {string} k */
      removeAttribute(k) { delete attrs[k]; },
      /** @param {any} child */
      appendChild(child) { children.push(child); return child; },
      /**
       * @param {string} type @param {(e: any) => void} fn
       */
      addEventListener(type, fn) {
        (listeners[type] = listeners[type] ?? []).push(fn);
      },
      /**
       * @param {string} type @param {any} evt
       */
      _fire(type, evt) {
        for (const fn of listeners[type] ?? []) fn(evt);
      },
    };
    return el;
  }

  const doc = {
    /** @param {string} tag */
    createElement: makeElement,
  };
  const rootEl = makeElement('section');
  return { doc, rootEl, storage };
}

/**
 * @param {{ status?: number, ok?: boolean, throws?: boolean }} [opts]
 */
function fakeFetch(opts = {}) {
  /** @type {Array<{ url: string, init: any }>} */
  const calls = [];
  /** @type {(url: string, init: any) => Promise<any>} */
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (opts.throws) throw new Error('network');
    const status = opts.status ?? 204;
    return { ok: opts.ok ?? (status >= 200 && status < 300), status };
  };
  return { impl, calls };
}

function flushMicrotasks() {
  return new Promise((r) => setImmediate(r));
}

test('mountNicknameField: returns null and is a no-op when rootEl is missing', () => {
  const result = mountNicknameField(/** @type {any} */ ({ rootEl: null }));
  assert.equal(result, null);
});

test('mountNicknameField: soft-disabled in prod — returns null and writes no DOM on non-local hostname', () => {
  // Backend (PUT /api/v1/profile + the `profiles` Cosmos container) is live
  // for both prod and dev. The UI is gated to localhost while H2's UX is
  // iterated on. Without this gate, real users would see the half-baked
  // form in the burger panel on every page.
  const env = fakeNicknameDom();
  const result = mountNicknameField(/** @type {any} */ ({
    hostname: 'www.yetanotherquiz.com',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fakeFetch().impl,
    getDeviceId: () => 'device-aaaaaaaa',
  }));
  assert.equal(result, null);
  assert.equal(env.rootEl.children.length, 0, 'no DOM written under rootEl');
});

test('mountNicknameField: renders on each of the recognised local hostnames', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1']) {
    const env = fakeNicknameDom();
    const form = mountNicknameField(/** @type {any} */ ({
      hostname,
      rootEl: env.rootEl,
      doc: env.doc,
      storage: env.storage,
      fetchImpl: fakeFetch().impl,
      getDeviceId: () => 'device-aaaaaaaa',
    }));
    assert.ok(form, `expected mount on ${hostname}`);
  }
});

test('mountNicknameField: builds form, label, input, button and status into rootEl', () => {
  const env = fakeNicknameDom();
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fakeFetch().impl,
    getDeviceId: () => 'device-aaaaaaaa',
  })));
  assert.ok(form);
  assert.equal(env.rootEl.children.length, 1, 'one form mounted under rootEl');
  // form > [label, button, status]
  assert.equal(form.tagName, 'FORM');
  assert.equal(form.children.length, 3);
  const [label, button, status] = form.children;
  assert.equal(label.tagName, 'LABEL');
  // label > [span, input]
  assert.equal(label.children[0].tagName, 'SPAN');
  assert.equal(label.children[0].getAttribute('data-i18n'), 'nickname.label');
  assert.equal(label.children[1].tagName, 'INPUT');
  assert.equal(label.children[1].maxLength, 24);
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.type, 'submit');
  assert.equal(button.getAttribute('data-i18n'), 'nickname.save');
  assert.equal(status.getAttribute('aria-live'), 'polite');
});

test('mountNicknameField: pre-fills input from cached nickname in localStorage', () => {
  const env = fakeNicknameDom({ cachedNickname: 'Alice' });
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fakeFetch().impl,
    getDeviceId: () => 'device-aaaaaaaa',
  })));
  const input = form.children[0].children[1];
  assert.equal(input.value, 'Alice');
});

test('mountNicknameField: no cache → input stays empty (placeholder visible)', () => {
  const env = fakeNicknameDom();
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fakeFetch().impl,
    getDeviceId: () => 'device-aaaaaaaa',
  })));
  const input = form.children[0].children[1];
  assert.equal(input.value, '');
});

test('mountNicknameField: submit PUTs trimmed nickname + deviceId, writes cache, shows Saved', async () => {
  const env = fakeNicknameDom();
  const fetcher = fakeFetch({ status: 204 });
  /** @type {Array<() => void>} */
  const flashes = [];
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fetcher.impl,
    getDeviceId: () => 'device-aaaaaaaa',
    setTimeoutImpl: /** @param {() => void} cb */ (cb) => { flashes.push(cb); return 1; },
    clearTimeoutImpl: () => {},
  })));
  const input = form.children[0].children[1];
  const status = form.children[2];
  input.value = '  Alice  ';

  form._fire('submit', { preventDefault: () => {} });
  await flushMicrotasks();

  assert.equal(fetcher.calls.length, 1);
  assert.equal(fetcher.calls[0].url, '/api/v1/profile');
  assert.equal(fetcher.calls[0].init.method, 'PUT');
  assert.equal(fetcher.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(fetcher.calls[0].init.body), {
    deviceId: 'device-aaaaaaaa',
    nickname: 'Alice',
  });
  assert.equal(env.storage._dump()[NICKNAME_STORAGE_KEY], 'Alice');
  assert.equal(status.textContent, 'Saved');
  assert.equal(status.classList.contains('is-saved'), true);
  assert.equal(flashes.length, 1, 'flash timer scheduled to clear the status');
});

test('mountNicknameField: empty input submits nickname: null and removes the cache key', async () => {
  const env = fakeNicknameDom({ cachedNickname: 'Alice' });
  const fetcher = fakeFetch({ status: 204 });
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fetcher.impl,
    getDeviceId: () => 'device-aaaaaaaa',
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  })));
  const input = form.children[0].children[1];
  input.value = '   ';  // whitespace-only → null after trim
  form._fire('submit', { preventDefault: () => {} });
  await flushMicrotasks();

  assert.deepEqual(JSON.parse(fetcher.calls[0].init.body), {
    deviceId: 'device-aaaaaaaa',
    nickname: null,
  });
  assert.equal(env.storage._dump()[NICKNAME_STORAGE_KEY], undefined, 'cache cleared');
});

test('mountNicknameField: non-2xx response shows error and does NOT write the cache', async () => {
  const env = fakeNicknameDom();
  const fetcher = fakeFetch({ status: 500, ok: false });
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fetcher.impl,
    getDeviceId: () => 'device-aaaaaaaa',
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  })));
  const input = form.children[0].children[1];
  const status = form.children[2];
  input.value = 'Alice';
  form._fire('submit', { preventDefault: () => {} });
  await flushMicrotasks();

  assert.equal(env.storage._dump()[NICKNAME_STORAGE_KEY], undefined, 'cache untouched on failure');
  assert.equal(status.textContent, 'Could not save');
  assert.equal(status.classList.contains('is-error'), true);
  assert.equal(status.classList.contains('is-saved'), false);
});

test('mountNicknameField: network throw is treated as error (no unhandled rejection)', async () => {
  const env = fakeNicknameDom();
  const fetcher = fakeFetch({ throws: true });
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fetcher.impl,
    getDeviceId: () => 'device-aaaaaaaa',
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  })));
  const input = form.children[0].children[1];
  const status = form.children[2];
  input.value = 'Alice';
  form._fire('submit', { preventDefault: () => {} });
  await flushMicrotasks();

  assert.equal(status.classList.contains('is-error'), true);
});

test('mountNicknameField: button is re-enabled after the round-trip (success and failure)', async () => {
  const env = fakeNicknameDom();
  const fetcher = fakeFetch({ status: 204 });
  const form = /** @type {any} */ (mountNicknameField(/** @type {any} */ ({
    hostname: 'localhost',
    rootEl: env.rootEl,
    doc: env.doc,
    storage: env.storage,
    fetchImpl: fetcher.impl,
    getDeviceId: () => 'device-aaaaaaaa',
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  })));
  const button = form.children[1];
  const input = form.children[0].children[1];
  input.value = 'Alice';
  form._fire('submit', { preventDefault: () => {} });
  await flushMicrotasks();
  assert.equal(button.disabled, false);
});
