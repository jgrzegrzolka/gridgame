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

test('module imports of shared files use the URL form their cache-bust pipeline expects', async () => {
  // Why this test exists: shared modules like i18n.js are imported from
  // BOTH HTML inline <script type="module"> blocks AND from sibling
  // .js files. Both pipelines must produce the SAME deploy-time URL
  // (`<path>?v=<sha>`) so the browser dedups to one module instance —
  // otherwise the module's top-level state diverges (e.g. bootI18n
  // populates cachedStrings in one instance, page.js's t() reads the
  // empty other, and every dynamic translation silently falls through
  // to the English fallback).
  //
  // The two pipelines bust differently and require OPPOSITE source forms:
  //   - HTML inline imports: must carry `?v=__BUILD__` literally — the
  //     HTML __BUILD__ sed in deploy.yml is the only thing that touches
  //     HTML, and bare imports here would ship as `<path>` (no version).
  //   - JS file imports: must be BARE — cache-bust.mjs's regex appends
  //     `?v=<sha>` only to paths with no existing `?`. A literal
  //     `?v=__BUILD__` in a JS source would survive deploy unchanged
  //     (cache-bust skips it; HTML sed doesn't process .js), so the
  //     deployed URL would carry the placeholder string itself.
  //
  // This test was originally pinned to "either all bare OR all
  // ?v=__BUILD__" — a textual symmetry that missed the asymmetric
  // pipeline reality and silently passed when every site was bare,
  // even though cache-bust.mjs was about to introduce the split at
  // deploy. The new contract pins the right invariant: each call site
  // uses the form its own pipeline expects.
  const root = dirname(fileURLToPath(import.meta.url));
  /** @type {string[]} */
  const files = [];
  await collectSourceFiles(root, files);

  const importRe = /from\s+['"]([^'"]*?\.js)(\?v=__BUILD__)?['"]/g;
  /** @type {string[]} */
  const failures = [];
  for (const f of files) {
    const rel = relative(root, f);
    // Server-side files don't run in a browser, so neither pipeline
    // applies — PartyKit code is deployed via `partykit deploy`, not
    // GitHub Pages. Test files run in Node and import directly via
    // node:fs, no cache-bust at all.
    if (rel.startsWith(`party${sep}`) || rel.startsWith('party/')) continue;
    if (f.endsWith('.test.js')) continue;
    const text = await readFile(f, 'utf-8');
    for (const m of text.matchAll(importRe)) {
      const importPath = m[1];
      // Bare specifiers (node built-ins, node_modules) don't go through
      // either pipeline — skip them.
      if (!importPath.startsWith('.')) continue;
      const hasToken = !!m[2];
      if (f.endsWith('.html') && !hasToken) {
        failures.push(
          `${rel}: HTML inline import of '${importPath}' is bare; expected '${importPath}?v=__BUILD__' so the HTML sed busts it to match cache-bust.mjs's rewrite of the same module on the JS side`,
        );
      } else if (f.endsWith('.js') && hasToken) {
        failures.push(
          `${rel}: JS import of '${importPath}' carries '?v=__BUILD__'; expected bare. The HTML sed doesn't process .js files, so this placeholder would ship as a literal string. cache-bust.mjs handles JS imports.`,
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
