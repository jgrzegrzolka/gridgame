import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import {
  resolveLang,
  lookupString,
  applyTextContent,
  applyAttributes,
  setStoredLang,
  wireLangToggle,
  t,
  countryName,
  withLocalizedAliases,
  relocalizeAliases,
  autoRelocalize,
  reloadI18n,
  _resetCacheForTests,
  _seedCacheForTests,
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
} from './i18n.js';

// ---- resolveLang ----

test('resolveLang: stored preference wins over browser language', () => {
  assert.equal(resolveLang('pl', 'en-US'), 'pl');
});

test('resolveLang: falls back to browser language when no stored preference', () => {
  assert.equal(resolveLang(null, 'pl-PL'), 'pl');
});

test('resolveLang: handles browser languages without a region tag', () => {
  assert.equal(resolveLang(null, 'pl'), 'pl');
});

test('resolveLang: returns the default when browser language is unsupported', () => {
  assert.equal(resolveLang(null, 'de-DE'), DEFAULT_LANG);
});

test('resolveLang: returns the default when nothing is supplied', () => {
  assert.equal(resolveLang(null, null), DEFAULT_LANG);
  assert.equal(resolveLang(null, undefined), DEFAULT_LANG);
});

test('resolveLang: ignores an invalid stored preference and falls back', () => {
  assert.equal(resolveLang('xx', 'pl-PL'), 'pl');
  assert.equal(resolveLang('xx', null), DEFAULT_LANG);
});

// ---- lookupString ----

test('lookupString: resolves a top-level string key', () => {
  assert.equal(lookupString({ title: 'Hello' }, 'title'), 'Hello');
});

test('lookupString: resolves a nested dotted key', () => {
  assert.equal(lookupString({ tile: { quiz: 'Quiz' } }, 'tile.quiz'), 'Quiz');
});

test('lookupString: returns null for a missing key', () => {
  assert.equal(lookupString({ tile: { quiz: 'Quiz' } }, 'tile.grid'), null);
});

test('lookupString: returns null when a path crosses a non-object', () => {
  assert.equal(lookupString({ title: 'Hello' }, 'title.nested'), null);
});

test('lookupString: a nullish key returns null instead of throwing (bad key must not blank a page)', () => {
  // Regression guard: an undefined label key (e.g. an unresolved mode short
  // label) used to crash `key.split` and take down the whole render.
  assert.equal(lookupString({ title: 'Hello' }, /** @type {any} */ (undefined)), null);
  assert.equal(lookupString({ title: 'Hello' }, /** @type {any} */ (null)), null);
});

test('t: a nullish key falls back to the provided fallback', () => {
  assert.equal(t(/** @type {any} */ (undefined), 'Fallback'), 'Fallback');
});

// ---- applyTextContent ----

function fakeEl(/** @type {Record<string, string>} */ attrs, /** @type {string} */ text = '') {
  const a = { ...attrs };
  return {
    /** @param {string} name */
    getAttribute(name) { return name in a ? a[name] : null; },
    /** @param {string} name @param {string} value */
    setAttribute(name, value) { a[name] = value; },
    textContent: text,
    _attrs: a,
  };
}

test('applyTextContent: replaces text when data-i18n key resolves', () => {
  const el = fakeEl({ 'data-i18n': 'tile.quiz' }, 'Quiz');
  applyTextContent({ tile: { quiz: 'Wiedza' } }, /** @type {any} */ (el));
  assert.equal(el.textContent, 'Wiedza');
});

test('applyTextContent: leaves text untouched when the key is missing', () => {
  const el = fakeEl({ 'data-i18n': 'tile.unknown' }, 'Quiz');
  applyTextContent({ tile: { quiz: 'Wiedza' } }, /** @type {any} */ (el));
  assert.equal(el.textContent, 'Quiz');
});

test('applyTextContent: does nothing on elements without data-i18n', () => {
  const el = fakeEl({}, 'Quiz');
  applyTextContent({ tile: { quiz: 'Wiedza' } }, /** @type {any} */ (el));
  assert.equal(el.textContent, 'Quiz');
});

// ---- applyAttributes ----

test('applyAttributes: replaces a single attribute', () => {
  const el = fakeEl({ 'data-i18n-attr': 'aria-label:back', 'aria-label': 'Home' });
  applyAttributes({ back: 'Strona główna' }, /** @type {any} */ (el));
  assert.equal(el._attrs['aria-label'], 'Strona główna');
});

