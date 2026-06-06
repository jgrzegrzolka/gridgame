import { flagsGamePool } from '../flags/group.js';
import { suggest, exactSingleMatch } from '../flags/engine.js';
import {
  findPool,
  classifyGuess,
  filterToCategory,
} from '../flags/findFlag.js';
import { formatTime, scoreColor } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti, launchFireworks } from '../confetti.js';
import { todayN, dailyNFromUrl, resolveDailyPuzzle } from '../flags/daily.js';
import { loadScores, saveScore, isCompleteRecord } from './scores.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootDaily() {
  const stateEl = /** @type {HTMLElement} */ (document.getElementById('daily-state'));
  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const resultEl = /** @type {HTMLElement} */ (document.getElementById('result'));
  const numEl = /** @type {HTMLElement} */ (document.getElementById('daily-n'));

  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = /** @type {HTMLImageElement} */ (zoom.querySelector('img'));
  const zoomName = /** @type {HTMLParagraphElement} */ (zoom.querySelector('p'));
  /** @param {Country} c */
  function openZoom(c) {
    zoomImg.src = `../flags/svg/${c.code}.svg`;
    const displayName = countryName(c);
    zoomImg.alt = displayName;
    zoomName.textContent = displayName;
    zoom.showModal();
  }
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });

  /** @param {Country} c */
  function flagTile(c) {
    const displayName = countryName(c);
    const li = document.createElement('li');
    li.className = 'find-tile';
    li.dataset.name = displayName;
    li.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = displayName;
    img.loading = 'lazy';
    li.appendChild(img);
    return li;
  }

  return Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()),
    fetch('./daily_puzzles.json').then((r) => r.json()),
  ])
    .then(([raw, catalog]) => {
      const all = withLocalizedAliases(flagsGamePool(raw, false));
      const today = todayN(catalog);
      const n = dailyNFromUrl(window.location.search, today);
      numEl.textContent = `#${n}`;

      const result = resolveDailyPuzzle(catalog, all, n);
      if (result.ok === false) {
        showState(reasonMessage(result.reason));
        return;
      }

      // Revisit: if this puzzle has a full saved record, jump
      // straight to the result page without confetti (the player
      // saw confetti the first time around; replaying it on every
      // revisit would be obnoxious).
      const stored = loadScores(window.localStorage)[n];
      if (isCompleteRecord(stored)) {
        const foundCodes = new Set(stored.c);
        renderResult(result.targets, foundCodes, stored.ms);
        return;
      }

      const category = filterToCategory(result.filter, t);
      startGame(n, category, result.targets, all);
    })
    .catch((err) => {
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });

  /** @param {string} msg */
  function showState(msg) {
    stateEl.textContent = msg;
    stateEl.hidden = false;
    gameEl.hidden = true;
    resultEl.hidden = true;
  }

  /**
   * Map a resolveDailyPuzzle failure reason to a localised message. Kept
   * inline (rather than promoted to the i18n module) so the message
   * shape stays a per-page concern — daily's pre-launch copy doesn't
   * leak into other features.
   *
   * @param {'not-found' | 'invalid-filter' | 'no-targets'} reason
   */
  function reasonMessage(reason) {
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
   * Paint the result section (final score, time, found grid, missed
   * grid) from a finished game's state, then swap from #game to
   * #result. Called from both `finish()` (just-completed play) and
   * the revisit boot path (restored from localStorage). Confetti is
   * the caller's responsibility — revisits don't want it.
   *
   * @param {Country[]} targets
   * @param {Set<string>} foundCodes
   * @param {number} elapsedMs
   */
  function renderResult(targets, foundCodes, elapsedMs) {
    const found = foundCodes.size;
    const total = targets.length;
    /** @type {HTMLElement} */ (document.getElementById('final-found')).textContent = String(found);
    /** @type {HTMLElement} */ (document.getElementById('final-total')).textContent = String(total);
    /** @type {HTMLElement} */ (document.getElementById('final-time')).textContent =
      `${t('game.time', 'Time')}: ${formatTime(elapsedMs)}`;
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
   * something meaningful until we add a shareable score string in
   * a later phase). The final found/total IS persisted (per puzzle
   * number) so the archive can show the player their score.
   *
   * @param {number} n
   * @param {import('../flags/engine.js').Category} category
   * @param {Country[]} targets
   * @param {Country[]} all
   */
  function startGame(n, category, targets, all) {
    const pool = findPool(all);
    const targetCodes = new Set(targets.map((c) => c.code));
    const foundCodes = new Set();
    const state = { targetCodes, foundCodes };

    const catEl = /** @type {HTMLElement} */ (document.getElementById('find-cat'));
    const countEl = /** @type {HTMLElement} */ (document.getElementById('find-count'));
    const timeEl = /** @type {HTMLElement} */ (document.getElementById('find-time'));
    const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
    const sugEl = /** @type {HTMLElement} */ (document.getElementById('find-suggestions'));
    const foundEl = /** @type {HTMLElement} */ (document.getElementById('find-found'));
    const giveUpEl = /** @type {HTMLElement} */ (document.getElementById('give-up'));

    catEl.textContent = category.label;
    updateCount();

    /** @type {Country[]} */
    let matches = [];
    let selected = 0;
    const startMs = Date.now();
    let timerRaf = 0;
    let finished = false;

    function updateCount() {
      countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
    }
    function tick() {
      timeEl.textContent = formatTime(Date.now() - startMs);
      if (!finished) timerRaf = requestAnimationFrame(tick);
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
      cancelAnimationFrame(timerRaf);
      const elapsed = Date.now() - startMs;
      const found = foundCodes.size;
      const total = targetCodes.size;
      saveScore(window.localStorage, n, found, total, Array.from(foundCodes), elapsed);
      if (found > 0) {
        launchConfetti();
        // Clean sweep gets fireworks on top of the confetti — confetti
        // alone is the standard celebration, fireworks mark a perfect
        // round.
        if (found === total) launchFireworks();
      }
      renderResult(targets, foundCodes, elapsed);
    }

    gameEl.hidden = false;
    tick();
    if (!('ontouchstart' in window)) inputEl.focus();
  }
}
