import { generateUltimateRandomPuzzle, suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../../../flags/engine.js';
import {
  newUltimateGame,
  attemptUltimateClaim,
  isUltimateGameOver,
  applyUltimateGiveUp,
  newlyWonSmallBoards,
  isMetaWinNewlyFormed,
} from '../../../flags/ultimateTicTacToe.js';
import { shouldFireTicTacToeConfetti } from '../../../flags/ticTacToe.js';
import { loadCountries } from '../../../flags/group.js';
import { t, countryName, withLocalizedAliases } from '../../../i18n.js';
import { launchConfetti } from '../../../confetti.js';
import { lockBodyScroll, unlockBodyScroll } from '../../bodyScrollLock.js';

/** @typedef {import('../../../flags/group.js').Country} Country */
/** @typedef {import('../../../flags/ultimateTicTacToe.js').UltimateGameState} UltimateGameState */
/** @typedef {import('../../../flags/ticTacToe.js').Player} Player */

/** @param {import('../../../flags/engine.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

export function bootTicTacToe9x9() {
  fetch('../../../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((rawCountries) => {
      const countries = withLocalizedAliases(rawCountries);
      // 9×9 requires every (row × col) small board to be filled with 9 distinct
      // flags AND no flag shared across small boards (global no-duplicate).
      // generateUltimateRandomPuzzle uses Hall's marriage theorem to ensure
      // every generated puzzle admits a full 81-distinct-country solution, so
      // no small board can dead-end early from a global-pool starvation.
      const puzzle = generateUltimateRandomPuzzle(countries);
      runUltimateTicTacToe({ puzzle, countries });
    })
    .catch((err) => {
      const turnText = document.getElementById('turn-text');
      if (turnText) turnText.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
 * @param {{ puzzle: import('../../../flags/engine.js').Puzzle, countries: Country[] }} config
 */
function runUltimateTicTacToe({ puzzle, countries }) {
  let state = newUltimateGame(puzzle, 'O');
  // Snapshot of the previous state used by renderGrid to detect "what
  // won this turn" for the one-shot shake animation. Must be declared
  // before renderAll() is first invoked below — renderGrid reads it.
  // Starts as the initial state (every winningLine === null) so nothing
  // shakes on first render.
  let prevState = state;
  /** @type {Player | null} */
  let lastRenderedPlayer = null;

  /** @type {{ bigRow: number, bigCol: number, smallRow: number, smallCol: number } | null} */
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
  const zoomEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('zoom'));
  const zoomImg = zoomEl ? /** @type {HTMLImageElement | null} */ (zoomEl.querySelector('img')) : null;
  const zoomName = zoomEl ? /** @type {HTMLParagraphElement | null} */ (zoomEl.querySelector('p')) : null;
  const turnLineEl = document.getElementById('turn-line');
  const turnBadgeEl = document.getElementById('turn-badge');
  const turnTextEl = document.getElementById('turn-text');
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const playAgainEl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('play-again'));
  const playAgainInlineEl = /** @type {HTMLAnchorElement | null} */ (
    document.getElementById('play-again-inline')
  );
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));

  colHeaderEls.forEach((th, i) => {
    th.textContent = tCat(puzzle.cols[i]);
  });

  // Build 9 grid rows. The first row of each meta-row band (grid rows 0, 3, 6)
  // carries a rowspan=3 row header on its left so the original 3 row labels
  // stay readable above their full vertical band.
  for (let r = 0; r < 9; r++) {
    const tr = document.createElement('tr');
    if (r % 3 === 0) {
      const rowHeader = document.createElement('th');
      rowHeader.rowSpan = 3;
      rowHeader.textContent = tCat(puzzle.rows[r / 3]);
      tr.appendChild(rowHeader);
    }
    for (let c = 0; c < 9; c++) {
      const td = document.createElement('td');
      td.className = 'cell';
      const bigRow = Math.floor(r / 3);
      const bigCol = Math.floor(c / 3);
      const smallRow = r % 3;
      const smallCol = c % 3;
      td.dataset.bigrow = String(bigRow);
      td.dataset.bigcol = String(bigCol);
      td.dataset.row = String(smallRow);
      td.dataset.col = String(smallCol);
      td.tabIndex = 0;
      td.addEventListener('click', () => onCellActivate(bigRow, bigCol, smallRow, smallCol));
      td.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCellActivate(bigRow, bigCol, smallRow, smallCol);
        }
      });
      tr.appendChild(td);
    }
    gridBodyEl.appendChild(tr);
  }

  renderAll();

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function onCellActivate(bigRow, bigCol, smallRow, smallCol) {
    const board = state.boards[bigRow][bigCol];
    const cellCountry = board.cells[smallRow][smallCol].country;
    // Owned cell — open the zoom dialog regardless of board lock / game state.
    if (cellCountry) {
      openZoom(cellCountry);
      return;
    }
    if (isUltimateGameOver(state)) return;
    // A small board that's been claimed or run dead still shows its flags but
    // empty sub-cells in it are unclickable.
    if (board.winner || board.dead) return;
    openPicker(bigRow, bigCol, smallRow, smallCol);
  }

  /** @param {Country} c */
  function openZoom(c) {
    if (!zoomEl || !zoomImg || !zoomName) return;
    zoomImg.src = `../../../flags/svg/${c.code}.svg`;
    const displayName = countryName(c);
    zoomImg.alt = displayName;
    zoomName.textContent = displayName;
    zoomEl.showModal();
  }

  if (zoomEl) {
    zoomEl.addEventListener('click', (e) => {
      if (e.target === zoomEl) zoomEl.close();
    });
  }

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function openPicker(bigRow, bigCol, smallRow, smallCol) {
    activeCell = { bigRow, bigCol, smallRow, smallCol };
    pickerCatsEl.textContent = `${tCat(puzzle.rows[bigRow])} × ${tCat(puzzle.cols[bigCol])}`;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    renderSuggestions();
    pickerEl.hidden = false;
    document.body.classList.add('picker-open');
    lockBodyScroll();
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
    unlockBodyScroll();
  }

  function updateSuggestions() {
    const query = pickerInputEl.value;
    /** @type {Set<string>} */
    const excludeCodes = new Set();
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const cells = state.boards[br][bc].cells;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            if (cells[r][c].country) excludeCodes.add(cells[r][c].country.code);
          }
        }
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
      if (cell) focusCell(cell.bigRow, cell.bigCol, cell.smallRow, cell.smallCol);
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
    if (cell) focusCell(cell.bigRow, cell.bigCol, cell.smallRow, cell.smallCol);
  });
  pickerCloseEl.addEventListener('click', () => {
    const cell = activeCell;
    closePicker();
    if (cell) focusCell(cell.bigRow, cell.bigCol, cell.smallRow, cell.smallCol);
  });

  /** @param {Country} country */
  function pickCountry(country) {
    if (!activeCell) return;
    const { bigRow, bigCol, smallRow, smallCol } = activeCell;
    const outcome = attemptUltimateClaim(state, bigRow, bigCol, smallRow, smallCol, country, countries);
    state = outcome.nextState;
    closePicker();
    if (outcome.kind === 'claimed') {
      renderAll();
      if (isUltimateGameOver(state)) {
        finishRound();
      } else {
        focusCell(bigRow, bigCol, smallRow, smallCol);
      }
    } else {
      // miss-invalid / miss-duplicate — engine has flipped the turn; shake.
      shakeCell(bigRow, bigCol, smallRow, smallCol);
      renderTurn();
      focusCell(bigRow, bigCol, smallRow, smallCol);
    }
  }

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function shakeCell(bigRow, bigCol, smallRow, smallCol) {
    const td = findCell(bigRow, bigCol, smallRow, smallCol);
    if (!td) return;
    td.classList.remove('shake');
    void td.offsetWidth;
    pulseShake(td);
  }

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function focusCell(bigRow, bigCol, smallRow, smallCol) {
    const td = findCell(bigRow, bigCol, smallRow, smallCol);
    if (td) td.focus({ preventScroll: true });
  }

  /**
   * @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol
   * @returns {HTMLTableCellElement | null}
   */
  function findCell(bigRow, bigCol, smallRow, smallCol) {
    return /** @type {HTMLTableCellElement | null} */ (
      gridBodyEl.querySelector(
        `td[data-bigrow="${bigRow}"][data-bigcol="${bigCol}"][data-row="${smallRow}"][data-col="${smallCol}"]`,
      )
    );
  }

  function renderGrid() {
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const board = state.boards[br][bc];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const td = findCell(br, bc, r, c);
            if (!td) continue;
            const cell = board.cells[r][c];
            td.innerHTML = '';
            td.classList.toggle('owned', !!cell.owner);
            td.classList.toggle('owner-x', cell.owner === 'X');
            td.classList.toggle('owner-o', cell.owner === 'O');
            td.classList.toggle('revealed', !!cell.revealed);
            td.classList.toggle('exhausted', !!cell.exhausted);
            td.classList.toggle('in-claimed-x', board.winner === 'X');
            td.classList.toggle('in-claimed-o', board.winner === 'O');
            td.classList.toggle('in-dead', board.dead);
            td.classList.remove('winning');
            if (cell.country) {
              const img = document.createElement('img');
              img.src = `../../../flags/svg/${cell.country.code}.svg`;
              img.alt = countryName(cell.country);
              td.appendChild(img);
            }
          }
        }
        // Highlight the 3-in-a-row line inside any claimed small board.
        if (board.winningLine) {
          for (const [r, c] of board.winningLine) {
            const td = findCell(br, bc, r, c);
            if (td) td.classList.add('winning');
          }
        }
      }
    }
    // Highlight the meta 3-in-a-row by tinting every cell of the 3 winning
    // small boards with `.meta-winning`. Already-claimed boards keep their
    // tint; this just stacks an extra highlight class so CSS can give them
    // a stronger emphasis (e.g. shadow / outline).
    if (state.winningLine) {
      for (const [br, bc] of state.winningLine) {
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const td = findCell(br, bc, r, c);
            if (td) td.classList.add('meta-winning');
          }
        }
      }
    }
    // One-shot shake on freshly-won small boards (the 3 winning cells of
    // each) and on the meta win (every cell of the 3 winning small
    // boards). prevState gates against replaying the animation on later
    // renders where the win is no longer "new".
    for (const [br, bc] of newlyWonSmallBoards(prevState, state)) {
      const board = state.boards[br][bc];
      if (!board.winningLine) continue;
      for (const [r, c] of board.winningLine) {
        const td = findCell(br, bc, r, c);
        if (!td) continue;
        td.classList.add('shake-win');
        setTimeout(() => td.classList.remove('shake-win'), 1200);
      }
    }
    if (isMetaWinNewlyFormed(prevState, state) && state.winningLine) {
      for (const [br, bc] of state.winningLine) {
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const td = findCell(br, bc, r, c);
            if (!td) continue;
            td.classList.add('shake-win');
            setTimeout(() => td.classList.remove('shake-win'), 1200);
          }
        }
      }
    }
    prevState = state;
    document.body.classList.toggle('game-over', isUltimateGameOver(state));
    if (giveUpEl) giveUpEl.hidden = isUltimateGameOver(state);
  }

  function renderTurn() {
    if (!turnBadgeEl || !turnTextEl) return;
    if (isUltimateGameOver(state)) {
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
      void turnBadgeEl.offsetWidth;
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
    if (state.gaveUp) {
      // Offline single-player: the player obviously knows they gave up, so the
      // result section just offers Play again. Online keeps a label because
      // "You/Opponent gave up" actually conveys information.
      const finalScoreLineEl = document.getElementById('final-score-line');
      if (finalScoreLineEl) finalScoreLineEl.hidden = true;
    } else if (state.winner) {
      finalScoreEl.textContent =
        t('ttt.playerWins', '{player} wins!').replace('{player}', state.winner);
      finalScoreEl.style.color = state.winner === 'X' ? 'var(--x-color)' : 'var(--o-color)';
      if (shouldFireTicTacToeConfetti({ winner: state.winner })) launchConfetti();
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

  if (playAgainInlineEl) {
    playAgainInlineEl.href = window.location.pathname + window.location.search;
    playAgainInlineEl.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.reload();
    }, { once: true });
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (isUltimateGameOver(state)) return;
      closePicker();
      state = applyUltimateGiveUp(state, countries);
      renderAll();
      finishRound();
    });
  }
}
