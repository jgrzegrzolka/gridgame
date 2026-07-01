import {
  createQuiz,
  VARIANTS,
  MODES,
  availableModes,
  resolveMode,
  isTimedMode,
  timedRemainingMs,
  timedBudgetUsedMs,
  lowerScoreWins,
  accuracyRatio,
  formatTime,
  recordResult,
  scoreColor,
  poolFor,
  targetFor,
  isQuizIncludeAll,
  isQuizShowMap,
  getQuizLastVariant,
  setQuizLastVariant,
  pickCelebration,
  shouldShowBestTime,
  mistakesAfterGiveUp,
  countModeProgressRatio,
} from '../flags/quiz.js';
import { flagsGamePool, loadCountries } from '../flags/group.js';
import { t, countryName } from '../i18n.js';
import { launchConfetti, launchFireworks } from '../confetti.js';
import { buildQuizMenu, buildVariantPicker } from './menu.js';
import { mountNicknameMenuItem, shareUrl } from '../common.js';
import { bumpShare, bumpQuiz60sDay, pushEngagementBlob } from '../flags/engagementCounters.js';
import { warsawDayNumber } from '../flags/warsawDay.js';
import { ensureProfile } from '../flags/autoProfile.js';
import { getOrCreateDeviceId, IDENTITY_STORAGE_KEY } from '../flags/identity.js';
import { trySyncDevices } from '../flags/syncHydrate.js';
import { quizRecordConfigKey } from '../flags/quizRecordConfigKey.js';
import { submitQuizRecord } from '../flags/quizRecordSubmit.js';
import {
  shouldPushQuizRecord,
  computeTodayPbCandidate,
  utcDateKey,
  getLastQuizRecordPushedAt,
  markQuizRecordPushed,
  getQuizDayBest,
  setQuizDayBest,
} from '../flags/quizRecordThrottle.js';
import { madeAnyQuizPick } from '../flags/quizEngagement.js';

/**
 * Wrap `submitQuizRecord` with the throttle decision. Push policy lives
 * in `flags/quizRecordThrottle.js` — this wrapper just gathers the
 * call-site inputs (sentinel, per-config day-best cache, today-PB
 * computation) and stamps both caches after a successful push.
 *
 * The day-best cache is the fix for the empty-leaderboard bug: without
 * it, a niche-config finish (e.g. oceania-all) that isn't an all-time
 * PB but IS the first-of-day-for-this-config would get dropped by the
 * 30 min throttle and never write the leaderboard row. With it, the
 * `isTodayPbCandidate` signal forces the push for any finish that
 * would change today's `dailyLeaderboards` row server-side.
 *
 * `engaged` is computed once at the call site via `madeAnyQuizPick` so
 * this gate and the 60s day-log gate see the same engagement signal.
 *
 * When skipped, returns a synthetic `{ outcome: 'ok' }` so
 * `runLeaderboardCycle` continues to the fetch step — the leaderboard
 * still paints, just without an incoming write to display.
 *
 * @param {{
 *   deviceId: string,
 *   configKey: string,
 *   score: number,
 *   durationMs: number,
 *   lowerWins: boolean,
 *   isNew: boolean,
 *   engaged: boolean,
 * }} args
 * @returns {Promise<{ outcome: 'ok' } | { outcome: 'failed', reason: string }>}
 */
async function maybeSubmitQuizRecord({ deviceId, configKey, score, durationMs, lowerWins, isNew, engaged }) {
  const store = window.localStorage;
  const now = Date.now();
  const lastPushedAt = getLastQuizRecordPushedAt(store);
  const dayBest = getQuizDayBest(store, configKey);
  const isTodayPbCandidate = computeTodayPbCandidate({
    dayBest, entry: { score, durationMs }, lowerWins, now,
  });
  if (!shouldPushQuizRecord({ engaged, isNew, isTodayPbCandidate, lastPushedAt, now })) {
    return { outcome: 'ok' };
  }
  const result = await submitQuizRecord({ deviceId, configKey, score, durationMs, lowerWins });
  if (result.outcome === 'ok') {
    markQuizRecordPushed(store, now);
    // Only stamp the day-best cache when this push actually changed
    // (or created) today's leaderboard row server-side. Throttle-path
    // pushes don't, so we don't lie about the server's state.
    if (isTodayPbCandidate) {
      setQuizDayBest(store, configKey, { date: utcDateKey(now), score, durationMs });
    }
  }
  return result;
}
import { fetchLeaderboard } from '../flags/dailyLeaderboardFetch.js';
import { renderLeaderboard } from '../flags/dailyLeaderboardRender.js';
import { runLeaderboardCycle } from '../flags/leaderboardLifecycle.js';
import { buildQuizShareTitle } from '../flags/quizShareTitle.js';
import { celebrate } from '../flags/achievementCelebrate.js';
import { primeAchievementsBaseline, refreshAchievementsAndDiff } from '../flags/achievementsBaseline.js';
import { mountFlagMap, paintCountryFlag } from './flagMap.js';
import { attachZoomPan } from './mapZoom.js';
import { openFlagZoom, wireFlagZoomBackdropClose } from '../flags/flagZoom.js';

