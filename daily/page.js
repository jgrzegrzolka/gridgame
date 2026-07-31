import { loadCountries } from '../flags/group.js';
import { t, countryName } from '../i18n.js';
import { buildAnswerPool } from './answerPool.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle, manualToCategory, superlativeToCategory } from '../flags/daily.js';
import { warsawToday } from '../flags/warsawTime.js';
import { visiblePuzzles } from '../flags/puzzleFilter.js';
import { loadScores, isCompleteRecord, migrateScores } from './scores.js';
import { loadProgress } from './progress.js';
import { filterToCategory } from '../flags/findFlag.js';
import {
  buildPopulationRankNotes,
  buildMetricRankNotes,
  buildSuperlativeTileMeta,
  metricFileFor,
} from '../flags/superlativeRank.js';
import { buildContinentNotes, mergeNotes, continentScopeOf } from '../flags/continentNotes.js';
import {
  wireZoom,
  openZoom,
  showState,
  paintDescription,
  renderResult,
  startGame,
  attachLangRefresh,
  showReason,
  setZoomNotes,
  setTileMeta,
  setCriteriaFilter,
  setCriteriaLead,
} from './playFlow.js';
import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { trySyncDevices, resolveIdentityAndHydrate } from '../flags/syncHydrate.js';
import { submitResult } from './statsSubmit.js';
import { fetchStats } from './statsClient.js';
import { applyFindRatesToTiles } from './statsOverlay.js';
import { ensureTurnstile, getTurnstileToken } from './turnstileClient.js';
import { runFinishFlow } from './finishFlow.js';
import { PROD_SITE_KEY } from './turnstileSiteKey.js';
import { mountDevReset } from './devReset.js';
import { pickMistakes, splitMistakeRail, MISTAKE_COLLAPSE_CAP } from './extraStats.js';
import { pickCallout } from './callout.js';
import { shareText } from '../common.js';
import { buildShareText } from '../flags/shareGrid.js';
import { fetchDailyMe } from './streakClient.js';
import { diffNewlyEarnedAchievements } from '../flags/achievements.js';
import { celebrate } from '../flags/achievementCelebrate.js';
import { primeAchievementsBaseline, refreshAchievementsAndDiff, getCachedAchievementsBaseline } from '../flags/achievementsBaseline.js';
import { bumpShare, pushEngagementBlob } from '../flags/engagementCounters.js';
import { ensureProfile } from '../flags/autoProfile.js';
import { fetchCatalog } from './catalogSource.js';

// Turnstile is soft-disabled across all environments (2026-06-10) after
// a real user's challenge was rejected by Cloudflare with a 401 on
// `/cdn-cgi/challenge-platform/h/g/pat/…` — her submission was silently
// dropped (by Phase B4 design) and the abuse defence Turnstile provides
// was judged not worth blocking legitimate plays in a tiny hobby app.
// Existing protections still in force: rate limit (5/min/IP), server-side
// validation, and one-submission-per-(puzzle, deviceId) via the Cosmos
// id. The SDK + widget + verifyTurnstile code is kept as scaffolding so
// flipping back is a one-line change here + setting TURNSTILE_SECRET to
// a real value in SWA. Server side: TURNSTILE_SECRET is set to "" in SWA
// so the existing skip-when-unset branch in dailyResult.js logs a warning
// and accepts every token.
const TURNSTILE_SITE_KEY = PROD_SITE_KEY;
const SKIP_TURNSTILE = true;

/** @typedef {import('../flags/group.js').Country} Country */

/**
 * Localized labels for the community-stats UI. Resolved at the call
 * site (not at module-load) so a soft language switch picks up fresh
 * strings the next time it renders.
 */
function statsLabels() {
  return {
    average: t('daily.stats.average', 'average: {average}'),
    playerCount: t('daily.stats.playerCount', '{count} players'),
    playersTooltip: t('daily.stats.playersTooltip', "How many players solved today's puzzle"),
    loading: t('daily.stats.loading', 'Loading stats'),
    mistakeTitle: t('daily.mistake.title', "Other players' most common mistake"),
    mistakeShowAll: t('daily.mistake.showAll', 'show all mistakes ({n})'),
    mistakeShowLess: t('daily.mistake.showLess', 'show less'),
    mistakeLegend: t('daily.mistake.legend', 'you made this mistake too'),
    streakLine: t('daily.streak.line', 'streak: {n}'),
    calloutEasiest: t('daily.callout.easiest', 'easiest'),
    calloutEasiestPlural: t('daily.callout.easiestPlural', 'easiest:'),
    calloutHardest: t('daily.callout.hardest', 'hardest'),
    calloutHardestPlural: t('daily.callout.hardestPlural', 'hardest:'),
  };
}

/**
 * Format the community mean for the score header. The number carries
 * one decimal place (server rounds it there) and the separator follows
 * the active locale — Polish shows `6,6`, English `6.6`. Whole means
 * collapse to an integer (`3`, not `3,0`).
 *
 * @param {number} mean
 */
function formatMean(mean) {
  const lang = document.documentElement.lang || 'en';
  return mean.toLocaleString(lang, { maximumFractionDigits: 1 });
}

/**
 * Module-scope streak state. Set when the GET /api/v1/daily/me response
 * lands (post-finish or revisit). Read by `paintStatsPanel` so the
 * streak sub-line follows the same rebuild-on-each-paint pattern as
 * the share button: no static HTML to survive `container.innerHTML = ''`,
 * and a soft language switch re-renders with the active locale's label.
 * `null` means "not loaded yet or failed"; the gate (currentStreak >= 2)
 * hides the line in any case where it would render as noise.
 *
 * @type {{ currentStreak: number } | null}
 */
let streakState = null;

/**
 * Whether the result now on screen is a *fresh finish* (play just ended)
 * vs a revisit / language re-paint. Only a fresh finish plays the
 * count-up and the fade-ins; a revisit renders the final state at once.
 * Set true in `handleFinish`, false on the revisit branch.
 */
let freshFinish = false;

/** Whether the result on screen is today's puzzle. The streak (`seria`)
 * segment shows on today's puzzle only — an archive revisit's streak
 * would falsely read as if that replay bumped the counter. Set alongside
 * `freshFinish` on both the finish and revisit paths. */
let resultIsToday = false;

/** Has the score count-up been kicked off this page load? Guards against
 * the repaints (average, streak, pill) restarting it. */
let countUpStarted = false;
/** The currently-shown score number — animated 0 → found on a fresh
 * finish, or the final value directly on a revisit. */
let scoreCurrent = 0;

/** True during the finish cascade window (~2.6s). While set, the score
 * header's average / streak / share get their staggered delay-fade
 * classes on each (re)paint, so they cascade in — score → średnia →
 * seria → share — even as stats/streak land and rebuild the block. Once
 * it clears, a later repaint (e.g. tapping the average) renders static,
 * so the cascade doesn't replay. */
let cascadeActive = false;
/** Timestamp (ms) of the finish, so each header piece can be scheduled to
 * fade in `targetMs` after the finish regardless of when its data lands. */
