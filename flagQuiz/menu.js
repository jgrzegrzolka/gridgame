import { VARIANTS, defaultModeFor, resolveMode } from '../flags/quiz.js';
import { t } from '../i18n.js';

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * Build the burger-menu contents for the flagQuiz feature.
 *
 * Same DOM goes on the main quiz page and on the stats sub-page so the
 * menu doesn't morph as the user navigates within the feature. The
 * caller passes:
 *
 *   - `relativeBase`: '' for the quiz page (links are `?v=X&n=Y`,
 *     stats link is `stats/`); '../' for the stats sub-page (links are
 *     `../?v=X&n=Y`, stats link is `./`).
 *   - `currentVariantKey`: the variant the user is currently playing
 *     (quiz page), or null on stats. Marks the matching variant link
 *     with aria-current="page".
 *   - `statsCurrent`: true on the stats page. Marks the "Your stats"
 *     link with aria-current="page".
 *
 * The map's show/hide is driven entirely by the toggle chip on the map
 * itself (present as a "show" chip even on the collapsed strip), so the
 * burger menu carries no map toggle.
 *
 * The "Include territories & other flags" toggle used to be built here.
 * Feature V replaced it with the `weird` deck, which needs no wiring at
 * all: it's an ordinary `VARIANTS` entry, so the loop below renders it as
 * a link like every other deck. Phase 2 replaces this list with the pill
 * switcher + a scope list that only appears under `flags`.
 *
 * @param {HTMLUListElement} menuEl
 * @param {Country[]} all
 * @param {{ relativeBase: string, currentVariantKey: string | null, statsCurrent: boolean }} opts
 */
export function buildQuizMenu(menuEl, all, opts) {
  const { relativeBase, currentVariantKey, statsCurrent } = opts;

  // "All countries" stands apart from the continent list; `weird` stands
  // apart from both — it's a different pool, not a slice of the world.
  const WIDE_GROUP = new Set(['countries']);
  const OWN_GROUP = new Set(['weird']);
  let dividerPlaced = false;
  let firstVariantPlaced = false;
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const pool = all.filter(variant.filter);
    const defaultMode = defaultModeFor(pool.length);
    if (defaultMode === null) continue;
    const li = document.createElement('li');
    if (!firstVariantPlaced) {
      firstVariantPlaced = true;
    } else if (OWN_GROUP.has(key)) {
      li.className = 'menu-divider';
    } else if (!dividerPlaced && !WIDE_GROUP.has(key)) {
      li.className = 'menu-divider';
      dividerPlaced = true;
    }
    const a = document.createElement('a');
    a.href = `${relativeBase}?v=${key}&n=${defaultMode}`;
    a.textContent = t(`variant.${key}`, variant.label);
    if (key === currentVariantKey) a.setAttribute('aria-current', 'page');
    li.appendChild(a);
    menuEl.appendChild(li);
  }

  const statsLi = document.createElement('li');
  statsLi.className = 'menu-divider';
  const statsA = document.createElement('a');
  statsA.href = statsCurrent ? './' : `${relativeBase}stats/`;
  statsA.textContent = t('menu.yourStats', 'Your stats');
  if (statsCurrent) statsA.setAttribute('aria-current', 'page');
  statsLi.appendChild(statsA);
  menuEl.appendChild(statsLi);

  const coffeeLi = document.createElement('li');
  coffeeLi.className = 'menu-divider';
  const coffeeA = document.createElement('a');
  coffeeA.className = 'menu-coffee';
  coffeeA.href = 'https://suppi.pl/jgrzegrzolka';
  coffeeA.target = '_blank';
  coffeeA.rel = 'noopener noreferrer';
  coffeeA.textContent = t('coffee', 'Buy me a coffee');
  coffeeLi.appendChild(coffeeA);
  menuEl.appendChild(coffeeLi);
}

/**
 * Build the first-visit category picker. Renders the same variant
 * list as the burger menu (same `.menu` class, same link shape) as
 * the page's landing state — the burger menu remains a parallel
 * access path, so the picker and burger always carry identical
 * options. No headline: the chrome buttons (back, lang, burger) set
 * the context, and a list of categories doesn't need an instruction.
 *
 * Each option is a navigation link to `?v=<key>&n=<mode>`. The next
 * page load is what triggers `setQuizLastVariant` in page.js, so a
 * single pick both starts the game AND populates lastVariant — which
 * is the signal page.js uses to skip the picker on subsequent visits.
 *
 * Mode resolution: if the current URL carries `?n=<mode>` (e.g. the
 * home tile's `?n=60s`), preserve it when valid for the variant's
 * pool. Otherwise fall back to `defaultModeFor(pool.length)`. Keeps
 * the home-tile's "60s timed challenge" intent travelling through
 * the picker — first-timers entering via that tile still get a 60s
 * landing once they pick a category.
 *
 * @param {HTMLUListElement} pickerListEl
 * @param {Country[]} all
 * @param {{ urlMode: string | null }} opts
 */
export function buildVariantPicker(pickerListEl, all, opts) {
  const { urlMode } = opts;
  // Empty before re-populating so a lang-toggle reload doesn't double
  // up the variant list.
  pickerListEl.innerHTML = '';
  // Variant key → continent silhouette filename. 'countries' (All) gets
  // a wireframe globe. Files live in flagQuiz/continents/ — rendered as
  // CSS masks (not <img>) so they inherit the brand colour from
  // --link-color and get smooth hover transitions for free.
  const ICONS = /** @type {Record<string, string>} */ ({
    countries: 'world.svg',
    europe: 'europe.svg',
    asia: 'asia.svg',
    africa: 'africa.svg',
    'north-america': 'north-america.svg',
    'south-america': 'south-america.svg',
    oceania: 'oceania.svg',
    // Not a continent, so not a landmass: the Jolly Roger, matching the icon
    // Flag Party already uses for the same non-sovereign pool ("a flag with
    // no country, unmistakably not a specific country"). Authored as a
    // monochrome alpha mask because `.picker-tile-icon` paints it via
    // mask-image, not as artwork.
    weird: 'weird.svg',
  });
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const pool = all.filter(variant.filter);
    const mode = resolveMode(urlMode, pool.length);
    if (mode === null) continue;
    const li = document.createElement('li');
    li.className = 'picker-tile';
    const a = document.createElement('a');
    a.href = `?v=${key}&n=${mode}`;
    const iconFile = ICONS[key];
    if (iconFile) {
      const icon = document.createElement('span');
      icon.className = 'picker-tile-icon';
      // mask-image points at the SVG; the background-color from CSS shows
      // through wherever the mask is opaque. -webkit-mask-image for older
      // Safari builds that haven't aliased the unprefixed property yet.
      const url = `url('continents/${iconFile}')`;
      icon.style.maskImage = url;
      icon.style.webkitMaskImage = url;
      a.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'picker-tile-label';
    label.textContent = t(`variant.${key}`, variant.label);
    a.appendChild(label);
    li.appendChild(a);
    pickerListEl.appendChild(li);
  }
}
