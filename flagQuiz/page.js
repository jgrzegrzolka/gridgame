import {
  createQuiz,
  VARIANTS,
  MODES,
  availableModes,
  defaultModeFor,
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
  preloadFlags,
  shouldFireQuizConfetti,
  shouldShowBestTime,
  mistakesAfterGiveUp,
  countModeProgressRatio,
} from '../flags/quiz.js';
import { flagsGamePool } from '../flags/group.js';
import { t, countryName } from '../i18n.js';
import { launchConfetti } from '../confetti.js';
import { buildQuizMenu } from './menu.js';

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

  const params = new URLSearchParams(window.location.search);
  const urlVariant = params.get('v');
  const urlMode = params.get('n');
  // Compute the effective variant before renderMenu runs so the menu can
  // mark the matching entry with aria-current="page".
  const currentVariantKey = urlVariant && VARIANTS[urlVariant] ? urlVariant : DEFAULT_VARIANT;

  const includeAll = isQuizIncludeAll();

  return fetch('../flags/countries.json')
    .then((r) => r.json())
    .then((raw) => {
      const all = flagsGamePool(raw, includeAll);
      preloadFlags(all, (url) => { new Image().src = url; });
      buildQuizMenu(/** @type {HTMLUListElement} */ (quizMenuEl), all, {
        relativeBase: '',
        currentVariantKey,
        statsCurrent: false,
      });

      const variantKey = currentVariantKey;
      let pool = all.filter(VARIANTS[variantKey].filter);
      let modeKey = urlMode && availableModes(pool.length).includes(urlMode)
        ? urlMode
        : defaultModeFor(pool.length);

      startGame(variantKey, modeKey, all);
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
    playModeEl.textContent = t(`variant.${key}`, VARIANTS[key].label);
    renderModeToggle(key, mode, availableModes(pool.length));

    let currentAnswer = null;
    let wrongCount = 0;
    let answeredCount = 0;
    let gameOver = false;
    const startTime = Date.now();
    let timerRaf = 0;

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

    function showResult() {
      cancelAnimationFrame(timerRaf);
      const elapsed = Date.now() - startTime;

      if (timed) {
        // Score = flags answered correctly. There's no "out of target"
        // ratio to colour by, so tint by accuracy (correct vs total picks):
        // a clean sweep is green, a 50/50 round is amber, all-wrong is red.
        const totalPicks = answeredCount + wrongCount;
        const ratio = totalPicks === 0 ? 0 : answeredCount / totalPicks;
        // Reset the label in case a prior all-mode round overwrote it
        // with "Mistakes:". 60s mode keeps the original "Final score:".
        finalScoreLabelEl.textContent = t('quiz.finalScore', 'Final score:');
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
        // Show "Time" only when the pool exhausted under budget — for a
        // time-out the value is always the budget itself, which the
        // mode label already tells the player. shouldShowBestTime is the
        // shared gate; flagQuiz/stats uses the same function.
        timeEl.textContent = shouldShowBestTime(mode, { time: budgetUsed })
          ? `${t('game.time', 'Time')}: ${formatTime(budgetUsed)}`
          : '';

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: answeredCount, time: budgetUsed }, includeAll,
        );
        bestEl.textContent = shouldShowBestTime(mode, best)
          ? `${t('quiz.yourBestScore', 'Your best score')}: ${best.score} ${t('game.in', 'in')} ${formatTime(best.time)}`
          : `${t('quiz.yourBestScore', 'Your best score')}: ${best.score}`;
        if (isNew) {
          bestEl.appendChild(document.createTextNode(' '));
          const badge = document.createElement('span');
          badge.className = 'new-badge';
          badge.textContent = t('game.newRecord', 'new record!');
          bestEl.appendChild(badge);
        }
        if (shouldFireQuizConfetti({ timed: true, wrongCount, isNew })) launchConfetti();
      } else {
        // Count mode is one-shot per question, so correct + wrong = target.
        // We still store wrongCount as best.score (lower-wins) for
        // backward-compat with nextBest's tiebreaker, but the display is
        // "correct/target" so the player reads it the same way as a
        // timed-mode score. Colour tint stays accuracy-based.
        finalScoreLabelEl.textContent = t('quiz.finalScore', 'Final score:');
        finalScoreEl.textContent = `${answeredCount}/${target}`;
        finalScoreLineEl.style.color = scoreColor(accuracyRatio(wrongCount, target));
        timeEl.textContent = `${t('game.time', 'Time')}: ${formatTime(elapsed)}`;

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: wrongCount, time: elapsed }, includeAll, lowerScoreWins,
        );
        const bestCorrect = Math.max(0, target - best.score);
        bestEl.textContent =
          `${t('quiz.yourBestScore', 'Your best score')}: ${bestCorrect}/${target} ${t('game.in', 'in')} ${formatTime(best.time)}`;
        if (isNew) {
          bestEl.appendChild(document.createTextNode(' '));
          const badge = document.createElement('span');
          badge.className = 'new-badge';
          badge.textContent = t('game.newRecord', 'new record!');
          bestEl.appendChild(badge);
        }
        if (shouldFireQuizConfetti({ timed: false, wrongCount, isNew })) launchConfetti();
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
        wrongCount = mistakesAfterGiveUp({ modeKey: mode, target, answeredCount, wrongCount });
        showResult();
      }, { once: true });
    }

    gameEl.hidden = false;
    tickTimer();
    render(quiz.next());
  }
}