let cascadeStart = 0;
/** One-shot guard for the community section fade (it renders once when
 * stats land, so a simple once-flag is enough). */
let communityFadedIn = false;

/** Threshold for showing the finish-screen streak line. Settled in
 * FEATURE.md: a single completion isn't a "streak", and surfacing
 * "Day streak: 1" the first time someone finishes is just clutter. */
const STREAK_MIN_TO_SHOW = 2;

/** True when the viewer has asked the OS to reduce motion — the count-up
 * jumps straight to the final value (CSS handles the fade/drop animations
 * via its own media query). */
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The player's own score, held module-scope so any of the async data
 * sources that feed the header (community average, streak) can repaint
 * the whole score block once they land without threading found/total
 * back through their own call chains. `null` until the first paint.
 *
 * @type {{ found: number, total: number } | null}
 */
let scoreState = null;

/**
 * Last community stats in view (with `mean` + `totalAttempts`), or null
 * when none exist yet / the fetch failed. Read by `paintScoreBlock` to
 * render the inline `średnia: N` fact and the "N graczy" pill. Set by
 * `paintCommunityStats`, which then repaints the score block.
 *
 * @type {{ totalAttempts: number, mean: number } | null}
 */
let communityStats = null;

/** Whether the tap-to-reveal "N graczy" pill above `średnia` is open.
 * Module-scope because `paintScoreBlock` rebuilds the block from
 * scratch on every repaint — the open state has to outlive the DOM. */
let playersPillOpen = false;

/** Whether the mistake rail is expanded (showing every mistake, incl.
 * the one-off single-player clicks) vs collapsed to the repeated ones.
 * Reset to collapsed each time the rail is freshly rendered. */
let mistakesExpanded = false;

/**
 * Enough to repaint just the mistake rail on a toggle without re-running
 * the whole community render. Set by `renderExtraStats`.
 *
 * @type {{ mistakes: Array<{ code: string, count: number }>, all: Country[], userWrongCodes?: Set<string> } | null}
 */
let mistakeRailState = null;

/**
 * Look up a country by 2-letter code in the loaded list. Used by the
 * extra-stats rail to resolve the flag's localized name for the hover
 * tooltip. Returns null when the code isn't in our dataset (defensive
 * — should never fire in practice, since both targets and any wrong
 * guess come from the same list).
 *
 * @param {Country[]} all
 * @param {string} code
 */
function findCountry(all, code) {
  return all.find((c) => c.code === code) || null;
}

/**
 * Build one flag tile for the mistake rail. Mirrors the result-page
 * tile structure (`.find-tile` + `.find-stats-pct` bottom badge) so the
 * rail renders with identical sizing, borders, hover tooltips and
 * percentage strip as the Znalezione/Pominięte grids above.
 *
 * `isMine` adds a small red top-right corner dot when the player clicked
 * this distractor themselves ("I made this mistake too").
 *
 * @param {{ code: string, count: number }} item
 * @param {Country | null} country
 * @param {boolean} isMine
 */
function buildExtraTile(item, country, isMine) {
  const li = document.createElement('li');
  li.className = 'find-tile';
  if (isMine) li.classList.add('is-user-wrong');
  li.dataset.code = item.code;
  li.dataset.name = country ? countryName(country) : item.code.toUpperCase();
  if (country) li.addEventListener('click', () => openZoom(country));
  const img = document.createElement('img');
  img.src = `../flags/svg/${item.code}.svg`;
  img.alt = li.dataset.name;
  img.loading = 'lazy';
  li.appendChild(img);
  const badge = document.createElement('span');
  badge.className = 'find-stats-pct';
  badge.textContent = `×${item.count}`;
  li.appendChild(badge);
  return li;
}

/**
 * Render the whole community section — the callout line describing the
 * round's spread, then the "most common mistake" rail. Both derive from
 * the same community `stats`, so keeping them in one call keeps them in
 * sync across the finish / revisit / language-switch repaints.
 *
 * @param {{ totalAttempts: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> } | null} stats
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {Set<string>} [userWrongCodes]
 */
function renderCommunity(stats, targets, all, userWrongCodes) {
  renderCallout(pickCallout({ stats, targetCodes: targets.map((c) => c.code) }), all);
  renderExtraStats(stats, all, userWrongCodes);
  // On a fresh finish the community section fades in once as it lands.
  if (freshFinish && !communityFadedIn) {
    communityFadedIn = true;
    for (const id of ['daily-callout', 'daily-extra-stats']) {
      const el = /** @type {HTMLElement} */ (document.getElementById(id));
      if (el && !el.hidden) el.classList.add('daily-fade-in');
    }
  }
}

/**
 * Render the callout line into `#daily-callout`: `najłatwiejsza · USA
 * 71% · najtrudniejsza · Grenada 0%`. Idempotent — clears + hides first,
 * so a repaint never stacks. Layout per `callout.kind`:
 *
 *   - 'none'     → nothing (no community data).
 *   - 'allEqual' → one fact: `najłatwiejsze:` + every flag + shared %.
 *   - 'spread'   → easiest fact then hardest fact; a single-code end
 *                  names the country, a tied end renders the flag row.
 *
 * @param {import('./callout.js').Callout} callout
 * @param {Country[]} all
 */
function renderCallout(callout, all) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-callout'));
  container.innerHTML = '';
  container.hidden = true;
  if (!callout || callout.kind === 'none') return;

  const labels = statsLabels();
  if (callout.kind === 'allEqual') {
    container.appendChild(buildCalloutFact(true, callout.codes, callout.pct, all, labels));
  } else {
    container.appendChild(buildCalloutFact(true, callout.easiest.codes, callout.easiest.pct, all, labels));
    container.appendChild(buildCalloutFact(false, callout.hardest.codes, callout.hardest.pct, all, labels));
  }
  container.hidden = false;
}

/**
 * Build one end of the callout. A single code renders `[flag] label ·
 * Name pct`; two or more render `label: [flag flag …] pct` (plural
 * label, no name). The % is ink-bold; everything else is muted.
 *
 * @param {boolean} easiest
 * @param {string[]} codes
 * @param {number} pct
 * @param {Country[]} all
 * @param {ReturnType<typeof statsLabels>} labels
 */
function buildCalloutFact(easiest, codes, pct, all, labels) {
  const fact = document.createElement('span');
  fact.className = 'daily-callout-fact';
  const pctEl = document.createElement('b');
  pctEl.className = 'daily-callout-pct';
  pctEl.textContent = `${pct}%`;

  if (codes.length === 1) {
    const country = findCountry(all, codes[0]);
    const name = country ? countryName(country) : codes[0].toUpperCase();
    fact.appendChild(buildCalloutFlag(codes[0], country));
    const label = document.createElement('span');
    label.className = 'daily-callout-label';
    label.textContent = `${easiest ? labels.calloutEasiest : labels.calloutHardest} · ${name}`;
    fact.appendChild(label);
    fact.appendChild(pctEl);
  } else {
    const label = document.createElement('span');
    label.className = 'daily-callout-label';
    label.textContent = easiest ? labels.calloutEasiestPlural : labels.calloutHardestPlural;
    fact.appendChild(label);
    const row = document.createElement('span');
    row.className = 'daily-callout-flags';
    for (const code of codes) row.appendChild(buildCalloutFlag(code, findCountry(all, code)));
    fact.appendChild(row);
    fact.appendChild(pctEl);
  }
  return fact;
}

