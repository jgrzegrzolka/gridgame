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
  const pickerEl = /** @type {HTMLDialogElement} */ (document.getElementById('picker'));
  const pickerInputEl = /** @type {HTMLInputElement} */ (document.getElementById('picker-input'));
  const suggestionsEl = document.getElementById('suggestions');
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
      td.addEventListener('click', () => openPicker(r, c));
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

  function openPicker(row, col) {
    if (isLocked()) return;
    if (solution[row][col]) return;
    activeCell = { row, col };
    pickerInputEl.value = '';
    suggestionsEl.innerHTML = '';
    topMatch = null;
    const td = gridBodyEl.querySelector(
      `td[data-row="${row}"][data-col="${col}"]`,
    );
    const rect = td.getBoundingClientRect();
    pickerEl.style.top = rect.top + 'px';
    pickerEl.style.left = rect.left + 'px';
    pickerEl.style.width = rect.width + 'px';
    pickerEl.show();
    pickerInputEl.focus();
  }

  pickerInputEl.addEventListener('input', () => {
    suggestionsEl.innerHTML = '';
    const excludeCodes = new Set();
    for (const row of solution) for (const cell of row) if (cell) excludeCodes.add(cell.code);
    const matches = suggest(allCountries, pickerInputEl.value, { excludeCodes });
    topMatch = matches[0] ?? null;
    for (const country of matches) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = `../../flags/svg/${country.code}.svg`;
      img.alt = '';
      li.appendChild(img);
      const name = document.createElement('span');
      name.textContent = country.name;
      li.appendChild(name);
      li.addEventListener('click', () => pickCountry(country));
      suggestionsEl.appendChild(li);
    }
  });

  pickerInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && topMatch) {
      e.preventDefault();
      pickCountry(topMatch);
    }
  });

  document.addEventListener('click', (e) => {
    if (!pickerEl.open) return;
    if (pickerEl.contains(e.target)) return;
    if (/** @type {HTMLElement} */ (e.target).closest('.cell')) return;
    pickerEl.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pickerEl.open) pickerEl.close();
  });

  function pickCountry(country) {
    if (!activeCell) return;
    const { row, col } = activeCell;
    const result = tryPick(puzzle, solution, row, col, country);
    pickerEl.close();
    if (!result.accepted) {
      if (!solution[row][col]) wrongCount++;
      shakeCell(row, col);
      renderGrid();
      persistState();
      return;
    }
    solution = result.solution;
    const filled = countFilled();
    if (filled === 9) {
      finalTimeMs = Date.now() - sessionStart;
    }
    renderGrid();
    persistState();
    if (filled === 9) finishRound();
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

  function renderGrid() {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const td = /** @type {HTMLTableCellElement} */ (
          gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
        );
        const country = solution[r][c];
        for (const [klass, shouldHave] of cellRenderClasses(country)) {
          td.classList.toggle(klass, shouldHave);
        }
        td.innerHTML = '';
        if (!country) continue;
        const img = document.createElement('img');
        img.src = `../../flags/svg/${country.code}.svg`;
        img.alt = country.name;
        td.appendChild(img);
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
    if (playTimerEl) playTimerEl.hidden = true;
    if (!resultEl) return;
    const filledCount = countFilled();
    const score = computeGridScore({ filledCount, wrongCount });
    if (finalScoreEl) finalScoreEl.textContent = String(score);
    if (finalScoreLineEl) finalScoreLineEl.style.color = scoreColor(score / 100);
    if (timeEl && finalTimeMs !== null) {
      timeEl.textContent = `Time: ${formatTime(finalTimeMs)}`;
    }
    if (playAgainEl) {
      if (allowReplay) {
        playAgainEl.href = window.location.pathname + window.location.search;
      } else {
        playAgainEl.hidden = true;
      }
    }
    resultEl.hidden = false;
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (isLocked()) return;
      gaveUp = true;
      finalTimeMs = Date.now() - sessionStart;
      if (pickerEl.open) pickerEl.close();
      renderGrid();
      persistState();
      finishRound();
    });
  }

  // Initial visibility decisions:
  // - If the round was already finished in a previous session, show
  //   the result block read-only and skip starting the timer.
  // - Otherwise start the live timer and keep the give-up button.
  if (isFinished()) {
    finishRound();
  } else if (playTimerEl) {
    tickTimer();
  }
}
