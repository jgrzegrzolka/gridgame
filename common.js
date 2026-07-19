import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from './flags/identity.js';
import { displayNickname } from './flags/nickname.js';
import { avatarSvg } from './flags/avatar.js';
import { initAppInsights } from './analytics/index.js';
import { bumpCoffeeClick, pushEngagementBlob } from './flags/engagementCounters.js';
import { migrateEngagement } from './flags/engagementMigration.js';
import { ensureProfile } from './flags/autoProfile.js';
import { primeAchievementsBaseline, refreshAchievementsAndDiff } from './flags/achievementsBaseline.js';
import { celebrate } from './flags/achievementCelebrate.js';

/**
 * Site wordmark in the top-left, pairing with the chrome cluster
 * on the top-right. Auto-mounts as a side effect of importing this
 * module — every page already imports common.js for the burger /
 * nickname helpers, so no per-page wiring is needed. The logo always
 * links to the site root via absolute `/`, with `aria-current="page"`
 * applied when the user is already on the home page (same vocabulary
 * the burger menu uses for the profile link).
 */
function mountSiteLogo() {
  if (document.querySelector('.site-logo')) return;
  const a = document.createElement('a');
  a.className = 'site-logo';
  a.href = '/';
  a.setAttribute('aria-label', 'Yet Another Quiz home');
  const isHome = window.location.pathname === '/'
    || window.location.pathname === '/index.html';
  if (isHome) a.setAttribute('aria-current', 'page');
  const img = document.createElement('img');
  img.src = '/logo.svg';
  img.alt = 'Yet Another Quiz';
  a.appendChild(img);
  document.body.insertBefore(a, document.body.firstChild);
}

/**
 * Wrap each `.actions-row` / `.result-links` element's children in a
 * single `<span class="row-inner">`. The sticky bottom row's bg still
 * needs to bleed to the viewport edges (so scrolling content doesn't
 * peek through), but the visible hairline above it should match the
 * row's content width — pure CSS can't measure rendered text width, so
 * we wrap once at DOMContentLoaded and put `border-top` on the wrapper.
 * Idempotent (skips rows already wrapped on a re-run).
 */
function wrapBottomRowsForInsetHairline() {
  document.querySelectorAll('.actions-row, .result-links').forEach((row) => {
    if (row.firstElementChild && row.firstElementChild.classList.contains('row-inner')
        && row.children.length === 1) return;
    const inner = document.createElement('span');
    inner.className = 'row-inner';
    while (row.firstChild) inner.appendChild(row.firstChild);
    row.appendChild(inner);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState !== 'loading') {
    mountSiteLogo();
    wrapBottomRowsForInsetHairline();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      mountSiteLogo();
      wrapBottomRowsForInsetHairline();
    }, { once: true });
  }
  // Feature Q — frontend telemetry. Auto-init alongside the site
  // logo since every player-facing page already imports common.js
  // for the burger / nickname helpers, so no per-page wiring needed.
  // No-op on localhost (skips the dev-pollution path the same way
  // requestHost.js tags Cosmos rows `local: true` on the api side).
  initAppInsights();
}

/**
 * Build a profile-identicon avatar span for the online screens (start line,
 * lobby roster, reveal picks, final board). The identicon is the deterministic
 * `avatarSvg(deviceId)` tile the burger nickname menu also shows, so a player
 * reads as the same avatar everywhere. Visual recipe lives on `.avatar` in
 * common.css.
 *
 * @param {string} deviceId  stable id that drives the identicon
 * @param {Document} [doc]
 * @returns {HTMLSpanElement}
 */
export function buildAvatar(deviceId, doc = document) {
  const a = doc.createElement('span');
  a.className = 'avatar';
  a.innerHTML = avatarSvg(deviceId);
  return a;
}

/**
 * Build the flag-colour swatch dot that precedes a colour pill / chip label.
 * Shared by flagsdata's filter bar and findFlag's chooser so the markup can't
 * drift. The visual recipe (size, ring) and the per-value fill hues live on
 * `.pill-swatch` in common.css — those hues are the one documented exception to
 * the seven-colour palette (a swatch shows a literal flag colour, like the flag
 * SVGs themselves). `aria-hidden` because the adjacent label already names the
 * colour, so the dot is decorative to assistive tech.
 *
 * @param {string} value  one of ALL_FLAG_COLORS (drives the CSS hue via data-value)
 * @param {Document} [doc]
 * @returns {HTMLSpanElement}
 */