/**
 * A single callout flag thumbnail (26×20, 24×18 on mobile via CSS).
 *
 * @param {string} code
 * @param {Country | null} country
 */
function buildCalloutFlag(code, country) {
  const img = document.createElement('img');
  img.className = 'daily-callout-flag';
  img.src = `../flags/svg/${code}.svg`;
  img.alt = country ? countryName(country) : code.toUpperCase();
  img.loading = 'lazy';
  return img;
}

/**
 * Mount the "Najczęstszy błąd innych graczy" rail under the community
 * callout. Collapsed by default: it shows only the *repeated* mistakes
 * (clicked by ≥ 2 players), capped at `MISTAKE_COLLAPSE_CAP`, so a
 * one-off click by a single player never reads as "a common mistake".
 * A "pokaż wszystkie pomyłki (N)" toggle reveals the full list.
 *
 * The whole rail is skipped when there are no repeated mistakes (no
 * submissions yet, all one-offs, or a legacy cached response without
 * perWrongCode) — better nothing than a heading over an empty grid.
 *
 * @param {{ totalAttempts: number, perWrongCode?: Record<string, number> } | null} stats
 * @param {Country[]} all
 * @param {Set<string>} [userWrongCodes] the player's own wrong clicks, so the
 *   rail can mark the distractors they clicked too.
 */
function renderExtraStats(stats, all, userWrongCodes) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-extra-stats'));
  container.innerHTML = '';
  container.hidden = true;
  mistakesExpanded = false; // fresh render always starts collapsed
  mistakeRailState = null;

  if (!stats) return;
  const mistakes = pickMistakes({ stats });
  if (splitMistakeRail(mistakes, false).repeatedCount === 0) return;

  mistakeRailState = { mistakes, all, userWrongCodes };
  paintMistakeRail();
  container.hidden = false;
}

/**
 * (Re)paint the mistake rail from `mistakeRailState` + `mistakesExpanded`
 * — heading, the tile grid, then a controls row (the expand/collapse
 * toggle, the singles tail when collapsed, and the red-dot legend when
 * any visible tile is the player's own mistake). Called on first render
 * and again on every toggle, so only the rail redraws.
 */
function paintMistakeRail() {
  if (!mistakeRailState) return;
  const { mistakes, all, userWrongCodes } = mistakeRailState;
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-extra-stats'));
  container.innerHTML = '';
  const labels = statsLabels();
  const split = splitMistakeRail(mistakes, mistakesExpanded);

  const title = document.createElement('h2');
  title.className = 'result-section-title';
  title.textContent = labels.mistakeTitle;
  container.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'find-result-found';
  let anyMine = false;
  for (const item of split.tiles) {
    const isMine = userWrongCodes ? userWrongCodes.has(item.code) : false;
    anyMine = anyMine || isMine;
    ul.appendChild(buildExtraTile(item, findCountry(all, item.code), isMine));
  }
  container.appendChild(ul);

  // Controls: a toggle exists whenever there's more than the collapsed
  // set (extra repeated beyond the cap, or any one-off singles).
  const collapsedShown = Math.min(split.repeatedCount, MISTAKE_COLLAPSE_CAP);
  const canExpand = split.totalCount > collapsedShown;
  if (canExpand || anyMine) {
    const controls = document.createElement('div');
    controls.className = 'daily-mistake-controls';
    if (canExpand) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'daily-mistake-toggle';
      toggle.textContent = mistakesExpanded
        ? labels.mistakeShowLess
        : labels.mistakeShowAll.replace('{n}', String(split.totalCount));
      toggle.addEventListener('click', () => {
        mistakesExpanded = !mistakesExpanded;
        paintMistakeRail();
      });
      controls.appendChild(toggle);
    }
    if (anyMine) {
      const legend = document.createElement('span');
      legend.className = 'daily-mistake-legend';
      const dot = document.createElement('span');
      dot.className = 'daily-mistake-legend-dot';
      legend.appendChild(dot);
      legend.appendChild(document.createTextNode(labels.mistakeLegend));
      controls.appendChild(legend);
    }
    container.appendChild(controls);
  }
}

/**
 * Paint the **score block** at the top of the result (above Found): a
 * single line — the player's score `14/22`, then the muted facts
 * `· średnia: 6,6 · seria: 51`. The average is tappable and reveals a
 * dark "N graczy" pill; the streak segment shows on today's puzzle only
 * (`currentStreak ≥ 2`). On touch devices the share button rides along
 * (Step 6 restyles / positions it). Always renders the instant a result
 * is in view — the score needs no network — and repaints whenever any
 * feeding state lands (community average, streak, language switch).
 *
 * Reads the module-scope `communityStats` / `streakState`; stores the
 * score in `scoreState` so those async sources can repaint the block
 * without threading found/total back through their own call chains.
 *
 * @param {number} found
 * @param {number} total
 */
function paintScoreBlock(found, total) {
  scoreState = { found, total };
  // On a fresh finish the number counts up (kicked off once); a revisit
  // shows the final value at once.
  if (!freshFinish) {
    scoreCurrent = found;
  } else if (!countUpStarted) {
    countUpStarted = true;
    startCountUp(found);
  }

  const container = /** @type {HTMLElement} */ (document.getElementById('daily-personal-stats'));
  container.hidden = false;

  // Fresh finish, block already mounted → update IN PLACE. A later-landing
  // streak (or stats) then only appends its own fact; it never rebuilds and
  // re-flashes what has already faded in (the "średnia disappears and comes
  // back" bug). Full rebuild is for the initial mount and the static
  // revisit / language-switch paths.
  if (freshFinish && container.querySelector('.daily-score-block')) {
    syncScoreNum();
    syncScoreFacts();
    return;
  }

  container.innerHTML = '';
  const block = document.createElement('div');
  block.className = 'daily-score-block';
  const line = document.createElement('div');
  line.className = 'daily-score-line';

  // Score: big value (the count-up's current tick) + muted /total. The
  // value sits in an inline-block sized to the total's digit width so the
  // count-up ticking 9 → 10 never nudges the /total beside it.
  const value = document.createElement('div');
  value.className = 'daily-score-value';
  const num = document.createElement('span');
  num.className = 'daily-score-num';
  num.style.minWidth = `${String(total).length}ch`;
  num.textContent = String(scoreCurrent);
  value.appendChild(num);
  const totalEl = document.createElement('span');
  totalEl.className = 'daily-score-total';
  totalEl.textContent = `/${total}`;
  value.appendChild(totalEl);
  line.appendChild(value);

  // Empty facts container; `syncScoreFacts` fills in the average / streak
  // as they land (below, and on later async paints).
  const facts = document.createElement('div');
  facts.className = 'daily-score-facts';
  line.appendChild(facts);
  block.appendChild(line);

  // Share button (touch-only). Sits as the block's second child so the
  // space-between layout right-aligns it beside the score on mobile;
  // desktop renders no button at all. On a fresh finish it fades in LAST
  // in the header cascade (score → średnia → seria → share).
  const shareBtn = createShareButton();
  if (shareBtn) {
    cascadeFade(shareBtn, 1500);
    block.appendChild(shareBtn);
  }

  container.appendChild(block);
  syncScoreFacts();
}

