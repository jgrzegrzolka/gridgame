import { loadCountries } from '../flags/group.js';
import { t, countryName } from '../i18n.js';
import { buildAnswerPool } from './answerPool.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle, manualToCategory, superlativeToCategory } from '../flags/daily.js';
import { warsawToday } from '../flags/warsawTime.js';
import { visiblePuzzles } from '../flags/puzzleFilter.js';
import { loadScores, isCompleteRecord, migrateScores, livesFromRecord } from './scores.js';
import { DAILY_LIVES } from './lives.js';
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
  paintLives,
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
import { pickDifficultyFacts, pickMistakeRail } from './extraStats.js';
import { computeVerdict, formatMultiplier, formatAvg } from './verdict.js';
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
    caption: t('daily.stats.caption', '% shows how many other players found each flag.'),
    loading: t('daily.stats.loading', 'Loading stats'),
  };
}

/** Active page language, for the locale-aware number formatters. */
function lang() {
  return document.documentElement.lang || 'en';
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

/** Threshold for including the streak in the share text. Settled in FEATURE.md:
 * a single completion isn't a "streak", and surfacing "streak: 1" the first
 * time someone finishes is just clutter. (The on-board streak line was removed
 * to declutter the score row; the streak now only rides along in the share.) */
const STREAK_MIN_TO_SHOW = 2;

/**
 * Score-row state (the redesigned result board). `scoreRow` holds the
 * placeholder element refs + this render's found/total + whether it animates,
 * so the async community mean can fill the verdict / average lines in place
 * without restarting the count-up. `communityStats` caches the last stats
 * object so the same fill runs after a repaint. `mistakesOpen` + `communityCtx`
 * back the "show all mistakes" toggle.
 *
 * @type {{ numEl: HTMLElement, verdictEl: HTMLElement, avgEl: HTMLElement, found: number, total: number, animate: boolean } | null}
 */
let scoreRow = null;
/** @type {{ totalAttempts: number, mean: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> } | null} */
let communityStats = null;
let mistakesOpen = false;
/** @type {{ rail: import('./extraStats.js').MistakeRail, all: Country[], userWrongCodes: Set<string> } | null} */
let communityCtx = null;

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
 * Build one flag tile for the "most common mistake" rail. Mirrors the
 * result-grid tile (`.find-tile` + `.find-stats-pct` bottom badge) so the rail
 * renders with identical sizing, borders, hover tooltips and strip as the
 * Znalezione/Pominięte grids above.
 *
 * `markerKind` of `'wrong'` adds the small red top-right corner dot — "you made
 * this mistake too". null skips it. (The old green "found" / red "missed"
 * markers are gone with the deleted ranking rail — the grids already ARE the
 * player's found / missed sets.)
 *
 * @param {{ code: string, pct?: number, count?: number }} item
 * @param {Country | null} country
 * @param {'wrong' | null} markerKind
 */
function buildExtraTile(item, country, markerKind) {
  const li = document.createElement('li');
  li.className = 'find-tile';
  if (markerKind === 'wrong') li.classList.add('is-user-wrong');
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
  badge.textContent = item.pct !== undefined ? `${item.pct}%` : `×${item.count}`;
  li.appendChild(badge);
  return li;
}

/**
 * Paint the community section (below Missed): the two-fact hardest/easiest
 * line and the "most common mistake" rail. Separated from the grids by
 * whitespace only (the 44px margin lives on `.daily-community` in CSS — no
 * hairline). Idempotent: clears the container each call, so a stats refetch or
 * language switch doesn't stack. Hidden entirely (with the caption) when there
 * are no community stats yet.
 *
 * `animate` fades the whole block up on a fresh finish; a revisit is static.
 *
 * @param {{ totalAttempts: number, mean: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> } | null} stats
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {Set<string>} userWrongCodes  the player's own wrong clicks (red "you
 *   too" dot on the mistake rail).
 * @param {{ animate: boolean }} opts
 */
function paintCommunity(stats, targets, all, userWrongCodes, { animate }) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  const captionEl = /** @type {HTMLElement} */ (document.getElementById('daily-caption'));
  container.innerHTML = '';
  container.classList.toggle('anim-fade-up-slow', animate === true);

  const has = stats && stats.totalAttempts > 0;
  container.hidden = !has;
  if (!has) {
    captionEl.hidden = true;
    captionEl.textContent = '';
    return;
  }

  const facts = pickDifficultyFacts({ stats, targetCodes: targets.map((c) => c.code) });
  const factsLine = buildFactsLine(facts, all);
  if (factsLine) container.appendChild(factsLine);

  const rail = pickMistakeRail({ stats });
  communityCtx = { rail, all, userWrongCodes };
  if (rail.collapsed.length > 0) container.appendChild(buildMistakeSection());

  // Hide the community box (and its 44px top margin) when neither the facts
  // line nor a mistake rail rendered — the per-tile %s + caption still stand.
  if (!container.firstChild) container.hidden = true;

  // The caption explains the per-tile %s, which always render.
  captionEl.textContent = statsLabels().caption;
  captionEl.hidden = false;
}