test('applyAttributes: replaces multiple attributes in one spec', () => {
  const el = fakeEl({
    'data-i18n-attr': 'aria-label:coffee,title:coffee',
    'aria-label': 'Buy me a coffee',
    'title': 'Buy me a coffee',
  });
  applyAttributes({ coffee: 'Postaw mi kawę' }, /** @type {any} */ (el));
  assert.equal(el._attrs['aria-label'], 'Postaw mi kawę');
  assert.equal(el._attrs['title'], 'Postaw mi kawę');
});

test('applyAttributes: tolerates whitespace inside the spec', () => {
  const el = fakeEl({ 'data-i18n-attr': ' aria-label : back ', 'aria-label': 'Home' });
  applyAttributes({ back: 'Strona główna' }, /** @type {any} */ (el));
  assert.equal(el._attrs['aria-label'], 'Strona główna');
});

test('applyAttributes: skips attributes whose key cannot be resolved', () => {
  const el = fakeEl({
    'data-i18n-attr': 'aria-label:unknown,title:coffee',
    'aria-label': 'Buy me a coffee',
    'title': 'Buy me a coffee',
  });
  applyAttributes({ coffee: 'Postaw mi kawę' }, /** @type {any} */ (el));
  assert.equal(el._attrs['aria-label'], 'Buy me a coffee');
  assert.equal(el._attrs['title'], 'Postaw mi kawę');
});

// ---- setStoredLang ----

function fakeStore() {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    /** @param {string} k @param {string} v */
    setItem(k, v) { data.set(k, v); },
    /** @param {string} k */
    getItem(k) { return data.get(k) ?? null; },
    _dump() { return Object.fromEntries(data); },
  };
}

test('setStoredLang: writes a supported language to the store', () => {
  const store = fakeStore();
  setStoredLang('pl', store);
  assert.equal(store._dump()[LANG_STORAGE_KEY], 'pl');
});

test('setStoredLang: is a no-op for unsupported codes', () => {
  const store = fakeStore();
  setStoredLang('xx', store);
  assert.deepEqual(store._dump(), {});
});

// ---- wireLangToggle ----

function fakeToggle() {
  return {
    _attrs: /** @type {Record<string, string>} */ ({}),
    /** @param {string} name @param {string} value */
    setAttribute(name, value) { this._attrs[name] = value; },
    /** @type {Array<(e: any) => void>} */
    _handlers: [],
    /** @param {string} type @param {(e: any) => void} h */
    addEventListener(type, h) {
      if (type === 'click') this._handlers.push(h);
    },
  };
}

test('wireLangToggle: tags current=en (so CSS shows UK flag) and aria-labels the action in English', () => {
  const toggle = fakeToggle();
  wireLangToggle('en', /** @type {any} */ (toggle));
  assert.equal(toggle._attrs['data-current'], 'en');
  assert.equal(toggle._attrs['aria-label'], 'Switch to Polish');
});

test('wireLangToggle: tags current=pl (so CSS shows Polish flag) and aria-labels the action in Polish', () => {
  const toggle = fakeToggle();
  wireLangToggle('pl', /** @type {any} */ (toggle));
  assert.equal(toggle._attrs['data-current'], 'pl');
  assert.equal(toggle._attrs['aria-label'], 'Przełącz na angielski');
});

test('wireLangToggle: is a no-op when no element is found', () => {
  // Just ensures no throw; passing null is the "couldn't find lang-toggle" path.
  wireLangToggle('en', null);
});

// ---- wireLangToggle soft-reload mode ----
//
// In soft mode the click handler delegates to a reload function (injected
// for tests, defaults to reloadI18n in production) instead of calling
// `window.location.reload()`. The toggle also subscribes to the
// `langchanged` event so a successful soft reload flips the data-current
// attribute, keeping the click handler's "next" computation correct.

function fakeSoftDoc() {
  /** @type {Array<(e: any) => void>} */
  const handlers = [];
  return {
    /** @param {string} _type @param {(e: any) => void} h */
    addEventListener(_type, h) { handlers.push(h); },
    /** @param {any} e */
    _fireLangChanged(e) { for (const h of handlers) h(e); },
    _handlerCount() { return handlers.length; },
  };
}

