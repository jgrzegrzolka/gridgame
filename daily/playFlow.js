/**
 * Shared find-all play flow for the daily catalog. Every page that lets
 * you play a daily-style puzzle — live `/daily/`, the author-only
 * `/daily/backlog/play.html`, and the author-only `/daily/ideas/play.html`
 * — imports the same `startGame` from here so the input mechanics,
 * suggestions, shake/wrong-flash, give-up flow, celebration tiers, and
 * result rendering stay byte-identical across all three. The per-mode
 * differences (which catalog to load, whether to persist the score,
 * which links to rewrite on the result page) live in each caller.
 *
 * Why a module instead of a branch in `daily/page.js`: a branch ships
 * to live players. A bug in an author-only branch could break the live
 * daily player even if the branch never runs (parse-time crashes, typos
 * in the always-run dispatcher above the branch). Pulling the play loop
 * out and giving author pages their own HTML host means the live
 * `page.js` no longer parses author-only URL params or names author-only
 * code paths.
 *
 * DOM contract: every page that imports this module must include the
 * same set of element IDs in its HTML — `daily-state`, `game`, `result`,
 * `daily-desc`, `find-cat`, `find-count`, `find-input`, `find-suggestions`,
 * `find-found`, `give-up`, `final-score-prefix`, `final-score-fraction`,
 * `final-found`, `final-total`, `final-score-line`, `find-result-found`,
 * `found-title`, `find-missed`, `missed-title`, and a `<dialog id="zoom">`
 * carrying an `img` and a `p`. The live `daily/index.html` is the
 * reference markup; `backlog/play.html` and `ideas/play.html` copy it.
 */

import { suggest, exactSingleMatch } from '../flags/engine.js';
import { findPool, classifyGuess } from '../flags/findFlag.js';
import { scoreColor, pickFinalScoreLine, pickCelebration } from '../flags/quiz.js';
import { t, countryName } from '../i18n.js';
import { launchConfetti, launchFireworks } from '../confetti.js';
import { saveScore } from './scores.js';

/** @typedef {import('../flags/group.js').Country} Country */

// Each `.find-tile` is built once and rendered with the country's display
// name baked into `dataset.name` (for the CSS hover label) and the inner
// `<img>`'s `alt`. On a soft language switch we need to re-paint those
// strings without rebuilding the tile (rebuilding would lose animations
// and tile order). The WeakMap holds the Country reference for each tile
// so `refreshTileNames` can call `countryName(c)` again against the new
// language cache. WeakMap (not a plain Map) so a removed tile is
// garbage-collected normally.
/** @type {WeakMap<HTMLElement, Country>} */
const tileCountries = new WeakMap();

/**
 * Walk every `.find-tile` currently in the document and re-apply the
 * display name to `dataset.name` + `<img>.alt`. Pure DOM walk — no
 * dependency on which game is active, so the live page's in-game found
 * list, the result-screen found list, and the result-screen missed list
 * all refresh together.
 */
function refreshTileNames() {
  const tiles = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.find-tile')
  );
  for (const tile of tiles) {
    const c = tileCountries.get(tile);
    if (!c) continue;
    const displayName = countryName(c);
    tile.dataset.name = displayName;
    const img = /** @type {HTMLImageElement | null} */ (tile.querySelector('img'));
    if (img) img.alt = displayName;
  }
}

// Flag SVGs are resolved against this module's URL — not against the
// HTML page that loaded a wrapping `play.js`. The live `daily/index.html`
// and the subfolder `backlog/play.html` / `ideas/play.html` live at
// different depths; without `import.meta.url`, the subfolder pages would
// look for SVGs under `daily/flags/svg/...` and 404. Resolving from the
// module URL gives the same correct site-root path from every caller.
const SVG_BASE = new URL('../flags/svg/', import.meta.url).href;

/**
 * Open the flag-zoom dialog for a single country. Internal; reached via
 * a click on any `flagTile`.
 *
 * @param {Country} c
 */
function openZoom(c) {
  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = /** @type {HTMLImageElement} */ (zoom.querySelector('img'));
  const zoomName = /** @type {HTMLParagraphElement} */ (zoom.querySelector('p'));
  zoomImg.src = `${SVG_BASE}${c.code}.svg`;
  const displayName = countryName(c);
  zoomImg.alt = displayName;
  zoomName.textContent = displayName;
  zoom.showModal();
}

