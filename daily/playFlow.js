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
 * `daily-desc`, `find-cat`, `find-count`, `daily-lives`, `find-input`, `find-suggestions`,
 * `find-found`, `give-up`, `final-score-prefix`, `final-score-fraction`,
 * `final-found`, `final-total`, `final-score-line`, `find-result-found`,
 * `found-title`, `find-missed`, `missed-title`, and a `<dialog id="zoom">`
 * carrying an `img`, a `p` (the country name), and a `p.zoom-note` (the
 * optional post-solve explanation). The live `daily/index.html` is the
 * reference markup; `backlog/play.html` and `ideas/play.html` copy it.
 */

import { suggest, exactSingleMatch } from '../flags/engine.js';
import { findPool, classifyGuess } from '../flags/findFlag.js';
import { createLives } from './lives.js';
import { renderCriteriaInline, renderMetricLeadInline, renderFlagLeadInline } from '../flags/filterChips.js';
import { scoreColor, pickFinalScoreLine, pickCelebration } from '../flags/quiz.js';
import { resolveNote } from '../flags/daily.js';
import { formatPopulationShort } from '../flags/populationRank.js';
import { wireFlagLightbox } from '../flags/flagLightbox.js';
import { t, countryName } from '../i18n.js';
import { runCelebration } from '../confetti.js';
import { saveScore } from './scores.js';
import {
  computeLangRefreshPayload,
  bindTileCountry,
  refreshTileNames,
} from '../langRefresh.js';

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * Wire the game handle returned by `startGame` to soft language
 * switches. On each `langchanged` event: re-paint the description
 * (if the page has one), recompute the localized country list +
 * targets + category label via `computeLangRefreshPayload`, and hand
 * the result to `game.refreshI18n`. Returns the listener function so
 * a future caller (or test) can `removeEventListener` it.
 *
 * The three daily play surfaces (live + backlog/ideas preview) all
 * share this shape; findFlag's listener is structurally different
 * (three states: chooser / game / result) and stays page-local.
 *
 * `labelFor` is supplied by the caller because filter-derived and
 * manual entries source the category label differently — filter
 * entries call `filterToCategory(filter, t).label`, manual entries
 * read `entry.title[lang]`. Keeps this helper agnostic.
 *
 * @param {{ refreshI18n: (next: { all: Country[], targets: Country[], label: string }) => void }} game
 * @param {{ raw: any[], targets: Country[], labelFor: () => string, description?: Record<string, string>, additionalDescription?: Record<string, string> }} deps
 * @returns {() => void}
 */
export function attachLangRefresh(game, { raw, targets, labelFor, description, additionalDescription }) {
  // Pre-compute the code set once — the targets array doesn't change
  // for the lifetime of a round, only the Country objects backing
  // their entries do (when withLocalizedAliases produces a fresh array
  // with new aliases). Pinning on codes lets us re-find the same
  // logical targets in the new array.
  const targetCodes = new Set(targets.map((c) => c.code));
  const listener = () => {
    if (description !== undefined) paintDescription(description, additionalDescription);
    game.refreshI18n(computeLangRefreshPayload({ raw, targetCodes, labelFor }));
  };
  document.addEventListener('langchanged', listener);
  return listener;
}

/**
 * Render a state-screen message (e.g. "Puzzle not found.") and keep it
 * in the active language across a soft language switch by re-rendering
 * on `langchanged`. The error / not-found branches across daily,
 * backlog, and ideas all need this — wrapping it once removes six
 * copies of the same listener-on-langchanged boilerplate.
 *
 * @param {'not-found' | 'invalid-filter' | 'no-targets'} reason
 */
export function showReason(reason) {
  const paint = () => showState(reasonMessage(reason));
  paint();
  document.addEventListener('langchanged', paint);
}

// Flag SVGs are resolved against this module's URL — not against the
// HTML page that loaded a wrapping `play.js`. The live `daily/index.html`
// and the subfolder `backlog/play.html` / `ideas/play.html` live at
// different depths; without `import.meta.url`, the subfolder pages would
// look for SVGs under `daily/flags/svg/...` and 404. Resolving from the
// module URL gives the same correct site-root path from every caller.
const SVG_BASE = new URL('../flags/svg/', import.meta.url).href;

