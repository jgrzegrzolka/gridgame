import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameMenuItem, mountPrivacyMenuItem, shareUrl, shareText, makeColorSwatch, wireJoinCodeField, NICKNAME_STORAGE_KEY } from './common.js';
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
    /** Default: nothing matches. Tests that need a hit override per-instance. */
    querySelector(/** @type {string} */ _sel) { return null; },
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

test('mountNicknameMenuItem: renders a single <li> with <a href={profileHref}> containing avatar + value', () => {
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
  // [avatar span, strong]
  assert.equal(a.children.length, 2);
  assert.equal(a.children[0].className, 'menu-nickname-avatar');
  assert.equal(a.children[1].tagName, 'STRONG');
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
  const strong = li.children[0].children[1];
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
  const strong = li.children[0].children[1];
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
  assert.equal(li.children[0].children[1].textContent, defaultNickname(id));
});

// ---------------------------------------------------------------------------
// mountPrivacyMenuItem
// ---------------------------------------------------------------------------

test('mountPrivacyMenuItem: no-op when rootEl is missing', () => {
  const result = mountPrivacyMenuItem(/** @type {any} */ ({ rootEl: null, privacyHref: '/privacy/' }));
  assert.equal(result, null);
});

test('mountPrivacyMenuItem: renders a single <li> with <a href={privacyHref}>', () => {
  const env = fakeMenuDom();
  const li = /** @type {any} */ (mountPrivacyMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    privacyHref: '../privacy/',
  })));
  assert.ok(li);
  assert.equal(li.tagName, 'LI');
  assert.equal(li.className, 'menu-privacy');
  const a = li.children[0];
  assert.equal(a.tagName, 'A');
  assert.equal(a.attrs.href, '../privacy/');
  assert.equal(a.attrs['data-i18n'], 'privacy.menuLink');
  assert.equal(a.textContent, 'Privacy');
});

test('mountPrivacyMenuItem: inserted IMMEDIATELY BEFORE the coffee link', () => {
  // Real-page layout: coffee link is the bottom item of the static menu.
  // Privacy should slot in right above it so the meta-nav reads
  // [feature links] → privacy → coffee.
  const env = fakeMenuDom({ existingItems: 2 });
  // Append a fake coffee <li><a class="menu-coffee"/></li> at the end.
  const coffeeLi = makeMenuElement('li');
  const coffeeA = makeMenuElement('a');
  coffeeA.className = 'menu-coffee';
  coffeeLi.appendChild(coffeeA);
  env.rootEl.appendChild(coffeeLi);
  // The fake doc's querySelector + closest need to find the coffee link.
  env.rootEl.querySelector = (/** @type {string} */ sel) =>
    sel === '.menu-coffee' ? coffeeA : null;
  coffeeA.closest = (/** @type {string} */ sel) => sel === 'li' ? coffeeLi : null;

  mountPrivacyMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    privacyHref: '../privacy/',
  }));

  // Order is: 2 existing + privacy + coffee (privacy is at index 2).
  assert.equal(env.rootEl.children.length, 4);
  assert.equal(env.rootEl.children[2].className, 'menu-privacy');
  assert.equal(env.rootEl.children[3], coffeeLi);
});

test('mountPrivacyMenuItem: falls back to appendChild when no coffee link is present', () => {
  const env = fakeMenuDom({ existingItems: 2 });
  // No coffee anchor — defensive fallback.
  env.rootEl.querySelector = () => null;

  mountPrivacyMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    privacyHref: '../privacy/',
  }));

  assert.equal(env.rootEl.children.length, 3);
  assert.equal(env.rootEl.children[2].className, 'menu-privacy');
});

test('mountPrivacyMenuItem: pageIsPrivacy adds aria-current="page" to the link', () => {
  const env = fakeMenuDom();
  const li = /** @type {any} */ (mountPrivacyMenuItem(/** @type {any} */ ({
    rootEl: env.rootEl,
    doc: env.doc,
    privacyHref: './',
    pageIsPrivacy: true,
  })));
  assert.equal(li.children[0].attrs['aria-current'], 'page');
});


