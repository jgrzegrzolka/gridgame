import {
  createQuiz,
  VARIANTS,
  MODES,
  availableModes,
  defaultModeFor,
  isTimedMode,
  timedRemainingMs,
  timedBudgetUsedMs,
  formatTime,
  recordResult,
  scoreColor,
  poolFor,
  targetFor,
  isQuizIncludeAll,
  setQuizIncludeAll,
  preloadFlags,
} from '../flags/quiz.js';
import { flagsGamePool } from '../flags/group.js';
import { t, countryName } from '../i18n.js';

export function bootFlagQuiz() {
  const quizMenuEl = document.getElementById('quiz-menu');
  const gameEl = document.getElementById('game');
  const countryNameEl = document.getElementById('country-name');
  const choicesEl = document.getElementById('choices');
  const feedbackEl = document.getElementById('feedback');
  const resultEl = document.getElementById('result');
  const finalScoreLineEl = document.getElementById('final-score-line');
  const finalScoreEl = document.getElementById('final-score');
  const timeEl = document.getElementById('time');
  const bestEl = document.getElementById('best');
  const playTimerEl = document.getElementById('play-time');
  const playModeEl = document.getElementById('play-mode');
  const playAgainEl = /** @type {HTMLAnchorElement} */ (document.getElementById('play-again'));
  const progressBarEl = document.getElementById('progress-bar');
  const modeToggleEl = document.getElementById('mode-toggle');
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));

  const DEFAULT_VARIANT = 'countries';

  const params = new URLSearchParams(window.location.search);
  const urlVariant = params.get('v');
  const urlMode = params.get('n');

  const includeAll = isQuizIncludeAll();

  return fetch('../flags/countries.json')
    .then((r) => r.json())
    .then((raw) => {
      const all = flagsGamePool(raw, includeAll);
      preloadFlags(all, (url) => { new Image().src = url; });
      renderMenu(all);

      let variantKey = urlVariant && VARIANTS[urlVariant]
        ? urlVariant
        : DEFAULT_VARIANT;
      let pool = all.filter(VARIANTS[variantKey].filter);
      let modeKey = urlMode && availableModes(pool.length).includes(urlMode)
        ? urlMode
        : defaultModeFor(pool.length);

      startGame(variantKey, modeKey, all);
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  function renderMenu(all) {
    const toggleLi = document.createElement('li');
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'scope-toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = includeAll;
    toggleInput.addEventListener('change', () => {
      setQuizIncludeAll(localStorage, toggleInput.checked);
      window.location.reload();
    });
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(document.createTextNode(' ' + t('menu.includeTerritories', 'Include territories & other flags')));
    toggleLi.appendChild(toggleLabel);
    quizMenuEl.appendChild(toggleLi);

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
      a.href = `?v=${key}&n=${defaultMode}`;
      a.textContent = t(`variant.${key}`, variant.label);
      li.appendChild(a);
      quizMenuEl.appendChild(li);
    }
    const statsLi = document.createElement('li');
    statsLi.className = 'menu-divider';
    const statsA = document.createElement('a');
    statsA.href = 'stats/';
    statsA.textContent = t('menu.yourStats', 'Your stats');
    statsLi.appendChild(statsA);
    quizMenuEl.appendChild(statsLi);

    const flagsDataLi = document.createElement('li');
    flagsDataLi.className = 'menu-divider';
    const flagsDataA = document.createElement('a');
    flagsDataA.href = '../flagsdata/';
    flagsDataA.textContent = t('menu.flagsData', 'Flags data');
    flagsDataLi.appendChild(flagsDataA);
    quizMenuEl.appendChild(flagsDataLi);
  }

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
    }

    function onAnswer(chosen, tile) {
      if (gameOver) return;
      if (chosen.code === currentAnswer.code) {
        answeredCount++;
        if (!timed) {
          progressBarEl.style.width = (answeredCount / target * 100) + '%';
        }
        tile.classList.add('correct');
        for (const t of choicesEl.querySelectorAll('.flag-choice')) {
          /** @type {HTMLButtonElement} */ (t).disabled = true;
        }
        feedbackEl.textContent = '';
        const nextQ = quiz.next();
        if (!nextQ) {
          setTimeout(() => {
            if (!gameOver) {
              gameOver = true;
              showResult();
            }
          }, 250);
        } else {
          setTimeout(() => { if (!gameOver) render(nextQ); }, 250);
        }
      } else {
        tile.classList.add('wrong');
        tile.disabled = true;
        feedbackEl.textContent = countryName(chosen);
        wrongCount++;
        if (timed) flashPenalty();
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
        // mode label already tells the player. The brag-worthy case is
        // running out of flags before the budget ends.
        const poolExhausted = budgetUsed < budgetMs;
        timeEl.textContent = poolExhausted
          ? `${t('game.time', 'Time')}: ${formatTime(budgetUsed)}`
          : '';

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: answeredCount, time: budgetUsed }, includeAll,
        );
        const bestWasPoolExhaust = best.time < budgetMs;
        bestEl.textContent = bestWasPoolExhaust
          ? `${t('quiz.yourBestScore', 'Your best score')}: ${best.score} ${t('game.in', 'in')} ${formatTime(best.time)}`
          : `${t('quiz.yourBestScore', 'Your best score')}: ${best.score}`;
        if (isNew) {
          bestEl.appendChild(document.createTextNode(' '));
          const badge = document.createElement('span');
          badge.className = 'new-badge';
          badge.textContent = t('game.newRecord', 'new record!');
          bestEl.appendChild(badge);
        }
      } else {
        const ratio = countScore() / target;
        const pct = Math.round(ratio * 100);
        finalScoreEl.textContent = String(pct);
        finalScoreLineEl.style.color = scoreColor(ratio);
        timeEl.textContent = `${t('game.time', 'Time')}: ${formatTime(elapsed)}`;

        const { best, isNew } = recordResult(
          localStorage, key, mode, { score: pct, time: elapsed }, includeAll,
        );
        bestEl.textContent =
          `${t('quiz.yourBestScore', 'Your best score')}: ${best.score} ${t('game.in', 'in')} ${formatTime(best.time)}`;
        if (isNew) {
          bestEl.appendChild(document.createTextNode(' '));
          const badge = document.createElement('span');
          badge.className = 'new-badge';
          badge.textContent = t('game.newRecord', 'new record!');
          bestEl.appendChild(badge);
        }
      }

      gameEl.hidden = true;
      progressBarEl.hidden = true;
      resultEl.hidden = false;
    }

    playAgainEl.href = window.location.pathname + window.location.search;

    if (giveUpEl) {
      giveUpEl.addEventListener('click', () => {
        if (gameOver) return;
        gameOver = true;
        if (!timed) {
          // Count-mode give-up: penalise the unanswered remainder so the
          // score reflects "you walked away with this much" rather than
          // crediting unattempted questions.
          wrongCount += target - answeredCount;
        }
        showResult();
      }, { once: true });
    }

    gameEl.hidden = false;
    tickTimer();
    render(quiz.next());
  }
}
