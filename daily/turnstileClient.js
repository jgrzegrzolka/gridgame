/**
 * Tiny wrapper around the Cloudflare Turnstile JS SDK. Hides:
 *
 *   - The async load-then-render dance (CF's `?onload=fn` callback +
 *     `turnstile.render()` happen-after-load).
 *   - The execute-then-await-callback shape for invisible mode.
 *
 * Callers get one async function: `getTurnstileToken()`. The first call
 * also triggers the lazy load + render of the widget; subsequent calls
 * reuse the rendered widget.
 *
 * Why no unit tests: the surface is a thin shim around third-party
 * globals (`window.turnstile`, dynamically-loaded `<script>`) and a
 * promise-callback bridge. The fakes needed to exercise it would be
 * larger than the file itself and would mostly test the fake. The
 * contract is verified end-to-end in the browser test for B4.
 *
 * Site key is public — safe in source. Secret stays in SWA env vars.
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTurnstileLoad';

/** @type {string | null} */
let widgetId = null;

/** @type {Promise<void> | null} */
let scriptLoadPromise = null;

/**
 * Resolvers for the one outstanding getTurnstileToken() call. Turnstile
 * callbacks are attached once at render time; we route them here so
 * each getToken() invocation can await its own token.
 *
 * @type {{ resolve: (t: string) => void, reject: (e: Error) => void } | null}
 */
let pending = null;

/**
 * Resolves once the CF SDK has loaded and our invisible widget is
 * rendered. Safe to call repeatedly — the work happens once.
 *
 * @param {{ container: HTMLElement, siteKey: string }} args
 */
export function ensureTurnstile({ container, siteKey }) {
  if (widgetId !== null) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise.then(() => mount(container, siteKey));

  scriptLoadPromise = new Promise((resolve, reject) => {
    // CF requires the callback to be globally reachable before the
    // script loads, hence `?onload=__onTurnstileLoad` matching the
    // global we set here.
    /** @type {any} */ (window).__onTurnstileLoad = () => resolve();
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('turnstile_script_load_failed'));
    document.head.appendChild(s);
  });

  return scriptLoadPromise.then(() => mount(container, siteKey));
}

/**
 * @param {HTMLElement} container
 * @param {string} siteKey
 */
function mount(container, siteKey) {
  if (widgetId !== null) return;
  /** @type {any} */ const ts = /** @type {any} */ (window).turnstile;
  widgetId = ts.render(container, {
    sitekey: siteKey,
    size: 'invisible',
    callback: (/** @type {string} */ token) => {
      const p = pending;
      pending = null;
      if (p) p.resolve(token);
    },
    'error-callback': (/** @type {string | undefined} */ err) => {
      const p = pending;
      pending = null;
      if (p) p.reject(new Error(err || 'turnstile_error'));
    },
    'timeout-callback': () => {
      const p = pending;
      pending = null;
      if (p) p.reject(new Error('turnstile_timeout'));
    },
  });
}

/**
 * @returns {Promise<string>} a fresh Turnstile token. Rejects if the
 *   widget hasn't been ensure()'d yet, or if Cloudflare reports an error.
 *   Only one in-flight call is supported at a time — concurrent callers
 *   would overwrite each other's pending resolver, which never happens
 *   in our flow (token requested at finish, single click).
 */
export function getTurnstileToken() {
  return new Promise((resolve, reject) => {
    if (widgetId === null) {
      reject(new Error('turnstile_not_ready'));
      return;
    }
    /** @type {any} */ const ts = /** @type {any} */ (window).turnstile;

    // If a still-valid token is sitting around, use it — no need to
    // burn another challenge round-trip with Cloudflare. SDK returns
    // an empty string when there isn't one.
    const existing = ts.getResponse(widgetId);
    if (existing) {
      resolve(existing);
      return;
    }

    pending = { resolve, reject };
    ts.reset(widgetId); // clear any expired token
    ts.execute(widgetId);
  });
}