export function makeColorSwatch(value, doc = document) {
  const sw = doc.createElement('span');
  sw.className = 'pill-swatch';
  sw.dataset.value = value;
  sw.setAttribute('aria-hidden', 'true');
  return sw;
}

/**
 * @typedef {'shared' | 'copied' | 'dismissed' | 'failed'} ShareResult
 */

/**
 * Share `url` via the best available platform mechanism. Tries the
 * native share sheet first (`navigator.share` — picks Messages /
 * WhatsApp / etc. on mobile), then the Async Clipboard API, then a
 * legacy `execCommand('copy')` via a hidden textarea for non-secure
 * contexts (LAN-IP dev). Returns a discriminated status so the caller
 * can decide what feedback (if any) to show:
 *
 *   - 'shared'    — system share sheet completed. No caller feedback
 *                   needed; the sheet itself was the affordance.
 *   - 'copied'    — URL landed in the clipboard. Caller should flash
 *                   a "Copied" indicator since there was no visible
 *                   confirmation otherwise.
 *   - 'dismissed' — user opened and dismissed the share sheet. Caller
 *                   should do nothing — falling through to clipboard
 *                   would silently overwrite their clipboard.
 *   - 'failed'    — all three mechanisms refused or threw. Caller may
 *                   choose to surface an error message.
 *
 * Deps are injectable so tests don't need to monkey-patch globals; in
 * prod they default to `globalThis.navigator` and `globalThis.document`.
 *
 * @param {string} url
 * @param {{ title?: string, text?: string }} [meta]
 * @param {{ navigator?: any, document?: any }} [deps]
 * @returns {Promise<ShareResult>}
 */
export async function shareUrl(url, meta = {}, deps = {}) {
  const nav = deps.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null);

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ ...meta, url });
      return 'shared';
    } catch (err) {
      // User dismissed the share sheet — don't silently fall through
      // and overwrite their clipboard. Anything else (share unsupported
      // for this payload, permissions error) falls through to clipboard
      // as a best-effort recovery.
      const name = err && /** @type {{ name?: string }} */ (err).name;
      if (name === 'AbortError') return 'dismissed';
    }
  }
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      // Permission denied or focus lost mid-call — try the legacy path.
    }
  }
  if (doc && legacyCopyToClipboard(url, doc)) return 'copied';
  return 'failed';
}

/**
 * Share an arbitrary multi-line text payload via the same three-tier
 * fallback as shareUrl(): navigator.share (mobile share sheet), then
 * navigator.clipboard.writeText, then the legacy textarea path.
 * Returns the same ShareResult shape so callers can route the UI
 * feedback identically (e.g. flash a "copied" indicator on 'copied').
 *
 * Use this when the payload is a multi-line block — a Wordle-style
 * share grid, etc. For a bare URL prefer shareUrl(): it puts the URL
 * on the share-sheet's `url` slot, which on iOS produces a richer
 * preview card than text-only.
 *
 * Callers that don't want the share-sheet on desktop should gate the
 * button itself (e.g. `matchMedia('(pointer: coarse)')`), not this
 * function — see daily/page.js createShareButton and the findFlag /
 * TTT touch-only reveals. The function intentionally stays
 * platform-agnostic so it works in any context where it's actually
 * called.
 *
 * @param {string} text
 * @param {{ title?: string }} [meta]
 * @param {{ navigator?: any, document?: any }} [deps]
 * @returns {Promise<ShareResult>}
 */
export async function shareText(text, meta = {}, deps = {}) {
  const nav = deps.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null);

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ ...meta, text });
      return 'shared';
    } catch (err) {
      const name = err && /** @type {{ name?: string }} */ (err).name;
      if (name === 'AbortError') return 'dismissed';
    }
  }
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch {
      // Permission denied or focus lost — fall through to legacy path.
    }
  }
  if (doc && legacyCopyToClipboard(text, doc)) return 'copied';
  return 'failed';
}

