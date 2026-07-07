import { loadCountries, flagsGamePool } from '../flags/group.js';
import { t, withLocalizedAliases, countryName } from '../i18n.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle, manualToCategory } from '../flags/daily.js';
import { warsawToday } from '../flags/warsawTime.js';
import { visiblePuzzles } from '../flags/puzzleFilter.js';
import { loadScores, isCompleteRecord, migrateScores } from './scores.js';
import { filterToCategory } from '../flags/findFlag.js';
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
} from './playFlow.js';
import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { trySyncDevices } from '../flags/syncHydrate.js';
import { submitResult } from './statsSubmit.js';
import { fetchStats } from './statsClient.js';
import { applyFindRatesToTiles } from './statsOverlay.js';
import { ensureTurnstile, getTurnstileToken } from './turnstileClient.js';
import { runFinishFlow } from './finishFlow.js';
import { PROD_SITE_KEY } from './turnstileSiteKey.js';
import { mountDevReset } from './devReset.js';
import { pickExtraStats, hasAnyExtraStats, pickMarkerKind } from './extraStats.js';
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
    scoreOnly: t('daily.stats.scoreOnly', 'Your score: {found}/{total}'),
    averageOnly: t('daily.stats.averageOnly', 'Average score: {average}/{total}'),
    caption: t('daily.stats.caption', '% shows how many other players found each flag.'),
    loading: t('daily.stats.loading', 'Loading stats'),
    extraRanking: t('daily.stats.extra.ranking', 'Most recognised:'),
    extraTopMistake: t('daily.stats.extra.topMistake', 'Most common mistake:'),
    streakLine: t('daily.streak.line', 'Streak: {n}'),
  };
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

/** Has the entry animation played for the streak yet this page load?
 * The shake + pink-to-primary colour flash should fire exactly once —
 * subsequent repaints (stats arriving after streak, language switch,
 * revisit re-paints) all reuse the same final-state styling. */
let streakAnimated = false;


/** Threshold for showing the finish-screen streak line. Settled in
 * FEATURE.md: a single completion isn't a "streak", and surfacing
 * "Day streak: 1" the first time someone finishes is just clutter. */
const STREAK_MIN_TO_SHOW = 2;

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
 * Build one flag tile for the extra-stats rail. Mirrors the result-page
 * tile structure (`.find-tile` + `.find-stats-pct` bottom badge) so the
 * three rail sections render with identical sizing, borders, hover
 * tooltips and percentage strip as the Znalezione/Pominięte grids above.
 *
 * `markerKind` adds a small top-right corner dot — green when the player
 * found this flag, red when they missed it. null skips the dot.
 *
 * @param {{ code: string, pct?: number, count?: number }} item
 * @param {Country | null} country
 * @param {'found' | 'missed' | null} markerKind
 */