/**
 * The two-fact community line ("najtrudniejsza · [flag] Grenada 0% ·
 * najłatwiejsza · [flag] USA 71%"), or the single all-equal sentence when
 * every flag shares one find-rate.
 *
 * @param {import('./extraStats.js').DifficultyFacts | null} facts
 * @param {Country[]} all
 */
function buildFactsLine(facts, all) {
  if (!facts) return null;
  const wrap = document.createElement('div');
  wrap.className = 'daily-facts';
  if (facts.kind === 'uniform') {
    // Every flag tied on one % — one line naming them all (no fake split).
    wrap.appendChild(buildFact(t('daily.result.allFlags', 'all flags'), facts.all, all));
  } else {
    wrap.appendChild(buildFact(t('daily.result.hardest', 'hardest'), facts.hardest, all));
    wrap.appendChild(buildFact(t('daily.result.easiest', 'easiest'), facts.easiest, all));
  }
  return wrap;
}

/**
 * One difficulty fact: label · a thumbnail for every tied flag · the country
 * name (only when a single flag holds this %) · pct. Thumbnails open the zoom
 * dialog like the grid tiles.
 *
 * @param {string} label
 * @param {import('./extraStats.js').DifficultyFact} fact
 * @param {Country[]} all
 */
function buildFact(label, fact, all) {
  const span = document.createElement('span');
  span.className = 'daily-fact';
  const lab = document.createElement('span');
  lab.className = 'daily-fact-label';
  lab.textContent = label;
  span.appendChild(lab);
  span.appendChild(document.createTextNode(' · '));
  for (const code of fact.codes) {
    const c = findCountry(all, code);
    const img = document.createElement('img');
    img.className = 'daily-fact-flag';
    img.src = `../flags/svg/${code}.svg`;
    img.alt = c ? countryName(c) : code.toUpperCase();
    img.loading = 'lazy';
    if (c) {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => openZoom(c));
    }
    span.appendChild(img);
  }
  // Name the country only when a single flag holds this % (with many tied,
  // the thumbnails speak for themselves and names would overflow the line).
  if (fact.codes.length === 1) {
    const c = findCountry(all, fact.codes[0]);
    const name = document.createElement('span');
    name.className = 'daily-fact-name';
    name.textContent = c ? countryName(c) : fact.codes[0].toUpperCase();
    span.appendChild(name);
  }
  const pct = document.createElement('b');
  pct.className = 'daily-fact-pct';
  pct.textContent = `${fact.pct}%`;
  span.appendChild(pct);
  return span;
}

/**
 * The "most common mistake" rail: heading, the flag grid (collapsed to the
 * shared ≥2 mistakes, or the full list when expanded), and a footer carrying
 * the expand/collapse toggle, the one-off tail count, and the "you too" legend.
 * Reads the module `communityCtx` + `mistakesOpen` so the toggle can rebuild
 * just this section in place.
 */