test('wireLangToggle soft mode: registers a langchanged listener on the supplied doc', () => {
  const toggle = fakeToggle();
  const doc = fakeSoftDoc();
  wireLangToggle('en', /** @type {any} */ (toggle), {
    softReload: true,
    doc: /** @type {any} */ (doc),
    reload: async () => {},
  });
  assert.equal(doc._handlerCount(), 1);
});

test('wireLangToggle soft mode: a langchanged event flips data-current and re-renders aria-label', () => {
  const toggle = fakeToggle();
  const doc = fakeSoftDoc();
  wireLangToggle('en', /** @type {any} */ (toggle), {
    softReload: true,
    doc: /** @type {any} */ (doc),
    reload: async () => {},
  });
  assert.equal(toggle._attrs['data-current'], 'en');
  doc._fireLangChanged({ detail: { lang: 'pl' } });
  assert.equal(toggle._attrs['data-current'], 'pl',
    'langchanged listener must update the toggle so the next click flips back to en');
  assert.equal(toggle._attrs['aria-label'], 'Przełącz na angielski');
});

test('wireLangToggle soft mode: a failed reload falls back to a full window.location.reload so the user still gets the language they asked for', async () => {
  // Network drop mid-toggle is the realistic case: the fetch in the
  // injected `reload` rejects. Soft mode catches the rejection and
  // triggers a hard reload as the recovery path; if that path were
  // missing, the click would silently drop the user's language choice.
  const toggle = fakeToggle();
  const doc = fakeSoftDoc();
  let hardReloadCalls = 0;
  const fakeWindow = {
    localStorage: fakeStore(),
    location: { reload: () => { hardReloadCalls++; } },
  };
  const prevWindow = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = fakeWindow;
  try {
    wireLangToggle('en', /** @type {any} */ (toggle), {
      softReload: true,
      doc: /** @type {any} */ (doc),
      reload: () => Promise.reject(new Error('network down')),
    });
    toggle._handlers[0]({ preventDefault() {} });
    // The .catch fires in a microtask after the click handler returns;
    // awaiting any resolved promise lets it run before we assert.
    await Promise.resolve();
    assert.equal(hardReloadCalls, 1,
      'a rejected soft reload must fall back to window.location.reload');
  } finally {
    if (prevWindow === undefined) {
      delete /** @type {any} */ (globalThis).window;
    } else {
      /** @type {any} */ (globalThis).window = prevWindow;
    }
  }
});

test('wireLangToggle soft mode: click invokes the injected reload with the next lang', () => {
  const toggle = fakeToggle();
  const doc = fakeSoftDoc();
  /** @type {string[]} */
  const reloadCalls = [];
  const fakeWindow = { localStorage: fakeStore() };
  const prevWindow = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = fakeWindow;
  try {
    wireLangToggle('en', /** @type {any} */ (toggle), {
      softReload: true,
      doc: /** @type {any} */ (doc),
      reload: async (lang) => { reloadCalls.push(lang); },
    });
    // Simulate the click that the real DOM would dispatch.
    toggle._handlers[0]({ preventDefault() {} });
    assert.deepEqual(reloadCalls, ['pl'],
      'click on an "en" toggle in soft mode reloads with pl');
    assert.equal(fakeWindow.localStorage._dump()[LANG_STORAGE_KEY], 'pl',
      'click still persists the new language so a future hard reload would pick it up');
  } finally {
    if (prevWindow === undefined) {
      delete /** @type {any} */ (globalThis).window;
    } else {
      /** @type {any} */ (globalThis).window = prevWindow;
    }
  }
});