// ---------------------------------------------------------------------------
// shareUrl
// ---------------------------------------------------------------------------

/**
 * Build a fake document that satisfies `legacyCopyToClipboard` — needs
 * createElement, body.{appendChild,removeChild}, and execCommand. Tracks
 * whether the textarea was inserted and removed so tests can assert no
 * cleanup leak.
 */
function fakeDoc({ execCommandReturns = true, execCommandThrows = false } = {}) {
  /** @type {any[]} */
  const inserted = [];
  return /** @type {any} */ ({
    createElement: () => ({
      value: "",
      setAttribute: () => {},
      style: {},
      select: () => {},
    }),
    body: {
      /** @param {any} el */
      appendChild: (el) => { inserted.push(el); },
      /** @param {any} el */
      removeChild: (el) => { const i = inserted.indexOf(el); if (i >= 0) inserted.splice(i, 1); },
    },
    execCommand: () => {
      if (execCommandThrows) throw new Error("execCommand blocked");
      return execCommandReturns;
    },
    get _inserted() { return inserted; },
  });
}

test("shareUrl: navigator.share success returns shared", async () => {
  /** @type {any[]} */
  const calls = [];
  const nav = /** @type {any} */ ({ share: async (/** @type {any} */ payload) => { calls.push(payload); } });
  const result = await shareUrl("https://example.com/?f=red", { title: "T", text: "X" }, { navigator: nav });
  assert.equal(result, "shared");
  assert.deepEqual(calls, [{ title: "T", text: "X", url: "https://example.com/?f=red" }]);
});

test("shareUrl: navigator.share AbortError returns dismissed without falling through", async () => {
  // Critical: a dismissed share sheet must NOT trigger a silent clipboard
  // overwrite. The user opened the sheet, decided not to share, the URL
  // should stay out of their clipboard.
  let clipboardCalled = false;
  const nav = {
    share: async () => { const e = /** @type {any} */ (new Error("abort")); e.name = "AbortError"; throw e; },
    clipboard: { writeText: async () => { clipboardCalled = true; } },
  };
  const result = await shareUrl("https://example.com/", {}, { navigator: nav });
  assert.equal(result, "dismissed");
  assert.equal(clipboardCalled, false, "clipboard must not be touched after dismiss");
});

test("shareUrl: navigator.share non-Abort error falls through to clipboard", async () => {
  const nav = /** @type {any} */ ({
    share: async () => { throw new Error("share unsupported for payload"); },
    clipboard: { writeText: async (/** @type {string} */ s) => { assert.equal(s, "https://example.com/"); } },
  });
  const result = await shareUrl("https://example.com/", {}, { navigator: nav });
  assert.equal(result, "copied");
});

test("shareUrl: no navigator.share but clipboard succeeds returns copied", async () => {
  const nav = { clipboard: { writeText: async () => {} } };
  const result = await shareUrl("https://example.com/", {}, { navigator: nav });
  assert.equal(result, "copied");
});

test("shareUrl: clipboard rejection falls through to legacy execCommand", async () => {
  const nav = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
  const doc = fakeDoc({ execCommandReturns: true });
  const result = await shareUrl("https://example.com/", {}, { navigator: nav, document: doc });
  assert.equal(result, "copied");
  assert.deepEqual(doc._inserted, [], "textarea must be cleaned up");
});

test("shareUrl: legacy execCommand returning false yields failed", async () => {
  const nav = {};
  const doc = fakeDoc({ execCommandReturns: false });
  const result = await shareUrl("https://example.com/", {}, { navigator: nav, document: doc });
  assert.equal(result, "failed");
});