/**
 * Last-resort copy via a hidden, off-screen textarea and the legacy
 * `document.execCommand('copy')` path. Async Clipboard API needs a
 * secure context (HTTPS or localhost); on a bare LAN-IP URL — common
 * when testing from a phone against the dev server — it's undefined,
 * so we keep this around.
 *
 * @param {string} text
 * @param {any} doc
 * @returns {boolean}
 */
function legacyCopyToClipboard(text, doc) {
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  doc.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  doc.body.removeChild(ta);
  return ok;
}

/** Display nickname cache key. Written when the user successfully saves a
 *  new value on the /profile/ page. Cleared (`removeItem`) when the user
 *  resets or clears their nickname — the matching server-side state is
 *  `nickname: null`, which means "fall back to the deterministic default
 *  from `flags/nickname.js`". */
export const NICKNAME_STORAGE_KEY = 'gridgame.nickname';
// Re-export so existing consumers that import IDENTITY_STORAGE_KEY
// from common.js keep working. The source of truth lives in
// flags/identity.js alongside STORAGE_KEY (deviceId).
export { IDENTITY_STORAGE_KEY };

/**
 * Disable the burger menu button when its menu has no items. Empty-menu pages
 * still render the burger for visual consistency with every other page, but
 * with no destinations to offer the button should be inert.
 *
 * Sets BOTH the native disabled property (so keyboard/Enter activation is
 * blocked at the DOM level) AND the aria-disabled attribute (which is what
 * common.css keys off for the greyed-out visual + pointer-events:none). The
 * two have to be set together: setting only `disabled` blocks the click but
 * leaves the button visually active, which reads as a broken interaction
 * rather than an inert affordance.
 *
 * @param {HTMLButtonElement} burgerEl
 * @param {HTMLElement} menuEl
 */
export function disableBurgerIfEmpty(burgerEl, menuEl) {
  if (menuEl.children.length === 0) {
    burgerEl.disabled = true;
    burgerEl.setAttribute('aria-disabled', 'true');
  }
}

/**
 * Add the missing dismissal paths to the burger menu:
 *   - A click anywhere outside both the burger button and its panel closes
 *     the panel. Before this, the only way to close was a second click on
 *     the burger itself, which is the only thing every other modern menu
 *     UX does NOT expect.
 *   - Pressing Escape closes the panel and returns focus to the burger so
 *     a keyboard user lands somewhere predictable.
 *
 * The burger button's open/close *toggle* still lives in the inline onclick
 * on every page — this helper only adds the dismiss-from-elsewhere paths
 * that the inline onclick can't observe. Safe to call on pages without a
 * burger: the function exits early if the elements are missing.
 *
 * @param {{ doc?: Document }} [options]
 */
export function wireBurgerDismiss(options = {}) {
  const doc = options.doc ?? document;
  const burger = doc.querySelector('.burger');
  const panel = /** @type {HTMLElement | null} */ (doc.querySelector('#burger-panel'));
  if (!burger || !panel) return;
  doc.addEventListener('click', (e) => {
    if (panel.hidden) return;
    const t = /** @type {Node | null} */ (e.target);
    if (!t) return;
    if (burger.contains(t) || panel.contains(t)) return;
    closeBurger(burger, panel);
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    closeBurger(burger, panel);
    /** @type {HTMLElement} */ (burger).focus?.();
  });
  // Coffee-click telemetry: every page's burger has a `.menu-coffee`
  // link; delegating from document is cheaper than wiring 18 inline
  // onclicks. Trust-based — no payment verification, just intent.
  // Drives the "Angel Investor" achievement, with the cascade card
  // dropping immediately after the event POST settles.
  doc.addEventListener('click', (e) => {
    const t = /** @type {Element | null} */ (e.target);
    if (!t || !('closest' in t)) return;
    const link = t.closest('.menu-coffee');
    if (!link) return;
    try {
      const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
      void ensureProfile(deviceId);
      // Local-only counter bump (Feature S Phase 3 replaced the
      // server-side engagementEvents write). Mirror to syncBlob
      // fire-and-forget so other devices on this deviceId see the
      // new count on their next pull. The achievement diff still
      // runs against the server snapshot during the Phase 3 → Phase 4
      // window — coffee_click effectively freezes in the snapshot
      // until Phase 4 ships and the diff switches to localStorage.
      bumpCoffeeClick(window.localStorage);
      void pushEngagementBlob(deviceId, window.localStorage);
      void refreshAchievementsAndDiff(deviceId).then((newly) => {
        if (newly.length > 0) void celebrate(newly);
      });
    } catch {
      // No deviceId on a doc without window/localStorage — skip silently.
    }
  });

  // Prime the achievement baseline so post-action diffs anywhere on
  // this page (coffee click, share button, etc.) have a real
  // pre-action snapshot to compare against. Cached path (no bypass);
  // boot doesn't need the freshest read.
  //
  // Also kick the one-time engagement migration (Feature S Phase 3).
  // Sentinel-guarded — first boot post-deploy runs the pull-first
  // migration; every subsequent boot short-circuits to a single
  // localStorage read. Fire-and-forget; never throws.
  try {
    const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
    primeAchievementsBaseline(deviceId);
    void migrateEngagement({ deviceId, store: window.localStorage });
  } catch {
    // window/localStorage missing in the test runner — skip silently.
  }
}