/**
 * Wire the zoom dialog's click-outside-to-close handler. Call once
 * during page boot — adding the listener inside `startGame` would
 * stack a fresh handler on every play and leak across replays.
 *
 * Each play page calls this from its `bootXxx()` entry point. Subfolder
 * pages (`backlog/play.html`, `ideas/play.html`) reference flag SVGs at
 * `../flags/svg/...` — the relative path from `playFlow.js` is the same
 * from all three caller paths because `playFlow.js` lives in `daily/`
 * and the SVGs live at `../flags/svg/` from there.
 */
export function wireZoom() {
  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });
}

/**
 * Build one tile in either the in-progress "found" list or the result
 * "found/missed" lists. Click opens the zoom dialog.
 *
 * @param {Country} c
 */
function flagTile(c) {
  const displayName = countryName(c);
  const li = document.createElement('li');
  li.className = 'find-tile';
  li.dataset.name = displayName;
  tileCountries.set(li, c);
  li.addEventListener('click', () => openZoom(c));
  const img = document.createElement('img');
  img.src = `${SVG_BASE}${c.code}.svg`;
  img.alt = displayName;
  img.loading = 'lazy';
  li.appendChild(img);
  return li;
}

/**
 * Replace the page with a single error message — used when the catalog
 * fetch fails or the requested puzzle can't be resolved.
 *
 * @param {string} msg
 */
export function showState(msg) {
  const stateEl = /** @type {HTMLElement} */ (document.getElementById('daily-state'));
  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const resultEl = /** @type {HTMLElement} */ (document.getElementById('result'));
  stateEl.textContent = msg;
  stateEl.hidden = false;
  gameEl.hidden = true;
  resultEl.hidden = true;
}

/**
 * Paint the puzzle's helper sentence for the current page language.
 * i18n has already run by the time the play page fires (the inline
 * `<script type="module">` chains via `.then(bootXxx)`), so
 * `documentElement.lang` is the resolved code. Falls back to English
 * if the requested language is missing — better to show *some*
 * sentence than to leak the absence of a translation. Empty/missing
 * description hides the element so the sovereign note still reads
 * naturally below the header.
 *
 * @param {Record<string, string> | undefined} description
 */
export function paintDescription(description) {
  const descEl = /** @type {HTMLElement} */ (document.getElementById('daily-desc'));
  const lang = document.documentElement.lang || 'en';
  const text = description?.[lang] ?? description?.en ?? '';
  descEl.textContent = text;
  descEl.hidden = text === '';
}

/**
 * Map a DailyResolutionFail.reason to a localised message. Kept here
 * (rather than in i18n.js) so the message shape stays a per-flow
 * concern — the daily play surface's pre-game copy doesn't leak into
 * unrelated features.
 *
 * @param {'not-found' | 'invalid-filter' | 'no-targets'} reason
 */
export function reasonMessage(reason) {
  switch (reason) {
    case 'not-found':
      return t('daily.notFound', 'Puzzle not found.');
    case 'invalid-filter':
      return `${t('game.failedToLoad', 'Failed to load:')} invalid puzzle filter`;
    case 'no-targets':
      return `${t('game.failedToLoad', 'Failed to load:')} no targets resolved`;
  }
}

/**
 * Paint the result section (final score, found grid, missed grid) and
 * swap from `#game` to `#result`. Called from both the natural end of
 * a play (via `startGame.finish`) and the revisit path on the live
 * page (restored from localStorage). Confetti is the caller's concern
 * — revisits don't want it.
 *
 * @param {Country[]} targets
 * @param {Set<string>} foundCodes
 */
