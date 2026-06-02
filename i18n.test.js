import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  resolveLang,
  lookupString,
  applyTextContent,
  applyAttributes,
  setStoredLang,
  wireLangToggle,
  t,
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
    textContent: /** @type {string | null} */ (''),
    /** @type {Array<(e: any) => void>} */
    _handlers: [],
    /** @param {string} type @param {(e: any) => void} h */
    addEventListener(type, h) {
      if (type === 'click') this._handlers.push(h);
    },
  };
}

test('wireLangToggle: shows "Polski" and switches to pl when current is en', () => {
  const toggle = fakeToggle();
  wireLangToggle('en', /** @type {any} */ (toggle));
  assert.equal(toggle.textContent, 'Polski');
});

test('wireLangToggle: shows "English" and switches to en when current is pl', () => {
  const toggle = fakeToggle();
  wireLangToggle('pl', /** @type {any} */ (toggle));
  assert.equal(toggle.textContent, 'English');
});

test('wireLangToggle: is a no-op when no element is found', () => {
  // Just ensures no throw; passing null is the "couldn't find lang-toggle" path.
  wireLangToggle('en', null);
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
