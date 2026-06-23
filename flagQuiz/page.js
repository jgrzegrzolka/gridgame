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
  getLastQuizRecordPushedAt,
  markQuizRecordPushed,
} from '../flags/quizRecordThrottle.js';
import { madeAnyQuizPick } from '../flags/quizEngagement.js';

/**
 * Wrap `submitQuizRecord` with the Feature S Phase 5 decision: PB beats
 * fire immediately; rounds with no real picks skip the POST entirely
 * (no consumer cares about empty-round attempt bumps); all other
 * finishes are throttled (one push per 30 minutes per device).
 *
 * `engaged` is computed once at the call site via
 * `madeAnyQuizPick` so this gate and the 60s day-log gate see the
 * same engagement signal — preventing the kind of drift that bit us
 * before unification (Phase 5 used `gaveUp`, the day-log gate used
 * pick count; they disagreed in two of four cases).
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
  if (!shouldPushQuizRecord({ engaged, isNew, lastPushedAt, now })) {
    return { outcome: 'ok' };
  }
  const result = await submitQuizRecord({ deviceId, configKey, score, durationMs, lowerWins });
  if (result.outcome === 'ok') markQuizRecordPushed(store, now);
  return result;
}
import { fetchLeaderboard } from '../flags/dailyLeaderboardFetch.js';
import { renderLeaderboard } from '../flags/dailyLeaderboardRender.js';
import { runLeaderboardCycle } from '../flags/leaderboardLifecycle.js';
import { buildQuizShareTitle } from '../flags/quizShareTitle.js';
import { celebrate } from '../flags/achievementCelebrate.js';
import { primeAchievementsBaseline, refreshAchievementsAndDiff } from '../flags/achievementsBaseline.js';

export function bootFlagQuiz() {
  const quizMenuEl = document.getElementById('quiz-menu');
  const gameEl = document.getElementById('game');
  const countryNameEl = document.getElementById('country-name');
  const choicesEl = document.getElementById('choices');
  const feedbackEl = document.getElementById('feedback');
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
      const rebuildMenu = () => {
        /** @type {HTMLUListElement} */ (quizMenuEl).innerHTML = '';
        buildQuizMenu(/** @type {HTMLUListElement} */ (quizMenuEl), all, {
          relativeBase: '',
          // No "current variant" on first visit — nothing is highlighted
          // in the burger menu because the player hasn't chosen anything
          // yet. Returning players keep their normal aria-current marker.
          currentVariantKey: isFirstVisit ? null : currentVariantKey,
          statsCurrent: false,
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

      const game = startGame(variantKey, modeKey, all);
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

  function startGame(key, mode, all) {
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
      const subtree = renderLeaderboard({
        state: leaderboardState.state,
        data: leaderboardState.data,
        ownDeviceId: deviceId,
        t,
        formatScore,
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
      feedbackEl.textContent = '';
      feedbackEl.classList.remove('shake-wrong');
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
        feedbackEl.textContent = '';
        feedbackEl.classList.remove('shake-wrong');
        advanceTo(quiz.next(), 250);
      } else if (timed) {
        // Timed mode keeps the multi-attempt-per-question flow: wrong pick
        // costs time (via flashPenalty), shake the feedback, let the player
        // try the remaining tiles until they hit the right one.
        tile.classList.add('wrong');
        tile.disabled = true;
        feedbackEl.textContent = countryName(chosen);
        feedbackEl.classList.remove('shake-wrong');
        void feedbackEl.offsetWidth;
        feedbackEl.classList.add('shake-wrong');
        wrongCount++;
        flashPenalty();
      } else {
        // Count mode is one-shot: a wrong pick ends the question. We
        // reveal the correct tile so the player learns what it was, then
        // advance to a fresh 4-flag set. This keeps mistakes <= target,
        // which lets the result/stats screens render as "correct/target".
        wrongCount++;
        tile.classList.add('wrong');
        const correctTile = choicesEl.querySelector(`[data-code="${currentAnswer.code}"]`);
        if (correctTile) correctTile.classList.add('correct');
        disableAllTiles();
        progressBarEl.style.width = (countModeProgressRatio(answeredCount, wrongCount, target) * 100) + '%';
        feedbackEl.textContent = '';
        feedbackEl.classList.remove('shake-wrong');
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
    };
  }
}
