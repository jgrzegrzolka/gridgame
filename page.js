import { bootI18n, wireLangToggle } from './i18n.js';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameMenuItem } from './common.js';
import { todayNFromDate } from './flags/daily.js';
import { warsawToday } from './flags/warsawTime.js';

/**
 * The hero's flag row is NOT built here — it's static markup in index.html.
 * It used to be painted at the end of this boot, which put 2.7KB of constant
 * decorative SVG behind the 91KB translation fetch, and the row visibly lagged
 * the headline beside it. Nothing in it needs i18n or the catalog, so it paints
 * with the document. `home.test.js` fails if it creeps back into this file.
 */
export function bootHome() {
  // Fill the hero's "No. N" caption client-side, before (and independent of)
  // the i18n fetch, so it paints promptly without a catalog request. The
  // number is language-agnostic; the "No." label around it is `data-i18n`.
  // Contiguous puzzle dates make days-since-launch the exact puzzle number
  // (see todayNFromDate) — the landing page stays fetch-free.
  const nEl = document.getElementById('hero-puzzle-n');
  if (nEl) {
    const n = todayNFromDate(warsawToday());
    // Blank the whole caption line before launch (n = 0) so it never shows
    // "No. 0"; from launch on, show the number.
    const meta = /** @type {HTMLElement | null} */ (nEl.closest('.hero-meta'));
    if (n > 0) nEl.textContent = String(n);
    else if (meta) meta.hidden = true;
  }

  bootI18n().then((lang) => {
    // The home is `data-i18n`-only, so a soft language switch just re-applies
    // the static strings — there's no dynamic text on the page to repaint.
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
  });
}