/**
 * Heart silhouette for the daily's wrong-guess budget, on a 24 × 22 grid.
 * One constant, rendered filled while a life is available and as an
 * outline once it's spent (see `heartSvg`) — so the two states can never
 * describe different shapes.
 */
const HEART_PATH =
  'M12 21C12 21 1.5 14.2 1.5 7.6 1.5 4.2 4.2 1.5 7.5 1.5c2 0 3.7 1 4.5 2.5' +
  '.8-1.5 2.5-2.5 4.5-2.5 3.3 0 6 2.7 6 6.1C22.5 14.2 12 21 12 21z';

/**
 * The active puzzle's per-answer "why" notes (`entry.notes`), keyed by
 * country code. Set once per puzzle via `setZoomNotes` from the page boot
 * file; read by `openZoom` to decide whether a flag gets an explanation
 * line under its name. Module-scope (not threaded through openZoom's
 * callers) because openZoom is wired deep in `flagTile` and the
 * extra-stats rail, and only ever shows one puzzle's flags at a time —
 * the same module-singleton shape `shareCtx` / `streakState` use in
 * page.js. `null` until a puzzle resolves, and on any page that doesn't
 * set notes (none today, but the preview pages could skip it) — openZoom
 * then just shows the name.
 *
 * @type {Record<string, Record<string, string>> | null}
 */
let zoomNotes = null;

/**
 * Install the active puzzle's notes for the zoom dialog. Called once from
 * the boot flow after the entry resolves — covers both the play path and
 * the revisit path, since both open the same zoom. Passing `undefined`
 * (an entry with no notes) clears any prior puzzle's notes.
 *
 * @param {Record<string, Record<string, string>> | undefined} notes
 */
export function setZoomNotes(notes) {
  zoomNotes = notes ?? null;
}

/**
 * Per-tile rank + population overlay for the active puzzle's RESULT grids,
 * keyed by country code. Set once per puzzle from the page boot flow (only the
 * daily page, only for population superlatives); read by `flagTile` when it
 * renders a result tile with `showMeta`. Module-scope for the same reason as
 * `zoomNotes` — `flagTile` is called deep inside `renderResult` and only ever
 * paints one puzzle's flags at a time. `null` on every other page / puzzle, so
 * tiles render exactly as before.
 *
 * @type {Map<string, { rank: number, pop: number | null }> | null}
 */
let tileMeta = null;

/**
 * Install (or clear, with `null`) the active puzzle's per-tile rank/population
 * overlay. Only the result grids read it, and only when `flagTile` is asked for
 * meta — the in-game found grid never shows it, so rank stays hidden while the
 * player is still guessing.
 *
 * @param {Map<string, { rank: number, pop: number | null }> | null | undefined} meta
 */
export function setTileMeta(meta) {
  tileMeta = meta ?? null;
}

/**
 * The active puzzle's source `Filters`, when it's a filter-kind puzzle — so the
 * criteria strip (`#find-cat`) renders as chips (metric name + icon, colour
 * swatch, exclude strike) instead of a plain dot-joined string. `null` for
 * superlative + manual puzzles, which carry a hand-written title and fall back
 * to plain text. Module-scope for the same reason as `zoomNotes` / `tileMeta`:
 * `renderResult` is module-level and reached from three paths (finish, revisit,
 * langchange) that don't all have the category in hand. `startGame` sets it for
 * the live-play + refresh paths; `daily/page.js` sets it on the revisit path
 * (where `startGame` never runs).
 *
 * @type {import('../flags/flagsFilter.js').Filters | null}
 */
let criteriaFilter = null;

/**
 * Install (or clear, with a null/undefined filter) the active puzzle's criteria
 * filter. Called by `startGame` internally and by `daily/page.js` on revisit.
 *
 * @param {import('../flags/flagsFilter.js').Filters | null | undefined} filter
 */
export function setCriteriaFilter(filter) {
  criteriaFilter = filter ?? null;
}

/**
 * The active puzzle's header lead when there are no filter chips: a superlative's
 * ranking metric icon (`{ metric }`) or a manual flag-design theme's flag glyph
 * (`{ flag: true }`). `null` for filter puzzles (chips) and plain-title manuals.
 * Set alongside `criteriaFilter` on every path that sets it (startGame for live
 * play, `daily/page.js` on revisit), for the same module-scope reason.
 *
 * @type {{ metric?: string, flag?: boolean } | null}
 */
