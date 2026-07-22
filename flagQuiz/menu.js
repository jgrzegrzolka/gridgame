import { VARIANTS, defaultModeFor, availableModes } from '../flags/quiz.js';
import { DECKS, deckOf, variantsForDeck, deckHasScopes, defaultVariantForDeck } from '../flags/decks.js';
import { deckIconHtml } from '../flags/deckIcons.js';
import { t } from '../i18n.js';

/** @typedef {import('../flags/group.js').Country} Country */

/** @param {Country[]} all @param {string} key */
function poolOf(all, key) {
  const v = VARIANTS[key];
  return v ? all.filter(v.filter) : [];
}

/**
 * The mode a menu link should point at: the one you're playing, when the
 * target pool allows it, else that pool's default.
 *
 * Every link used to hardcode `defaultModeFor(...)`, which is always '60s'.
 * So a player mid-endurance who tapped Asia was silently dropped back into a
 * 60-second sprint, with nothing to explain why. Falling back matters too:
 * not every deck offers every mode (Facts, in Phase 4, can't be endured —
 * there's nothing to exhaust), so a blind carry-over would dead-end.
 *
 * @param {Country[]} all
 * @param {string} key            target variant
 * @param {string | null} current the mode being played, or null (stats page)
 * @returns {string | null}
 */
function modeForLink(all, key, current) {
  const size = poolOf(all, key).length;
  if (current && availableModes(size, key).includes(current)) return current;
  return defaultModeFor(size, key);
}

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
 *   - `currentMode`: the mode being played, carried onto every link so
 *     switching deck or continent doesn't silently drop you out of it.
 *     Null on stats, where there's no round in progress.
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
 * @param {{ relativeBase: string, currentVariantKey: string | null, currentMode?: string | null, statsCurrent: boolean }} opts
 */
export function buildQuizMenu(menuEl, all, opts) {
  const { relativeBase, currentVariantKey, currentMode = null, statsCurrent } = opts;
  const activeDeck = currentVariantKey ? deckOf(currentVariantKey) : null;

  // ---- 1. deck pills ---- (no caption: the pills are self-evidently the deck
  // switcher, and each carries its own icon + name)
  const deckLi = document.createElement('li');
  deckLi.className = 'menu-decks';
  const pills = document.createElement('div');
  pills.className = 'deck-pills';
  for (const deck of DECKS) {
    const fallback = defaultVariantForDeck(deck.id);
    if (!fallback) continue;
    // Tapping the LIT pill must not throw away your continent, so the active
    // deck links at the variant you're on rather than its default.
    const to = deck.id === activeDeck && currentVariantKey ? currentVariantKey : fallback;
    const mode = modeForLink(all, to, currentMode);
    if (mode === null) continue;
    const a = document.createElement('a');
    a.className = 'pill deck-pill';
    if (deck.id === activeDeck) a.classList.add('active');
    a.href = `${relativeBase}?v=${to}&n=${mode}`;
    const ico = document.createElement('span');
    ico.className = 'deck-pill-ico';
    ico.innerHTML = deckIconHtml(deck.id, { base: `${relativeBase}../` });
    a.appendChild(ico);
    a.appendChild(document.createTextNode(t(`deck.${deck.id}`, deck.label)));
    pills.appendChild(a);
  }
  deckLi.appendChild(pills);
  menuEl.appendChild(deckLi);

  // ---- 2. the current deck's scopes, only when there IS a choice ----
  // Under a single-variant deck the continents are absent, not disabled:
  // there is genuinely nothing to pick. Derived from the deck's own shape,
  // so Phases 3/4 (world-only) inherit it without a rule to remember.
  if (activeDeck && deckHasScopes(activeDeck)) {
    // No caption: the continent links speak for themselves. The first rendered
    // scope carries the menu-divider (which the caption's <li> used to own), so
    // the scope list still reads as its own group under the deck pills.
    let firstScope = true;
    for (const key of variantsForDeck(activeDeck)) {
      const variant = VARIANTS[key];
      if (!variant) continue;
      const mode = modeForLink(all, key, currentMode);
      if (mode === null) continue;
      const li = document.createElement('li');
      if (firstScope) {
        li.className = 'menu-divider';
        firstScope = false;
      }
      const a = document.createElement('a');
      a.href = `${relativeBase}?v=${key}&n=${mode}`;
      a.textContent = t(`variant.${key}`, variant.label);
      if (key === currentVariantKey) a.setAttribute('aria-current', 'page');
      li.appendChild(a);
      menuEl.appendChild(li);
    }
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
  coffeeA.textContent = t('menu.coffee', 'Buy me a coffee');
  coffeeLi.appendChild(coffeeA);
  menuEl.appendChild(coffeeLi);
}
