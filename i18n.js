/**
 * Tiny i18n for the static site. Each page that wants translations marks
 * elements with `data-i18n` (textContent) or `data-i18n-attr` (attributes)
 * and calls bootI18n() once on load.
 *
 * @typedef {Record<string, any>} Strings
 */

import { createCountry } from './flags/group.js';

export const SUPPORTED_LANGS = /** @type {const} */ (['en', 'pl']);
export const DEFAULT_LANG = 'en';
export const LANG_STORAGE_KEY = 'gridgame.lang';

/**
 * The most recently loaded strings, cached so JS that runs after bootI18n
 * resolves can translate dynamically-created content via t(). Empty by
 * default — t() falls back to the supplied fallback (which should always
 * be the English source string), so callers don't need to special-case
 * the not-yet-loaded path.
 *
 * @type {Strings}
 */
let cachedStrings = {};

/**
 * Decide which language to use. Stored preference wins, otherwise fall back
 * to the browser's preferred language if it's one we support, otherwise the
 * default.
 *
 * @param {string | null} stored
 * @param {string | null | undefined} browserLang
 * @returns {string}
 */
export function resolveLang(stored, browserLang) {
  if (stored && /** @type {readonly string[]} */ (SUPPORTED_LANGS).includes(stored)) {
    return stored;
  }
  if (browserLang) {
    const short = browserLang.toLowerCase().split('-')[0];
    if (/** @type {readonly string[]} */ (SUPPORTED_LANGS).includes(short)) {
      return short;
    }
  }
  return DEFAULT_LANG;
}

/**
 * Resolve a dotted key like "tile.quiz" against a nested strings object.
 *
 * @param {Strings} strings
 * @param {string} key
 * @returns {string | null}
 */
export function lookupString(strings, key) {
  // A nullish key (a caller passed an undefined label key) must degrade to the
  // fallback, never throw — one bad key should not blank an entire page. This
  // is what caught the Flag Party lobby: a metric chip with an unresolved short
  // label crashed the whole boot render on `undefined.split`.
  if (key == null) return null;
  const parts = key.split('.');
  /** @type {any} */
  let cur = strings;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * @typedef {{
 *   getAttribute(name: string): string | null,
 *   setAttribute(name: string, value: string): void,
 *   textContent: string | null
 * }} I18nElement
 */

/**
 * Replace textContent with strings[key] for an element marked with data-i18n.
 *
 * @param {Strings} strings
 * @param {I18nElement} el
 */
export function applyTextContent(strings, el) {
  const key = el.getAttribute('data-i18n');
  if (!key) return;
  const value = lookupString(strings, key);
  if (value != null) el.textContent = value;
}

/**
 * Replace one or more attributes for an element marked with
 * data-i18n-attr="attr1:key1,attr2:key2". Useful for aria-label, title, and
 * custom data-* attributes the page reads at runtime.
 *
 * @param {Strings} strings
 * @param {I18nElement} el
 */
export function applyAttributes(strings, el) {
  const spec = el.getAttribute('data-i18n-attr');
  if (!spec) return;
  for (const pair of spec.split(',')) {
    const [attr, key] = pair.split(':').map((s) => s.trim());
    if (!attr || !key) continue;
    const value = lookupString(strings, key);
    if (value != null) el.setAttribute(attr, value);
  }
}

/**
 * Persist a language choice. No-op for unsupported values.
 *
 * @param {string} lang
 * @param {{ setItem(k: string, v: string): void }} [store]
 */
export function setStoredLang(lang, store) {
  if (!/** @type {readonly string[]} */ (SUPPORTED_LANGS).includes(lang)) return;
  const target = store ?? window.localStorage;
  target.setItem(LANG_STORAGE_KEY, lang);
}

/**
 * Configure a language-toggle link to display the *current* language's flag
 * (via the data-current attribute, picked up by CSS) and switch to the other
 * language on click. The aria-label describes the action in the *current*
 * language so a screen-reader user announcing the page in their language
 * hears the action in the same language.
 *
 * Soft-reload mode (`options.softReload = true`) swaps the language in place
 * via `reloadI18n` instead of a full page reload. Pages that opt in must
 * also register `document.addEventListener('langchanged', ...)` listeners
 * for every text surface they paint outside `data-i18n` markup — otherwise
 * those surfaces stay stuck in the old language. Default is the legacy
 * full-reload path so unmigrated pages keep working unchanged.
 *
 * @param {string} currentLang
 * @param {{ setAttribute(name: string, value: string): void, addEventListener(type: 'click', handler: (e: Event) => void): void } | null} [toggleEl]
 * @param {{
 *   softReload?: boolean,
 *   base?: string,
 *   doc?: { addEventListener(type: 'langchanged', handler: (e: any) => void): void },
 *   reload?: (lang: string, options?: { base?: string }) => Promise<unknown>,
 * }} [options]
 */
export function wireLangToggle(currentLang, toggleEl, options = {}) {
  const {
    softReload = false,
    base = './',
    doc = typeof document !== 'undefined' ? document : null,
    reload = reloadI18n,
  } = options;
  const el = toggleEl === undefined ? document.getElementById('lang-toggle') : toggleEl;
  if (!el) return;
  // Track current in a closure so a second click in soft mode flips back
  // to the language we started in. The langchanged listener (registered
  // only in soft mode) keeps this in sync after each successful reload.
  let current = currentLang;
  const renderToggleState = (/** @type {string} */ lang) => {
    el.setAttribute('data-current', lang);
    el.setAttribute('aria-label', lang === 'pl' ? 'Przełącz na angielski' : 'Switch to Polish');
  };
  renderToggleState(current);
  if (softReload && doc) {
    doc.addEventListener('langchanged', (e) => {
      current = e.detail.lang;
      renderToggleState(current);
    });
  }
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const next = current === 'pl' ? 'en' : 'pl';
    setStoredLang(next);
    if (softReload) {
      // Flip the flag + aria-label synchronously so the click feels
      // instant, instead of waiting for the i18n JSON fetch below to
      // resolve and dispatch langchanged. `current` is updated locally
      // for the same reason — a double-click during the in-flight reload
      // would otherwise re-compute `next` from the stale value.
      renderToggleState(next);
      current = next;
      // Fire-and-forget: any listener that needs to wait for the new
      // strings registers on `langchanged`. A failed re-fetch falls
      // back to a hard reload so the user still gets the language
      // they asked for instead of a half-translated page.
      reload(next, { base }).catch(() => window.location.reload());
    } else {
      window.location.reload();
    }
  });
}

