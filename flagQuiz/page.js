import {
  createQuiz,
  VARIANTS,
  availableModes,
  defaultModeFor,
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
import { t } from '../i18n.js';

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
      document.body.textContent = `${t('quiz.failedToLoad', 'Failed to load:')} ${err.message}`;
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

    // Language toggle (last item — the bottom of the burger). Hidden by
    // common.css while I18N_ENABLED is false; wireLangToggle still wires
    // it up so it works the moment the flag flips.
    const langLi = document.createElement('li');
    langLi.className = 'menu-divider';
    const langA = document.createElement('a');
    langA.href = '#';
    langA.id = 'lang-toggle';
    langLi.appendChild(langA);
    quizMenuEl.appendChild(langLi);
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
      if (m === mode) {
        const span = document.createElement('span');
        span.className = 'mode-current';
        span.textContent = m;
        modeToggleEl.appendChild(span);
      } else {
        const a = document.createElement('a');
        a.href = `?v=${key}&n=${m}`;
        a.textContent = m;
        modeToggleEl.appendChild(a);
      }
    });
  }

  function startGame(key, mode, all) {
    const pool = poolFor(key, all);
    const target = targetFor(mode, pool);
    const quiz = createQuiz(pool, target);
    playModeEl.textContent = t(`variant.${key}`, VARIANTS[key].label);
    renderModeToggle(key, mode, availableModes(pool.length));

    let currentAnswer = null;
    let wrongCount = 0;
    let answeredCount = 0;
    const startTime = Date.now();
    let timerRaf = 0;

    function tickTimer() {
      playTimerEl.textContent = formatTime(Date.now() - startTime);
      timerRaf = requestAnimationFrame(tickTimer);
    }

    function score() {
      return Math.max(0, target - wrongCount);
    }

    function render(q) {
      currentAnswer = q.answer;
      countryNameEl.textContent = q.answer.name;
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
      if (chosen.code === currentAnswer.code) {
        answeredCount++;
        progressBarEl.style.width = (answeredCount / target * 100) + '%';
        tile.classList.add('correct');
        for (const t of choicesEl.querySelectorAll('.flag-choice')) {
          /** @type {HTMLButtonElement} */ (t).disabled = true;
        }
        feedbackEl.textContent = '';
        const nextQ = quiz.next();
        if (!nextQ) {
          setTimeout(showResult, 250);
        } else {
          setTimeout(() => render(nextQ), 250);
        }
      } else {
        tile.classList.add('wrong');
        tile.disabled = true;
        feedbackEl.textContent = chosen.name;
        wrongCount++;
      }
    }

    function showResult() {
      cancelAnimationFrame(timerRaf);
      const ratio = score() / target;
      const pct = Math.round(ratio * 100);
      const elapsed = Date.now() - startTime;
      finalScoreEl.textContent = String(pct);
      finalScoreLineEl.style.color = scoreColor(ratio);
      timeEl.textContent = `${t('quiz.time', 'Time')}: ${formatTime(elapsed)}`;

      const { best, isNew } = recordResult(
        localStorage, key, mode, { score: pct, time: elapsed }, includeAll,
      );
      bestEl.textContent =
        `${t('quiz.yourBestScore', 'Your best score')}: ${best.score} ${t('quiz.in', 'in')} ${formatTime(best.time)}`;
      if (isNew) {
        bestEl.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = t('quiz.newRecord', 'new record!');
        bestEl.appendChild(badge);
      }

      gameEl.hidden = true;
      progressBarEl.hidden = true;
      resultEl.hidden = false;
    }

    playAgainEl.href = window.location.pathname + window.location.search;

    if (giveUpEl) {
      giveUpEl.addEventListener('click', () => {
        wrongCount += target - answeredCount;
        showResult();
      }, { once: true });
    }

    gameEl.hidden = false;
    tickTimer();
    render(quiz.next());
  }
}