let criteriaLead = null;

/**
 * Install (or clear) the active puzzle's header lead. Called by `startGame` and
 * by `daily/page.js` on revisit, mirroring `setCriteriaFilter`.
 *
 * @param {{ metric?: string, flag?: boolean } | null | undefined} lead
 */
export function setCriteriaLead(lead) {
  criteriaLead = lead ?? null;
}

/**
 * Paint the criteria strip, in priority order: a filter-kind (or manual-with-
 * `criteria`) puzzle renders the icon chips; a superlative leads its title with
 * the ranking metric's icon; a flag-design manual leads with the flag glyph;
 * everything else is the plain hand-written `label`. One place so the finish,
 * revisit, and langchange paints stay identical.
 *
 * @param {HTMLElement} catEl
 * @param {string} label
 */
function paintCriteria(catEl, label) {
  if (criteriaFilter) catEl.replaceChildren(renderCriteriaInline(criteriaFilter, t));
  else if (criteriaLead?.metric) catEl.replaceChildren(renderMetricLeadInline(criteriaLead.metric, label));
  else if (criteriaLead?.flag) catEl.replaceChildren(renderFlagLeadInline(label));
  else catEl.textContent = label;
}

/**
 * Open the flag-zoom dialog for a single country. Wired by `flagTile`
 * for the in-progress + result grids, and reused by `daily/page.js` for
 * the extra-stats rail tiles so a click on any flag — wherever it
 * appears on the result page — opens the same dialog.
 *
 * When the active puzzle carries a note for this country (`setZoomNotes`),
 * a quiet caption line renders under the name explaining the non-obvious
 * match. The note element is hidden when there's no note, so flags
 * without one look exactly as before.
 *
 * @param {Country} c
 */
export function openZoom(c) {
  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = /** @type {HTMLImageElement} */ (zoom.querySelector('img'));
  const zoomName = /** @type {HTMLParagraphElement} */ (zoom.querySelector('p'));
  const zoomNote = /** @type {HTMLElement | null} */ (zoom.querySelector('.zoom-note'));
  zoomImg.src = `${SVG_BASE}${c.code}.svg`;
  const displayName = countryName(c);
  zoomImg.alt = displayName;
  zoomName.textContent = displayName;
  if (zoomNote) {
    const lang = document.documentElement.lang || 'en';
    const noteText = resolveNote(zoomNotes ?? undefined, c.code, lang);
    zoomNote.textContent = noteText;
    zoomNote.hidden = noteText === '';
  }
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
  // Tap the flag to enlarge it in the shared full-viewport lightbox — same
  // affordance flagsdata's zoom popup gives. The dialog is capped at
  // min(80vw, 320px), so the lightbox is a genuine magnification. Wired once
  // here (idempotent per element) rather than per openZoom() call.
  wireFlagLightbox(zoom.querySelector('img'), t);
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });
}

/**
 * Build one tile in either the in-progress "found" list or the result
 * "found/missed" lists. Click opens the zoom dialog.
 *
 * `showMeta` opts the tile into the rank + population overlay (`tileMeta`):
 * a rank badge in the top-left corner and a compact population pill in the
 * top-right, leaving the bottom strip free for the community find-rate
 * (`.find-stats-pct`). Only the result grids pass `true` — the in-game found
 * grid never does, so a correct guess doesn't leak its rank mid-play.
 *
 * @param {Country} c
 * @param {boolean} [showMeta]
 */