/**
 * Apply translations to every [data-i18n] and [data-i18n-attr] element under
 * the given root, then update <html lang>. DOM-facing glue around the pure
 * helpers above.
 *
 * @param {Strings} strings
 * @param {string} lang
 * @param {Document} [doc]
 */
export function applyStringsToDocument(strings, lang, doc) {
  const root = doc ?? document;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    applyTextContent(strings, /** @type {any} */ (el));
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    applyAttributes(strings, /** @type {any} */ (el));
  }
  root.documentElement.setAttribute('lang', lang);
}

/**
 * One-shot boot: resolve language, fetch i18n/<lang>.json, apply to the
 * current document. Returns the language code that was applied so callers
 * can configure language-toggle UI without re-running resolveLang.
 *
 * English (DEFAULT_LANG) is loaded just like any other language. Earlier
 * the function returned early for English on the assumption that HTML
 * `data-i18n` fallbacks were already in English so no fetch was needed —
 * but JS-runtime `t()` callers like `t('motif.star-or-moon', 'star-or-moon')`
 * pass the raw id as a fallback, so an unloaded English table surfaced
 * the dashed id ("Has star-or-moon") instead of the human-readable form
 * ("Has star or moon"). Always loading the language file makes the i18n
 * table the single source of truth in both languages.
 *
 * @param {string} [base] - URL prefix where the `i18n/` directory lives
 * @returns {Promise<string>}
 */
export async function bootI18n(base = './') {
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  const lang = resolveLang(stored, window.navigator.language);
  // The lang-toggle flag is already painted by an inline non-module
  // <script> in every HTML page (right after the `#lang-toggle` element),
  // which runs before this module is even fetched. Pinned by the
  // "every page with #lang-toggle has the sync paint" test in
  // chrome.test.js. No need to re-paint here.
  const res = await fetch(`${base}i18n/${lang}.json`);
  if (!res.ok) return lang;
  const strings = await res.json();
  cachedStrings = strings;
  applyStringsToDocument(strings, lang);
  return lang;
}

/**
 * Look up a translation for a dotted key against the strings most recently
 * loaded by bootI18n. Falls back to the supplied fallback when nothing is
 * loaded yet (or the key isn't translated) — that's the English source
 * string at the call-site, so callers don't need to special-case load
 * order.
 *
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
export function t(key, fallback) {
  return lookupString(cachedStrings, key) ?? fallback;
}

/**
 * Re-fetch the i18n file for `lang`, swap the in-memory cache, re-apply
 * `data-i18n` / `data-i18n-attr` markup over the document, and dispatch a
 * `langchanged` CustomEvent on `doc` so per-page renderers can re-paint
 * the text surfaces they own (strings set via `t()` in JS — status lines,
 * suggestion items, result messages, etc.). The whole point is to avoid
 * the `window.location.reload()` path so partial game progress, focus,
 * scroll position, and in-flight input all survive a language switch.
 *
 * Returns a promise that resolves once the new strings are applied and
 * the event has fired. Rejects only on `fetch` failure — non-ok responses
 * resolve as a no-op (the caller has nothing to do; the existing language
 * stays in place). `fetchImpl` is injectable so tests don't need to mock
 * the global.
 *
 * @param {string} lang
 * @param {{
 *   base?: string,
 *   doc?: Document,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 * @returns {Promise<void>}
 */
