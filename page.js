import { bootI18n, wireLangToggle, t, countryName } from './i18n.js';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameMenuItem } from './common.js';
import { loadCountries } from './flags/group.js';
import { getFlagFacts, storyFlagCodes } from './flags/flagFacts.js';
import { renderFlagFacts } from './flags/flagFactsRender.js';
import { openFlagZoom, wireFlagZoomBackdropClose } from './flags/flagZoom.js';
import { wireFlagLightbox } from './flags/flagLightbox.js';
import { warsawToday } from './flags/warsawTime.js';
import { flagOfDay } from './flags/flagOfDay.js';

/** @typedef {import('./flags/group.js').Country} Country */

export function bootHome() {
  bootI18n().then((lang) => {
    // Home page is otherwise `data-i18n`-only — applyStringsToDocument covers
    // every static translated surface, so soft-reload is essentially free
    // here. The one dynamic string (the flag-of-the-day country name) gets a
    // `langchanged` listener of its own below.
    wireLangToggle(lang, undefined, { softReload: true, base: './' });
    disableBurgerIfEmpty(
      document.querySelector('.burger'),
      document.querySelector('#burger-panel .menu'),
    );
    wireBurgerDismiss();
    mountNicknameMenuItem({
      rootEl: document.querySelector('#burger-panel .menu'),
      profileHref: 'profile/',
    });
    mountFlagOfDay();
  });
}

/**
 * Populate the facts panel for a code (or clear + hide it when there's no
 * story). Same shape as flagsdata's `paintFacts`; base is `flags/` because
 * the home page sits at the site root. Kept in sync deliberately — the popup
 * must render identically on both pages.
 *
 * @param {HTMLDialogElement} zoom
 * @param {HTMLElement} zoomFacts
 * @param {string} code
 */
function paintFacts(zoom, zoomFacts, code) {
  zoomFacts.innerHTML = '';
  const facts = getFlagFacts(code);
  zoom.classList.toggle('has-facts', !!facts);
  zoomFacts.hidden = !facts;
  if (!facts) return;
  const subtree = renderFlagFacts({ facts, t, doc: document, base: 'flags/' });
  if (subtree) zoomFacts.appendChild(subtree);
}

/**
 * Pick today's flag from the story pool, paint the compact card, and wire it
 * to open the shared story popup. No-ops silently if the markup is missing or
 * the fetch fails — the card starts hidden, so a failure just leaves it off.
 */
function mountFlagOfDay() {
  const card = /** @type {HTMLButtonElement | null} */ (document.getElementById('flag-of-day'));
  const zoom = /** @type {HTMLDialogElement | null} */ (document.getElementById('zoom'));
  if (!card || !zoom) return;

  // Editorial pins — force a specific flag on a specific date. Debut day
  // (2026-07-02) leads with Poland; every other day uses the normal
  // cycle-shuffle rotation. Safe to leave in place or extend later.
  const OVERRIDES = { '2026-07-02': 'pl' };
  const code = flagOfDay(warsawToday(), storyFlagCodes(), OVERRIDES);
  if (!code) return;

  const img = /** @type {HTMLImageElement | null} */ (card.querySelector('.fotd-flag'));
  const nameEl = /** @type {HTMLElement | null} */ (card.querySelector('.fotd-name'));
  const kicker = card.querySelector('.fotd-kicker');
  const zoomFacts = /** @type {HTMLElement} */ (zoom.querySelector('.country-facts'));

  // Need the localized display name for the country. Fetch the dataset once;
  // if it fails, leave the card hidden rather than showing a code.
  fetch('flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((countries) => {
      const c = countries.find((x) => x.code === code);
      if (!c) return;

      if (img) img.src = `flags/svg/${code}.svg`;

      const paintName = () => {
        const name = countryName(c);
        if (img) img.alt = name;
        if (nameEl) nameEl.textContent = name;
        // The kicker text already carries its trailing colon ("Flag of the
        // day:"), so join with a space, not another colon.
        const label = kicker ? (kicker.textContent || '').trim() : '';
        card.setAttribute('aria-label', `${label} ${name}`.trim());
      };
      paintName();
      // The kicker re-translates via data-i18n upstream on a soft language
      // switch; the country name isn't a static string, so repaint it here.
      document.addEventListener('langchanged', paintName);

      card.addEventListener('click', () => {
        openFlagZoom(zoom, { code, displayName: countryName(c), svgBase: 'flags/svg/' });
        // showModal() autofocuses the × button; move focus to the dialog
        // (tabindex="-1", outline suppressed) so the ring only shows on Tab.
        zoom.focus();
        paintFacts(zoom, zoomFacts, code);
      });

      card.hidden = false;
    })
    .catch(() => { /* leave the card hidden on any failure */ });

  wireFlagZoomBackdropClose(zoom);
  // Tap the headline flag to enlarge it in a lightbox (same behaviour on
  // /flagsdata/ and /flagQuiz/). Wired once; reads the img's live src on tap.
  wireFlagLightbox(zoom.querySelector('img'), t);
  // Explicit × close (the backdrop target shrinks when the facts popup goes
  // near-full-screen on mobile). Native Esc still works too.
  const closeBtn = zoom.querySelector('.zoom-close');
  if (closeBtn) closeBtn.addEventListener('click', () => zoom.close());
}