/** Reflect the current count-up value onto the number element, if present. */
function syncScoreNum() {
  const numEl = document.querySelector('.daily-score-num');
  if (numEl) numEl.textContent = String(scoreCurrent);
}

/**
 * Ensure the average + streak facts are present, appending whichever has
 * landed and isn't shown yet — without touching what's already there. On a
 * fresh finish each fades in on the header cascade's clock (średnia 1.1s,
 * seria 1.3s after the finish).
 */
function syncScoreFacts() {
  const facts = /** @type {HTMLElement} */ (document.querySelector('.daily-score-facts'));
  if (!facts) return;
  const labels = statsLabels();
  if (communityStats && communityStats.totalAttempts > 0 && !facts.querySelector('.daily-score-avg-wrap')) {
    const avg = buildAverageFact(labels, communityStats);
    cascadeFade(avg, 1100);
    facts.appendChild(avg);
  }
  if (resultIsToday && streakState && streakState.currentStreak >= STREAK_MIN_TO_SHOW
      && !facts.querySelector('.daily-score-streak')) {
    const streak = buildStreakFact(labels, streakState.currentStreak);
    cascadeFade(streak, 1300);
    // Separator space — `.daily-score-streak` is inline-block, which strips
    // its own leading whitespace, so without this the streak butts straight
    // against the average ("6,6· seria").
    if (facts.querySelector('.daily-score-avg-wrap')) facts.appendChild(document.createTextNode(' '));
    facts.appendChild(streak);
  }
}

/**
 * Fade `el` in on the finish cascade's clock: it becomes visible `targetMs`
 * after the finish, whenever the element was actually created (average /
 * streak / share arrive on their own async cadence, so the delay is
 * computed from the elapsed time, not baked into a class). Outside the
 * cascade window — a revisit, or a late tap — it renders static.
 * Reduced-motion is handled in CSS.
 *
 * @param {HTMLElement} el
 * @param {number} targetMs
 */
function cascadeFade(el, targetMs) {
  if (!cascadeActive) return;
  const elapsed = Date.now() - cascadeStart;
  el.style.animationDelay = `${Math.max(0, targetMs - elapsed)}ms`;
  el.classList.add('daily-fade-in');
}

/**
 * Build the `· średnia: N` fact — a tappable label that toggles a dark
 * "N graczy" pill floated above it. The pill's open state lives in the
 * module-scope `playersPillOpen` (the block rebuilds on every repaint,
 * so the DOM can't hold it); a document-level dismiss listener wired in
 * `bootDaily` closes it on an outside click.
 *
 * @param {ReturnType<typeof statsLabels>} labels
 * @param {{ totalAttempts: number, mean: number }} stats
 */
function buildAverageFact(labels, stats) {
  const wrap = document.createElement('span');
  wrap.className = 'daily-score-avg-wrap';
  const avg = document.createElement('span');
  avg.className = 'daily-score-avg';
  avg.dataset.playersToggle = '1';
  avg.setAttribute('role', 'button');
  avg.setAttribute('tabindex', '0');
  avg.title = labels.playersTooltip;
  avg.textContent = `· ${labels.average.replace('{average}', formatMean(stats.mean))}`;
  const toggle = () => { playersPillOpen = !playersPillOpen; syncPlayersPill(); };
  avg.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
  avg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  wrap.appendChild(avg);
  if (playersPillOpen) syncPlayersPill(wrap);
  return wrap;
}

/**
 * Add or remove the "N graczy" pill on the average, in place (no block
 * rebuild), from `playersPillOpen`. Optionally scoped to a given wrap when
 * called during the initial build.
 *
 * @param {HTMLElement} [wrap]
 */
function syncPlayersPill(wrap) {
  const w = wrap || /** @type {HTMLElement | null} */ (document.querySelector('.daily-score-avg-wrap'));
  if (!w) return;
  const existing = w.querySelector('.daily-players-pill');
  if (playersPillOpen && !existing && communityStats) {
    const pill = document.createElement('span');
    pill.className = 'daily-players-pill';
    pill.textContent = statsLabels().playerCount.replace('{count}', String(communityStats.totalAttempts));
    w.appendChild(pill);
  } else if (!playersPillOpen && existing) {
    existing.remove();
  }
}

/**
 * Build the `· seria: N` fact. Plain muted text; the caller adds the
 * one-shot fade-in on a fresh finish (no shake — the locked design fades
 * it in like the average).
 *
 * @param {ReturnType<typeof statsLabels>} labels
 * @param {number} currentStreak
 */
function buildStreakFact(labels, currentStreak) {
  const streakSpan = document.createElement('span');
  streakSpan.className = 'daily-score-streak';
  streakSpan.textContent = ` · ${labels.streakLine.replace('{n}', String(currentStreak))}`;
  return streakSpan;
}

/**
 * Kick off the score count-up 0 → target. The DOM already shows 0 before
 * this fires (paintScoreBlock reads `scoreCurrent`), so the final value
 * never flashes. Reduced-motion jumps straight to the target.
 *
 * @param {number} target
 */
function startCountUp(target) {
  if (prefersReducedMotion()) {
    scoreCurrent = target;
    return;
  }
  scoreCurrent = 0;
  // Start after the entrance slide settles, then tick ~60ms/step. Update
  // ONLY the number element (re-found each tick, since an async repaint —
  // average / streak landing — can replace it). A full repaintScoreBlock
  // here would rebuild the average / streak / share on every tick and
  // restart their fade-ins mid-flight.
  setTimeout(() => {
    const iv = setInterval(() => {
      scoreCurrent = Math.min(scoreCurrent + 1, target);
      const numEl = document.querySelector('.daily-score-num');
      if (numEl) numEl.textContent = String(scoreCurrent);
      if (scoreCurrent >= target) clearInterval(iv);
    }, 60);
  }, 450);
}

/** Repaint the score block from module-scope state, if it's on screen. */
function repaintScoreBlock() {
  if (scoreState) paintScoreBlock(scoreState.found, scoreState.total);
}

/**
 * Close the "N graczy" pill on any click outside the `średnia` toggle.
 * Wired once from `bootDaily`. Capture phase so it sees the click before
 * the toggle's own handler; a click *on* the toggle is ignored here and
 * left to that handler to flip the state.
 */
