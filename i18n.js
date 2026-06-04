/**
 * Tiny i18n for the static site. Each page that wants translations marks
 * elements with `data-i18n` (textContent) or `data-i18n-attr` (attributes)
 * and calls bootI18n() once on load.
 *
 * @typedef {Record<string, any>} Strings
 */

export const SUPPORTED_LANGS = /** @type {const} */ (['en', 'pl']);
export const DEFAULT_LANG = 'en';
export const LANG_STORAGE_KEY = 'gridgame.lang';

export const I18N_ENABLED = true;

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
 * @param {string} currentLang
 * @param {{ setAttribute(name: string, value: string): void, addEventListener(type: 'click', handler: (e: Event) => void): void } | null} [toggleEl]
 */
export function wireLangToggle(currentLang, toggleEl) {
  const el = toggleEl === undefined ? document.getElementById('lang-toggle') : toggleEl;
  if (!el) return;
  const next = currentLang === 'pl' ? 'en' : 'pl';
  el.setAttribute('data-current', currentLang);
  el.setAttribute('aria-label', currentLang === 'pl' ? 'Przełącz na angielski' : 'Switch to Polish');
  el.addEventListener('click', (e) => {
    e.preventDefault();
    setStoredLang(next);
    window.location.reload();
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
  if (!I18N_ENABLED) return DEFAULT_LANG;
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  const lang = resolveLang(stored, window.navigator.language);
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

/**
 * Enrich a list of countries with their localized name appended to each
 * one's aliases. Lets `suggest()` in flags/grid.js match Polish input
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
 * @template T
 * @param {T[]} countries
 * @returns {T[]}
 */
export function withLocalizedAliases(countries) {
  return countries.map((c) => {
    const item = /** @type {any} */ (c);
    const localized = countryName(item);
    if (localized === item.name) return c;
    return /** @type {any} */ ({ ...item, aliases: [...(item.aliases ?? []), localized] });
  });
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
