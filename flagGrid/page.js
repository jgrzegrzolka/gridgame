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
 * Picking model: tapping (or pressing Enter on) an empty cell opens a
 * bottom-sheet picker that hosts a real <input>. The OS keyboard fires
 * for free, autocomplete suggestions live inside the sheet, and the
 * cell-level keydown handlers used in the previous design are gone —
 * mobile browsers never showed a keyboard for a focused <td>.
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
  /** Which cell the open picker is filling. null when the picker is closed. */
  /** @type {{ row: number, col: number } | null} */
  let activeCell = null;
  /** @type {Country[]} */
  let currentMatches = [];
  /** Index into currentMatches that arrow keys / Enter act on. */
  let selectedIndex = 0;

  const gridBodyEl = document.getElementById('grid-body');
  const pickerEl = document.getElementById('picker');
  const pickerBackdropEl = document.getElementById('picker-backdrop');
  const pickerCloseEl = document.getElementById('picker-close');
  const pickerCatsEl = document.getElementById('picker-cats');
  const pickerInputEl = /** @type {HTMLInputElement} */ (
    document.getElementById('picker-input')
  );
  const pickerSuggestionsEl = /** @type {HTMLUListElement} */ (
    document.getElementById('picker-suggestions')
  );
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
      td.addEventListener('click', () => onCellActivate(r, c));
      td.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCellActivate(r, c);
        }
      });
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

  function onCellActivate(row, col) {
    if (isLocked()) return;
    if (solution[row][col]) return; // filled cells are inert
    openPicker(row, col);
  }

  function openPicker(row, col) {
    activeCell = { row, col };
    pickerCatsEl.textContent =
      `${puzzle.rows[row].label} × ${puzzle.cols[col].label}`;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    renderSuggestions();
    pickerEl.hidden = false;
    document.body.classList.add('picker-open');
    // Focus after the sheet is visible — iOS only pops the keyboard
    // when focus moves to a visible element inside a user gesture.
    pickerInputEl.focus();
  }

  function closePicker() {
    if (pickerEl.hidden) return;
    activeCell = null;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    pickerSuggestionsEl.innerHTML = '';
    pickerEl.hidden = true;
    document.body.classList.remove('picker-open');
  }

  function updateSuggestions() {
    const query = pickerInputEl.value;
    const excludeCodes = new Set();
    for (const row of solution) for (const cell of row) if (cell) excludeCodes.add(cell.code);
    currentMatches = suggest(allCountries, query, { excludeCodes });
    selectedIndex = 0;
    renderSuggestions();
  }

  function renderSuggestions() {
    pickerSuggestionsEl.innerHTML = '';
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
      // mousedown — fires before the input's blur on desktop, so the
      // pick lands before any blur-driven cleanup. Mobile fires touch
      // before blur too, so a 'click' alternative would also work; we
      // keep mousedown for parity with the previous design.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickCountry(country);
      });
      li.addEventListener('mouseenter', () => {
        selectedIndex = i;
        renderSelected();
      });
      pickerSuggestionsEl.appendChild(li);
    });
  }

  function renderSelected() {
    const items = pickerSuggestionsEl.querySelectorAll('li');
    items.forEach((li, i) => {
      li.classList.toggle('selected', i === selectedIndex);
    });
  }

  pickerInputEl.addEventListener('input', updateSuggestions);
  pickerInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      const cell = activeCell;
      closePicker();
      if (cell) focusCell(cell.row, cell.col);
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
  });

  pickerBackdropEl.addEventListener('click', () => {
    const cell = activeCell;
    closePicker();
    if (cell) focusCell(cell.row, cell.col);
  });
  pickerCloseEl.addEventListener('click', () => {
    const cell = activeCell;
    closePicker();
    if (cell) focusCell(cell.row, cell.col);
  });

  function pickCountry(country) {
    if (!activeCell) return;
    const { row, col } = activeCell;
    const result = tryPick(puzzle, solution, row, col, country);
    if (!result.accepted) {
      if (!solution[row][col]) wrongCount++;
      closePicker();
      shakeCell(row, col);
      focusCell(row, col);
      persistState();
      return;
    }
    solution = result.solution;
    closePicker();
    const filled = countFilled();
    if (filled === 9) {
      finalTimeMs = Date.now() - sessionStart;
    }
    renderGrid();
    persistState();
    if (filled === 9) {
      finishRound();
    } else {
      advanceToNextEmpty();
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

  function focusCell(r, c) {
    const td = /** @type {HTMLTableCellElement | null} */ (
      gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
    );
    if (td) td.focus({ preventScroll: true });
  }

  /**
   * Page load: focus the first empty cell so keyboard users can act,
   * but do NOT auto-open the picker — popping the OS keyboard on
   * arrival is jarring on mobile.
   */
  function focusFirstEmpty() {
    if (isLocked()) return;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (solution[r][c]) continue;
        focusCell(r, c);
        return;
      }
    }
  }

  /**
   * After a successful pick: focus the next empty cell AND open its
   * picker, so the player keeps filling without re-tapping.
   */
  function advanceToNextEmpty() {
    if (isLocked()) return;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (solution[r][c]) continue;
        focusCell(r, c);
        openPicker(r, c);
        return;
      }
    }
  }

  /**
   * Render one cell's content: flag image when filled, empty otherwise.
   * Touches only the classes owned by the renderer — transient classes
   * like .shake survive.
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
      closePicker();
      renderGrid();
      persistState();
      finishRound();
    });
  }

  // Initial visibility decisions:
  // - If the round was already finished in a previous session, show
  //   the result block read-only and skip starting the timer.
  // - Otherwise start the live timer and focus the first empty cell.
  if (isFinished()) {
    finishRound();
  } else {
    if (playTimerEl) tickTimer();
    focusFirstEmpty();
  }
}