function wirePlayersPillDismiss() {
  document.addEventListener('click', (e) => {
    if (!playersPillOpen) return;
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target && target.closest && target.closest('[data-players-toggle]')) return;
    playersPillOpen = false;
    syncPlayersPill();
  }, true);
}

/**
 * Record the community stats and surface the average in the score block.
 * The average used to render its own line below Missed; it now lives
 * inline in the top score block, so this stores `communityStats` and
 * repaints the block. The bottom `#daily-stats` slot carries only the
 * transient "Loading stats…" indicator now (once stats land the average
 * has moved up and the slot is empty).
 *
 * @param {{ totalAttempts: number, mean: number, perCodeFinds: Record<string, number> } | null} stats
 * @param {number} total unused — kept so callers don't have to change;
 *   the total comes from `scoreState` now.
 * @param {{ loading?: boolean }} [opts]
 */
function paintCommunityStats(stats, total, opts = {}) {
  const labels = statsLabels();
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  container.innerHTML = '';

  const hasAverage = stats && stats.totalAttempts > 0;
  communityStats = hasAverage ? stats : null;
  if (!hasAverage) playersPillOpen = false; // no average → no pill to keep open
  if (scoreState) repaintScoreBlock();

  if (opts.loading === true) {
    // Three pulsing dots after the label — CSS animates them in a wave
    // so the player can tell something is happening across the long
    // mobile path (Turnstile execute → POST → stats GET).
    container.hidden = false;
    const l = document.createElement('p');
    l.className = 'daily-stats-loading';
    l.textContent = labels.loading;
    const dots = document.createElement('span');
    dots.className = 'loading-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    l.appendChild(dots);
    container.appendChild(l);
  } else {
    container.hidden = true;
  }
}

/**
 * Fetch stats for puzzle N and repaint the panel with the community
 * average + apply per-tile overlays. The score-only paint must
 * already have happened (by the caller, before await'ing here) so
 * the player sees their own number while the network is in flight.
 *
 * `bypassCache: true` is used by the post-finish path so the player
 * sees their just-submitted result reflected immediately; revisits
 * use the default (cached) path.
 *
 * @param {number} n
 * @param {Country[]} targets
 * @param {number} found
 * @param {Country[]} all
 * @param {Set<string>} userWrongCodes
 * @param {{ bypassCache?: boolean }} [opts]
 */
async function loadAndPaintStats(n, targets, found, all, userWrongCodes, opts = {}) {
  const stats = await fetchStats(n, { bypassCache: opts.bypassCache === true });
  if (!stats) {
    // Fetch failed — hide the community slot (the personal slot at
    // top still shows the score). Clears any loading dots the caller
    // painted while we were in flight.
    paintCommunityStats(null, targets.length);
    return;
  }
  paintCommunityStats(stats, targets.length);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
  renderCommunity(stats, targets, all, userWrongCodes);
}

/**
 * Fetch this device's streak / win-% numbers and repaint the panel so
 * the streak sub-line lands without waiting on a follow-up event.
 * Failures resolve to null and leave streakState untouched — the
 * existing panel keeps showing without a streak line, no error UI.
 *
 * `bypassCache: true` on the post-finish path so the just-submitted
 * result lands in the streak immediately (the endpoint's 60s cache
 * would otherwise hide it until the next minute).
 *
 * @param {string} deviceId
 * @param {number} found
 * @param {number} totalCount
 * @param {{ bypassCache?: boolean }} [opts]
 */
async function loadAndPaintStreak(deviceId, found, totalCount, opts = {}) {
  const streak = await fetchDailyMe(deviceId, {
    bypassCache: opts.bypassCache === true,
  });
  if (!streak) return;
  streakState = streak;
  // Repaint just the personal slot — streak lives there and the
  // community slot is independent (its state was already painted by
  // loadAndPaintStats / handleFinish.onStats).
  paintScoreBlock(found, totalCount);
}

/**
 * Module-scope share context. Set whenever a fresh result is in view
 * (natural finish, revisit, post-langchange re-paint). Read by the
 * share button's onclick, which is created inside paintStatsPanel so
 * it lives inline at the end of `.daily-stats-headline`
 * ("Your score: 2/4 · Average score: 3.4/4 [share]"). Storing in a
 * module ref keeps paintStatsPanel from threading wire-data through
 * every caller — the headline gets rebuilt on each panel paint
 * (loading → score-only → score-with-stats), so a static button-
 * in-HTML wouldn't survive `container.innerHTML = ''`.
 *
 * @type {{ n: number, answerCodes: string[], foundCodes: string[] } | null}
 */
let shareCtx = null;

/**
 * @param {number} n
 * @param {Country[]} targets
 * @param {string[] | Set<string>} foundCodes
 */
function setShareCtx(n, targets, foundCodes) {
  const foundArr = Array.isArray(foundCodes) ? foundCodes : Array.from(foundCodes);
  shareCtx = { n, answerCodes: targets.map((c) => c.code), foundCodes: foundArr };
}

/**
 * Build the inline share button that sits at the end of the daily
 * stats headline. Click → builds the Wordle-style text via
 * `buildShareText` and pushes it through `shareText` (mobile share
 * sheet → clipboard → legacy textarea fallback). On `copied`, flash
 * `.copied` on the button for 1.5 s (CSS handles the icon swap).
 *
 * Touch-only: matches TTT (`ticTacToe/page.js:76`) and findFlag's
 * `#game-share` / `#result-share` reveals. On desktop the OS share
 * sheet is heavy (Windows Share dialog with contacts; macOS share
 * menu) and clipboard-only feedback is too quiet to be discoverable
 * — both wrong for the surface, so we just don't render the icon
 * there. One rule across the whole site: share-icons are touch-only.
 *
 * Reads from the module-level `shareCtx` and `streakState` so the
 * panel-paint code doesn't need to know any of the puzzle details.
 *
 * @returns {HTMLButtonElement | null}
 */