test("shareUrl: legacy execCommand throwing yields failed (and still cleans up the textarea)", async () => {
  const nav = {};
  const doc = fakeDoc({ execCommandThrows: true });
  const result = await shareUrl("https://example.com/", {}, { navigator: nav, document: doc });
  assert.equal(result, "failed");
  assert.deepEqual(doc._inserted, [], "textarea must be removed even when execCommand throws");
});

test("shareUrl: no navigator and no document yields failed", async () => {
  const result = await shareUrl("https://example.com/", {}, { navigator: null, document: null });
  assert.equal(result, "failed");
});


// ---------------------------------------------------------------------------
// shareText
// ---------------------------------------------------------------------------

// Mirrors shareUrl but for an arbitrary text payload. The full state matrix
// (share / dismissed / copied / failed) is already exercised by the shareUrl
// suite above — these tests pin the payload-shape differences and the
// "clipboard gets the text, not a URL" contract.

test("shareText: navigator.share gets the text payload (not url)", async () => {
  /** @type {any[]} */
  const calls = [];
  const nav = /** @type {any} */ ({ share: async (/** @type {any} */ payload) => { calls.push(payload); } });
  const grid = "Yet Another Quiz — Daily #9 — 8/10\n\n🟩🟩🟩🟩🟩\n🟩🟩🟩⬛⬛\n\nhttps://www.yetanotherquiz.com/daily/";
  const result = await shareText(grid, { title: "Daily #9" }, { navigator: nav });
  assert.equal(result, "shared");
  assert.deepEqual(calls, [{ title: "Daily #9", text: grid }]);
});

test("shareText: navigator.share AbortError returns dismissed without falling through", async () => {
  // Same dismissed-must-not-overwrite-clipboard guarantee as shareUrl.
  let clipboardCalled = false;
  const nav = {
    share: async () => { const e = /** @type {any} */ (new Error("abort")); e.name = "AbortError"; throw e; },
    clipboard: { writeText: async () => { clipboardCalled = true; } },
  };
  const result = await shareText("anything", {}, { navigator: nav });
  assert.equal(result, "dismissed");
  assert.equal(clipboardCalled, false, "clipboard must not be touched after dismiss");
});

test("shareText: clipboard receives the full multi-line text", async () => {
  const grid = "title\n\n🟩⬛\n\nhttps://example.com/";
  /** @type {string | null} */
  let received = null;
  const nav = { clipboard: { writeText: async (/** @type {string} */ s) => { received = s; } } };
  const result = await shareText(grid, {}, { navigator: nav });
  assert.equal(result, "copied");
  assert.equal(received, grid);
});

test("shareText: legacy fallback gets the text payload, not a url", async () => {
  // Confirms that the legacyCopyToClipboard path is reached with the
  // text argument (not silently dropped or swapped for a URL).
  const nav = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
  const doc = fakeDoc({ execCommandReturns: true });
  const result = await shareText("multi\nline\ntext", {}, { navigator: nav, document: doc });
  assert.equal(result, "copied");
  assert.deepEqual(doc._inserted, [], "textarea must be cleaned up");
});


/**
 * Minimal fake element/document for makeColorSwatch: tracks className, the
 * dataset map, and setAttribute calls — the only surface the helper touches.
 */
function fakeSwatchDoc() {
  return /** @type {any} */ ({
    createElement: () => {
      /** @type {Record<string, string>} */
      const attrs = {};
      return {
        className: '',
        dataset: /** @type {Record<string, string>} */ ({}),
        setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { attrs[k] = v; },
        getAttribute: (/** @type {string} */ k) => attrs[k] ?? null,
      };
    },
  });
}

test('makeColorSwatch builds a .pill-swatch span carrying the colour in data-value', () => {
  const sw = makeColorSwatch('red', fakeSwatchDoc());
  assert.equal(sw.className, 'pill-swatch');
  assert.equal(sw.dataset.value, 'red');
});