/**
 * @param {Element} burgerEl
 * @param {HTMLElement} panelEl
 */
function closeBurger(burgerEl, panelEl) {
  burgerEl.setAttribute('aria-expanded', 'false');
  const openLabel = /** @type {HTMLElement} */ (burgerEl).dataset?.labelOpen;
  if (openLabel) burgerEl.setAttribute('aria-label', openLabel);
  panelEl.hidden = true;
}

/**
 * Mount the "Your name: <display-name>" link into the burger panel's `<ul>`.
 * The link points at `/profile/` so the user can change their nickname on
 * a dedicated page; this helper only renders the menu surface.
 *
 * The displayed name resolves via `flags/nickname.js::displayNickname`:
 * the cached `gridgame.nickname` wins if present; otherwise a deterministic
 * two-word default is derived from the deviceId. Same deviceId → same
 * default for every viewer, with no server fetch required.
 *
 * Inserted as the FIRST child of the menu so the "this is you" affordance
 * is the most prominent item. `aria-current="page"` is set automatically
 * when the page hosting the menu is `/profile/` itself.
 *
 * Anything DOM-side (storage, deviceId, doc, location) is injectable so
 * tests don't need a real browser.
 *
 * @param {{
 *   rootEl: HTMLElement | null,
 *   profileHref: string,
 *   doc?: Document,
 *   storage?: Pick<Storage, 'getItem'>,
 *   getDeviceId?: () => string,
 *   pageIsProfile?: boolean,
 * }} opts
 */
export function mountNicknameMenuItem(opts) {
  if (!opts || !opts.rootEl) return null;
  const doc = opts.doc ?? document;
  const storage = opts.storage ?? window.localStorage;
  // Default deviceId resolution reads from window.localStorage directly,
  // not from `storage` — in prod they're the same object, but tests
  // inject `storage` as a read-only fake and override `getDeviceId`.
  // Keeping the default path off `storage` lets the `storage` param's
  // type stay `Pick<Storage, 'getItem'>` instead of dragging in
  // setItem/removeItem (needed by getOrCreateDeviceId on first run).
  const getDeviceId = opts.getDeviceId
    ?? (() => getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID()));

  /** @type {string | null} */
  let cached = null;
  try {
    cached = storage.getItem(NICKNAME_STORAGE_KEY);
  } catch {
    /* private mode / no quota — fall through to the default */
  }
  const deviceId = getDeviceId();
  const name = displayNickname(deviceId, cached);

  const li = doc.createElement('li');
  li.className = 'menu-nickname';

  const a = doc.createElement('a');
  a.setAttribute('href', opts.profileHref);
  if (opts.pageIsProfile) a.setAttribute('aria-current', 'page');

  // Avatar tile: a deterministic identicon derived from deviceId. The
  // SVG markup is self-contained and built entirely from the hash + a
  // fixed palette, so dropping it into `innerHTML` is safe — no path
  // for user-supplied content to enter the SVG string.
  const avatar = doc.createElement('span');
  avatar.className = 'menu-nickname-avatar';
  avatar.innerHTML = avatarSvg(deviceId);

  const value = doc.createElement('strong');
  value.className = 'menu-nickname-value';
  value.textContent = name;

  a.appendChild(avatar);
  a.appendChild(value);
  li.appendChild(a);

  // Insert as the first menu item — "you" deserves top placement above any
  // navigation links the page added below.
  const firstChild = opts.rootEl.firstChild;
  if (firstChild) opts.rootEl.insertBefore(li, firstChild);
  else opts.rootEl.appendChild(li);
  return li;
}