test('wireLangToggle soft mode: click flips data-current synchronously, before the reload promise resolves', () => {
  // The whole point of the optimistic synchronous paint: a click should
  // flip the flag *now*, not after the i18n JSON has been re-fetched.
  // Without this, a slow connection would leave the user staring at the
  // old flag (and aria-label) for the duration of the network round-trip.
  const toggle = fakeToggle();
  const doc = fakeSoftDoc();
  const fakeWindow = { localStorage: fakeStore() };
  const prevWindow = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = fakeWindow;
  try {
    wireLangToggle('en', /** @type {any} */ (toggle), {
      softReload: true,
      doc: /** @type {any} */ (doc),
      // The reload promise stays pending — simulates a slow network. If the
      // toggle waited for it, the post-click assertions below would still
      // see data-current="en". The pending promise is harmless once the
      // test scope ends.
      reload: () => new Promise(() => {}),
    });
    assert.equal(toggle._attrs['data-current'], 'en',
      'pre-click state: flag matches the resolved language');
    toggle._handlers[0]({ preventDefault() {} });
    assert.equal(toggle._attrs['data-current'], 'pl',
      'click must paint the new flag synchronously, without awaiting reload');
    assert.equal(toggle._attrs['aria-label'], 'Przełącz na angielski',
      'click must update aria-label synchronously too — screen readers need the new action label immediately');
    // A second click before reload resolves should flip back to en —
    // `current` must have been updated locally on the first click so the
    // `next` computation isn't stuck on the stale value.
    toggle._handlers[0]({ preventDefault() {} });
    assert.equal(toggle._attrs['data-current'], 'en',
      'second click during in-flight reload must flip back, proving `current` was updated locally on the first click');
  } finally {
    if (prevWindow === undefined) {
      delete /** @type {any} */ (globalThis).window;
    } else {
      /** @type {any} */ (globalThis).window = prevWindow;
    }
  }
});

// ---- reloadI18n ----
//
// Re-fetches the language file, swaps the cache, re-applies markup, and
// dispatches `langchanged` on the doc. Used by soft-reload mode to swap
// languages without losing partial game progress to a full page reload.

function fakeReloadDoc() {
  /** @type {any[]} */
  const events = [];
  return {
    documentElement: {
      /** @type {string | null} */
      _lang: null,
      /** @param {string} name @param {string} value */
      setAttribute(name, value) { if (name === 'lang') this._lang = value; },
    },
    /** @returns {any[]} */
    querySelectorAll() { return []; },
    /** @param {any} e */
    dispatchEvent(e) { events.push(e); return true; },
    _events: events,
  };
}

function fakeFetch(/** @type {Record<string, any>} */ table) {
  /** @param {any} url */
  return async (url) => {
    const path = String(url);
    if (path in table) {
      const body = table[path];
      return /** @type {any} */ ({ ok: true, status: 200, json: async () => body });
    }
    return /** @type {any} */ ({ ok: false, status: 404, json: async () => null });
  };
}

test('reloadI18n: swaps cachedStrings so subsequent t() calls return the new language', async () => {
  _seedCacheForTests({ quiz: { giveUp: 'Give up' } });
  await reloadI18n('pl', {
    base: './',
    doc: /** @type {any} */ (fakeReloadDoc()),
    fetchImpl: fakeFetch({ './i18n/pl.json': { quiz: { giveUp: 'Poddaję się' } } }),
  });
  assert.equal(t('quiz.giveUp', 'Give up'), 'Poddaję się');
  _resetCacheForTests();
});

test('reloadI18n: updates <html lang>', async () => {
  _resetCacheForTests();
  const doc = fakeReloadDoc();
  await reloadI18n('pl', {
    base: './',
    doc: /** @type {any} */ (doc),
    fetchImpl: fakeFetch({ './i18n/pl.json': {} }),
  });
  assert.equal(doc.documentElement._lang, 'pl');
  _resetCacheForTests();
});

test('reloadI18n: dispatches langchanged with { detail: { lang } }', async () => {
  _resetCacheForTests();
  const doc = fakeReloadDoc();
  await reloadI18n('pl', {
    base: './',
    doc: /** @type {any} */ (doc),
    fetchImpl: fakeFetch({ './i18n/pl.json': {} }),
  });
  assert.equal(doc._events.length, 1);
  assert.equal(doc._events[0].type, 'langchanged');
  assert.deepEqual(doc._events[0].detail, { lang: 'pl' });
  _resetCacheForTests();
});

