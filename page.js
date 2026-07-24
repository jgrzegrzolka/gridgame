import { bootI18n, wireLangToggle } from './i18n.js';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameMenuItem } from './common.js';

/**
 * The hero's flag row is NOT built here — it's static markup in index.html.
 * It used to be painted at the end of this boot, which put 2.7KB of constant
 * decorative SVG behind the 91KB translation fetch, and the row visibly lagged
 * the headline beside it. Nothing in it needs i18n or the catalog, so it paints
 * with the document. `home.test.js` fails if it creeps back into this file.
 */
export function bootHome() {
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