function createShareButton() {
  if (!shareCtx) return null;
  const isTouchDevice = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if (!isTouchDevice) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'share-link';
  btn.id = 'result-share';
  btn.setAttribute('aria-label', t('daily.share.aria', 'Share result'));
  const icon = document.createElement('span');
  icon.className = 'share-icon';
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);
  btn.onclick = async () => {
    if (!shareCtx) return;
    const { n, answerCodes, foundCodes } = shareCtx;
    const titleLine = t('daily.share.title', 'Yet Another Quiz: Daily Flag Puzzle #{n}, {score}/{total}')
      .replace('{n}', String(n))
      .replace('{score}', String(foundCodes.length))
      .replace('{total}', String(answerCodes.length));
    // Streak only included when the on-screen streak line is also
    // showing (≥ STREAK_MIN_TO_SHOW). Single threshold across panel +
    // share keeps "what gets celebrated" consistent.
    const showStreakInShare = streakState && streakState.currentStreak >= STREAK_MIN_TO_SHOW;
    const streakLine = showStreakInShare
      ? t('daily.share.streakLine', '🔥 {n}-day streak')
        .replace('{n}', String(streakState.currentStreak))
      : undefined;
    // Always include the puzzle number in the share URL — `/daily/`
    // alone always serves *today's* puzzle, so a recipient clicking
    // a share for a past-day puzzle would land on the wrong one.
    // Including `?n=${n}` makes the recipient see the exact puzzle
    // the sharer played, whether it's today's or from the archive.
    const text = buildShareText({
      titleLine,
      answerCodes,
      foundCodes,
      url: `${window.location.origin}/daily/?n=${n}`,
      streakLine,
    });
    const r = await shareText(text);
    if (r === 'copied') {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    }
    // Engagement event: log only when the share actually resolved to
    // a system action. 'shared' = OS share sheet completed; 'copied' =
    // landed on the clipboard. 'dismissed' / 'failed' = no share
    // occurred, no event. Fire-and-forget — failure here mustn't
    // block the UI.
    if (r === 'shared' || r === 'copied') {
      const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
      void ensureProfile(deviceId);
      // Feature S Phase 3: local counter + syncBlob push replaces the
      // engagementEvents POST. Achievement diff still runs against
      // the server snapshot during the Phase 3 → Phase 4 window;
      // Phase 4 will rewire it to read from localStorage.
      bumpShare(window.localStorage, 'daily');
      void pushEngagementBlob(deviceId, window.localStorage);
      void refreshAchievementsAndDiff(deviceId).then((newly) => {
        if (newly.length > 0) void celebrate(newly);
      });
    }
  };
  return btn;
}

/**
 * Post-finish hook: thin DOM/network wrapper around the testable
 * `runFinishFlow` orchestrator. Wires the loading spinner, score-only
 * fallback, and stats-with-overlays paint callbacks; everything else
 * (Turnstile + submit + fetch + failure handling) lives in finishFlow.js
 * where it can be unit-tested with fake deps.
 *
 * @param {number} n
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {{ foundCodes: string[], wrongCodes: string[], totalCount: number, durationMs: number }} info
 * @param {boolean} isToday — true when `n` is the live daily puzzle.
 *   Streak only renders for today's puzzle: archive finishes don't
 *   extend the streak counter, so surfacing "Seria dni: 2" on an
 *   archive replay would falsely suggest the replay just bumped it.
 */
async function handleFinish(n, targets, all, info, isToday) {
  // A natural finish plays the count-up + fade-in choreography; the
  // score block, community section, and (renderResult's) grids all read
  // this flag. Revisits leave it false and render the final state.
  freshFinish = true;
  resultIsToday = isToday;
  // Open the cascade window: the header pieces fade in staggered as they
  // arrive; close it after the cascade completes so a later interaction
  // (tapping the average) repaints statically instead of replaying it.
  cascadeActive = true;
  cascadeStart = Date.now();
  setTimeout(() => { cascadeActive = false; }, 2600);
  setShareCtx(n, targets, info.foundCodes);
  const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
  const deviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());
  const found = info.foundCodes.length;

  // On localhost we skip the CF Turnstile SDK entirely — see
  // turnstileSiteKey.js for the rationale. Server-side accepts an
  // empty token when TURNSTILE_SECRET is unset (local.settings.json
  // default), so the no-op functions round-trip cleanly.
  const ensureTurnstileFn = SKIP_TURNSTILE
    ? () => Promise.resolve()
    : () => ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY });
  const getTurnstileTokenFn = SKIP_TURNSTILE
    ? () => Promise.resolve('')
    : getTurnstileToken;

  await runFinishFlow({
    n,
    found,
    totalCount: info.totalCount,
    foundCodes: info.foundCodes,
    wrongCodes: info.wrongCodes,
    durationMs: info.durationMs,
    deviceId,
    store: window.localStorage,
    ensureTurnstile: ensureTurnstileFn,
    getTurnstileToken: getTurnstileTokenFn,
    submitResult,
    fetchStats,
    onLoading: () => {
      paintScoreBlock(found, info.totalCount);
      paintCommunityStats(null, info.totalCount, { loading: true });
    },
    onCleared: () => paintCommunityStats(null, info.totalCount),
    onStats: (stats) => {
      paintCommunityStats(stats, targets.length);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
      renderCommunity(stats, targets, all, new Set(info.wrongCodes));
    },
  });

  // Achievement diff goes through the shared baseline helper so the
  // post-finish state stays in sync with the post-share / post-coffee-
  // click state — three earn-moments on the same page session would
  // otherwise drift apart and double-fire cards. The helper handles
  // the bypassCache fetch internally. Runs for every daily finish —
  // archive plays legitimately earn achievements too (an archive
  // completion bumps totalCompleted server-side just like a today-
  // finish does), so the unlock card should pop there as well.
  const newlyEarned = await refreshAchievementsAndDiff(deviceId);
  const fresh = getCachedAchievementsBaseline();
  if (fresh) {
    streakState = fresh;
    // Only repaint the streak sub-line when this is today's puzzle —
    // surfacing it on an archive finish would falsely suggest the play
    // extended the streak counter.
    if (isToday) paintScoreBlock(found, info.totalCount);
  }
  if (newlyEarned.length > 0) void celebrate(newlyEarned);
}

/**
 * Live `/daily/` boot. Loads today's puzzle (or `?n=N` from the URL),
 * checks for a complete saved record (revisit → jump to result), and
 * otherwise hands off to the shared play flow.
 *
 * Author-only modes (backlog preview, ideas preview) used to live here
 * as `?backlog=N` / `?idea=K` branches. They've moved to their own pages
 * under `daily/backlog/` and `daily/ideas/`, each calling into the same
 * `playFlow.startGame`. Keeping this file player-only means a bug in
 * either author tool can't crash live daily.
 */