export function renderResult(targets, foundCodes) {
  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const resultEl = /** @type {HTMLElement} */ (document.getElementById('result'));

  const found = foundCodes.size;
  const total = targets.length;
  const { prefixKey, showFraction } = pickFinalScoreLine(found, total);
  const prefixEl = /** @type {HTMLElement} */ (document.getElementById('final-score-prefix'));
  prefixEl.setAttribute('data-i18n', prefixKey);
  prefixEl.textContent = t(prefixKey, prefixKey === 'findFlag.youFoundAll' ? 'You found all' : 'You found');
  /** @type {HTMLElement} */ (document.getElementById('final-score-fraction')).hidden = !showFraction;
  /** @type {HTMLElement} */ (document.getElementById('final-found')).textContent = String(found);
  /** @type {HTMLElement} */ (document.getElementById('final-total')).textContent = String(total);
  /** @type {HTMLElement} */ (document.getElementById('final-score-line')).style.color = scoreColor(found / total);

  const foundFlags = targets.filter((c) => foundCodes.has(c.code));
  const foundResultEl = /** @type {HTMLElement} */ (document.getElementById('find-result-found'));
  foundResultEl.innerHTML = '';
  for (const c of foundFlags) foundResultEl.appendChild(flagTile(c));
  /** @type {HTMLElement} */ (document.getElementById('found-title')).hidden = foundFlags.length === 0;

  const missed = targets.filter((c) => !foundCodes.has(c.code));
  const missedEl = /** @type {HTMLElement} */ (document.getElementById('find-missed'));
  missedEl.innerHTML = '';
  for (const c of missed) missedEl.appendChild(flagTile(c));
  /** @type {HTMLElement} */ (document.getElementById('missed-title')).hidden = missed.length === 0;

  gameEl.hidden = true;
  resultEl.hidden = false;
}

/**
 * Run the find-all game against a fixed target list. This is the
 * non-stats variant of findFlag's startGame — same input mechanics,
 * same shake/wrong-flash, no best-time recording (daily is a
 * "everyone-the-same" puzzle; per-user best times don't add up to
 * something meaningful until we add a shareable score string in a
 * later phase).
 *
 * `opts.skipSave` is the only switch. Live daily's normal play path
 * persists the final found/total per puzzle number so the archive can
 * show the player their score. All author-only play (backlog preview,
 * ideas preview) and live-daily replay set `skipSave: true` — those
 * runs must not pollute the player's archive.
 *
 * Returns a handle with `refreshI18n({ all, targets, label })` so the
 * caller can swap in re-localized country data (fresh `aliases` from a
 * second `withLocalizedAliases` pass — needed because the suggestion
 * matcher reads `aliases`, which are baked at boot time) and a fresh
 * category label on a soft language switch, without rebuilding the
 * game state. Found-tile display names (read from `countryName`) and
 * suggestion items re-paint as part of the same call.
 *
 * @param {number} n  puzzle number for `saveScore`; ignored when
 *                    `skipSave` is true, but always required so the
 *                    function signature stays uniform across callers.
 * @param {import('../flags/engine.js').Category} category
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {{ skipSave?: boolean }} [opts]
 * @returns {{ refreshI18n: (next: { all: Country[], targets: Country[], label: string }) => void }}
 */