test('reloadI18n: re-localizes autoRelocalize-registered lists before firing langchanged', async () => {
  // Boot English: Mexico has no localized alias yet.
  _resetCacheForTests();
  const list = withLocalizedAliases([{ code: 'mx', name: 'Mexico', aliases: /** @type {string[]} */ ([]) }]);
  assert.deepEqual(list[0].aliases ?? [], []);
  autoRelocalize(list);
  // Capture the aliases at the instant langchanged is dispatched, to prove the
  // re-localize runs BEFORE the event (so page handlers see fresh aliases).
  const doc = fakeReloadDoc();
  let aliasesAtDispatch = null;
  const origDispatch = doc.dispatchEvent.bind(doc);
  doc.dispatchEvent = (e) => { aliasesAtDispatch = [...(list[0].aliases ?? [])]; return origDispatch(e); };
  await reloadI18n('pl', {
    base: './',
    doc: /** @type {any} */ (doc),
    fetchImpl: fakeFetch({ './i18n/pl.json': { country: { mx: 'Meksyk' } } }),
  });
  assert.deepEqual(list[0].aliases, ['Meksyk'], 'registered list re-localized after switch');
  assert.deepEqual(aliasesAtDispatch, ['Meksyk'], 're-localized before langchanged fired');
  _resetCacheForTests();
});

test('reloadI18n: non-ok fetch is a silent no-op — cache stays put, no event fires', async () => {
  _seedCacheForTests({ quiz: { giveUp: 'Give up' } });
  const doc = fakeReloadDoc();
  await reloadI18n('pl', {
    base: './',
    doc: /** @type {any} */ (doc),
    fetchImpl: fakeFetch({}),
  });
  assert.equal(t('quiz.giveUp', 'fallback'), 'Give up',
    'cache untouched after a failed re-fetch');
  assert.equal(doc._events.length, 0, 'no langchanged when nothing changed');
  _resetCacheForTests();
});

