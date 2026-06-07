import { VARIANTS, defaultModeFor, availableModes, isQuizIncludeAll, setQuizIncludeAll } from '../flags/quiz.js';
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
 * The scope toggle is built here too so the toggle's wiring (label,
 * track, thumb, delayed reload) lives in one place.
 *
 * @param {HTMLUListElement} menuEl
 * @param {Country[]} all
 * @param {{ relativeBase: string, currentVariantKey: string | null, statsCurrent: boolean }} opts
 */
export function buildQuizMenu(menuEl, all, opts) {
  const { relativeBase, currentVariantKey, statsCurrent } = opts;
  const includeAll = isQuizIncludeAll();

  menuEl.appendChild(buildScopeToggleLi(includeAll));

  const WIDE_GROUP = new Set(['countries']);
  let dividerPlaced = false;
  let firstVariantPlaced = false;
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const pool = all.filter(variant.filter);
    const defaultMode = defaultModeFor(pool.length);
    if (defaultMode === null) continue;
    const li = document.createElement('li');
    if (!firstVariantPlaced) {
      // Separates the scope toggle from the variant list.
      li.className = 'menu-divider';
      firstVariantPlaced = true;
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
}

/**
 * Build the first-visit category picker. Same variant list shape as
 * the burger menu, but presented as the page's landing state — the
 * burger menu remains a parallel access path.
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
 * @param {HTMLElement} pickerTilesEl
 * @param {Country[]} all
 * @param {{ urlMode: string | null }} opts
 */
export function buildVariantPicker(pickerTilesEl, all, opts) {
  const { urlMode } = opts;
  // Empty before re-populating so a lang-toggle reload doesn't double
  // up the variant list.
  pickerTilesEl.innerHTML = '';
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const pool = all.filter(variant.filter);
    const defaultMode = defaultModeFor(pool.length);
    if (defaultMode === null) continue;
    const mode = urlMode && availableModes(pool.length).includes(urlMode)
      ? urlMode
      : defaultMode;
    const a = document.createElement('a');
    a.className = 'quiz-picker-tile';
    a.href = `?v=${key}&n=${mode}`;
    a.textContent = t(`variant.${key}`, variant.label);
    pickerTilesEl.appendChild(a);
  }
}

/** @param {boolean} includeAll */
function buildScopeToggleLi(includeAll) {
  const toggleLi = document.createElement('li');
  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'scope-toggle';
  const textSpan = document.createElement('span');
  textSpan.className = 'scope-toggle-text';
  textSpan.textContent = t('menu.includeTerritories', 'Include territories & other flags');
  const switchSpan = document.createElement('span');
  switchSpan.className = 'scope-toggle-switch';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = includeAll;
  toggleInput.addEventListener('change', () => {
    setQuizIncludeAll(localStorage, toggleInput.checked);
    // Let the slide animation finish so the user sees the toggle move
    // before the page reloads.
    setTimeout(() => window.location.reload(), 350);
  });
  const trackSpan = document.createElement('span');
  trackSpan.className = 'scope-toggle-track';
  trackSpan.setAttribute('aria-hidden', 'true');
  const thumbSpan = document.createElement('span');
  thumbSpan.className = 'scope-toggle-thumb';
  trackSpan.appendChild(thumbSpan);
  switchSpan.appendChild(toggleInput);
  switchSpan.appendChild(trackSpan);
  toggleLabel.appendChild(textSpan);
  toggleLabel.appendChild(switchSpan);
  toggleLi.appendChild(toggleLabel);
  return toggleLi;
}