/**
 * Mount a "Privacy" link into the burger menu, positioned RIGHT ABOVE the
 * "Buy me a coffee" link. Both are meta-navigation that sits at the
 * bottom of the menu; privacy goes first because it's the more important
 * of the two (a user looking for "where's my data" should find it before
 * the coffee CTA).
 *
 * Lookup is `.menu-coffee` (its parent `<li>`). If no coffee link is
 * present we fall back to appending at the bottom — defensive against
 * future pages whose menu happens to omit the coffee CTA.
 *
 * @param {{
 *   rootEl: HTMLElement | null,
 *   privacyHref: string,
 *   doc?: Document,
 *   pageIsPrivacy?: boolean,
 * }} opts
 */
/**
 * Mount a "Sync across devices" link into the burger menu, above
 * the Privacy entry. The label stays the same whether or not the
 * device is already linked — visiting the page itself is how the
 * user manages the link, so the menu doesn't need to advertise
 * link state.
 *
 * Anchor order on the canonical menu, top to bottom:
 *   nickname → … → SYNC → privacy → coffee
 *
 * Falls back to inserting before `.menu-coffee` if no privacy link
 * is present (e.g. a page that omits privacy but wants sync), and
 * to appending if neither is present.
 *
 * @param {{
 *   rootEl: HTMLElement | null,
 *   syncHref: string,
 *   doc?: Document,
 *   pageIsSync?: boolean,
 * }} opts
 */
export function mountSyncMenuItem(opts) {
  if (!opts || !opts.rootEl) return null;
  const doc = opts.doc ?? document;

  const li = doc.createElement('li');
  li.className = 'menu-sync';

  const a = doc.createElement('a');
  a.setAttribute('href', opts.syncHref);
  if (opts.pageIsSync) a.setAttribute('aria-current', 'page');
  a.setAttribute('data-i18n', 'menu.sync');
  a.textContent = 'Sync across devices';

  li.appendChild(a);

  // Anchor: prefer the privacy link's <li>; fall back to coffee's;
  // append at end if neither is present.
  const privacyLink = opts.rootEl.querySelector('.menu-privacy');
  const privacyLi = privacyLink ? privacyLink.closest('li') : null;
  if (privacyLi) {
    opts.rootEl.insertBefore(li, privacyLi);
    return li;
  }
  const coffeeLink = opts.rootEl.querySelector('.menu-coffee');
  const coffeeLi = coffeeLink ? coffeeLink.closest('li') : null;
  if (coffeeLi) {
    opts.rootEl.insertBefore(li, coffeeLi);
  } else {
    opts.rootEl.appendChild(li);
  }
  return li;
}

/**
 * Mount a "Privacy" link into the burger menu, positioned RIGHT
 * ABOVE the "Buy me a coffee" link.
 *
 * @param {{
 *   rootEl: HTMLElement | null,
 *   privacyHref: string,
 *   doc?: Document,
 *   pageIsPrivacy?: boolean,
 * }} opts
 */
export function mountPrivacyMenuItem(opts) {
  if (!opts || !opts.rootEl) return null;
  const doc = opts.doc ?? document;

  const li = doc.createElement('li');
  li.className = 'menu-privacy';

  const a = doc.createElement('a');
  a.setAttribute('href', opts.privacyHref);
  if (opts.pageIsPrivacy) a.setAttribute('aria-current', 'page');
  a.setAttribute('data-i18n', 'privacy.menuLink');
  a.textContent = 'Privacy';

  li.appendChild(a);

  // Anchor: the coffee link's <li>. Insert before it so the menu reads
  // … → privacy → coffee. Falls back to append-at-end if the page has
  // no coffee link to anchor on.
  const coffeeLink = opts.rootEl.querySelector('.menu-coffee');
  const coffeeLi = coffeeLink ? coffeeLink.closest('li') : null;
  if (coffeeLi) {
    opts.rootEl.insertBefore(li, coffeeLi);
  } else {
    opts.rootEl.appendChild(li);
  }
  return li;
}