function buildMistakeSection() {
  const { rail, all, userWrongCodes } = /** @type {NonNullable<typeof communityCtx>} */ (communityCtx);
  const section = document.createElement('div');
  section.className = 'daily-mistakes';

  const h = document.createElement('h2');
  h.className = 'result-section-title';
  h.textContent = t('daily.result.topMistake', "Other players' most common mistake");
  section.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'find-result-found daily-mistake-grid';
  const items = mistakesOpen ? rail.all : rail.collapsed;
  for (const item of items) {
    const marker = userWrongCodes && userWrongCodes.has(item.code) ? 'wrong' : null;
    ul.appendChild(buildExtraTile(item, findCountry(all, item.code), marker));
  }
  section.appendChild(ul);

  const footer = document.createElement('div');
  footer.className = 'daily-mistake-footer';
  if (rail.total > rail.collapsed.length) {
    const toggle = document.createElement('a');
    toggle.href = '#';
    toggle.className = 'daily-mistake-toggle';
    toggle.textContent = mistakesOpen
      ? t('daily.result.showFewer', 'show fewer')
      : t('daily.result.showAll', 'show all mistakes ({n})').replace('{n}', String(rail.total));
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      mistakesOpen = !mistakesOpen;
      const container = document.getElementById('daily-stats');
      const old = container && container.querySelector('.daily-mistakes');
      if (old) old.replaceWith(buildMistakeSection());
    });
    footer.appendChild(toggle);
  }
  const legend = document.createElement('span');
  legend.className = 'daily-mistake-legend';
  const dot = document.createElement('span');
  dot.className = 'daily-mistake-legend-dot';
  legend.appendChild(dot);
  legend.appendChild(document.createTextNode(t('daily.result.mistakeLegend', 'you made this mistake too')));
  footer.appendChild(legend);

  section.appendChild(footer);
  return section;
}

/**
 * Reorder the Missed grid ascending by community find-rate (hardest first) once
 * the stats land. No-op without stats; the tiles carry `data-code`, so this
 * just reads `perCodeFinds` and re-appends in order.
 *
 * @param {{ totalAttempts: number, perCodeFinds: Record<string, number> }} stats
 */
function sortMissedByFindRate(stats) {
  if (!stats || !stats.totalAttempts) return;
  const ul = /** @type {HTMLElement} */ (document.getElementById('find-missed'));
  const rate = (/** @type {Element} */ li) =>
    (stats.perCodeFinds[/** @type {HTMLElement} */ (li).dataset.code] || 0) / stats.totalAttempts;
  const tiles = Array.from(ul.children).sort((a, b) => rate(a) - rate(b));
  for (const li of tiles) ul.appendChild(li);
}

/**
 * Apply a landed stats object to the whole result board: fill the verdict +
 * average, overlay per-tile find-rates (unless every flag ties, where the
 * strips would just repeat one number), sort Missed hardest-first, and paint
 * the community section.
 *
 * @param {{ totalAttempts: number, mean: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> }} stats
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {Set<string>} userWrongCodes
 * @param {boolean} animate
 */
function applyStats(stats, targets, all, userWrongCodes, animate) {
  communityStats = stats;
  updateScoreStats();
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
  applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
  sortMissedByFindRate(stats);
  paintCommunity(stats, targets, all, userWrongCodes, { animate });
}

/**
 * Paint the score-row skeleton (above Found) and start the count-up: the big
 * score number, a verdict / average / streak stack, and the hearts,
 * right-aligned. The community mean and streak arrive async, so the verdict /
 * average / streak lines start hidden and are filled in place by
 * `updateScoreStats` / `updateScoreStreak` — this way the count-up never
 * restarts when stats land.
 *
 * `lives` draws the hearts ({max,left}, or null for uncapped legacy runs).
 * `animate` is true on a fresh finish (count-up + fades) and false on a
 * revisit / language-switch repaint (everything static).
 *
 * @param {number} found
 * @param {number} total
 * @param {{ max: number, left: number } | null} lives
 * @param {{ animate: boolean }} opts
 */
function paintScoreRow(found, total, lives, { animate }) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-personal-stats'));
  container.hidden = false;
  container.innerHTML = '';

  const scoreEl = document.createElement('span');
  scoreEl.className = 'daily-score';
  const numEl = document.createElement('span');
  numEl.className = 'daily-score-num';
  // Reserve the final digit width so a 9 → 10 count-up step never nudges the
  // /total that follows.
  numEl.style.minWidth = `${String(found).length}ch`;
  const totalEl = document.createElement('span');
  totalEl.className = 'daily-score-total';
  totalEl.textContent = `/${total}`;
  scoreEl.append(numEl, totalEl);
  // Touch-only share icon rides at the end of the score number.
  const shareBtn = createShareButton();
  if (shareBtn) scoreEl.appendChild(shareBtn);

  const stack = document.createElement('span');
  stack.className = 'daily-score-stack';
  const verdictEl = document.createElement('span');
  verdictEl.className = 'daily-verdict';
  verdictEl.hidden = true;
  const avgEl = document.createElement('span');
  avgEl.className = 'daily-avg';
  avgEl.hidden = true;
  // The streak line ("Seria: N") was removed from the result board to keep the
  // score row uncluttered — the streak still travels in the share text.
  stack.append(verdictEl, avgEl);

  // Hearts reuse the shared `.daily-lives` row (filled = left, hollow = spent,
  // last-life pulse) — the in-game row is hidden via CSS once finished.
  const heartsEl = document.createElement('ul');
  heartsEl.className = 'daily-lives daily-score-hearts';
  if (lives) paintLives(heartsEl, lives.max, lives.left);

  container.append(scoreEl, stack, heartsEl);

  scoreRow = { numEl, verdictEl, avgEl, found, total, animate };
  runCountUp(numEl, found, animate);
  // Reflect any data that resolved before this (re)paint.
  updateScoreStats();
}