export async function bootDaily() {
  wireZoom();
  mountDevReset();
  wirePlayersPillDismiss();

  // Feature W: resolve identity durably before anything reads local caches —
  // restoring the original deviceId + rebuilding `daily.scores` from Cosmos if
  // localStorage was evicted. Fast path (local id present) = no network.
  const bootDeviceId = await resolveIdentityAndHydrate({
    store: window.localStorage, randomUUID: () => window.crypto.randomUUID(),
  });

  // Migrations run after any hydrate so credited-answer fixups apply to
  // hydrated rows too, not just ones this browser already had.
  migrateScores(window.localStorage);
  // Background sync for linked devices only. Unlinked users pay
  // zero (a single localStorage read returns null and the helper
  // exits). Linked users refresh local cache from the server at
  // most once per hour — enough to keep "today already played?"
  // and the archive grid honest after the other linked device
  // submitted something elsewhere.
  //
  // We hold the promise so the revisit branch below can await it
  // before deciding play-vs-revisit. Without that, a linked device
  // that hasn't pulled the other device's row yet would fall through
  // to the play flow and ask the user to re-play (issue #543).
  const bgHydrate = trySyncDevices({
    deviceId: bootDeviceId,
    store: window.localStorage,
    identityKey: IDENTITY_STORAGE_KEY,
  });
  void bgHydrate;
  // Pre-fetch the achievement baseline via the shared helper. common.js's
  // wireBurgerDismiss primes too, but doing it again here is idempotent
  // and avoids racing the burger-wiring call. Mirror into the local
  // streakState once it settles so streak rendering has data before the
  // first finish — without this, a player who hasn't interacted yet
  // wouldn't see their streak count.
  primeAchievementsBaseline(bootDeviceId);
  void fetchDailyMe(bootDeviceId).then((s) => { if (s) streakState = s; });

  const numEl = /** @type {HTMLElement} */ (document.getElementById('daily-n'));
  const isReplay = isReplayFromUrl(window.location.search);

  return Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    fetchCatalog('puzzles'),
  ])
    .then(async ([raw, /** @type {import('../flags/daily.js').DailyPuzzle[]} */ allEntries]) => {
      // Pool the daily game searches + renders against: the sovereign base
      // plus the exact non-sovereign codes catalog entries reference
      // (England, territories). See buildAnswerPool.
      const all = buildAnswerPool(raw, allEntries);

      // Filter future-dated entries out client-side. Anyone curling the
      // blob can still see them; the server rejects submissions for
      // future puzzleIds, so the worst the page can do is let an
      // author preview tomorrow without recording a score.
      const catalog = visiblePuzzles(allEntries, warsawToday());
      const today = todayN(catalog);
      const n = dailyNFromUrl(window.location.search, today);
      // Streak only renders for today's puzzle. Archive finishes /
      // revisits don't extend the streak counter — surfacing the
      // sub-line there would falsely suggest the archive play just
      // bumped it. Computed once at boot, threaded into the revisit
      // branch and handleFinish.
      const isToday = n === today;
      numEl.textContent = `${n}`;
      // Tab title carries #N so archived puzzles open in separate tabs
      // read distinctly. Override runs after bootI18n's data-i18n pass.
      document.title = `Yet Another Quiz #${n}`;
      // Burger menu's "Today's puzzle" link is hard-coded with
      // aria-current="page" in daily/index.html — correct for the
      // bare /daily/ landing, but on an archive view (?n=N) the user
      // is NOT on today's puzzle, so the link should be live again.
      // Strip the attribute when we know we're elsewhere.
      if (!isToday) {
        const todayLink = document.querySelector('#burger-panel a[data-i18n="daily.todaysPuzzle"]');
        if (todayLink) todayLink.removeAttribute('aria-current');
      }

      // Point the static "Play again" link at this same puzzle with the
      // replay flag set, so clicking it re-runs the game without
      // touching the archive score. Pinning N in the href (rather than
      // relying on "today") keeps the link stable if the catalog rolls
      // over while the result page is open.
      const playAgainLink = document.getElementById('play-again');
      if (playAgainLink) playAgainLink.setAttribute('href', `./?n=${n}&replay=1`);

      const result = resolveDailyPuzzle(catalog, all, n);
      if (result.ok === false) {
        showReason(result.reason);
        return;
      }

      paintDescription(result.entry.description, result.entry.additionalDescription);
      // Install this puzzle's per-answer "why" notes for the zoom dialog.
      // Runs above both the revisit and play branches so a tap on any
      // result tile (or extra-stats rail tile) surfaces the explanation
      // wherever the flag appears. Notes are language-agnostic at install
      // time (they carry every language); openZoom localizes on open, so
      // a soft language switch needs no re-install.
      //
      // On a continent-scoped puzzle, fold in the straddler classification
      // notes (Georgia in "Europe + cross" is a five-cross flag a player
      // clicks, misses because we classify it Asia, then meets in the "Most
      // missed" rail). `buildContinentNotes` returns {} off continent scope.
      setZoomNotes(mergeNotes(result.entry.notes, buildContinentNotes(result.entry)));
      setTileMeta(null);

      // Superlatives: one metric fetch feeds two enrichments of the result
      // screen —
      //   1. zoom captions across the WHOLE sovereign pool (figure + world
      //      rank), so even the "Most missed" distractor tiles say "#15 in the
      //      world", not just a bare name (vs. baked `entry.notes`, which only
      //      cover the frozen answers);
      //   2. a per-tile overlay (in-puzzle rank badge + value pill) on the
      //      Found / Missed grids.
      // `metricFileFor` resolves ANY superlative's metric against the shared
      // registry — this used to read `metric === 'population'`, which is why
      // #51 ("the 10 largest countries by area") shipped with no rank numbers.
      // Best-effort: `popReady` gates only the revisit path's immediate render
      // so the badges are present first paint. The play path finishes long
      // after this resolves, so it never blocks on the fetch. On failure the
      // baked zoom notes stand and the tiles render without the overlay.
      let popReady = Promise.resolve();
      const metricFile = metricFileFor(result.entry);
      if (metricFile) {
        popReady = fetch(`../flags/metrics/${metricFile}`)
          .then((r) => r.json())
          .then((d) => {
            const values = d.values ?? {};
            // On a continent-scoped superlative ("largest countries of Europe")
            // the rank notes also carry each in-continent country's rank within
            // that continent ("· #8 in Europe"), after the world rank. Null for
            // a world-scoped superlative, so nothing extra is appended.
            const contScope = continentScopeOf(result.entry);
            // Metric figure first, then the continent note where both apply
            // (e.g. Russia in "most populous Asia" shows its world rank AND why
            // it isn't on the list). Off continent scope the second map is {}.
            // Population phrases its own captions ("129.7 million"); every other
            // metric prefixes the puzzle's baked note (or a formatted figure for
            // an unbaked distractor) and appends the same rank.
            const notes =
              result.entry.metric === 'population'
                ? buildPopulationRankNotes(all, values, contScope)
                : buildMetricRankNotes(all, values, d, result.entry.notes, contScope);
            setZoomNotes(mergeNotes(notes, buildContinentNotes(result.entry)));
            setTileMeta(buildSuperlativeTileMeta(result.entry, values, d));
          })
          .catch(() => {});
      }

      // Filter entries derive the category label from the parsed
      // Filters object (re-translated on every langchange so pill
      // labels follow the active language). Manual entries skip that
      // pipeline — there's no filter — and pull the label from the
      // hand-written `entry.title` map keyed by language.
      //
      // Hoisted above the revisit branch so the revisit path also has
      // a category label to repaint into the puzzle title strip above
      // the result — startGame doesn't run on revisit, and renderResult
      // now needs the label to set `#find-cat`.
      // Kind-aware category: manual + superlative render their hand-written
      // `title` (a superlative's `filter` only narrowed its ranking pool, so
      // it isn't the criteria); filter entries render the pill chain.
      const catFor = () => {
        const lang = document.documentElement.lang || 'en';
        if (result.entry.kind === 'manual') return manualToCategory(result.entry, lang);
        if (result.entry.kind === 'superlative') return superlativeToCategory(result.entry, lang);
        return filterToCategory(/** @type {import('../flags/flagsFilter.js').Filters} */ (result.filter), t);
      };
      const labelFor = () => catFor().label;
      const category = catFor();
      // Filter-kind puzzles carry a `.filter` so the criteria strip renders as
      // chips; a superlative / flag-design manual carries a `.lead` so the strip
      // leads with an icon. Set both here so the revisit path (which paints the
      // result via renderResult without ever calling startGame) has them too.
      // startGame sets them again for the live-play path — same values, harmless.
      setCriteriaFilter(category.filter);
      setCriteriaLead(category.lead);

      // Revisit: if this puzzle has a full saved record, jump straight
      // to the result page without confetti (the player saw confetti
      // the first time around; replaying it on every revisit would be
      // obnoxious). Replay mode skips this shortcut — the whole point
      // of ?replay=1 is to actually replay.
      //
      // For linked devices without a local record, wait on the
      // background hydrate first — the other device may have submitted
      // this puzzle and we'd otherwise drop into the play flow instead
      // of revisit (issue #543). If the background hydrate was gated
      // 'fresh' (already ran within the hour) we force a fresh GET,
      // since the row we need may have landed on the server inside that
      // window. Unlinked users return 'unlinked' instantly — no cost.
      let stored = loadScores(window.localStorage)[n];
      if (!isReplay && !isCompleteRecord(stored)) {
        const bg = await bgHydrate;
        if (bg.ran === false && bg.reason === 'fresh') {
          await trySyncDevices({
            deviceId: bootDeviceId,
            store: window.localStorage,
            identityKey: IDENTITY_STORAGE_KEY,
            force: true,
          });
        }
        stored = loadScores(window.localStorage)[n];
      }
      if (!isReplay && isCompleteRecord(stored)) {
        const foundCodes = new Set(stored.c);
        // The player's own wrong clicks, persisted alongside the found codes
        // (absent on perfect play or pre-`w` records → the "Most common
        // mistake" row simply stays unmarked). Powers the self-mistake dot.
        const wrongCodes = new Set(stored.w || []);
        const revisitDeviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());
        // Revisit renders the final state — no count-up, no fades (motion
        // is for the finish moment). renderResult without `animate` leaves
        // the panel class-free.
        freshFinish = false;
        resultIsToday = isToday;
        // Wait on the (best-effort) metric fetch so a revisit paints the rank +
        // population overlay on the first render rather than a beat later.
        await popReady;
        renderResult(result.targets, foundCodes, category.label);
        // Hearts are a play-time instrument (budget left) — the result
        // screen never shows them (Part 4). No paintLives here; the
        // `#game.is-finished .daily-lives` rule keeps the row hidden.
        setShareCtx(n, result.targets, foundCodes);
        paintScoreBlock(foundCodes.size, result.targets.length);
        paintCommunityStats(null, result.targets.length, { loading: true });
        // Community stats are gated on Cosmos, not this device's
        // localStorage: always GET, and let the response decide
        // (totalAttempts === 0 → paintCommunityStats hides the
        // section). This way puzzles you finished on a different
        // device — or before submit-tracking shipped — still show
        // stats if the server has them.
        loadAndPaintStats(n, result.targets, foundCodes.size, all, wrongCodes);
        // Streak fires alongside stats. Cached (no bypass) — revisits
        // don't have a fresh submit to chase past the 60s cache window.
        // Today-only: archive revisits don't show the streak.
        if (isToday) {
          loadAndPaintStreak(revisitDeviceId, foundCodes.size, result.targets.length);
        }
        // Re-paint on a soft language switch so found/missed tile hover
        // labels + the description re-translate without a page reload.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description, result.entry.additionalDescription);
          renderResult(result.targets, foundCodes, labelFor());
          setShareCtx(n, result.targets, foundCodes);
          paintScoreBlock(foundCodes.size, result.targets.length);
          paintCommunityStats(null, result.targets.length, { loading: true });
          loadAndPaintStats(n, result.targets, foundCodes.size, all, wrongCodes);
          if (isToday) {
            loadAndPaintStreak(revisitDeviceId, foundCodes.size, result.targets.length);
          }
        });
        return;
      }

      // Pre-warm Turnstile during gameplay so the slow first-time
      // script download + iframe render is paid while the player is
      // already busy guessing flags, not while they're staring at the
      // result screen wondering why their stats haven't appeared. On
      // mobile cold path this shaves 1-3s off the post-finish wait;
      // ensureTurnstile() is idempotent so the call inside handleFinish
      // still works (it short-circuits to Promise.resolve()).
      // Skipped on localhost — see SKIP_TURNSTILE above.
      if (!SKIP_TURNSTILE) {
        const widgetContainer = /** @type {HTMLElement} */ (document.getElementById('turnstile-widget'));
        ensureTurnstile({ container: widgetContainer, siteKey: TURNSTILE_SITE_KEY })
          .catch(() => { /* preload failure is silent — handleFinish retries */ });
      }
      // Replays treated identically to first finishes: local archive
      // overwrites with the latest attempt, and we re-POST to the
      // server. The server enforces first-attempt-only via 409 on
      // duplicate (puzzleId, deviceId); the client just hands the
      // result over and treats 204 / 409 as equivalent. This makes
      // replays self-healing when the first POST failed (Turnstile
      // glitch, network drop, etc) — the player can replay and
      // finally get their result counted.
      const game = startGame(n, category, result.targets, all, {
        // Reaching startGame with `!isReplay` means no complete record
        // exists for this puzzle (the revisit branch above would have
        // caught it), so this is a scored first attempt and must survive
        // a reload — otherwise refreshing refunds the wrong-guess budget
        // and the cap becomes opt-in. Explicit replays stay resettable:
        // they're unscored practice.
        persistProgress: !isReplay,
        resume: isReplay ? null : loadProgress(window.localStorage, n),
        onFinish: (info) => handleFinish(n, result.targets, all, info, isToday),
        // First focus on the search input fires `daily_start` — the
        // "intent to play" signal for Feature M Part B analytics.
        // Server-side `id` is deterministic per (dayId, puzzleId) so
        // refresh + click within the same Warsaw day for the same
        // puzzle dedupes via the 409 path. Captures archive replays
        // too (engagement counts regardless of which puzzle).
        onFirstInteraction: () => {
          // First-interaction signal: only ensureProfile remains (the
          // engagement-event analytic was dropped in Feature S Phase 3 —
          // no achievement consumed daily_start). Keeping the trigger
          // alive so the auto-profile row still gets created on first
          // play even if the user never finishes the puzzle.
          const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
          void ensureProfile(deviceId);
        },
      });
      attachLangRefresh(game, {
        raw,
        targets: result.targets,
        labelFor,
        description: result.entry.description,
        additionalDescription: result.entry.additionalDescription,
      });
    })
    .catch((err) => {
      // Fetch / parse errors freeze the message in the page's language
      // at error time. Re-translation on `langchanged` would require
      // localising the error.message half too — out of scope for the
      // soft-reload work, and this is a rare path anyway.
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });
}