export function startGame(n, category, targets, all, opts = {}) {
  const skipSave = opts.skipSave === true;
  // pool is rebuilt on a soft language switch (the suggestion matcher reads
  // each Country's `aliases`, which are baked at withLocalizedAliases time
  // and stale after the language flips). targetCodes is mutated in place
  // so the `state` object below keeps pointing at the same Set instance.
  let pool = findPool(all);
  const targetCodes = new Set(targets.map((c) => c.code));
  const foundCodes = new Set();
  const state = { targetCodes, foundCodes };

  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const catEl = /** @type {HTMLElement} */ (document.getElementById('find-cat'));
  const countEl = /** @type {HTMLElement} */ (document.getElementById('find-count'));
  const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
  const sugEl = /** @type {HTMLElement} */ (document.getElementById('find-suggestions'));
  const foundEl = /** @type {HTMLElement} */ (document.getElementById('find-found'));
  const giveUpEl = /** @type {HTMLElement} */ (document.getElementById('give-up'));

  catEl.textContent = category.label;
  updateCount();

  /** @type {Country[]} */
  let matches = [];
  let selected = 0;
  let finished = false;

  function updateCount() {
    countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
  }
  /* Brief flash on each correct guess. Remove → force reflow → add
   * is the standard pattern for re-triggering a CSS animation on the
   * same element. Called from the match branch only — initial
   * updateCount() at startup shouldn't pulse. */
  function pulseCount() {
    countEl.classList.remove('find-count--pulse');
    void countEl.offsetWidth;
    countEl.classList.add('find-count--pulse');
  }

  function renderSuggestions() {
    sugEl.innerHTML = '';
    matches.forEach((c, i) => {
      const li = document.createElement('li');
      if (i === selected) li.classList.add('selected');
      const span = document.createElement('span');
      span.textContent = countryName(c);
      li.appendChild(span);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        submitCountry(c);
      });
      li.addEventListener('mouseenter', () => {
        selected = i;
        renderSelected();
      });
      sugEl.appendChild(li);
    });
    sugEl.hidden = matches.length === 0;
  }
  function renderSelected() {
    for (const [i, li] of sugEl.querySelectorAll('li').entries()) {
      li.classList.toggle('selected', i === selected);
    }
  }
  function updateSuggestions() {
    matches = suggest(pool, inputEl.value, { excludeCodes: foundCodes });
    selected = 0;
    renderSuggestions();
    const auto = exactSingleMatch(matches, inputEl.value);
    if (auto) submitCountry(auto);
  }

  function shakeInput() {
    inputEl.classList.remove('shake');
    void inputEl.offsetWidth;
    inputEl.classList.add('shake');
  }
  function flashWrong() {
    inputEl.classList.remove('wrong', 'shake');
    void inputEl.offsetWidth;
    inputEl.classList.add('wrong', 'shake');
    setTimeout(() => inputEl.classList.remove('wrong', 'shake'), 700);
  }

  /** @param {Country} c */
  function appendFound(c) {
    foundEl.insertBefore(flagTile(c), foundEl.firstChild);
  }

  /** @param {Country} c */
  function submitCountry(c) {
    const outcome = classifyGuess(state, c);
    if (outcome.kind === 'match') {
      foundCodes.add(c.code);
      appendFound(c);
      updateCount();
      pulseCount();
      inputEl.value = '';
      matches = [];
      renderSuggestions();
      if (foundCodes.size === targetCodes.size) finish();
      return;
    }
    if (outcome.kind === 'duplicate') {
      shakeInput();
      return;
    }
    if (outcome.kind === 'wrong-category') {
      flashWrong();
      inputEl.value = '';
      matches = [];
      renderSuggestions();
      return;
    }
    shakeInput();
  }

  inputEl.addEventListener('input', updateSuggestions);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = matches[selected];
      if (picked) submitCountry(picked);
      else shakeInput();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (matches.length === 0) return;
      selected = (selected + 1) % matches.length;
      renderSelected();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (matches.length === 0) return;
      selected = (selected - 1 + matches.length) % matches.length;
      renderSelected();
      return;
    }
    if (e.key === 'Escape') {
      inputEl.value = '';
      matches = [];
      renderSuggestions();
    }
  });

  giveUpEl.addEventListener('click', () => finish());

  function finish() {
    if (finished) return;
    finished = true;
    const found = foundCodes.size;
    const total = targetCodes.size;
    if (!skipSave) {
      saveScore(window.localStorage, n, found, total, Array.from(foundCodes));
    }
    const { tier, intensity } = pickCelebration({ found, total });
    if (tier === 'fireworks') launchFireworks();
    else if (tier === 'confetti') launchConfetti({ intensity });
    renderResult(targets, foundCodes);
  }

  gameEl.hidden = false;
  if (!('ontouchstart' in window)) inputEl.focus();

  return {
    /**
     * Apply a fresh language to the live game. Caller (page boot file)
     * re-runs `withLocalizedAliases` against the raw country list and
     * re-derives `targets` + the category label, then hands them in here.
     * The targetCodes Set is mutated in place so the closure-captured
     * `state` object stays valid.
     *
     * @param {{ all: Country[], targets: Country[], label: string }} next
     */
    refreshI18n(next) {
      targets = next.targets;
      all = next.all;
      pool = findPool(all);
      targetCodes.clear();
      for (const c of targets) targetCodes.add(c.code);
      catEl.textContent = next.label;
      refreshTileNames();
      renderSuggestions();
      if (finished) renderResult(targets, foundCodes);
    },
  };
}