function buildExtraTile(item, country, markerKind) {
  const li = document.createElement('li');
  li.className = 'find-tile';
  if (markerKind === 'found') li.classList.add('is-user-found');
  else if (markerKind === 'missed') li.classList.add('is-user-missed');
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
 * Mount the "Mostly guessed / Most missed / Most common mistake" rail
 * under the Znalezione/Pominięte sections, matching their h2 + grid
 * visual pattern. Idempotent — clears the container first so a stats
 * refetch (post-finish, language switch) doesn't stack rows.
 *
 * Each row only renders when its picks list is non-empty; the whole
 * rail is skipped when all three are empty (no submissions yet, or a
 * legacy cached response without perWrongCode).
 *
 * @param {{ totalAttempts: number, perCodeFinds: Record<string, number>, perWrongCode?: Record<string, number> } | null} stats
 * @param {Country[]} targets
 * @param {Country[]} all
 * @param {Set<string>} userFoundCodes
 */
function renderExtraStats(stats, targets, all, userFoundCodes) {
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-extra-stats'));
  container.innerHTML = '';
  container.hidden = true;

  if (!stats) return;
  const targetCodes = new Set(targets.map((c) => c.code));
  const picks = pickExtraStats({ stats, targetCodes: targets.map((c) => c.code) });
  if (!hasAnyExtraStats(picks)) return;

  const labels = statsLabels();
  appendExtraRow(container, labels.extraRanking, picks.ranking, all, targetCodes, userFoundCodes);
  appendExtraRow(container, labels.extraTopMistake, picks.topMistake, all, targetCodes, userFoundCodes);

  container.hidden = false;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {Array<{ code: string, pct?: number, count?: number }>} items
 * @param {Country[]} all
 * @param {Set<string>} targetCodes
 * @param {Set<string>} userFoundCodes
 */
function appendExtraRow(parent, label, items, all, targetCodes, userFoundCodes) {
  if (items.length === 0) return;
  const title = document.createElement('h2');
  title.className = 'result-section-title';
  title.textContent = label;
  parent.appendChild(title);
  const ul = document.createElement('ul');
  ul.className = 'find-result-found';
  for (const item of items) {
    const marker = pickMarkerKind({ code: item.code, targetCodes, userFoundCodes });
    ul.appendChild(buildExtraTile(item, findCountry(all, item.code), marker));
  }
  parent.appendChild(ul);
}

/**
 * Paint the **personal stats** slot (above Found): the player's score,
 * an optional streak segment when `currentStreak ≥ 2`, and an inline
 * share button on touch devices. Always renders the moment a result is
 * in view — no network fetch needed, so the score is visible instantly.
 *
 * Repainted on every change to module-scope state (streak resolves,
 * language switch) — share button, streak entry animation, and DOM
 * cleanup all rebuild from scratch via createShareButton and the
 * streakAnimated flag.
 *
 * @param {number} found
 * @param {number} total
 */
function paintPersonalStats(found, total) {
  const labels = statsLabels();
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-personal-stats'));
  container.hidden = false;
  container.innerHTML = '';
  const h = document.createElement('p');
  h.className = 'daily-stats-headline';

  // Inline composition: score → (· streak when ≥ 2) → (· share icon
  // when on touch). The headline runs as inline text (no flex) so the
  // share button stays glued to its preceding text when a narrow
  // viewport wraps the line — otherwise flex-wrap puts the button on
  // its own row, which is uglier than a natural mid-text wrap.
  //
  // Streak is its own span (rather than concatenated into the score
  // text) so the entry animation can target just the streak — first-
  // time appearance shakes + flashes secondary-pink, then settles to
  // inherit the headline's primary colour.
  const shareBtn = createShareButton();
  const showStreak = streakState && streakState.currentStreak >= STREAK_MIN_TO_SHOW;
  const textEl = document.createElement('span');
  textEl.textContent = labels.scoreOnly
    .replace('{found}', String(found))
    .replace('{total}', String(total));
  h.appendChild(textEl);
  if (showStreak) {
    h.appendChild(document.createTextNode(' · '));
    const streakSpan = document.createElement('span');
    streakSpan.className = streakAnimated
      ? 'daily-stats-streak'
      : 'daily-stats-streak daily-stats-streak-enter';
    streakSpan.textContent = labels.streakLine.replace('{n}', String(streakState.currentStreak));
    if (!streakAnimated) {
      streakAnimated = true;
      // Drop the entry class after the animation completes so the
      // span is back to a plain inline-block — keeps the DOM honest
      // about its current visual state (no leftover animation hook).
      streakSpan.addEventListener('animationend', () => {
        streakSpan.classList.remove('daily-stats-streak-enter');
      }, { once: true });
    }
    h.appendChild(streakSpan);
  }
  // No trailing space after the dot — the share-link button has 6px
  // left padding (common.css .share-link) which gives the gap to the
  // icon glyph. Adding a trailing space stacks on top of the padding
  // and breaks the rhythm vs the "2 · " separator before this one.
  if (shareBtn) {
    h.appendChild(document.createTextNode(' ·'));
    h.appendChild(shareBtn);
  }
  container.appendChild(h);
}

/**
 * Paint the **community stats** slot (below Missed): the community
 * average + the caption explaining per-tile %s, or an animated
 * "Loading stats…" placeholder while the fetch pipeline runs.
 *
 * Hidden entirely (along with the caption) when no community data
 * exists and we're not loading — keeps the result panel from showing
 * an empty section on fetch failure or "be the first" puzzles. The
 * personal slot at the top still shows the score, so the player
 * always has their own number even when community is silent.
 *
 * @param {{ totalAttempts: number, mean: number, perCodeFinds: Record<string, number> } | null} stats
 * @param {number} total
 * @param {{ loading?: boolean }} [opts]
 */
function paintCommunityStats(stats, total, opts = {}) {
  const labels = statsLabels();
  const container = /** @type {HTMLElement} */ (document.getElementById('daily-stats'));
  container.innerHTML = '';
  const captionEl = /** @type {HTMLElement} */ (document.getElementById('daily-caption'));

  const hasAverage = stats && stats.totalAttempts > 0;
  const showCommunity = hasAverage || opts.loading === true;
  container.hidden = !showCommunity;

  if (!showCommunity) {
    captionEl.textContent = '';
    captionEl.hidden = true;
    return;
  }

  if (hasAverage) {
    const h = document.createElement('p');
    h.className = 'daily-stats-headline';
    h.textContent = labels.averageOnly
      .replace('{average}', String(stats.mean))
      .replace('{total}', String(total));
    container.appendChild(h);
  }
  if (opts.loading) {
    // Three pulsing dots after the label — CSS animates them in a wave
    // so the player can tell something is happening across the long
    // mobile path (Turnstile execute → POST → stats GET).
    const l = document.createElement('p');
    l.className = 'daily-stats-loading';
    l.textContent = labels.loading;
    const dots = document.createElement('span');
    dots.className = 'loading-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    l.appendChild(dots);
    container.appendChild(l);
  }
  // Caption only when stats arrived AND we have per-tile overlays to
  // explain. The score-only / loading states don't need it.
  // Lives in #daily-caption (separate slot) so the legend appears
  // beneath all the flags it describes, not stuck to the headline.
  if (hasAverage) {
    captionEl.textContent = labels.caption;
    captionEl.hidden = false;
  } else {
    captionEl.textContent = '';
    captionEl.hidden = true;
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
 * @param {{ bypassCache?: boolean }} [opts]
 */
async function loadAndPaintStats(n, targets, found, all, userFoundCodes, opts = {}) {
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
  renderExtraStats(stats, targets, all, userFoundCodes);
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
  paintPersonalStats(found, totalCount);
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
    const titleLine = t('daily.share.title', 'Yet Another Quiz — Daily Flag Puzzle #{n} — {score}/{total}')
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
      paintPersonalStats(found, info.totalCount);
      paintCommunityStats(null, info.totalCount, { loading: true });
    },
    onCleared: () => paintCommunityStats(null, info.totalCount),
    onStats: (stats) => {
      paintCommunityStats(stats, targets.length);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-result-found')), stats);
      applyFindRatesToTiles(/** @type {HTMLElement} */ (document.getElementById('find-missed')), stats);
      renderExtraStats(stats, targets, all, new Set(info.foundCodes));
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
    if (isToday) paintPersonalStats(found, info.totalCount);
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
export function bootDaily() {
  wireZoom();
  mountDevReset();
  migrateScores(window.localStorage);
  const bootDeviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
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
      // The daily game runs on the sovereign pool. Manual puzzles, though,
      // can reference non-sovereign flags the filter DSL can't express —
      // home nations (England), territories, regions — as answers. Pull in
      // exactly the extra codes any catalog entry references so those flags
      // are both searchable in the input and renderable as targets, without
      // dumping the whole territory/bloc pool (eu, un, asean, …) into every
      // puzzle's autocomplete.
      const sov = flagsGamePool(raw, false);
      const sovCodes = new Set(sov.map((c) => c.code));
      const referenced = new Set(allEntries.flatMap((e) => e.answers ?? []));
      const extras = flagsGamePool(raw, true).filter(
        (c) => !sovCodes.has(c.code) && referenced.has(c.code),
      );
      const all = withLocalizedAliases([...sov, ...extras]);

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

      paintDescription(result.entry.description);
      // Install this puzzle's per-answer "why" notes for the zoom dialog.
      // Runs above both the revisit and play branches so a tap on any
      // result tile (or extra-stats rail tile) surfaces the explanation
      // wherever the flag appears. Notes are language-agnostic at install
      // time (they carry every language); openZoom localizes on open, so
      // a soft language switch needs no re-install.
      setZoomNotes(result.entry.notes);

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
      const labelFor = result.entry.kind === 'manual'
        ? () => manualToCategory(result.entry, document.documentElement.lang || 'en').label
        : () => filterToCategory(/** @type {import('../flags/flagsFilter.js').Filters} */ (result.filter), t).label;
      const category = result.entry.kind === 'manual'
        ? manualToCategory(result.entry, document.documentElement.lang || 'en')
        : filterToCategory(/** @type {import('../flags/flagsFilter.js').Filters} */ (result.filter), t);

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
        const revisitDeviceId = getOrCreateDeviceId(window.localStorage, () => crypto.randomUUID());
        renderResult(result.targets, foundCodes, category.label);
        setShareCtx(n, result.targets, foundCodes);
        paintPersonalStats(foundCodes.size, result.targets.length);
        paintCommunityStats(null, result.targets.length, { loading: true });
        // Community stats are gated on Cosmos, not this device's
        // localStorage: always GET, and let the response decide
        // (totalAttempts === 0 → paintCommunityStats hides the
        // section). This way puzzles you finished on a different
        // device — or before submit-tracking shipped — still show
        // stats if the server has them.
        loadAndPaintStats(n, result.targets, foundCodes.size, all, foundCodes);
        // Streak fires alongside stats. Cached (no bypass) — revisits
        // don't have a fresh submit to chase past the 60s cache window.
        // Today-only: archive revisits don't show the streak.
        if (isToday) {
          loadAndPaintStreak(revisitDeviceId, foundCodes.size, result.targets.length);
        }
        // Re-paint on a soft language switch so found/missed tile hover
        // labels + the description re-translate without a page reload.
        document.addEventListener('langchanged', () => {
          paintDescription(result.entry.description);
          renderResult(result.targets, foundCodes, labelFor());
          setShareCtx(n, result.targets, foundCodes);
          paintPersonalStats(foundCodes.size, result.targets.length);
          paintCommunityStats(null, result.targets.length, { loading: true });
          loadAndPaintStats(n, result.targets, foundCodes.size, all, foundCodes);
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