function flagTile(c, showMeta = false) {
  const displayName = countryName(c);
  const li = document.createElement('li');
  li.className = 'find-tile';
  li.dataset.name = displayName;
  // dataset.code lets the post-finish stats overlay (statsOverlay.js)
  // look up the community find rate for this tile without rebuilding
  // the whole result page. countryName() is language-dependent and
  // mutates on a soft language switch; the code is stable.
  li.dataset.code = c.code;
  bindTileCountry(li, c);
  li.addEventListener('click', () => openZoom(c));
  const img = document.createElement('img');
  img.src = `${SVG_BASE}${c.code}.svg`;
  img.alt = displayName;
  img.loading = 'lazy';
  li.appendChild(img);
  if (showMeta && tileMeta) {
    const m = tileMeta.get(c.code);
    if (m) {
      const rank = document.createElement('span');
      rank.className = 'find-tile-rank';
      rank.textContent = `#${m.rank}`;
      li.appendChild(rank);
      if (typeof m.pop === 'number') {
        const pop = document.createElement('span');
        pop.className = 'find-tile-pop';
        pop.textContent = formatPopulationShort(m.pop, document.documentElement.lang || 'en');
        li.appendChild(pop);
      }
    }
  }
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
 * Paint the puzzle's helper sentence (and optional second line) for the
 * current page language. i18n has already run by the time the play page
 * fires (the inline `<script type="module">` chains via `.then(bootXxx)`),
 * so `documentElement.lang` is the resolved code. Falls back to English
 * if the requested language is missing — better to show *some* sentence
 * than to leak the absence of a translation. Empty/missing text hides the
 * element.
 *
 * The second line (`additionalDescription`) carries per-puzzle qualifiers
 * like "Sovereign countries only." It is *puzzle data*, not page chrome —
 * "sovereign only" is a property of the specific puzzle (a manual roster
 * of sovereign countries has it too; the World Cup roster, which includes
 * England, does not), so it can't be derived from `kind` or baked into the
 * page. Rendered into a `.daily-note` sibling this function owns: created
 * when the puzzle supplies the line, removed when it doesn't, so a repaint
 * (langchange / revisit) never leaves a stale note from a prior puzzle.
 *
 * @param {Record<string, string> | undefined} description
 * @param {Record<string, string> | undefined} [additionalDescription]
 */
export function paintDescription(description, additionalDescription) {
  const descEl = /** @type {HTMLElement} */ (document.getElementById('daily-desc'));
  const lang = document.documentElement.lang || 'en';
  const text = description?.[lang] ?? description?.en ?? '';
  descEl.textContent = text;
  descEl.hidden = text === '';

  const noteText = additionalDescription?.[lang] ?? additionalDescription?.en ?? '';
  let noteEl = /** @type {HTMLElement | null} */ (document.querySelector('.daily-note'));
  if (noteText === '') {
    if (noteEl) noteEl.remove();
    return;
  }
  if (!noteEl) {
    noteEl = document.createElement('p');
    noteEl.className = 'daily-note';
    descEl.insertAdjacentElement('afterend', noteEl);
  }
  noteEl.textContent = noteText;
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
 * `categoryLabel` is repainted into `#find-cat` so the puzzle title strip
 * (which stays visible above the result via the `.is-finished` class)
 * carries the current language's label. Revisits and soft language
 * switches pass a fresh string each call.
 *
 * @param {Country[]} targets
 * @param {Set<string>} foundCodes
 * @param {string} categoryLabel
 */
export function renderResult(targets, foundCodes, categoryLabel) {
  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const resultEl = /** @type {HTMLElement} */ (document.getElementById('result'));
  const catEl = /** @type {HTMLElement} */ (document.getElementById('find-cat'));

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
  for (const c of foundFlags) foundResultEl.appendChild(flagTile(c, true));
  /** @type {HTMLElement} */ (document.getElementById('found-title')).hidden = foundFlags.length === 0;

  const missed = targets.filter((c) => !foundCodes.has(c.code));
  const missedEl = /** @type {HTMLElement} */ (document.getElementById('find-missed'));
  missedEl.innerHTML = '';
  for (const c of missed) missedEl.appendChild(flagTile(c, true));
  /** @type {HTMLElement} */ (document.getElementById('missed-title')).hidden = missed.length === 0;

  // Keep #game visible so the puzzle title strip (.find-header with the
  // category label + .daily-desc) sits above the result — the player
  // sees what they just solved. Play-only children (input, in-game grid,
  // count, sovereign note, give-up row) hide via the .is-finished class.
  paintCriteria(catEl, categoryLabel);
  gameEl.hidden = false;
  gameEl.classList.add('is-finished');
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
 * `opts.skipSave` controls local persistence. Live daily's normal play
 * path persists the final found/total per puzzle number so the archive
 * can show the player their score. All author-only play (backlog
 * preview, ideas preview) and live-daily replay set `skipSave: true` —
 * those runs must not pollute the player's archive.
 *
 * `opts.onFinish({ foundCodes, totalCount, durationMs })` is an optional
 * post-finish hook called once after `renderResult`. Live daily uses
 * this to submit to the stats API + render the community panel; author
 * pages don't pass it. Hook fires for both real finishes and give-ups.
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
 * `onFirstInteraction` (optional) fires once, on the first focus of
 * the country-search input — the clearest "intent to play" signal we
 * have without a cell-click grid. One-shot via `{ once: true }`, so
 * the listener self-removes after fire; refocusing later in the same
 * round doesn't re-emit. Used by `daily/page.js` to fire the
 * `daily_start` engagement event (Feature M Part B); the author-only
 * sister pages (`daily/ideas/`, `daily/backlog/`) don't pass it, so
 * preview-renders stay event-free.
 *
 * @param {{ skipSave?: boolean, onFinish?: (info: { foundCodes: string[], wrongCodes: string[], totalCount: number, durationMs: number }) => void, onFirstInteraction?: () => void }} [opts]
 * @returns {{ refreshI18n: (next: { all: Country[], targets: Country[], label: string }) => void }}
 */
export function startGame(n, category, targets, all, opts = {}) {
  const skipSave = opts.skipSave === true;
  const onFinish = typeof opts.onFinish === 'function' ? opts.onFinish : null;
  const onFirstInteraction = typeof opts.onFirstInteraction === 'function' ? opts.onFirstInteraction : null;
  const startTime = Date.now();
  // pool is rebuilt on a soft language switch (the suggestion matcher reads
  // each Country's `aliases`, which are baked at withLocalizedAliases time
  // and stale after the language flips). targetCodes is mutated in place
  // so the `state` object below keeps pointing at the same Set instance.
  let pool = findPool(all);
  const targetCodes = new Set(targets.map((c) => c.code));
  const foundCodes = new Set();
  // Captures every real-country guess that isn't in the target set
  // (the `wrong-category` branch of classifyGuess). Dedup'd by Set so
  // typing the same wrong country twice is recorded once. Reported
  // in the onFinish payload for the stats API — not displayed in-game.
  // Future stats UIs ("most-wrong-guessed today", "your distractors")
  // depend on this data being captured per submission from day one.
  const wrongCodes = new Set();
  // Wrong-guess budget. Keyed on country code inside `lives`, so it can
  // never disagree with `wrongCodes` above — both charge once per wrong
  // country, however many times the player retypes it.
  const lives = createLives();
  const state = { targetCodes, foundCodes };

  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const catEl = /** @type {HTMLElement} */ (document.getElementById('find-cat'));
  const countEl = /** @type {HTMLElement} */ (document.getElementById('find-count'));
  const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
  const sugEl = /** @type {HTMLElement} */ (document.getElementById('find-suggestions'));
  const foundEl = /** @type {HTMLElement} */ (document.getElementById('find-found'));
  const giveUpEl = /** @type {HTMLElement} */ (document.getElementById('give-up'));
  const livesEl = /** @type {HTMLElement} */ (document.getElementById('daily-lives'));

  // Filter-kind puzzles render their criteria as chips; a superlative / flag-
  // design manual leads its title with an icon; a plain manual keeps its title.
  // Set here so the live-play + langchange paths (all routed through startGame)
  // are covered; revisit sets both in page.js.
  setCriteriaFilter(category.filter);
  setCriteriaLead(category.lead);
  paintCriteria(catEl, category.label);
  updateCount();
  renderLives();

  /** @type {Country[]} */
  let matches = [];
  let selected = 0;
  let finished = false;

  function updateCount() {
    countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
  }
  /* One heart per life, spent ones hollowed out left-to-right.
   *
   * Built in JS rather than as two CSS `mask-image` data URIs so the
   * filled and outline forms share a single path constant — two copies
   * of a hand-written heart path is exactly the kind of duplicate that
   * drifts the first time someone nudges a curve.
   *
   * Colour comes from `currentColor`, so the stylesheet keeps ownership
   * of the hue (`--secondary-color` on `.daily-life`) and this function
   * only decides fill-vs-stroke. Stroke is 2.8 units in a 24-unit
   * viewBox rendered at 13 px ≈ 1.5 px on screen: a 1 px-equivalent
   * hairline in pink disappears into the page tint at this size, and
   * anything under 1 px would round away entirely on standard-DPI
   * displays.
   *
   * @param {boolean} spent
   * @returns {SVGSVGElement}
   */
  function heartSvg(spent) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 22');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', HEART_PATH);
    if (spent) {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2.8');
      path.setAttribute('stroke-linejoin', 'round');
    } else {
      path.setAttribute('fill', 'currentColor');
    }
    svg.appendChild(path);
    return svg;
  }

  /* One heart per life, spent ones hollowed out left-to-right. Rebuilt
   * wholesale rather than toggling a class on one dot because the row
   * is at most `DAILY_LIVES` nodes and a full repaint keeps the
   * language-switch path (which re-runs the label) trivially correct.
   * On the last life the row pulses rather than turning red: red is
   * `--wrong-color`, which this repo reserves for "that answer was
   * wrong", and a dot meaning "one guess left" is a warning, not a
   * verdict. The exact count stays spelled out in the aria-label. */
  function renderLives() {
    const left = lives.remaining();
    livesEl.setAttribute(
      'aria-label',
      // Label-then-number, not "{n} guesses left": Polish agrees the noun
      // with the count in three different ways (1 / 2-4 / 5+), so a counted
      // noun would be wrong at both ends. This shape is correct at every n
      // in both languages without a plural-rules table.
      t('daily.guessesLeft', 'Wrong guesses left: {n}').replace('{n}', String(left)),
    );
    livesEl.classList.toggle('daily-lives--last', left === 1);
    livesEl.innerHTML = '';
    for (let i = 0; i < lives.max; i += 1) {
      const li = document.createElement('li');
      const spent = i >= left;
      li.className = spent ? 'daily-life daily-life--spent' : 'daily-life';
      li.appendChild(heartSvg(spent));
      livesEl.appendChild(li);
    }
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
    // `showMeta: true` so a correct guess on a population superlative slots in
    // with its rank + population pills right away — the player watches the
    // ranked list fill as they play. `tileMeta` is null on every non-superlative
    // puzzle, so those found tiles stay bare flags (flagTile no-ops the overlay).
    foundEl.insertBefore(flagTile(c, true), foundEl.firstChild);
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
      wrongCodes.add(c.code);
      lives.spend(c.code);
      renderLives();
      flashWrong();
      inputEl.value = '';
      matches = [];
      renderSuggestions();
      // Out of lives ends the round on the same path as Give up: the
      // result panel reveals what was missed and the score submits as
      // it stands. Deliberately no separate "you lost" screen — the
      // score is still `found / total`, and a player who found 9 of 12
      // before running out did not lose, they stopped early.
      if (lives.exhausted()) finish();
      return;
    }
    shakeInput();
  }

  inputEl.addEventListener('input', updateSuggestions);
  if (onFirstInteraction) {
    // First focus on the search input = clearest "intent to play"
    // signal we have on a text-input flow. `{ once: true }` removes
    // the listener after fire so a later refocus mid-round doesn't
    // re-emit. Daily's caller fires `daily_start` from here; the
    // author-only preview pages skip this opt-in.
    inputEl.addEventListener('focus', onFirstInteraction, { once: true });
  }
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
      saveScore(window.localStorage, n, found, total, Array.from(foundCodes), Array.from(wrongCodes));
    }
    const { tier, intensity } = pickCelebration({ found, total });
    runCelebration(tier, { intensity });
    renderResult(targets, foundCodes, category.label);
    if (onFinish) {
      onFinish({
        foundCodes: Array.from(foundCodes),
        wrongCodes: Array.from(wrongCodes),
        totalCount: total,
        durationMs: Date.now() - startTime,
      });
    }
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
      // criteriaFilter is language-independent (Sets of value strings), so it
      // survives a soft language switch untouched — only `next.label` (the
      // plain-text fallback) needs the fresh translation.
      paintCriteria(catEl, next.label);
      refreshTileNames();
      // The lives row is dots — nothing to re-translate visually — but its
      // aria-label spells the count out in words, so it re-renders too.
      renderLives();
      renderSuggestions();
      if (finished) renderResult(targets, foundCodes, next.label);
    },
  };
}