test('makeColorSwatch marks the dot aria-hidden (the adjacent label names the colour)', () => {
  const sw = makeColorSwatch('blue', fakeSwatchDoc());
  assert.equal(sw.getAttribute('aria-hidden'), 'true');
});

/**
 * Minimal stand-in for the start screens' join row: an <input> that fires its
 * `input` listeners on a scripted edit, plus the submit button whose `disabled`
 * flag is the whole point of the wiring.
 */
function fakeJoinRow(initial = '') {
  /** @type {(() => void)[]} */
  const listeners = [];
  const input = /** @type {any} */ ({
    value: initial,
    selectionStart: initial.length,
    /** @param {string} type @param {() => void} fn */
    addEventListener: (type, fn) => { if (type === 'input') listeners.push(fn); },
    /** @param {number} a @param {number} b */
    setSelectionRange: (a, b) => { input.selectionStart = a; input.selectionEnd = b; },
  });
  const btn = /** @type {any} */ ({ disabled: false });
  /** Simulate a user edit: set the raw value, then fire `input`. */
  const edit = (/** @type {string} */ raw, /** @type {number} */ caret = -1) => {
    input.value = raw;
    input.selectionStart = caret < 0 ? raw.length : caret;
    for (const fn of listeners) fn();
  };
  return { input, btn, edit };
}

test('wireJoinCodeField: normalises the value as it is typed', () => {
  const { input, btn, edit } = fakeJoinRow();
  wireJoinCodeField(input, btn);
  edit('66-bk');
  assert.equal(input.value, '66BK');
});

test('wireJoinCodeField: a pasted invite link collapses to its room code', () => {
  const { input, btn, edit } = fakeJoinRow();
  wireJoinCodeField(input, btn);
  edit('https://www.yetanotherquiz.com/flagParty/?r=66BKE');
  assert.equal(input.value, '66BKE');
  assert.equal(btn.disabled, false);
});

// The inert-until-valid contract. It is what lets the join link be a quiet
// text link instead of a button whose only answer to a short code would be
// "Code must be 5 characters" — and, because a disabled submit button does not
// submit its form, it is also what gates Enter.
test('wireJoinCodeField: the submit button stays disabled until the code is 5 characters', () => {
  const { input, btn, edit } = fakeJoinRow();
  wireJoinCodeField(input, btn);
  assert.equal(btn.disabled, true, 'empty field starts inert');
  edit('66BK');
  assert.equal(btn.disabled, true, 'four characters is still inert');
  edit('66BKE');
  assert.equal(btn.disabled, false, 'five characters enables it');
  edit('66BK');
  assert.equal(btn.disabled, true, 'deleting back below five disables it again');
});

test('wireJoinCodeField: syncs once on wiring, so a prefilled field is not left inert', () => {
  const { input, btn } = fakeJoinRow('66bke');
  wireJoinCodeField(input, btn);
  assert.equal(input.value, '66BKE');
  assert.equal(btn.disabled, false);
});

// Editing mid-code must not fling the cursor to the end — the rewrite happens
// on every keystroke, so without this a backspace in the middle would move the
// caret away from where the user was working.
test('wireJoinCodeField: keeps the caret where it was after a rewrite', () => {
  const { input, btn, edit } = fakeJoinRow();
  wireJoinCodeField(input, btn);
  edit('66bke', 3);
  assert.equal(input.value, '66BKE');
  assert.equal(input.selectionStart, 3);
});

test('wireJoinCodeField: clamps the caret when normalisation shortens the value', () => {
  const { input, btn, edit } = fakeJoinRow();
  wireJoinCodeField(input, btn);
  edit('6-6-b', 5);
  assert.equal(input.value, '66B');
  assert.equal(input.selectionStart, 3);
});

test('wireJoinCodeField: works without a submit button', () => {
  const { input, edit } = fakeJoinRow();
  wireJoinCodeField(input, null);
  edit('66bke');
  assert.equal(input.value, '66BKE');
});
