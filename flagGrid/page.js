import {
  tryPick,
  suggest,
  computeGridScore,
  loadGridState,
  saveGridState,
  cellRenderClasses,
  pulseShake,
} from '../flags/grid.js';
import { formatTime, scoreColor } from '../flags/quiz.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/grid.js').Puzzle} Puzzle */
/** @typedef {import('../flags/grid.js').GridState} GridState */

/**
 * Fetch countries.json, build a puzzle from the variant's `puzzleFor`
 * callback, then mount the UI.
 *
 * Options:
 *  - `stateKey`: localStorage key. When set, picks/wrongCount/finalTime
 *    persist and a finished round is restored read-only on revisit.
 *  - `allowReplay`: when true the end-game block shows a "Play again"
 *    link. Pages that persist a single trial (e.g. Game 1) omit this.
 *
 * @param {(countries: Country[]) => Puzzle} puzzleFor
 * @param {{ stateKey?: string, allowReplay?: boolean }} [options]
 */
export function bootFlagGrid(puzzleFor, options = {}) {
  fetch('../../flags/countries.json')
    .then((r) => r.json())
    .then((countries) => {
      const puzzle = puzzleFor(countries);
      runFlagGrid({ puzzle, countries, options });
    })
    .catch((err) => {
      const liveEl = document.getElementById('play-time');
      if (liveEl) liveEl.textContent = 'Failed to load: ' + err.message;
    });
}

/**
 * Mount the Flag Grid UI against the markup in the variant's index.html
 * for the given puzzle and pre-fetched country list. Variants differ in
 * which puzzle they supply and whether they persist state.
 *
 * @param {{
 *   puzzle: Puzzle,
 *   countries: Country[],
 *   options?: { stateKey?: string, allowReplay?: boolean },
 * }} config
 */