/**
 * Build an iOS-style toggle list item for a burger menu. Same surface
 * shape every page uses: label on the left, sliding switch on the
 * right, page reload after the slide animation so the new preference
 * state takes effect cleanly.
 *
 * `label` is the already-translated string (caller invokes `t()`).
 * `labelKey` is the optional i18n key — when set, it's written as
 * `data-i18n` on the text span so `applyStringsToDocument` retranslates
 * the label on a soft language switch without the page rebuilding the
 * menu.
 *
 * `reload` (default true) reloads the page 350ms after a change so the
 * new setting takes effect on a fresh boot — correct for toggles that
 * change the game's content (e.g. the territory-scope toggle). Pass
 * `false` for toggles whose effect the caller applies live in
 * `onChange` (e.g. flagQuiz's show-map toggle, which mounts/hides the
 * map in place rather than restarting the round).
 *
 * @param {{
 *   label: string,
 *   labelKey?: string,
 *   initial: boolean,
 *   onChange: (checked: boolean) => void,
 *   reload?: boolean,
 * }} opts
 * @returns {HTMLLIElement}
 */
export function buildToggleLi({ label, labelKey, initial, onChange, reload = true }) {
  const toggleLi = document.createElement('li');
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'scope-toggle';
  const textSpan = document.createElement('span');
  textSpan.className = 'scope-toggle-text';
  textSpan.textContent = label;
  if (labelKey) textSpan.setAttribute('data-i18n', labelKey);
  const switchSpan = buildToggleSwitch({
    initial,
    onChange: (checked) => {
      onChange(checked);
      // Let the slide animation finish so the user sees the toggle move
      // before the page reloads. Skipped when `reload` is false — the
      // caller applies the change live in `onChange` instead.
      if (reload) setTimeout(() => window.location.reload(), 350);
    },
  });
  toggleLabel.appendChild(textSpan);
  toggleLabel.appendChild(switchSpan);
  toggleLi.appendChild(toggleLabel);
  return toggleLi;
}

/**
 * The switch itself — the `.scope-toggle-switch / -track / -thumb` trio with a
 * real `<input type="checkbox">` behind it, so Tab / Space and screen readers
 * get native checkbox behaviour and the visual chrome paints off `:checked`.
 *
 * Split out of {@link buildToggleLi} because the burger menu's `<li><label>`
 * wrapper is menu chrome, not part of the control: Flag Party's lobby needs the
 * same switch sitting inside a player chip, where an `<li>` would be wrong and a
 * nested `<label>` would fight the chip's own hit target. `profile/sync/page.js`
 * had already hand-assembled these four elements for the same reason, which is
 * the second copy that made this worth extracting rather than repeating.
 *
 * `ariaLabel` names the control for assistive tech. Optional because a switch
 * inside a `<label>` (the burger menu) already takes its name from the label
 * text — but a switch dropped next to a *sibling* span has no name at all, which
 * is what the Flag Party lobby was shipping: "checkbox, unchecked" repeated once
 * per player, with no way to tell whose row you were on.
 *
 * @param {{ initial: boolean, onChange: (checked: boolean) => void, ariaLabel?: string }} opts
 * @returns {HTMLSpanElement}
 */
export function buildToggleSwitch({ initial, onChange, ariaLabel }) {
  const switchSpan = document.createElement('span');
  switchSpan.className = 'scope-toggle-switch';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = initial;
  if (ariaLabel) toggleInput.setAttribute('aria-label', ariaLabel);
  toggleInput.addEventListener('change', () => onChange(toggleInput.checked));
  const trackSpan = document.createElement('span');
  trackSpan.className = 'scope-toggle-track';
  trackSpan.setAttribute('aria-hidden', 'true');
  const thumbSpan = document.createElement('span');
  thumbSpan.className = 'scope-toggle-thumb';
  trackSpan.appendChild(thumbSpan);
  switchSpan.appendChild(toggleInput);
  switchSpan.appendChild(trackSpan);
  return switchSpan;
}