/**
 * Fresh-finish entrance flourish the CSS can't express alone: a staggered
 * tile-drop across the found grid (per-tile delay) and a fade-up on the
 * Pominięte block. Applied only on a real finish — never a revisit — and
 * skipped whole under reduced-motion. The verdict / community fades and the
 * count-up are handled where their data lands.
 */
function runFinishFlourish() {
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  document.querySelectorAll('#find-result-found .find-tile').forEach((li, i) => {
    /** @type {HTMLElement} */ (li).style.animation =
      `tile-drop 0.45s cubic-bezier(0.2, 0.8, 0.3, 1.1) ${200 + i * 45}ms both`;
  });
  for (const id of ['missed-title', 'find-missed']) {
    const el = document.getElementById(id);
    if (el) el.style.animation = 'fade-up 0.5s ease 0.9s both';
  }
}

/**
 * Count a number element up from 0 to `target`. The DOM shows `0` before the
 * timer starts (never a flash of the final value), and the count is gated
 * behind prefers-reduced-motion + `animate` — a revisit or a reduced-motion
 * visitor jumps straight to the value.
 *
 * @param {HTMLElement} el
 * @param {number} target
 * @param {boolean} animate
 */
function runCountUp(el, target, animate) {
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce || target <= 0) {
    el.textContent = String(target);
    return;
  }
  el.textContent = '0';
  // Start after the entrance slide settles (~450ms), then ~60ms per step.
  setTimeout(() => {
    let s = 0;
    const timer = setInterval(() => {
      s += 1;
      el.textContent = String(Math.min(s, target));
      if (s >= target) clearInterval(timer);
    }, 60);
  }, 450);
}

/**
 * Fill the verdict + average lines from the cached community stats. No stats
 * (not loaded / fetch failed) → both stay hidden and the board shows only the
 * score. Below-average → the verdict simply doesn't render (the muted average
 * carries the fact; the board never scolds).
 */
function updateScoreStats() {
  if (!scoreRow) return;
  const { verdictEl, avgEl, found, animate } = scoreRow;
  const stats = communityStats;
  if (!stats || !stats.totalAttempts) {
    verdictEl.hidden = true;
    avgEl.hidden = true;
    return;
  }
  const l = lang();
  avgEl.textContent = t('daily.result.avg', "players' average {avg}")
    .replace('{avg}', formatAvg(stats.mean, l));
  avgEl.hidden = false;
  const v = computeVerdict(found, stats.mean);
  if (v) {
    verdictEl.textContent = verdictText(v, l);
    verdictEl.style.color = v.kind === 'level' ? 'var(--muted-color)' : 'var(--correct-color)';
    verdictEl.hidden = false;
    if (animate) {
      verdictEl.classList.remove('anim-fade-up');
      void verdictEl.offsetWidth;
      verdictEl.classList.add('anim-fade-up');
    }
  } else {
    verdictEl.hidden = true;
  }
}

/**
 * @param {{ kind: 'multiplier', k: number } | { kind: 'above' } | { kind: 'level' }} v
 * @param {string} l
 */
function verdictText(v, l) {
  if (v.kind === 'multiplier') {
    return t('daily.result.verdictMultiplier', '▲ {k}× above average')
      .replace('{k}', formatMultiplier(v.k, l));
  }
  if (v.kind === 'above') return t('daily.result.verdictAbove', '▲ above average');
  return t('daily.result.verdictLevel', 'on par with the average');
}

/**
 * Fetch stats for puzzle N and apply them across the result board (verdict,
 * average, per-tile %s, Missed sort, community section). The score row must
 * already be painted (by the caller) so the player sees their own number while
 * the network is in flight.
 *
 * `bypassCache: true` on the post-finish path so the just-submitted result
 * reflects immediately; revisits use the cached path. `animate` fades the
 * verdict + community in on a fresh finish.
 *
 * @param {number} n
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {Set<string>} userWrongCodes
 * @param {{ bypassCache?: boolean, animate?: boolean }} [opts]
 */