export function runFlagGrid({ puzzle, countries, options = {} }) {
  const { stateKey, allowReplay = false } = options;
  const store = stateKey ? globalThis.localStorage : null;
  const byCode = new Map(countries.map((c) => [c.code, c]));

  // Hydrate from any persisted state — picks come back as codes, look
  // each one up in the live country list so the renderer has the same
  // Country objects it would get from a fresh pick.
  const saved = store && stateKey ? loadGridState(store, stateKey) : null;
  /** @type {(Country | null)[][]} */
  let solution = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  let wrongCount = 0;
  let gaveUp = false;
  /** @type {number | null} */
  let finalTimeMs = null;
  if (saved) {
    for (let i = 0; i < 9; i++) {
      const code = saved.picks[i];
      const c = code ? byCode.get(code) : null;
      solution[Math.floor(i / 3)][i % 3] = c ?? null;
    }
    wrongCount = saved.wrongCount;
    gaveUp = saved.gaveUp;
    finalTimeMs = saved.finalTimeMs;
  }

  /** @type {Country[]} */
  const allCountries = countries;
  /** @type {{ row: number, col: number } | null} */
  let activeCell = null;
  /** @type {Country | null} */
  let topMatch = null;

  const gridBodyEl = document.getElementById('grid-body');
  const suggestionsEl = /** @type {HTMLUListElement} */ (document.getElementById('suggestions'));
  /** Current in-cell autocomplete query (live in the focused cell). */
  let query = '';
  /** @type {Country[]} */
  let currentMatches = [];
  /** Index into currentMatches that arrow keys / Enter act on. */
  let selectedIndex = 0;
  const colHeaderEls = document.querySelectorAll('.col-header');
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  const playTimerEl = document.getElementById('play-timer-line');
  const playTimeEl = document.getElementById('play-time');
  const resultEl = document.getElementById('result');
  const finalScoreLineEl = document.getElementById('final-score-line');
  const finalScoreEl = document.getElementById('final-score');
  const timeEl = document.getElementById('time');
  const playAgainEl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('play-again'));

  colHeaderEls.forEach((th, i) => {
    th.textContent = puzzle.cols[i].label;
  });

  for (let r = 0; r < 3; r++) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.textContent = puzzle.rows[r].label;
    tr.appendChild(rowHeader);
    for (let c = 0; c < 3; c++) {
      const td = document.createElement('td');
      td.className = 'cell';
      td.dataset.row = String(r);
      td.dataset.col = String(c);
      td.tabIndex = 0;
      td.addEventListener('focus', () => onCellFocus(r, c));
      td.addEventListener('blur', () => onCellBlur(r, c));
      td.addEventListener('keydown', (e) => onCellKey(r, c, e));
      tr.appendChild(td);
    }
    gridBodyEl.appendChild(tr);
  }

  // In-memory timer. We don't persist elapsed across sessions — if a
  // /1/ game is finished, finalTimeMs is shown; otherwise the timer
  // resets to 0 for this session.
  const sessionStart = Date.now();
  let timerRaf = 0;
  function tickTimer() {
    if (playTimeEl) playTimeEl.textContent = formatTime(Date.now() - sessionStart);
    timerRaf = requestAnimationFrame(tickTimer);
  }
  function stopTimer() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = 0;
  }

  renderGrid();

  function isFinished() {
    return finalTimeMs !== null;
  }
  function isLocked() {
    // While solved is computed live during play, the persistence
    // boundary is finalTimeMs: once that's set we treat the round as
    // permanently over and the board as read-only.
    return isFinished() || gaveUp;
  }

  function onCellFocus(row, col) {
    activeCell = { row, col };
    query = '';
    topMatch = null;
    renderCellContent(row, col);
    hideSuggestions();
  }

  function onCellBlur(row, col) {
    // Suggestions get their own click handlers, which fire before
    // blur — so a click on a suggestion still pickCountry()s before
    // we clear here. Tabbing or clicking elsewhere clears the query
    // and the in-cell echo.
    if (activeCell && activeCell.row === row && activeCell.col === col) {
      activeCell = null;
    }
    if (!solution[row][col]) {
      query = '';
      renderCellContent(row, col);
    }
    hideSuggestions();
  }

  function onCellKey(row, col, e) {
    if (isLocked()) return;
    if (solution[row][col]) return; // filled cells are inert
    if (e.key === 'Escape') {
      e.preventDefault();
      query = '';
      currentMatches = [];
      topMatch = null;
      renderCellContent(row, col);
      hideSuggestions();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = currentMatches[selectedIndex];
      if (picked) pickCountry(picked);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMatches.length === 0) return;
      selectedIndex = (selectedIndex + 1) % currentMatches.length;
      renderSelected();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentMatches.length === 0) return;
      selectedIndex = (selectedIndex - 1 + currentMatches.length) % currentMatches.length;
      renderSelected();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (query.length > 0) {
        query = query.slice(0, -1);
        renderCellContent(row, col);
        updateSuggestions();
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      query += e.key;
      renderCellContent(row, col);
      updateSuggestions();
    }
  }

  function updateSuggestions() {
    if (!activeCell) {
      hideSuggestions();
      return;
    }
    const excludeCodes = new Set();
    for (const row of solution) for (const cell of row) if (cell) excludeCodes.add(cell.code);
    currentMatches = suggest(allCountries, query, { excludeCodes });
    topMatch = currentMatches[0] ?? null;
    selectedIndex = 0;
    suggestionsEl.innerHTML = '';
    if (currentMatches.length === 0) {
      hideSuggestions();
      return;
    }
    currentMatches.forEach((country, i) => {
      const li = document.createElement('li');
      if (i === selectedIndex) li.classList.add('selected');
      const img = document.createElement('img');
      img.src = `../../flags/svg/${country.code}.svg`;
      img.alt = '';
      li.appendChild(img);
      const name = document.createElement('span');
      name.textContent = country.name;
      li.appendChild(name);
      // mousedown — fires before the cell's blur that would clear
      // the query and tear down the suggestions list.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickCountry(country);
      });
      // Hover also moves the keyboard selection — keeps the highlighted
      // row in sync with whatever the user's pointer is over, so
      // Enter and click agree.
      li.addEventListener('mouseenter', () => {
        selectedIndex = i;
        renderSelected();
      });
      suggestionsEl.appendChild(li);
    });
    positionSuggestionsAtActiveMiddle();
    suggestionsEl.hidden = false;
  }

  function renderSelected() {
    const items = suggestionsEl.querySelectorAll('li');
    items.forEach((li, i) => {
      li.classList.toggle('selected', i === selectedIndex);
    });
  }

  function hideSuggestions() {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = '';
    currentMatches = [];
    selectedIndex = 0;
  }

  function positionSuggestionsAtActiveMiddle() {
    if (!activeCell) return;
    const td = gridBodyEl.querySelector(
      `td[data-row="${activeCell.row}"][data-col="${activeCell.col}"]`,
    );
    if (!td) return;
    const rect = td.getBoundingClientRect();
    // position: fixed — viewport-relative; anchor to the cell's
    // vertical middle so the suggestions list overlaps the bottom
    // half of the cell and extends downward.
    suggestionsEl.style.top = `${rect.top + rect.height / 2}px`;
    suggestionsEl.style.left = `${rect.left}px`;
  }

  function pickCountry(country) {
    if (!activeCell) return;
    const { row, col } = activeCell;
    const result = tryPick(puzzle, solution, row, col, country);
    if (!result.accepted) {
      if (!solution[row][col]) wrongCount++;
      query = '';
      topMatch = null;
      hideSuggestions();
      renderCellContent(row, col);
      shakeCell(row, col);
      persistState();
      return;
    }
    solution = result.solution;
    query = '';
    topMatch = null;
    hideSuggestions();
    const filled = countFilled();
    if (filled === 9) {
      finalTimeMs = Date.now() - sessionStart;
    }
    renderGrid();
    persistState();
    if (filled === 9) {
      finishRound();
    } else {
      focusNextEmpty();
    }
  }

  function shakeCell(row, col) {
    const td = gridBodyEl.querySelector(
      `td[data-row="${row}"][data-col="${col}"]`,
    );
    td.classList.remove('shake');
    void td.offsetWidth;
    pulseShake(td);
  }

  function countFilled() {
    let n = 0;
    for (const row of solution) for (const c of row) if (c) n++;
    return n;
  }

  /**
   * Move keyboard focus to the next empty cell in reading order
   * (left-to-right, top-to-bottom). No-op when the board is locked or
   * already full. Uses preventScroll so initial focus on page load
   * doesn't jump the viewport.
   */
  function focusNextEmpty() {
    if (isLocked()) return;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (solution[r][c]) continue;
        const td = /** @type {HTMLTableCellElement | null} */ (
          gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
        );
        if (td) td.focus({ preventScroll: true });
        return;
      }
    }
  }

  /**
   * Render one cell's content: flag image when filled, or the current
   * autocomplete query (gray text echo) when this is the active empty
   * cell, or empty otherwise. Touches only the classes owned by the
   * renderer — transient classes like .shake survive.
   */
  function renderCellContent(r, c) {
    const td = /** @type {HTMLTableCellElement} */ (
      gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
    );
    if (!td) return;
    const country = solution[r][c];
    for (const [klass, shouldHave] of cellRenderClasses(country)) {
      td.classList.toggle(klass, shouldHave);
    }
    td.innerHTML = '';
    if (country) {
      const img = document.createElement('img');
      img.src = `../../flags/svg/${country.code}.svg`;
      img.alt = country.name;
      td.appendChild(img);
      return;
    }
    if (activeCell && activeCell.row === r && activeCell.col === c && query) {
      const span = document.createElement('span');
      span.className = 'cell-query';
      span.textContent = query;
      td.appendChild(span);
    }
  }

  function renderGrid() {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        renderCellContent(r, c);
      }
    }
    if (giveUpEl) giveUpEl.hidden = isLocked();
  }

  function persistState() {
    if (!store || !stateKey) return;
    const picks = solution.flat().map((c) => (c ? c.code : null));
    saveGridState(store, stateKey, {
      picks,
      wrongCount,
      gaveUp,
      finalTimeMs,
    });
  }

  function finishRound() {
    stopTimer();
    // Freeze the live timer at the final value — keep the slot occupied
    // so the grid doesn't shift up when the round ends.
    if (playTimeEl && finalTimeMs !== null) {
      playTimeEl.textContent = formatTime(finalTimeMs);
    }
    if (!resultEl) return;
    const filledCount = countFilled();
    const score = computeGridScore({ filledCount, wrongCount });
    if (finalScoreEl) finalScoreEl.textContent = String(score);
    if (finalScoreLineEl) finalScoreLineEl.style.color = scoreColor(score / 100);
    if (timeEl && finalTimeMs !== null) {
      timeEl.textContent = `Time: ${formatTime(finalTimeMs)}`;
    }
    if (playAgainEl) {
      // /1/ persists state, so a replay must first wipe it — otherwise
      // the freshly-loaded round would just re-hydrate the same locked
      // state we're trying to escape. /rand/ has no state, so this is
      // a plain reload.
      playAgainEl.href = window.location.pathname + window.location.search;
      if (stateKey) playAgainEl.textContent = 'Retry';
      playAgainEl.addEventListener('click', (e) => {
        e.preventDefault();
        if (store && stateKey) store.removeItem(stateKey);
        window.location.reload();
      }, { once: true });
    }
    resultEl.hidden = false;
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (isLocked()) return;
      gaveUp = true;
      finalTimeMs = Date.now() - sessionStart;
      hideSuggestions();
      query = '';
      renderGrid();
      persistState();
      finishRound();
    });
  }

  // Reposition any open suggestions on scroll/resize so the popup
  // tracks its anchor cell.
  window.addEventListener('scroll', () => {
    if (!suggestionsEl.hidden) positionSuggestionsAtActiveMiddle();
  });
  window.addEventListener('resize', () => {
    if (!suggestionsEl.hidden) positionSuggestionsAtActiveMiddle();
  });

  // Initial visibility decisions:
  // - If the round was already finished in a previous session, show
  //   the result block read-only and skip starting the timer.
  // - Otherwise start the live timer and keep the give-up button.
  if (isFinished()) {
    finishRound();
  } else {
    if (playTimerEl) tickTimer();
    focusNextEmpty();
  }
}