test('reloadI18n: respects the base prefix when building the i18n URL', async () => {
  // Pages under nested directories (e.g. daily/) boot with `base: '../'`.
  // The reload path must honour the same base so the second fetch hits
  // the same `i18n/<lang>.json` file the first boot loaded.
  _resetCacheForTests();
  /** @type {string[]} */
  const seen = [];
  await reloadI18n('pl', {
    base: '../',
    doc: /** @type {any} */ (fakeReloadDoc()),
    fetchImpl: /** @type {any} */ (async (/** @type {any} */ url) => {
      seen.push(String(url));
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  });
  assert.deepEqual(seen, ['../i18n/pl.json']);
  _resetCacheForTests();
});

// ---- t() ----

test('t: returns the fallback when no strings have been loaded', () => {
  _resetCacheForTests();
  assert.equal(t('quiz.giveUp', 'Give up'), 'Give up');
});

test('t: returns the translation when the key is in the cache', () => {
  _seedCacheForTests({ quiz: { giveUp: 'Poddaję się' } });
  assert.equal(t('quiz.giveUp', 'Give up'), 'Poddaję się');
  _resetCacheForTests();
});

test('t: falls back when the key is missing from a partially-loaded cache', () => {
  _seedCacheForTests({ quiz: { giveUp: 'Poddaję się' } });
  assert.equal(t('quiz.playAgain', 'Play again'), 'Play again');
  _resetCacheForTests();
});

// ---- countryName + withLocalizedAliases ----

test('countryName: falls back to country.name when no translation is loaded', () => {
  _resetCacheForTests();
  assert.equal(countryName({ code: 'pl', name: 'Poland' }), 'Poland');
});

test('countryName: returns the translation when the code is in the cache', () => {
  _seedCacheForTests({ country: { pl: 'Polska' } });
  assert.equal(countryName({ code: 'pl', name: 'Poland' }), 'Polska');
  _resetCacheForTests();
});

test('withLocalizedAliases: appends the localized name to aliases when different', () => {
  _seedCacheForTests({ country: { pl: 'Polska' } });
  const out = withLocalizedAliases([{ code: 'pl', name: 'Poland' }]);
  assert.deepEqual(out, [{ code: 'pl', name: 'Poland', aliases: ['Polska'] }]);
  _resetCacheForTests();
});

test('withLocalizedAliases: preserves existing aliases', () => {
  _seedCacheForTests({ country: { us: 'Stany Zjednoczone' } });
  const out = withLocalizedAliases([
    { code: 'us', name: 'United States of America', aliases: ['USA'] },
  ]);
  assert.deepEqual(out, [{
    code: 'us',
    name: 'United States of America',
    aliases: ['USA', 'Stany Zjednoczone'],
  }]);
  _resetCacheForTests();
});

test('withLocalizedAliases: passes entries through unchanged when localized name equals English', () => {
  _resetCacheForTests();
  const input = [{ code: 'tg', name: 'Togo' }];
  const out = withLocalizedAliases(input);
  assert.equal(out[0], input[0], 'no allocation when nothing changes');
});

// Regression pin — withLocalizedAliases clones via `{ ...item, aliases: [...] }`,
// which only copies enumerable own properties. The `colors` getter on Country
// (added by createCountry, union of primaryColors + additionalColors) must
// survive that spread; otherwise downstream readers like engine.js's hasColor
// predicate (`c.colors.includes(color)`) hit `undefined.includes` at runtime.
// This blew up the findFlag page once and wasn't caught by any test because
// no test exercised the full createCountry → withLocalizedAliases → predicate
// pipeline. Keep this test alongside any change to `colors`-getter enumerability.
test('withLocalizedAliases: preserves c.colors on cloned Country objects', async () => {
  const { createCountry } = await import('./flags/group.js');
  _seedCacheForTests({ country: { pl: 'Polska' } });
  const pl = createCountry({
    code: 'pl', name: 'Poland', category: 'country', continent: 'Europe',
    primaryColors: ['white', 'red'], additionalColors: [],
  });
  assert.deepEqual(pl.colors, ['white', 'red'], 'sanity: getter works before clone');
  const [cloned] = withLocalizedAliases([pl]);
  assert.deepEqual(cloned.colors, ['white', 'red'],
    'cloned country lost c.colors — was the getter set to enumerable:false?');
  _resetCacheForTests();
});

// ---- relocalizeAliases (soft language switch keeps search in sync) ----

test('relocalizeAliases: adds the localized alias in place after a language switch', () => {
  // Boot in English: no distinct localized name, so the entry passes through
  // unchanged with no alias — this is the state that made "Meksyk" unsearchable
  // after switching to Polish before the fix.
  _resetCacheForTests();
  const list = withLocalizedAliases([{ code: 'mx', name: 'Mexico', aliases: /** @type {string[]} */ ([]) }]);
  assert.deepEqual(list[0].aliases ?? [], []);
  // Switch to Polish and relocalize the same array in place.
  _seedCacheForTests({ country: { mx: 'Meksyk' } });
  relocalizeAliases(list);
  assert.deepEqual(list[0].aliases, ['Meksyk']);
  _resetCacheForTests();
});

test('relocalizeAliases: swaps languages without accumulating stale aliases', () => {
  _seedCacheForTests({ country: { de: 'Niemcy' } });
  const list = withLocalizedAliases([{ code: 'de', name: 'Germany', aliases: ['Deutschland'] }]);
  assert.deepEqual(list[0].aliases, ['Deutschland', 'Niemcy']);
  // Switch to a language whose name equals English → only the base survives.
  _resetCacheForTests();
  relocalizeAliases(list);
  assert.deepEqual(list[0].aliases, ['Deutschland'], 'stale localized alias dropped, base kept');
  // Switch back to Polish → base + Polish, not doubled.
  _seedCacheForTests({ country: { de: 'Niemcy' } });
  relocalizeAliases(list);
  assert.deepEqual(list[0].aliases, ['Deutschland', 'Niemcy']);
  _resetCacheForTests();
});

// ---- JSON file parity ----

/**
 * Flatten a nested strings object into a sorted list of dotted keys, so
 * two language files can be compared structurally regardless of object
 * ordering.
 *
 * @param {Record<string, any>} obj
 * @param {string} [prefix]
 * @returns {string[]}
 */
function flattenKeys(obj, prefix = '') {
  /** @type {string[]} */
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
async function collectSourceFiles(dir, out) {
  const SKIP = new Set(['node_modules', '.git', '.partykit', 'svg', '.claude']);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(full, out);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
}

test('module imports of shared files are bare on BOTH HTML and JS sides (cache-bust stamps the SHA at deploy)', async () => {
  // Why this test exists: shared modules like i18n.js are imported from
  // BOTH HTML inline <script type="module"> blocks AND from sibling
  // .js files. Both sides must produce the SAME URL so the browser
  // dedups to one module instance — otherwise the module's top-level
  // state diverges (e.g. bootI18n populates cachedStrings in one
  // instance, page.js's t() reads the empty other, and every dynamic
  // translation silently falls through to the English fallback).
  //
  // The contract: every relative `import ... from '...js'` in
  // production source — whether inside an HTML inline <script> block
  // or inside a .js file — must be BARE. cache-bust.mjs walks both
  // .html and .js at deploy and appends the same `?v=<sha>` suffix to
  // every relative .js path it finds in a string literal. In dev
  // neither pipeline runs, but bare-on-both-sides still produces
  // matching URLs.
  //
  // History: 3514081 added `?v=__BUILD__` to HTML inline imports to
  // close a prod-time URL mismatch (HTML bare vs cache-bust'd JS),
  // but that broke dev parity — the literal `?v=__BUILD__` token in
  // HTML didn't match the bare JS imports. The fix is to teach
  // cache-bust.mjs to walk HTML inline imports too, so the source on
  // both sides can stay bare.
  //
  // What this test does NOT cover: HTML `<script src>` and
  // `<link href>` placeholders still need `?v=__BUILD__` in source —
  // those flow through the HTML sed because cache-bust.mjs's regex
  // is bound to .js/.json paths and won't touch .css / .svg refs.
  const root = dirname(fileURLToPath(import.meta.url));
  /** @type {string[]} */
  const files = [];
  await collectSourceFiles(root, files);

  const importRe = /from\s+['"]([^'"]*?\.js)(\?v=__BUILD__)?['"]/g;
  /** @type {string[]} */
  const failures = [];
  for (const f of files) {
    const rel = relative(root, f);
    // Server-side files don't run in a browser — PartyKit code is
    // deployed via `partykit deploy`, not GitHub Pages, and neither
    // pipeline touches it. Test files run in Node and import directly
    // via node:fs.
    if (rel.startsWith(`party${sep}`) || rel.startsWith('party/')) continue;
    if (f.endsWith('.test.js')) continue;
    const text = await readFile(f, 'utf-8');
    for (const m of text.matchAll(importRe)) {
      const importPath = m[1];
      // Bare specifiers (node built-ins, node_modules) don't go through
      // either pipeline — skip them.
      if (!importPath.startsWith('.')) continue;
      const hasToken = !!m[2];
      if (hasToken) {
        failures.push(
          `${rel}: import of '${importPath}' carries '?v=__BUILD__'; expected BARE. cache-bust.mjs walks both .html and .js at deploy and stamps the SHA on every relative .js/.json path it finds — keeping source bare on both sides means dev and prod produce matching URLs across the HTML↔JS boundary.`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('i18n: en.json and pl.json have identical key trees', async () => {
  const enText = await readFile(new URL('./i18n/en.json', import.meta.url), 'utf8');
  const plText = await readFile(new URL('./i18n/pl.json', import.meta.url), 'utf8');
  const enKeys = flattenKeys(JSON.parse(enText));
  const plKeys = flattenKeys(JSON.parse(plText));
  const enSet = new Set(enKeys);
  const plSet = new Set(plKeys);
  const missingInPl = enKeys.filter((k) => !plSet.has(k));
  const missingInEn = plKeys.filter((k) => !enSet.has(k));
  // Reporting both directions keeps the failure message useful no matter
  // which side fell behind.
  assert.deepEqual(
    { missingInPl, missingInEn },
    { missingInPl: [], missingInEn: [] },
  );
});

test('i18n: every flag colour in ALL_FLAG_COLORS has a translation in every language', async () => {
  // Catches the next time a new colour enters the data without a matching
  // i18n key — the chooser would otherwise render the raw English token
  // (e.g. "violet") in Polish. The en/pl-symmetry test above doesn't
  // catch this when BOTH languages miss the key (which is how we shipped
  // for a while before noticing).
  const { ALL_FLAG_COLORS } = await import('./flags/engine.js');
  const enJson = JSON.parse(await readFile(new URL('./i18n/en.json', import.meta.url), 'utf8'));
  const plJson = JSON.parse(await readFile(new URL('./i18n/pl.json', import.meta.url), 'utf8'));
  const missing = [];
  for (const color of ALL_FLAG_COLORS) {
    if (!enJson.color || typeof enJson.color[color] !== 'string' || enJson.color[color].length === 0) {
      missing.push(`en.color.${color}`);
    }
    if (!plJson.color || typeof plJson.color[color] !== 'string' || plJson.color[color].length === 0) {
      missing.push(`pl.color.${color}`);
    }
  }
  assert.deepEqual(missing, []);
});

// ---- placeholder consistency ----

/**
 * The `{token}` placeholders in a string, as a sorted unique list.
 * @param {string} s
 * @returns {string[]}
 */
function placeholdersIn(s) {
  return [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

test('i18n placeholders match between en, pl, and each call site fallback', async () => {
  // Why this test exists: a rename moved page.js to `{rounds}` while en.json
  // still said `{blocks}`, so the progress pill rendered the literal text
  // "Round 1/{blocks}" in production. Every unit test stayed green — nothing
  // compared a string's placeholders against the fallback the caller passes,
  // and the two live in different files. A mismatch here is always a bug: the
  // caller substitutes one set of names and the translation expects another,
  // so an unsubstituted `{token}` reaches the screen.
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  const en = JSON.parse(await readFile(join(root, 'i18n', 'en.json'), 'utf8'));
  const pl = JSON.parse(await readFile(join(root, 'i18n', 'pl.json'), 'utf8'));

  /** @param {any} obj @param {string} key */
  const lookup = (obj, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

  /** @type {string[]} */
  const files = [];
  await collectSourceFiles(root, files);

  /** @type {string[]} */
  const problems = [];
  let checked = 0;
  for (const file of files) {
    if (file.endsWith('.test.js')) continue;
    const src = await readFile(file, 'utf8');
    const rel = relative(root, file).split(sep).join('/');
    // t('some.key', 'fallback with {tokens}'). The fallback may be double-quoted
    // when it contains an apostrophe ("{name}'s pick"), so match either quote
    // style — missing those would leave real call sites unchecked.
    for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      const [, key, single, double] = m;
      const fallback = single ?? double ?? '';
      const want = placeholdersIn(fallback);
      for (const [lang, dict] of [['en', en], ['pl', pl]]) {
        const value = lookup(dict, key);
        if (typeof value !== 'string') continue; // missing keys are a separate test's job
        const got = placeholdersIn(value);
        if (want.length > 0) checked++;
        if (got.join(',') !== want.join(',')) {
          problems.push(
            `${rel}: t('${key}') fallback has {${want.join('} {')}} but ${lang}.json has {${got.join('} {')}}`,
          );
        }
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
  // A scanning test that silently matches nothing is worse than no test: it
  // reads as coverage while asserting on an empty set. If a call-site style
  // changes (template literals, a helper wrapping t()), this trips instead of
  // quietly going green.
  assert.ok(checked >= 20, `expected to check 20+ placeholder-carrying t() call sites, saw ${checked}`);
});

test('no party string still uses the retired block vocabulary', async () => {
  // Why this test exists: the block->round/round->question rename swept code and
  // i18n *keys*, but the codemod never covered the JSON *values*. The pick screen
  // shipped reading "Your pick, choose the next block" — invisible to 2900 tests,
  // caught only by looking at a screenshot. A round is five questions; nothing in
  // Flag Party is a block any more.
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  const langs = {
    en: JSON.parse(await readFile(join(root, 'i18n', 'en.json'), 'utf8')),
    pl: JSON.parse(await readFile(join(root, 'i18n', 'pl.json'), 'utf8')),
  };
  /** @type {string[]} */
  const offenders = [];
  for (const [lang, dict] of Object.entries(langs)) {
    /** @param {any} node @param {string} path */
    const walk = (node, path) => {
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      } else if (typeof node === 'string' && /\b(block|blocks|blok|bloku|bloki|blokiem)\b/i.test(node)) {
        offenders.push(`${lang}.${path} = ${JSON.stringify(node)}`);
      }
    };
    walk(dict.party, 'party');
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the reveal badge and the break chip do not share one label', async () => {
  // `party.fastest` is a per-question claim that someone actually came first
  // (gated by `wasFastest`). `party.speedBonus` labels the break chip, which is
  // a round TOTAL of speed points -- 13 there can mean first twice and second
  // once. Reusing `fastest` for both announced "13 Fastest" to screen readers.
  const enJson = JSON.parse(await readFile(new URL('./i18n/en.json', import.meta.url), 'utf8'));
  const plJson = JSON.parse(await readFile(new URL('./i18n/pl.json', import.meta.url), 'utf8'));
  for (const [name, j] of [['en', enJson], ['pl', plJson]]) {
    assert.ok(j.party.fastest, `${name}: party.fastest must exist`);
    assert.ok(j.party.speedBonus, `${name}: party.speedBonus must exist`);
    assert.notEqual(j.party.speedBonus, j.party.fastest,
      `${name}: the chip label must not be the same string as the badge`);
  }
});