async function loadAndPaintStats(n, targets, all, userWrongCodes, opts = {}) {
  const stats = await fetchStats(n, { bypassCache: opts.bypassCache === true });
  if (!stats) {
    // Fetch failed — the score row still shows the player's own number; the
    // community section stays hidden.
    communityStats = null;
    updateScoreStats();
    paintCommunity(null, targets, all, userWrongCodes, { animate: false });
    return;
  }
  applyStats(stats, targets, all, userWrongCodes, opts.animate === true);
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
  // The streak line was removed from the board; this only refreshes the value
  // the share text carries.
  streakState = streak;
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
      // Score row + hearts render immediately (the count-up starts); the
      // community section fades in once stats land. Hearts from the run's
      // spent budget (DAILY_LIVES minus this run's wrong countries).
      const lives = { max: DAILY_LIVES, left: Math.max(0, DAILY_LIVES - info.wrongCodes.length) };
      paintScoreRow(found, info.totalCount, lives, { animate: true });
      runFinishFlourish();
    },
    onCleared: () => {
      communityStats = null;
      updateScoreStats();
      paintCommunity(null, targets, all, new Set(info.wrongCodes), { animate: false });
    },
    onStats: (stats) => {
      applyStats(stats, targets, all, new Set(info.wrongCodes), true);
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
    // Keep the streak value fresh for the share text (the on-board streak line
    // was removed to declutter the score row).
    streakState = fresh;
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
  // TEMP DIAGNOSTIC (replay-shows-result investigation): proves THIS page.js
  // ran (vs a stale cached copy). If the result appears on a replay but this
  // marker is absent from the console, the browser served an old page.js.
  console.warn('[daily-diag] bootDaily build=fix-2026-07-30b', location.search);
  wireZoom();
  mountDevReset();

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
      // TEMP DIAGNOSTIC (replay-shows-result investigation).
      console.warn('[daily-diag] revisit-gate', { isReplay, hasRecord: isCompleteRecord(stored), search: location.search });
      if (!isReplay && isCompleteRecord(stored)) {
        const foundCodes = new Set(stored.c);
        // The player's own wrong clicks, persisted alongside the found codes
        // (absent on perfect play or pre-`w` records → the "Most common
        // mistake" row simply stays unmarked). Powers the self-mistake dot.
        const wrongCodes = new Set(stored.w || []);
        const revisitDeviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());
        // Wait on the (best-effort) metric fetch so a revisit paints the rank +
        // population overlay on the first render rather than a beat later.
        await popReady;
        renderResult(result.targets, foundCodes, category.label);
        setShareCtx(n, result.targets, foundCodes);
        // Hearts moved into the score row (the in-game row is hidden once
        // finished). `startGame` never runs on this path, so the budget comes
        // from the saved record; uncapped legacy runs return null → no hearts,
        // rather than inventing a constraint the player never faced. Static
        // (animate:false) — the finish celebration already happened.
        const revisitLives = livesFromRecord(stored);
        paintScoreRow(foundCodes.size, result.targets.length, revisitLives, { animate: false });
        // Community stats are gated on Cosmos, not this device's localStorage:
        // always GET and let the response decide (totalAttempts === 0 →
        // paintCommunity hides the section). Puzzles finished on another device
        // — or before submit-tracking shipped — still show stats if the server
        // has them.
        loadAndPaintStats(n, result.targets, all, wrongCodes);
        // Streak fires alongside stats. Cached (no bypass) — revisits don't
        // chase a fresh submit past the 60s cache. Today-only.
        if (isToday) {
          loadAndPaintStreak(revisitDeviceId, foundCodes.size, result.targets.length);
        }
        // Re-paint on a soft language switch so found/missed tile hover labels,
        // the score row, and the community section re-translate without a
        // reload. Static (animate:false) — no re-run of the finish choreography.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description, result.entry.additionalDescription);
          renderResult(result.targets, foundCodes, labelFor());
          setShareCtx(n, result.targets, foundCodes);
          paintScoreRow(foundCodes.size, result.targets.length, livesFromRecord(stored), { animate: false });
          loadAndPaintStats(n, result.targets, all, wrongCodes);
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
