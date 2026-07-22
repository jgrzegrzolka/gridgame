import { bootI18n, wireLangToggle } from './i18n.js';
import { disableBurgerIfEmpty, wireBurgerDismiss, mountNicknameMenuItem } from './common.js';
import { FAKE_FLAGS } from './flags/fakeFlags.js';

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
    mountHeroFlags();
  });
}

// One empty "to find" box trails the three fake flags in the hero — a fixed,
// decorative hint that there are real flags to discover, not a count of anything.
const HERO_EMPTY_BOXES = 1;

/**
 * Fill the hero's flag row: three fixed fake flags (flags/fakeFlags.js) plus one
 * empty "to find" box. The whole hero is static and fabricated — the headline
 * and the criteria chips are hard-coded decoration in the HTML — so nothing here
 * touches today's puzzle. That means NO catalog fetch on the landing page (the
 * home stays instant), and the "Today's puzzle" button still links to the real
 * daily. Trusted constant markup, so innerHTML is safe. (A later step may draw
 * the fakes from a larger pool.)
 */
function mountHeroFlags() {
  const stampsEl = document.getElementById('hero-stamps');
  if (!stampsEl) return;
  stampsEl.innerHTML = '';
  for (const svg of FAKE_FLAGS) {
    const cell = document.createElement('span');
    cell.className = 'hero-stamp fake';
    cell.innerHTML = svg;
    stampsEl.appendChild(cell);
  }
  for (let i = 0; i < HERO_EMPTY_BOXES; i++) {
    const cell = document.createElement('span');
    cell.className = 'hero-stamp todo';
    stampsEl.appendChild(cell);
  }
}
