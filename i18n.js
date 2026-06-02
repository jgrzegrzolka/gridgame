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
 * Configure a language-toggle link to display the *other* language's name
 * (in that language) and switch on click. Always shows the destination in
 * its own language so a user who doesn't read the current page can still
 * find the way out.
 *
 * @param {string} currentLang
 * @param {{ textContent: string | null, addEventListener(type: 'click', handler: (e: Event) => void): void } | null} [toggleEl]
 */
export function wireLangToggle(currentLang, toggleEl) {
  const el = toggleEl === undefined ? document.getElementById('lang-toggle') : toggleEl;
  if (!el) return;
  const next = currentLang === 'pl' ? 'en' : 'pl';
  el.textContent = next === 'pl' ? 'Polski' : 'English';
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
 * @param {string} [base] - URL prefix where the `i18n/` directory lives
 * @returns {Promise<string>}
 */
export async function bootI18n(base = './') {
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  const lang = resolveLang(stored, window.navigator.language);
  if (lang === DEFAULT_LANG) {
    return lang;
  }
  const res = await fetch(`${base}i18n/${lang}.json`);
  if (!res.ok) return lang;
  const strings = await res.json();
  applyStringsToDocument(strings, lang);
  return lang;
}