export function bootFlagQuiz() {
  const quizMenuEl = document.getElementById('quiz-menu');
  const gameEl = document.getElementById('game');
  const countryNameEl = document.getElementById('country-name');
  const choicesEl = document.getElementById('choices');
  const resultEl = document.getElementById('result');
  const finalScoreLineEl = document.getElementById('final-score-line');
  const finalScoreLabelEl = document.getElementById('final-score-label');
  const finalScoreEl = document.getElementById('final-score');
  const timeEl = document.getElementById('time');
  const bestEl = document.getElementById('best');
  const leaderboardEl = document.getElementById('daily-leaderboard');
  const leaderboardTitleEl = document.getElementById('leaderboard-title');
  const leaderboardBodyEl = document.getElementById('leaderboard-body');
  const playTimerEl = document.getElementById('play-time');
  const playModeEl = document.getElementById('play-mode');
  const playAgainEl = /** @type {HTMLAnchorElement} */ (document.getElementById('play-again'));
  const progressBarEl = document.getElementById('progress-bar');
  const modeToggleEl = document.getElementById('mode-toggle');
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  const playAgainInlineEl = /** @type {HTMLAnchorElement | null} */ (
    document.getElementById('play-again-inline')
  );
  const flagMapEl = /** @type {HTMLElement | null} */ (
    document.getElementById('flag-map-section')
  );
  const zoomEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('zoom'));
  if (zoomEl) wireFlagZoomBackdropClose(zoomEl);

  const DEFAULT_VARIANT = 'countries';

  // Anonymous per-device ID used to address this player's row in the
  // cloud quiz-records doc. Same key as daily-puzzle submissions —
  // clearing localStorage resets both at once, which is the intended
  // identity model (zero PII, zero account).
  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());

  // Background sync for linked devices — refreshes `flagquiz.best.*`
  // from the server at most once per hour so the picker shows
  // personal-bests that include plays from the other linked device.
  // Unlinked users exit on the identity gate without any network.
  void trySyncDevices({
    deviceId, store: window.localStorage, identityKey: IDENTITY_STORAGE_KEY,
  });

  // Achievement baseline lives in flags/achievementsBaseline.js — the
  // shared module so this page's finish diff AND any post-action
  // share/coffee diff use the same axis (no double-firing across two
  // earn moments). common.js's wireBurgerDismiss already primes it,
  // but doing it again here is idempotent and avoids racing the
  // burger-wiring call.
  primeAchievementsBaseline(deviceId);

  const params = new URLSearchParams(window.location.search);
  const urlVariant = params.get('v');
  const urlMode = params.get('n');
  // Resolution order: explicit ?v= deep-link → player's last saved
  // pick → first-visit picker. Last-pick memory means returning
  // players land on the category they actually play, not "All
  // countries" every time.
  const savedVariant = getQuizLastVariant(window.localStorage);
  // First-visit signal: no URL override AND no saved pick. The
  // picker becomes the landing state instead of forcing a default
  // start. As soon as the player clicks a picker tile, the next
  // page load sets savedVariant and this branch goes quiet forever.
  const isFirstVisit = !urlVariant && !savedVariant;
  const currentVariantKey = urlVariant && VARIANTS[urlVariant]
    ? urlVariant
    : (savedVariant ?? DEFAULT_VARIANT);
  // Persist the resolved variant so the next bare-/flagQuiz/ visit
  // lands here. Deep-link visits write through too — if a friend
  // shares ?v=africa and you play it, that becomes your last pick.
  // Skipped on first visit so "I haven't picked yet" stays true
  // until the player actually picks — otherwise we'd save the
  // DEFAULT_VARIANT fallback and suppress the picker forever.
  if (!isFirstVisit) {
    setQuizLastVariant(window.localStorage, currentVariantKey);
  }

  const includeAll = isQuizIncludeAll();

  return fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((raw) => {
      const all = flagsGamePool(raw, includeAll);

      // Re-buildable menu — rebuilds clear `menuEl.innerHTML` first so
      // a soft language switch doesn't double the variant list. The
      // nickname "Your name: …" item is re-inserted after each rebuild
      // for the same reason; without that, the first langchanged would
      // wipe it.
      // Set once the round starts (below). The show-map toggle's
      // onChange reads this lazily, so a toggle before the game exists
      // (first-visit picker) simply persists the preference.
      /** @type {{ refreshI18n: () => void, setMapVisible: (show: boolean) => void } | null} */
      let game = null;
      const rebuildMenu = () => {
        /** @type {HTMLUListElement} */ (quizMenuEl).innerHTML = '';
        buildQuizMenu(/** @type {HTMLUListElement} */ (quizMenuEl), all, {
          relativeBase: '',
          // No "current variant" on first visit — nothing is highlighted
          // in the burger menu because the player hasn't chosen anything
          // yet. Returning players keep their normal aria-current marker.
          currentVariantKey: isFirstVisit ? null : currentVariantKey,
          statsCurrent: false,
          // Live map mount/hide instead of a page reload. No-op until the
          // game is created (first-visit picker has no round to overlay).
          onShowMapChange: (checked) => { if (game) game.setMapVisible(checked); },
        });
        mountNicknameMenuItem({
          rootEl: quizMenuEl,
          profileHref: '../profile/',
        });
      };
      rebuildMenu();

      // First visit → show the picker instead of starting a game.
      // Each picker tile is a navigation link, so the click is what
      // actually starts the game (via the resulting page load that
      // then takes the explicit-?v= branch above).
      if (isFirstVisit) {
        const pickerEl = /** @type {HTMLElement} */ (document.getElementById('quiz-picker'));
        const pickerListEl = /** @type {HTMLUListElement} */ (document.getElementById('quiz-picker-list'));
        buildVariantPicker(pickerListEl, all, { urlMode });
        pickerEl.hidden = false;
        document.addEventListener('langchanged', () => {
          rebuildMenu();
          buildVariantPicker(pickerListEl, all, { urlMode });
        });
        return;
      }

      const variantKey = currentVariantKey;
      let pool = all.filter(VARIANTS[variantKey].filter);
      let modeKey = resolveMode(urlMode, pool.length);

      game = startGame(variantKey, modeKey, all, raw);
      document.addEventListener('langchanged', () => {
        rebuildMenu();
        game.refreshI18n();
      });
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  function renderModeToggle(key, mode, modes) {
    modeToggleEl.innerHTML = '';
    if (modes.length < 2) return;
    modes.forEach((m, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'mode-sep';
        sep.textContent = '|';
        modeToggleEl.appendChild(sep);
      }
      const label = t(`quiz.mode.${m}`, m);
      if (m === mode) {
        const span = document.createElement('span');
        span.className = 'mode-current';
        span.textContent = label;
        modeToggleEl.appendChild(span);
      } else {
        const a = document.createElement('a');
        a.href = `?v=${key}&n=${m}`;
        a.textContent = label;
        modeToggleEl.appendChild(a);
      }
    });
  }

  function startGame(key, mode, all, raw) {
    const pool = poolFor(key, all);
    const target = targetFor(mode, pool);
    const quiz = createQuiz(pool, target);
    const timed = isTimedMode(mode);
    const modeDef = MODES[mode];
    const budgetMs = timed && modeDef.kind === 'timed' ? modeDef.budgetMs : 0;
    const penaltyMs = timed && modeDef.kind === 'timed' ? modeDef.penaltyMs : 0;
    const modes = availableModes(pool.length);
    playModeEl.textContent = t(`variant.${key}`, VARIANTS[key].label);
    renderModeToggle(key, mode, modes);

    let currentAnswer = null;
    let wrongCount = 0;
    let answeredCount = 0;
    let gameOver = false;
    let gaveUp = false;
    const startTime = Date.now();
    let timerRaf = 0;

    // Per-variant contour map. Each entry says which asset to mount
    // and, for variants that use the shared world map, which country
    // codes to crop the viewBox to. Europe ships its own focused asset
    // (better stylistic tuning at the regional scale); Asia uses the
    // world map with a runtime viewBox crop. Future continents follow
    // the Asia pattern by adding an entry here. Gate: variant must be
    // in this table AND the player has the show-map toggle on.
    const variantPool = all.filter(VARIANTS[key].filter);
    // `cropExcludes` per-variant drops countries from the bbox crop
    // computation only. The country still renders + is quizzed; it
    // just doesn't pull the viewBox toward its bbox. Used for
    // antimeridian-spanning countries whose `<g>` bbox effectively
    // wraps the whole map (US's Aleutians cross the date line, so
    // including US in NA's crop blows the viewBox out to the world).
    //
    // `cropPad` extends the crop bounds in SVG units after the bbox
    // union is computed. For NA we exclude US from the bbox math but
    // pad the west edge by 200 units so Alaska's main body comes back
    // into view (it sits west of Canada's westernmost point).
    const MAP_CONFIG = /** @type {Record<string, { url: string, crop: boolean, cropExcludes?: string[], cropPad?: { left?: number, right?: number, top?: number, bottom?: number } }>} */ ({
      // "All countries" — the whole-world view. No crop; the asset's
      // natural viewBox already covers everything. Microstates scope
      // is the full pool so every tiny country worldwide gets a ring.
      countries:       { url: './worldMap.svg',  crop: false },
      europe:          { url: './europeMap.svg', crop: false },
      asia:            { url: './worldMap.svg',  crop: true  },
      africa:          { url: './worldMap.svg',  crop: true  },
      'north-america': { url: './worldMap.svg',  crop: true,  cropExcludes: ['us'], cropPad: { left: 200 } },
      'south-america': { url: './worldMap.svg',  crop: true  },
      // Fiji and Kiribati both span the antimeridian — including them
      // would blow the crop out the same way US did for NA. Australia +
      // NZ + the central-Pacific island chains still anchor a sensible
      // Oceania view without them.
      oceania:         { url: './worldMap.svg',  crop: true,  cropExcludes: ['fj', 'ki'] },
    });
    /** @type {SVGElement | null} */
    let mapSvg = null;
    // True between a successful mountMap and the next hideMap. Tracked
    // separately from `mapSvg` because the mount is async — the flag is
    // set synchronously so a rapid toggle-on/off can't double-mount.
    let mapMounted = false;
    // Set once the click → flag-zoom handler is attached to flagMapEl.
    // The handler lives on the container (not the inner SVG), so it
    // survives re-mounts; we only want to bind it once.
    let mapClickWired = false;
    // Answer-paint history: every markCountry pushes {code, kind} here
    // so a map mounted LATE (the player flips "Show map" on mid-round or
    // after finishing) can replay the round's fills onto the fresh SVG.
    /** @type {{ code: string, kind: 'correct' | 'wrong' }[]} */
    const painted = [];

    /**
     * Record + paint an answered country. Single source of truth for the
     * map fill so a late mount replays exactly what live play would have
     * drawn. No-op on the SVG itself until a map is mounted (mapSvg null).
     * @param {string} code
     * @param {'correct' | 'wrong'} kind
     */
    function markCountry(code, kind) {
      painted.push({ code, kind });
      paintCountryFlag(mapSvg, code, '../flags/svg/', kind);
    }

    // Click → flag zoom popup. The map is non-interactive while the
    // round is in progress (no `.is-finished` on the section); once the
    // round ends `.is-finished` is set and every country becomes a
    // review surface. Lookup is built from `raw` (the full 270-entry
    // country list), not the playable `all` pool — territories like Isle
    // of Man / Guernsey / Jersey / Faroe Islands aren't quiz items in
    // the default sovereign pool, but they're still rendered on the map
    // and the player can click them to see the flag.
    const byCode = new Map(raw.map((c) => [c.code, c]));
    function wireMapClick() {
      if (!flagMapEl || mapClickWired) return;
      mapClickWired = true;
      flagMapEl.addEventListener('click', (e) => {
        if (!flagMapEl.classList.contains('is-finished')) return;
        const target = /** @type {Element | null} */ (e.target);
        if (!target) return;
        // Resolve to a country ISO2 code. Two shapes:
        //   1. Overlay hit-target — carries `data-hit-for="va"`.
        //   2. Country path — walk up to find the first [id] ancestor
        //      whose value is a known country code. Handles both
        //      single-path countries (id="es") and `<g id="ru">`
        //      wrappers whose child paths have their own ids
        //      (`ru-main`, `gb-eng`, etc.) that aren't real codes.
        let code = (typeof target.getAttribute === 'function')
          ? target.getAttribute('data-hit-for')
          : null;
        if (!code) {
          let el = /** @type {Element | null} */ (target);
          while (el) {
            const id = el.id;
            if (id && byCode.has(id)) { code = id; break; }
            el = el.parentElement;
          }
        }
        if (!code) return;
        const country = byCode.get(code);
        if (!country) return;
        openFlagZoom(zoomEl, {
          code: country.code,
          displayName: countryName(country),
          svgBase: '../flags/svg/',
        });
      });
    }

    function mountMap() {
      if (!flagMapEl || !MAP_CONFIG[key] || mapMounted) return;
      const cfg = MAP_CONFIG[key];
      const variantCodes = variantPool.map((c) => c.code);
      const excludes = new Set(cfg.cropExcludes || []);
      const cropCodes = cfg.crop
        ? variantCodes.filter((c) => !excludes.has(c))
        : null;
      mapMounted = true;
      flagMapEl.hidden = false;
      flagMapEl.setAttribute('aria-hidden', 'false');
      // Mounting after the round already ended (player flipped the toggle
      // on the result screen): drop the section into the result panel and
      // mark it reviewable, mirroring what showResult does for a map that
      // was already up at finish.
      if (gameOver) {
        resultEl.insertBefore(flagMapEl, leaderboardEl);
        flagMapEl.classList.add('is-finished');
      }
      void mountFlagMap({
        container: flagMapEl,
        url: cfg.url,
        cropCodes,
        cropPad: cfg.cropPad,
        // Microstate overlays only land on countries the player will
        // actually be quizzed on — the world map is geographically
        // wide and we don't want pink rings decorating Caribbean /
        // Pacific microstates that aren't part of the Asian round.
        scopeCodes: variantCodes,
        fullscreenLabel: t('menu.fullscreen', 'Toggle fullscreen'),
      }).then((svg) => {
        mapSvg = svg;
        // Wheel-zoom + pinch + drag-pan + double-tap-reset. Attached
        // once the SVG is in the DOM (and after cropToCountries has
        // set the final viewBox, since mapZoom reads that as the
        // "original" bounds for clamping).
        if (svg) {
          attachZoomPan(svg);
          // Replay the round so far — fills every country already
          // answered before this (possibly late) mount.
          for (const p of painted) {
            paintCountryFlag(svg, p.code, '../flags/svg/', p.kind);
          }
        }
      });
      wireMapClick();
    }

    function hideMap() {
      if (!flagMapEl) return;
      mapMounted = false;
      mapSvg = null;
      flagMapEl.hidden = true;
      flagMapEl.setAttribute('aria-hidden', 'true');
      flagMapEl.classList.remove('is-finished');
      // Drop the inlined SVG. The click handler stays bound to flagMapEl
      // (the container) and is gated on `.is-finished`, so it's inert
      // until a re-mount restores both the SVG and that class.
      flagMapEl.innerHTML = '';
    }

    /**
     * Live response to the burger menu's "Show map" toggle — mount or
     * hide the map in place, no page reload. Variants with no map asset
     * (none today, but the table is the gate) silently no-op.
     * @param {boolean} show
     */
    function setMapVisible(show) {
      if (show) mountMap();
      else hideMap();
    }

    if (isQuizShowMap()) mountMap();

    // Result-screen data is captured once when showResult fires so a
    // soft language switch can re-paint the localized labels (Final
    // score, Your best score, Time, new record) without re-running
    // recordResult or re-firing the celebration. Null until the game
    // ends; refreshI18n's `paintResultLabels` no-ops until then.
    /** @type {{ timed: boolean, isNew: boolean, best: { score: number, time: number }, elapsed: number, budgetUsed: number, gaveUp: boolean } | null} */
    let resultLabelData = null;

    // Captured by `runLeaderboardCycle`'s paint callback so a soft language
    // switch can re-render translated labels without re-issuing the fetch.
    /** @type {{ state: 'loading' | 'ready' | 'failed', data?: { top: any[], you: any } } | null} */
    let leaderboardState = null;

    function paintLeaderboard() {
      if (!leaderboardState) return;
      leaderboardEl.hidden = false;
      // The "Today's leaderboard" header is for the populated panel —
      // showing it above a "Loading…" spinner reads as a promise the
      // page hasn't kept yet. Reveals on first non-loading paint.
      leaderboardTitleEl.hidden = leaderboardState.state === 'loading';
      // Endurance mode stores `score = wrongCount` (lower wins). Showing
      // that as the leaderboard column reads as "Janko 0" — which the
      // player parses as "Janko got 0 correct" instead of "Janko got 0
      // wrong". Transform back to a correct-count display for that mode.
      // Timed (60s) mode already stores `score = correctCount`, no
      // transform needed.
      const formatScore = timed ? undefined : (n) => String(target - n);
      // 60s mode only: a row whose score reaches the pool size cleared
      // every flag in the category → the renderer shows its finish time
      // next to the score. Endurance mode stores wrong-counts (lower
      // wins), so "cleared all" isn't a score threshold there — pass null
      // to suppress the time.
      const poolTotal = timed ? pool.length : null;
      const subtree = renderLeaderboard({
        state: leaderboardState.state,
        data: leaderboardState.data,
        ownDeviceId: deviceId,
        t,
        formatScore,
        formatTime,
        poolTotal,
      });
      leaderboardBodyEl.innerHTML = '';
      leaderboardBodyEl.appendChild(subtree);
    }

    // For timed mode the progress bar is the countdown — we widen it from
    // 0% to 100% as the budget burns down, so the visual matches the
    // dwindling timer rather than the meaningless "questions done" ratio.
    if (timed) {
      progressBarEl.style.width = '0%';
      // Drop the flash class once the keyframes finish, so the next
      // wrong click can restart the animation cleanly via reflow.
      playTimerEl.addEventListener('animationend', () => {
        playTimerEl.classList.remove('penalty');
      });
    }

    function flashPenalty() {
      playTimerEl.classList.remove('penalty');
      // Force a reflow so the re-added class triggers the animation again
      // even if a previous flash is still mid-flight.
      void playTimerEl.offsetWidth;
      playTimerEl.classList.add('penalty');
    }

    function tickTimer() {
      if (timed) {
        const elapsedMs = Date.now() - startTime;
        const remaining = timedRemainingMs({ budgetMs, penaltyMs, elapsedMs, wrongCount });
        playTimerEl.textContent = formatTime(remaining);
        progressBarEl.style.width = ((budgetMs - remaining) / budgetMs * 100) + '%';
        if (remaining <= 0 && !gameOver) {
          gameOver = true;
          showResult();
          return;
        }
      } else {
        playTimerEl.textContent = formatTime(Date.now() - startTime);
      }
      timerRaf = requestAnimationFrame(tickTimer);
    }

    function countScore() {
      return Math.max(0, target - wrongCount);
    }

    function render(q) {
      currentAnswer = q.answer;
      countryNameEl.textContent = countryName(q.answer);
      choicesEl.innerHTML = '';
      for (const c of q.choices) {
        const tile = document.createElement('button');
        tile.className = 'flag-choice';
        tile.dataset.code = c.code;
        const img = document.createElement('img');
        img.src = `../flags/svg/${c.code}.svg`;
        img.alt = '';
        tile.appendChild(img);
        tile.addEventListener('click', () => onAnswer(c, tile));
        choicesEl.appendChild(tile);
      }
      // Warm the next round's flags while the player reads the current
      // one, so render(quiz.next()) hits the browser cache. Replaces the
      // old preload-everything-at-start strategy that queued the first
      // visible flags behind ~200 background prefetches.
      const upcoming = quiz.peek();
      if (upcoming) {
        for (const c of upcoming.choices) {
          new Image().src = `../flags/svg/${c.code}.svg`;
        }
      }
    }

    function disableAllTiles() {
      for (const t of choicesEl.querySelectorAll('.flag-choice')) {
        /** @type {HTMLButtonElement} */ (t).disabled = true;
      }
    }

    function advanceTo(nextQ, delayMs) {
      if (!nextQ) {
        setTimeout(() => {
          if (!gameOver) {
            gameOver = true;
            showResult();
          }
        }, delayMs);
      } else {
        setTimeout(() => { if (!gameOver) render(nextQ); }, delayMs);
      }
    }

    function onAnswer(chosen, tile) {
      if (gameOver) return;
      if (chosen.code === currentAnswer.code) {
        answeredCount++;
        if (!timed) {
          progressBarEl.style.width = (countModeProgressRatio(answeredCount, wrongCount, target) * 100) + '%';
        }
        tile.classList.add('correct');
        disableAllTiles();
        // currentAnswer.code is the ISO2 of the country in question.
        // Fill the country's contour with its flag + green outline.
        // Records into `painted` so a map mounted later replays it.
        markCountry(currentAnswer.code, 'correct');
        advanceTo(quiz.next(), 250);
      } else if (timed) {
        // 60s is one-shot per question, same as count mode: a wrong
        // pick advances the round. The cabinet (quiz.addToCabinet)
        // queues the missed answer for revisit if the main pool
        // exhausts before time runs out — your second chance is at the
        // end, not in-place. Penalty (flashPenalty / wrongCount++)
        // still applies so random clickers are punished by lost
        // budget.
        wrongCount++;
        tile.classList.add('wrong');
        // Overlay the wrong country's name on the tile itself — the
        // .flag-choice.wrong[data-name]::after rule paints a strip
        // across the flag's bottom. Replaces the standalone .feedback
        // line so the map below has more vertical room.
        tile.dataset.name = countryName(chosen);
        const correctTile = choicesEl.querySelector(`[data-code="${currentAnswer.code}"]`);
        if (correctTile) correctTile.classList.add('correct');
        disableAllTiles();
        flashPenalty();
        // Map: fill the ASKED-ABOUT country (currentAnswer.code) with its
        // flag + red outline, matching count mode's semantics — the player
        // sees the flag they missed. The clicked-country tracking we used
        // during multi-attempt was lossy (latest-wins would flip the red to
        // green if that country later came up correct); the cabinet pattern
        // makes the asked-about marking honest — a wrong stays wrong unless
        // revisited and corrected.
        markCountry(currentAnswer.code, 'wrong');
        quiz.addToCabinet(currentAnswer);
        advanceTo(quiz.next(), 1200);
      } else {
        // Count mode is one-shot: a wrong pick ends the question. We
        // reveal the correct tile so the player learns what it was, then
        // advance to a fresh 4-flag set. This keeps mistakes <= target,
        // which lets the result/stats screens render as "correct/target".
        wrongCount++;
        tile.classList.add('wrong');
        // Overlay the wrong-pick name on the tile (same strip pattern
        // as timed mode above) so the player sees what they clicked
        // even though they're focused on the now-revealed correct tile.
        tile.dataset.name = countryName(chosen);
        const correctTile = choicesEl.querySelector(`[data-code="${currentAnswer.code}"]`);
        if (correctTile) correctTile.classList.add('correct');
        disableAllTiles();
        progressBarEl.style.width = (countModeProgressRatio(answeredCount, wrongCount, target) * 100) + '%';
        // Map: the asked-about country (currentAnswer.code) is the one
        // the player missed — flag-fill + red-outline *that*, not the wrong
        // choice. The clicked-wrong tile's country may not have been asked
        // yet and shouldn't get pre-marked here.
        markCountry(currentAnswer.code, 'wrong');
        advanceTo(quiz.next(), 1200);
      }
    }

    /**
     * Paint the result screen's localized strings from `resultLabelData`.
     * No-op until showResult has populated the data. Idempotent —
     * `bestEl.textContent = …` wipes any prior "new record!" badge, and
     * the badge is re-appended on each call so a soft language switch
     * mid-result re-translates correctly.
     */
    function paintResultLabels() {
      if (!resultLabelData) return;
      const { timed: t_, isNew, best, elapsed, budgetUsed, gaveUp: rgaveUp } = resultLabelData;
      finalScoreLabelEl.textContent = t('quiz.finalScore', 'Final score:');
      if (t_) {
        // Show "Time" only when the pool exhausted under budget — for a
        // time-out the value is always the budget itself, which the mode
        // label already tells the player. shouldShowBestTime is the
        // shared gate; flagQuiz/stats uses the same function. Also
        // suppressed on give-up: the elapsed time before quitting isn't
        // a meaningful result.
        timeEl.textContent = !rgaveUp && shouldShowBestTime(mode, { time: budgetUsed })
          ? `${t('game.time', 'Time')}: ${formatTime(budgetUsed)}`
          : '';
        bestEl.textContent = shouldShowBestTime(mode, best)
          ? `${t('quiz.yourBestScore', 'Your best score')}: ${best.score} ${t('game.in', 'in')} ${formatTime(best.time)}`
          : `${t('quiz.yourBestScore', 'Your best score')}: ${best.score}`;
      } else {
        // Same give-up suppression in count mode — the elapsed time of a
        // give-up round (often < 2s) is misleading next to the score.
        timeEl.textContent = rgaveUp
          ? ''
          : `${t('game.time', 'Time')}: ${formatTime(elapsed)}`;
        const bestCorrect = Math.max(0, target - best.score);
        bestEl.textContent =
          `${t('quiz.yourBestScore', 'Your best score')}: ${bestCorrect}/${target} ${t('game.in', 'in')} ${formatTime(best.time)}`;
      }
      if (isNew) {
        bestEl.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = t('game.newRecord', 'new record!');
        bestEl.appendChild(badge);
      }
    }

    /**
     * Mount the inline share button at the end of the final-score line.
     * Touch-only (matches daily / findFlag / TTT) — desktop's OS share
     * sheet is heavy for what's conceptually "copy this URL", and a
     * silent clipboard path is too quiet to be discoverable, so we just
     * don't render the icon there. Click → shareUrl(currentURL, title +
     * "Can you beat me?"), with a 1.5 s `.copied` flash on clipboard
     * success.
     *
     * The current URL already encodes variant + mode (?v=…&n=…) so a
     * recipient lands on the exact same configuration.
     *
     * Idempotent — bails if the button already exists, so a hot re-paint
     * (lang switch) doesn't double-mount.
     *
     * @param {number} correct  Correct-answer count for this round.
     */
    function mountShareButton(correct) {
      const isTouchDevice = typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
      if (!isTouchDevice) return;
      if (document.getElementById('result-share')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'share-link';
      btn.id = 'result-share';
      btn.setAttribute('aria-label', t('quiz.share.aria', 'Share result'));
      const iconEl = document.createElement('span');
      iconEl.className = 'share-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      btn.appendChild(iconEl);
      btn.onclick = async () => {
        const title = buildQuizShareTitle({
          template: t('quiz.share.title', 'Yet Another Quiz — {variant} {mode} — {score}'),
          variant: t(`variant.${key}`, VARIANTS[key].label),
          mode: t(`quiz.mode.${mode}`, mode),
          timed,
          correct,
          target,
        });
        const text = t('quiz.share.text', 'Can you beat me?');
        const r = await shareUrl(window.location.href, { title, text });
        if (r === 'copied') {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1500);
        }
        if (r === 'shared' || r === 'copied') {
          void ensureProfile(deviceId);
          // Feature S Phase 3: local counter + syncBlob push replaces
          // the engagementEvents POST. Achievement diff still reads
          // the server snapshot during the Phase 3 → Phase 4 window;
          // Phase 4 will rewire it to localStorage.
          bumpShare(window.localStorage, 'flagquiz');
          void pushEngagementBlob(deviceId, window.localStorage);
          void refreshAchievementsAndDiff(deviceId).then((newly) => {
            if (newly.length > 0) void celebrate(newly);
          });
        }
      };
      finalScoreLineEl.appendChild(btn);
    }

    function showResult() {
      cancelAnimationFrame(timerRaf);
      const elapsed = Date.now() - startTime;

      if (timed) {
        // Score = flags answered correctly. There's no "out of target"
        // ratio to colour by, so tint by accuracy (correct vs total picks):
        // a clean sweep is green, a 50/50 round is amber, all-wrong is red.
        const totalPicks = answeredCount + wrongCount;
        const ratio = totalPicks === 0 ? 0 : answeredCount / totalPicks;
        finalScoreEl.textContent = String(answeredCount);
        finalScoreLineEl.style.color = scoreColor(ratio);

        // Record "budget consumed", not wall clock — bounds at the
        // budget for time-outs, lower only when the pool exhausts under
        // budget. nextBest's lower-time tiebreaker then rewards
        // efficient rounds; a wall-clock metric would perversely favour
        // the round that burned more penalties. See timedBudgetUsedMs
        // docstring and tests for the contract.
        const budgetUsed = timedBudgetUsedMs({
          budgetMs, penaltyMs, elapsedMs: elapsed, wrongCount,
        });

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: answeredCount, time: budgetUsed }, includeAll,
        );
        resultLabelData = { timed: true, isNew, best, elapsed, budgetUsed, gaveUp };
        paintResultLabels();
        // Cloud write on every finish (not just PBs): F5 added server-side
        // attempts + lastPlayedAt counters that depend on it. The chained
        // leaderboard fetch lands after the server's leaderboard write
        // completes so the just-played row is visible on this paint.
        const configKey = quizRecordConfigKey(key, mode, includeAll);
        void ensureProfile(deviceId);
        // Feature S Phase 3: 60s-mode finish records the Warsaw day on
        // the local day log (idempotent per day) and mirrors to the
        // syncBlob. Drives Sprint Habit / Steady Sprinter / Monthly
        // Sprinter / Quiz Centurion achievements — Phase 4 will rewire
        // the achievement evaluator to compute streak from this log
        // instead of the server snapshot.
        const engaged = madeAnyQuizPick({ answeredCount, wrongCount });
        const today60s = warsawDayNumber(Date.now());
        if (today60s !== null && engaged) {
          bumpQuiz60sDay(window.localStorage, today60s);
          void pushEngagementBlob(deviceId, window.localStorage);
        }
        const cycleP = runLeaderboardCycle({
          submitImpl: () => maybeSubmitQuizRecord({
            deviceId, configKey,
            score: answeredCount, durationMs: budgetUsed, lowerWins: false,
            isNew, engaged,
          }),
          fetchImpl: () => fetchLeaderboard({ configKey, deviceId, fresh: true }),
          paint: (s) => { leaderboardState = s; paintLeaderboard(); },
        });
        const { tier, intensity } = pickCelebration({
          found: answeredCount,
          // total isn't meaningful for 60s mode (the round ends when the
          // budget runs out, not when the pool is exhausted); isTimed
          // suppresses the sweep branch of pickCelebration so this
          // value is unused.
          total: 0,
          isTimed: true,
          isNew,
          prematurelyGaveUp: gaveUp,
        });
        if (tier === 'fireworks') launchFireworks();
        else if (tier === 'confetti') launchConfetti({ intensity });
        // Achievement diff: chain off the leaderboard cycle so the
        // bypassCache fetch lands AFTER submitQuizRecord has settled
        // server-side (the cycle awaits the submit internally before
        // resolving). Uses the shared baseline so this finish and any
        // post-finish share / coffee click on the same page session
        // share one diff axis (no double-firing).
        void cycleP.then(async () => {
          const newly = await refreshAchievementsAndDiff(deviceId);
          if (newly.length > 0) void celebrate(newly);
        });
      } else {
        // Count mode is one-shot per question, so correct + wrong = target.
        // We still store wrongCount as best.score (lower-wins) for
        // backward-compat with nextBest's tiebreaker, but the display is
        // "correct/target" so the player reads it the same way as a
        // timed-mode score. Colour tint stays accuracy-based.
        finalScoreEl.textContent = `${answeredCount}/${target}`;
        finalScoreLineEl.style.color = scoreColor(accuracyRatio(wrongCount, target));

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: wrongCount, time: elapsed }, includeAll, lowerScoreWins,
        );
        resultLabelData = { timed: false, isNew, best, elapsed, budgetUsed: 0, gaveUp };
        paintResultLabels();
        const configKey = quizRecordConfigKey(key, mode, includeAll);
        void ensureProfile(deviceId);
        // No engagement counter for endurance-mode plays — pre-Phase-3
        // we wrote them defensively for a possible future achievement,
        // but Phase 3 dropped that speculation. Add a bumpQuizAllDay
        // call back if such an achievement actually lands.
        const engaged = madeAnyQuizPick({ answeredCount, wrongCount });
        const cycleP = runLeaderboardCycle({
          submitImpl: () => maybeSubmitQuizRecord({
            deviceId, configKey,
            score: wrongCount, durationMs: elapsed, lowerWins: true,
            isNew, engaged,
          }),
          fetchImpl: () => fetchLeaderboard({ configKey, deviceId, fresh: true }),
          paint: (s) => { leaderboardState = s; paintLeaderboard(); },
        });
        const { tier, intensity } = pickCelebration({
          found: answeredCount,
          total: target,
          isTimed: false,
          isNew,
          prematurelyGaveUp: gaveUp,
        });
        if (tier === 'fireworks') launchFireworks();
        else if (tier === 'confetti') launchConfetti({ intensity });
        // Achievement diff — mirrors the 60s branch. Chains off the
        // leaderboard cycle so the bypassCache fetch lands AFTER
        // submitQuizRecord has settled server-side. Catches the
        // endurance tier (Marathon, World Tour, Iron Memory, Perfect
        // Round, All Countries Mastered, Endurance Atlas).
        void cycleP.then(async () => {
          const newly = await refreshAchievementsAndDiff(deviceId);
          if (newly.length > 0) void celebrate(newly);
        });
      }

      mountShareButton(answeredCount);

      // Re-parent the europe contour map into the result panel, above
      // the leaderboard. The section was mounted as a child of #game so
      // the player sees it filling in live; on finish we want the final
      // pattern to sit next to the score recap, not vanish with the
      // play UI. Idempotent when the map isn't mounted (other variants
      // or 60s mode): flagMapEl stays `hidden` and the move is a no-op.
      //
      // `.is-finished` also gets set here — the click handler reads it
      // to decide whether to open the flag-zoom popup. Map clicks are
      // ignored during play; once the round ends every country becomes
      // a review surface.
      if (flagMapEl && !flagMapEl.hidden) {
        resultEl.insertBefore(flagMapEl, leaderboardEl);
        flagMapEl.classList.add('is-finished');
      }

      gameEl.hidden = true;
      progressBarEl.hidden = true;
      resultEl.hidden = false;
    }

    playAgainEl.href = window.location.pathname + window.location.search;
    if (playAgainInlineEl) {
      playAgainInlineEl.href = window.location.pathname + window.location.search;
    }

    if (giveUpEl) {
      giveUpEl.addEventListener('click', () => {
        if (gameOver) return;
        gameOver = true;
        gaveUp = true;
        wrongCount = mistakesAfterGiveUp({ modeKey: mode, target, answeredCount, wrongCount });
        showResult();
      }, { once: true });
    }

    gameEl.hidden = false;
    tickTimer();
    render(quiz.next());

    return {
      /**
       * Soft language switch: re-translate every text surface this
       * game owns. Mid-round → play-mode label + mode-toggle links +
       * the current country prompt re-paint. Post-round → result
       * screen labels re-paint from the captured `resultLabelData`.
       * The timer keeps running (in 60s mode this is the intended
       * behaviour — the lang flip doesn't pause the budget).
       */
      refreshI18n() {
        playModeEl.textContent = t(`variant.${key}`, VARIANTS[key].label);
        renderModeToggle(key, mode, modes);
        if (currentAnswer) countryNameEl.textContent = countryName(currentAnswer);
        paintResultLabels();
        // The share button itself stays mounted across a lang switch —
        // re-rendering it would clear any in-flight `.copied` flash and
        // the click handler reads t(…) fresh on each click anyway, so
        // the title/text already follow the live language. Only the
        // static aria-label needs an explicit re-paint.
        const shareBtn = document.getElementById('result-share');
        if (shareBtn) shareBtn.setAttribute('aria-label', t('quiz.share.aria', 'Share result'));
        // Re-paint the leaderboard panel so its labels ("Loading…",
        // empty-state copy, "You" suffix) come back in the new language.
        // Bails out if no leaderboard render has happened yet (refreshI18n
        // can fire mid-game before showResult sets leaderboardState).
        paintLeaderboard();
      },
      // Burger-menu "Show map" toggle hook — mount/hide the map live
      // over the current round (or result screen) instead of reloading.
      setMapVisible,
    };
  }
}