export async function reloadI18n(lang, options = {}) {
  const {
    base = './',
    doc = typeof document !== 'undefined' ? /** @type {any} */ (document) : null,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  } = options;
  if (!doc || !fetchImpl) return;
  const res = await fetchImpl(`${base}i18n/${lang}.json`);
  if (!res.ok) return;
  const strings = await res.json();
  cachedStrings = strings;
  applyStringsToDocument(strings, lang, doc);
  doc.dispatchEvent(new CustomEvent('langchanged', { detail: { lang } }));
}

/**
 * Display name for a country in the active language. Falls back to the
 * English name baked into countries.json when no translation is loaded
 * (or a translation for this code is missing).
 *
 * @param {{ code: string, name: string }} c
 * @returns {string}
 */
export function countryName(c) {
  return t(`country.${c.code}`, c.name);
}

// Base (pre-localization) aliases per country object, captured the first time
// we localize it. relocalizeAliases() uses this to swap the localized alias
// for another language in place without piling up stale ones — the search
// index must follow a soft language switch, or you see the localized names but
// can only search them in the boot language (e.g. pick "Meksyk" fails after
// switching to Polish because the aliases were frozen in English at boot).
const baseAliasesByCountry = new WeakMap();

/**
 * Enrich a list of countries with their localized name appended to each
 * one's aliases. Lets `suggest()` in flags/engine.js match Polish input
 * against the Polish name without coupling the engine to i18n — callers
 * just pass `withLocalizedAliases(countries)` instead of the raw list.
 *
 * Entries whose localized name equals the English name pass through
 * unmodified — no point bloating aliases with a duplicate. The generic
 * preserves the input element type, so call-sites that pass `Country[]`
 * get `Country[]` back without an extra cast. The inside is typed with
 * `any` because the spread + override pattern widens past TypeScript's
 * narrowing — the function's behavior is fully covered by i18n.test.js.
 *
 * Records each entry's base aliases so a later `relocalizeAliases()` can
 * rebuild the localized alias for a new language (soft language switch).
 *
 * @template T
 * @param {T[]} countries
 * @returns {T[]}
 */
export function withLocalizedAliases(countries) {
  return countries.map((c) => {
    const item = /** @type {any} */ (c);
    const base = item.aliases ?? [];
    const localized = countryName(item);
    if (localized === item.name) {
      // No distinct localized name to add (e.g. English). Still record the
      // base on the original so a switch to another language can add one.
      baseAliasesByCountry.set(item, base);
      return c;
    }
    const cloned = { ...item, aliases: [...base, localized] };
    // If the input is a full Country (has primaryColors), re-wrap through
    // createCountry so the cloned object gets a fresh non-enumerable `colors`
    // getter. A raw spread would copy `colors` as a static enumerable field,
    // which then leaks into JSON.stringify output. Minimal stubs without
    // primaryColors (used in some i18n tests) pass through as-is — they're
    // not Countries, so there's no getter to re-attach.
    const wrapped = /** @type {any} */ (Array.isArray(item.primaryColors) ? createCountry(cloned) : cloned);
    baseAliasesByCountry.set(wrapped, base);
    return wrapped;
  });
}

/**
 * Rebuild each country's localized alias in place for the *current* language.
 * Call from a `langchanged` handler so the picker's search index follows a
 * soft language switch: without it, the names re-render in the new language
 * but stay searchable only in the boot language. Mutates `aliases` on the
 * existing objects (preserving any metrics already denormalized onto them);
 * the base aliases come from the WeakMap populated by withLocalizedAliases.
 *
 * @param {{ code: string, name: string, aliases?: string[] }[]} countries
 */
export function relocalizeAliases(countries) {
  for (const c of countries) {
    const item = /** @type {any} */ (c);
    let base = baseAliasesByCountry.get(item);
    if (base === undefined) {
      // Not seen by withLocalizedAliases (defensive) — adopt the current
      // aliases as the base so we at least don't accumulate from here on.
      base = item.aliases ?? [];
      baseAliasesByCountry.set(item, base);
    }
    const localized = countryName(item);
    item.aliases = localized === item.name ? [...base] : [...base, localized];
  }
}

/**
 * Reset the in-memory string cache. Tests use this between cases; production
 * code shouldn't need it.
 */
export function _resetCacheForTests() {
  cachedStrings = {};
}

/**
 * Seed the in-memory string cache. Tests use this to exercise t() without
 * calling bootI18n; production code shouldn't need it.
 *
 * @param {Strings} strings
 */
export function _seedCacheForTests(strings) {
  cachedStrings = strings;
}
