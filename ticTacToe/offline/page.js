import { generateRandomPuzzle, suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../../flags/grid.js';
import { newGame, attemptClaim, isGameOver } from '../../flags/ticTacToe.js';
import { t, countryName, withLocalizedAliases } from '../../i18n.js';

/** @typedef {import('../../flags/group.js').Country} Country */
/** @typedef {import('../../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../../flags/ticTacToe.js').Player} Player */

/** @param {import('../../flags/grid.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

export function bootTicTacToe() {
  fetch('../../flags/countries.json')
    .then((r) => r.json())
    .then((rawCountries) => {
      const countries = withLocalizedAliases(rawCountries);
      const puzzle = generateRandomPuzzle(countries);
      runTicTacToe({ puzzle, countries });
    })
    .catch((err) => {
      const turnText = document.getElementById('turn-text');
      if (turnText) turnText.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
 * @param {{ puzzle: import('../../flags/grid.js').Puzzle, countries: Country[] }} config
 */
function runTicTacToe({ puzzle, countries }) {
  let state = newGame(puzzle, 'O');
  /** @type {Player | null} */
  let lastRenderedPlayer = null;

  /** @type {{ row: number, col: number } | null} */
  let activeCell = null;
  /** @type {Country[]} */
  let currentMatches = [];
  let selectedIndex = 0;

  const gridBodyEl = document.getElementById('grid-body');
  const pickerEl = document.getElementById('picker');
  const pickerBackdropEl = document.getElementById('picker-backdrop');
  const pickerCloseEl = document.getElementById('picker-close');
  const pickerCatsEl = document.getElementById('picker-cats');
  const pickerInputEl = /** @type {HTMLInputElement} */ (document.getElementById('picker-input'));
  const pickerSuggestionsEl = /** @type {HTMLUListElement} */ (document.getElementById('picker-suggestions'));
  const colHeaderEls = document.querySelectorAll('.col-header');
  const turnLineEl = document.getElementById('turn-line');
  const turnBadgeEl = document.getElementById('turn-badge');
  const turnTextEl = document.getElementById('turn-text');
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const playAgainEl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('play-again'));

  colHeaderEls.forEach((th, i) => {
    th.textContent = tCat(puzzle.cols[i]);
  });

  for (let r = 0; r < 3; r++) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.textContent = tCat(puzzle.rows[r]);
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

  renderAll();

  /** @param {number} row @param {number} col */
  function onCellActivate(row, col) {
    if (isGameOver(state)) return;
    if (state.cells[row][col].owner) return;
    openPicker(row, col);
  }

  /** @param {number} row @param {number} col */
  function openPicker(row, col) {
    activeCell = { row, col };
    pickerCatsEl.textContent = `${tCat(puzzle.rows[row])} × ${tCat(puzzle.cols[col])}`;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    renderSuggestions();
    pickerEl.hidden = false;
    document.body.classList.add('picker-open');
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
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = state.cells[r][c];
        if (cell.country) excludeCodes.add(cell.country.code);
      }
    }
    currentMatches = suggest(countries, query, { excludeCodes });
    selectedIndex = 0;
    renderSuggestions();
    const auto = exactSingleMatch(currentMatches, query);
    if (auto) pickCountry(auto);
  }

  function renderSuggestions() {
    pickerSuggestionsEl.innerHTML = '';
    currentMatches.forEach((country, i) => {
      const li = document.createElement('li');
      if (i === selectedIndex) li.classList.add('selected');
      const name = document.createElement('span');
      name.textContent = countryName(country);
      li.appendChild(name);
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

  /** @param {Country} country */
  function pickCountry(country) {
    if (!activeCell) return;
    const { row, col } = activeCell;
    const outcome = attemptClaim(state, row, col, country);
    state = outcome.nextState;
    closePicker();
    if (outcome.kind === 'claimed') {
      renderAll();
      if (isGameOver(state)) {
        finishRound();
      } else {
        focusCell(row, col);
      }
    } else {
      // miss-invalid or miss-duplicate — shake the cell, turn already flipped by engine.
      shakeCell(row, col);
      renderTurn();
      focusCell(row, col);
    }
  }

  /** @param {number} row @param {number} col */
  function shakeCell(row, col) {
    const td = /** @type {HTMLTableCellElement} */ (
      gridBodyEl.querySelector(`td[data-row="${row}"][data-col="${col}"]`)
    );
    td.classList.remove('shake');
    void td.offsetWidth;
    pulseShake(td);
  }

  /** @param {number} r @param {number} c */
  function focusCell(r, c) {
    const td = /** @type {HTMLTableCellElement | null} */ (
      gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
    );
    if (td) td.focus({ preventScroll: true });
  }

  /** @param {number} r @param {number} c */
  function renderCellContent(r, c) {
    const td = /** @type {HTMLTableCellElement} */ (
      gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
    );
    if (!td) return;
    const cell = state.cells[r][c];
    td.innerHTML = '';
    td.classList.toggle('owned', !!cell.owner);
    td.classList.toggle('owner-x', cell.owner === 'X');
    td.classList.toggle('owner-o', cell.owner === 'O');
    td.classList.remove('winning');
    if (cell.country && cell.owner) {
      const img = document.createElement('img');
      img.src = `../../flags/svg/${cell.country.code}.svg`;
      img.alt = countryName(cell.country);
      td.appendChild(img);
    }
  }

  function renderGrid() {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        renderCellContent(r, c);
      }
    }
    if (state.winningLine) {
      for (const [r, c] of state.winningLine) {
        const td = gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
        if (td) td.classList.add('winning');
      }
    }
    document.body.classList.toggle('game-over', isGameOver(state));
  }

  function renderTurn() {
    if (!turnBadgeEl || !turnTextEl) return;
    if (isGameOver(state)) {
      if (turnLineEl) turnLineEl.hidden = true;
      lastRenderedPlayer = null;
      return;
    }
    if (turnLineEl) turnLineEl.hidden = false;
    turnBadgeEl.hidden = false;
    turnBadgeEl.textContent = state.currentPlayer;
    const changed = lastRenderedPlayer !== state.currentPlayer;
    turnBadgeEl.className = 'turn-badge ' + state.currentPlayer.toLowerCase();
    turnTextEl.textContent = t('ttt.toMove', 'to move');
    if (changed) {
      void turnBadgeEl.offsetWidth; // restart the bounce animation on every turn change.
      turnBadgeEl.classList.add('bounce');
      lastRenderedPlayer = state.currentPlayer;
    }
  }

  function renderAll() {
    renderGrid();
    renderTurn();
  }

  function finishRound() {
    if (!resultEl || !finalScoreEl) return;
    if (state.winner) {
      finalScoreEl.textContent =
        t('ttt.playerWins', '{player} wins!').replace('{player}', state.winner);
      finalScoreEl.style.color = state.winner === 'X' ? 'var(--x-color)' : 'var(--o-color)';
    } else {
      finalScoreEl.textContent = t('ttt.draw', 'Draw');
      finalScoreEl.style.color = '#1c1c1c';
    }
    if (playAgainEl) {
      playAgainEl.href = window.location.pathname + window.location.search;
      playAgainEl.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.reload();
      }, { once: true });
    }
    resultEl.hidden = false;
  }
}
