import { generateRandomPuzzle, suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../../flags/engine.js';
import { loadCountries, attachPopulations, attachAreas, attachDensities, attachGdps, attachGdpPerCapitas, attachCoffees } from '../../flags/group.js';
import { metricDataGap } from '../../flags/metricTiers.js';
import { newGame, attemptClaim, isGameOver, applyGiveUp, shouldFireTicTacToeConfetti, newlyWinningCells } from '../../flags/ticTacToe.js';
import { t, countryName, withLocalizedAliases } from '../../i18n.js';
import { launchConfetti } from '../../confetti.js';
import { trapPicker, releasePicker } from '../pickerLock.js';

/** @typedef {import('../../flags/group.js').Country} Country */
/** @typedef {import('../../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../../flags/ticTacToe.js').Player} Player */

/** @param {import('../../flags/engine.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

export function bootTicTacToe() {
  // Build the empty 3×3 grid structure synchronously, before the
  // countries.json fetch resolves. On slow connections the fetch +
  // localised-alias pass + puzzle generation can take a couple of
  // seconds, and during that window the user used to see only the
  // (empty) thead row of the table — "half a grid". Pre-building the
  // skeleton means the full layout is on-screen from page-load; the
  // header text and per-cell click handlers get wired up later inside
  // runTicTacToe once the data is ready.
  buildGridSkeleton();
  // Population is a separate sparse metric — fetch it alongside countries (the
  // browser must fetch JSON, never import it) and denormalize it onto the
  // Country objects so the `population` threshold categories resolve. Attach
  // after withLocalizedAliases, which re-runs createCountry and would otherwise
  // not carry the field.
  Promise.all([
    fetch('../../flags/countries.json').then((r) => r.json()),
    fetch('../../flags/metrics/population.json').then((r) => r.json()),
    fetch('../../flags/metrics/area.json').then((r) => r.json()),
    fetch('../../flags/metrics/density.json').then((r) => r.json()),
    fetch('../../flags/metrics/gdp.json').then((r) => r.json()),
    fetch('../../flags/metrics/gdpPerCapita.json').then((r) => r.json()),
    fetch('../../flags/metrics/coffee.json').then((r) => r.json()),
  ])
    .then(([rawCountries, population, area, density, gdp, gdpPerCapita, coffee]) => {
      const countries = withLocalizedAliases(loadCountries(rawCountries));
      attachPopulations(countries, population.values);
      attachAreas(countries, area.values);
      attachDensities(countries, density.values);
      attachGdps(countries, gdp.values);
      attachGdpPerCapitas(countries, gdpPerCapita.values);
      attachCoffees(countries, coffee.values);
      const puzzle = generateRandomPuzzle(countries);
      runTicTacToe({ puzzle, countries });
    })
    .catch((err) => {
      const turnText = document.getElementById('turn-text');
      if (turnText) turnText.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

function buildGridSkeleton() {
  const gridBodyEl = document.getElementById('grid-body');
  if (!gridBodyEl) return;
  for (let r = 0; r < 3; r++) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    tr.appendChild(rowHeader);
    for (let c = 0; c < 3; c++) {
      const td = document.createElement('td');
      td.className = 'cell';
      td.dataset.row = String(r);
      td.dataset.col = String(c);
      tr.appendChild(td);
    }
    gridBodyEl.appendChild(tr);
  }
}

/**
 * @param {{ puzzle: import('../../flags/engine.js').Puzzle, countries: Country[] }} config
 */
function runTicTacToe({ puzzle, countries }) {
  let state = newGame(puzzle, 'O');
  // Tracks the last-seen winningLine so renderGrid fires the win-shake
  // only on the transition, not on later re-renders. Declared up here
  // because renderAll() (called during init) calls renderGrid which
  // reads it — a later declaration would hit a TDZ on first render.
  /** @type {[number, number][] | null} */
  let lastSeenWinningLine = null;
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

  // The grid skeleton is already in the DOM (buildGridSkeleton ran in
  // bootTicTacToe before the fetch). Enrich it: paint the row/col
  // header text from the freshly generated puzzle, then wire each
  // cell's click + keydown handlers — these need to close over the
  // local `state` and the picker functions, which only exist now.
  colHeaderEls.forEach((th, i) => {
    th.textContent = tCat(puzzle.cols[i]);
  });
  const trs = gridBodyEl.querySelectorAll('tr');
  trs.forEach((tr, r) => {
    const rowHeader = tr.querySelector('th');
    if (rowHeader) rowHeader.textContent = tCat(puzzle.rows[r]);
    tr.querySelectorAll('td').forEach((td, c) => {
      /** @type {HTMLTableCellElement} */ (td).tabIndex = 0;
      td.addEventListener('click', () => onCellActivate(r, c));
      td.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCellActivate(r, c);
        }
      });
    });
  });

  renderAll();

  /** @param {number} row @param {number} col */
  function onCellActivate(row, col) {
    const cellCountry = state.cells[row][col].country;
    if (cellCountry) {
      openZoom(cellCountry);
      return;
    }
    if (isGameOver(state)) return;
    openPicker(row, col);
  }

  /** @param {Country} c */
  function openZoom(c) {
    if (!zoomEl || !zoomImg || !zoomName) return;
    zoomImg.src = `../../flags/svg/${c.code}.svg`;
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

  // ---- Rules help ----
  const rulesBtnEl = document.getElementById('rules-btn');
  const rulesHelpEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('rules-help'));
  const rulesCloseEl = document.getElementById('rules-close');
  if (rulesBtnEl && rulesHelpEl) {
    rulesBtnEl.addEventListener('click', () => rulesHelpEl.showModal());
    rulesHelpEl.addEventListener('click', (e) => {
      if (e.target === rulesHelpEl) rulesHelpEl.close();
    });
  }
  if (rulesCloseEl && rulesHelpEl) {
    rulesCloseEl.addEventListener('click', () => rulesHelpEl.close());
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
    trapPicker(pickerEl);
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
    releasePicker();
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
    // Don't auto-submit a data-gap match — leave it visible as "no data" rather
    // than shaking mid-type. A deliberate Enter/click still routes through the
    // pickCountry guard.
    if (auto && !activeCellDataGap(auto)) pickCountry(auto);
  }

  /**
   * The metric key the active cell has no data for `country` (so picking it
   * would lose the cell to a data gap, not a wrong guess), or null when it's a
   * fair guess. Drives the "no data" disable in the picker.
   * @param {Country} country
   */
  function activeCellDataGap(country) {
    if (!activeCell) return null;
    return metricDataGap([puzzle.rows[activeCell.row], puzzle.cols[activeCell.col]], country);
  }

  function renderSuggestions() {
    pickerSuggestionsEl.innerHTML = '';
    currentMatches.forEach((country, i) => {
      const li = document.createElement('li');
      if (i === selectedIndex) li.classList.add('selected');
      const name = document.createElement('span');
      name.textContent = countryName(country);
      li.appendChild(name);
      // No population value on a population cell → the player can't know our
      // data lacks it, so show it disabled with a "no data" tag rather than let
      // them pick it and lose the cell. Every commit path also refuses it.
      if (activeCellDataGap(country)) {
        li.classList.add('no-data');
        const tag = document.createElement('span');
        tag.className = 'suggestion-no-data';
        tag.textContent = t('ttt.noData', 'no data');
        li.appendChild(tag);
      } else {
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickCountry(country);
        });
        li.addEventListener('mouseenter', () => {
          selectedIndex = i;
          renderSelected();
        });
      }
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
    // Refuse a country with no data for a metric axis of this cell (also
    // reached via Enter / exact-name auto-submit) — a shake signals "not a
    // valid pick here" instead of flipping the turn on a data gap.
    if (activeCellDataGap(country)) {
      pulseShake(pickerInputEl);
      return;
    }
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
    td.classList.toggle('revealed', !!cell.revealed);
    td.classList.toggle('exhausted', !!cell.exhausted);
    td.classList.remove('winning');
    if (cell.country) {
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
    // Fire a one-shot shake on the freshly formed line; comparing against
    // lastSeenWinningLine prevents the animation from replaying on later
    // re-renders that re-apply the .winning class.
    const fresh = newlyWinningCells(
      { winningLine: lastSeenWinningLine },
      { winningLine: state.winningLine },
    );
    for (const [r, c] of fresh) {
      const td = gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
      if (!td) continue;
      td.classList.add('shake-win');
      setTimeout(() => td.classList.remove('shake-win'), 1200);
    }
    lastSeenWinningLine = state.winningLine;
    document.body.classList.toggle('game-over', isGameOver(state));
    if (giveUpEl) giveUpEl.hidden = isGameOver(state);
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

  /**
   * Paint the final-score text from state. Idempotent — a langchanged
   * event can call it without re-firing confetti or re-binding the
   * Play again handler.
   */
  function paintFinalScore() {
    if (!finalScoreEl) return;
    if (state.gaveUp) return; // line hidden by finishRound; nothing to paint.
    if (state.winner) {
      finalScoreEl.textContent =
        t('ttt.playerWins', '{player} wins!').replace('{player}', state.winner);
      finalScoreEl.style.color = state.winner === 'X' ? 'var(--x-color)' : 'var(--o-color)';
    } else {
      finalScoreEl.textContent = t('ttt.draw', 'Draw');
      finalScoreEl.style.color = '#1c1c1c';
    }
  }

  function finishRound() {
    if (!resultEl || !finalScoreEl) return;
    if (state.gaveUp) {
      // Offline single-player: the player obviously knows they gave up, so the
      // result section just offers Play again. Online keeps a label because
      // "You/Opponent gave up" actually conveys information.
      const finalScoreLineEl = document.getElementById('final-score-line');
      if (finalScoreLineEl) finalScoreLineEl.hidden = true;
    } else {
      paintFinalScore();
      if (state.winner && shouldFireTicTacToeConfetti({ winner: state.winner })) launchConfetti();
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

  /**
   * Soft language switch: re-translate grid headers, the in-game
   * "to move" line + cell `<img>.alt` (via renderGrid), the picker
   * categories if open, and the result text if showing.
   */
  function refreshI18nForGame() {
    colHeaderEls.forEach((th, i) => {
      th.textContent = tCat(puzzle.cols[i]);
    });
    const rowHeaders = gridBodyEl.querySelectorAll('tr > th');
    rowHeaders.forEach((th, i) => {
      th.textContent = tCat(puzzle.rows[i]);
    });
    renderGrid();
    renderTurn();
    if (!pickerEl.hidden && activeCell) {
      const { row, col } = activeCell;
      pickerCatsEl.textContent = `${tCat(puzzle.rows[row])} × ${tCat(puzzle.cols[col])}`;
    }
    if (resultEl && !resultEl.hidden) paintFinalScore();
  }

  document.addEventListener('langchanged', refreshI18nForGame);

  if (playAgainInlineEl) {
    playAgainInlineEl.href = window.location.pathname + window.location.search;
    playAgainInlineEl.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.reload();
    }, { once: true });
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (isGameOver(state)) return;
      closePicker();
      state = applyGiveUp(state, countries);
      renderAll();
      finishRound();
    });
  }
}
