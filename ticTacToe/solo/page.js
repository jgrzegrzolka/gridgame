import { generateRandomPuzzle, buildFlagCategoryPool, suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../../flags/engine.js';
import { renderCategoryLabel, renderCategoryPair } from '../../flags/filterChips.js';
import { loadCountries, attachMetrics } from '../../flags/group.js';
import { METRIC_FILES } from '../../flags/metrics/index.js';
import { metricDataGap } from '../../flags/metricTiers.js';
import { newSoloGame, attemptSoloClaim, isSoloOver, applySoloGiveUp, newlyClaimedCells, boardIsUntouched } from '../../flags/ticTacToe.js';
import { isTttAdvanced } from '../../flags/tttSettings.js';
import { wireAdvancedToggle } from '../advancedToggle.js';
import { t, countryName, withLocalizedAliases, autoRelocalize } from '../../i18n.js';
import { launchConfetti } from '../../confetti.js';
import { trapPicker, releasePicker } from '../pickerLock.js';
import { openMatchSheet, wireMatchSheetDismiss } from '../matchSheet.js';

/** @typedef {import('../../flags/group.js').Country} Country */

/** @param {import('../../flags/engine.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

export function bootTicTacToeSolo() {
  // Build the empty grid skeleton synchronously so the full 4×4 layout is
  // on-screen from page-load, before the countries.json fetch + puzzle
  // generation resolve (same reasoning as the offline page).
  buildGridSkeleton();
  // Population is a separate sparse metric — fetch it alongside countries (the
  // browser must fetch JSON, never import it) and denormalize it onto the
  // Country objects so the `population` threshold categories resolve.
  Promise.all([
    fetch('../../flags/countries.json').then((r) => r.json()),
    ...METRIC_FILES.map((m) =>
      fetch(`../../flags/metrics/${m.file}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => [m.key, j ? j.values : null])),
  ])
    .then(([rawCountries, ...metricPairs]) => {
      const countries = withLocalizedAliases(loadCountries(rawCountries));
      attachMetrics(countries, Object.fromEntries(metricPairs));
      // The Advanced switch is read here, once, because the board is dealt
      // once. Flipping it later re-deals via a reload (see advancedToggle.js).
      // Note the polarity: the flag pool is the default and the engine's own
      // full-pool default is the opt-in branch.
      const puzzle = generateRandomPuzzle(
        countries,
        isTttAdvanced() ? {} : { pool: buildFlagCategoryPool() },
      );
      runSolo({ puzzle, countries });
    })
    .catch((err) => {
      const game = document.querySelector('.game');
      if (game) {
        const p = document.createElement('p');
        p.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
        game.prepend(p);
      }
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
function runSolo({ puzzle, countries }) {
  let state = newSoloGame(puzzle);
  // Previous render's state, for the claimed-cell diff in renderGrid. Safe to
  // hold by reference rather than copy: every claim rebuilds cells, so this
  // stays a snapshot instead of aliasing the live board.
  /** @type {import('../../flags/ticTacToe.js').SoloState | null} */
  let lastRenderedState = null;

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
  const matchesEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('matches'));
  const zoomImg = zoomEl ? /** @type {HTMLImageElement | null} */ (zoomEl.querySelector('img')) : null;
  const zoomName = zoomEl ? /** @type {HTMLParagraphElement | null} */ (zoomEl.querySelector('p')) : null;
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const playAgainEl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('play-again'));
  const playAgainInlineEl = /** @type {HTMLAnchorElement | null} */ (
    document.getElementById('play-again-inline')
  );
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));

  // Enrich the pre-built skeleton: paint the header text from the generated
  // puzzle, then wire each cell's click + keydown handlers.
  colHeaderEls.forEach((th, i) => {
    renderCategoryLabel(/** @type {HTMLElement} */ (th), puzzle.cols[i], tCat(puzzle.cols[i]));
  });
  const trs = gridBodyEl.querySelectorAll('tr');
  trs.forEach((tr, r) => {
    const rowHeader = tr.querySelector('th');
    if (rowHeader) renderCategoryLabel(rowHeader, puzzle.rows[r], tCat(puzzle.rows[r]));
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

  renderGrid();

  /** @param {number} row @param {number} col */
  function onCellActivate(row, col) {
    const cell = state.cells[row][col];
    // A give-up reveal cell opens the "all matches" sheet (the example flag is
    // one of many); a player-claimed cell still zooms the single flag.
    if (cell.revealed) {
      openMatchSheet({
        dialogEl: matchesEl, puzzle, row, col, countries,
        svgBase: '../../flags/svg/', t, countryName, tCat,
      });
      return;
    }
    if (cell.country) {
      openZoom(cell.country);
      return;
    }
    if (isSoloOver(state)) return;
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
  wireMatchSheetDismiss(matchesEl);

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
    renderCategoryPair(pickerCatsEl, puzzle.rows[row], puzzle.cols[col], tCat(puzzle.rows[row]), tCat(puzzle.cols[col]));
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
   * would lose the pick to a data gap, not a wrong guess), or null when it's a
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
      // No metric value on a metric cell → the player can't know our data lacks
      // it, so show it disabled with a "no data" tag rather than let them pick
      // it. Every commit path also refuses it.
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
    // Refuse a country with no data for a metric axis of this cell — a shake
    // signals "not a valid pick here" instead of accepting a data gap.
    if (activeCellDataGap(country)) {
      pulseShake(pickerInputEl);
      return;
    }
    const { row, col } = activeCell;
    const outcome = attemptSoloClaim(state, row, col, country);
    closePicker();
    if (outcome.kind === 'claimed') {
      state = outcome.nextState;
      renderGrid();
      if (isSoloOver(state)) {
        finishRound();
      } else {
        focusCell(row, col);
      }
    } else {
      // Wrong / duplicate guess: close the picker and shake the cell, same as
      // the offline / online pages. Solo has no turn to flip, so the cell just
      // stays empty — click it again to retry.
      shakeCell(row, col);
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
    // Solo has a single player, so a filled cell reads as a plain flag tile —
    // no owner-x/owner-o colour wash. Give-up reveals use the shared .revealed
    // treatment (flag, no tint), same as the other TTT pages.
    td.classList.toggle('owned', !!cell.owner);
    td.classList.toggle('revealed', !!cell.revealed);
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
    // One-shot flip on cells claimed since the last render. A state diff, not
    // a `.owned` selector: renderCellContent rebuilds every cell's <img> on
    // every render, so the class would re-flip the whole board each time.
    for (const [r, c] of newlyClaimedCells(lastRenderedState, state)) {
      const td = gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
      if (!td) continue;
      td.classList.add('flip-in');
      setTimeout(() => td.classList.remove('flip-in'), 400);
    }
    lastRenderedState = state;
    document.body.classList.toggle('game-over', isSoloOver(state));
    if (giveUpEl) giveUpEl.hidden = isSoloOver(state);
  }

  /**
   * Paint the final-score text. Idempotent — a langchanged event can call it
   * without re-firing confetti or re-binding Play again.
   */
  function paintFinalScore() {
    if (!finalScoreEl) return;
    if (state.gaveUp) return; // line hidden by finishRound; nothing to paint.
    finalScoreEl.textContent = t('ttt.solved', 'Solved!');
    finalScoreEl.style.color = 'var(--primary-color)';
  }

  function finishRound() {
    if (!resultEl || !finalScoreEl) return;
    if (state.gaveUp) {
      // The player obviously knows they gave up, so the result section just
      // offers Play again (mirrors the offline hotseat page).
      const finalScoreLineEl = document.getElementById('final-score-line');
      if (finalScoreLineEl) finalScoreLineEl.hidden = true;
    } else {
      paintFinalScore();
      launchConfetti();
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
   * Soft language switch: re-translate grid headers, cell `<img>.alt` (via
   * renderGrid), the picker categories if open, and the result text if showing.
   */
  function refreshI18nForGame() {
    colHeaderEls.forEach((th, i) => {
      renderCategoryLabel(/** @type {HTMLElement} */ (th), puzzle.cols[i], tCat(puzzle.cols[i]));
    });
    const rowHeaders = gridBodyEl.querySelectorAll('tr > th');
    rowHeaders.forEach((th, i) => {
      renderCategoryLabel(/** @type {HTMLElement} */ (th), puzzle.rows[i], tCat(puzzle.rows[i]));
    });
    renderGrid();
    if (!pickerEl.hidden && activeCell) {
      const { row, col } = activeCell;
      renderCategoryPair(pickerCatsEl, puzzle.rows[row], puzzle.cols[col], tCat(puzzle.rows[row]), tCat(puzzle.cols[col]));
    }
    if (resultEl && !resultEl.hidden) paintFinalScore();
  }

  // Keep the picker's search index in sync on a soft language switch — reloadI18n
  // re-localizes registered lists before firing langchanged.
  autoRelocalize(countries);
  document.addEventListener('langchanged', refreshI18nForGame);

  if (playAgainInlineEl) {
    playAgainInlineEl.href = window.location.pathname + window.location.search;
    playAgainInlineEl.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.reload();
    }, { once: true });
  }

  wireAdvancedToggle({
    // Two switches, one setting: the burger's and the "How to play" dialog's.
    inputEls: [
      /** @type {HTMLInputElement | null} */ (document.getElementById('advanced-toggle-input')),
      /** @type {HTMLInputElement | null} */ (document.getElementById('rules-advanced-toggle-input')),
    ],
    isBoardUntouched: () => boardIsUntouched(state),
    redeal: () => window.location.reload(),
  });

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (isSoloOver(state)) return;
      closePicker();
      state = applySoloGiveUp(state, countries);
      renderGrid();
      finishRound();
    });
  }
}
