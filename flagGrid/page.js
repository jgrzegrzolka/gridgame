import {
  tryPick,
  suggest,
  exactSingleMatch,
  computeGridScore,
  GRID_MAX_SCORE,
  pickObscurity,
  cellScore,
  loadGridState,
  saveGridState,
  recordGridResult,
  fillEmptyCellsForGiveUp,
  cellRenderClasses,
  pulseShake,
  isGridLocked,
  translateCategoryLabel,
} from '../flags/grid.js';
import { scoreColor } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti } from '../confetti.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/grid.js').Puzzle} Puzzle */
/** @typedef {import('../flags/grid.js').GridState} GridState */

/** @param {import('../flags/grid.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

/**
 * @param {(countries: Country[]) => Puzzle} puzzleFor
 * @param {{ stateKey?: string, allowReplay?: boolean }} [options]
 */
export function bootFlagGrid(puzzleFor, options = {}) {
  return fetch('../../flags/countries.json')
    .then((r) => r.json())
    .then((rawCountries) => {
      // Grid uses the full 270 — more valid candidates per cell trades a
      // tiny bit of challenge for a richer pool. No scope toggle here.
      // withLocalizedAliases makes `suggest()` accept input in the active
      // language without coupling flags/grid.js to i18n.
      const countries = withLocalizedAliases(rawCountries);
      const puzzle = puzzleFor(countries);
      runFlagGrid({ puzzle, countries, options });
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}

/**
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

  const saved = store && stateKey ? loadGridState(store, stateKey) : null;
  /** @type {(Country | null)[][]} */
  let solution = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  let wrongCount = 0;
  let gaveUp = false;
  /** @type {Array<string | null>} */
  let revealedCodes = Array(9).fill(null);
  /** Tarnished-cell mask. A cell flips to `true` the first time the
   *  player picks a wrong country for it; never flips back. The score
   *  reads this directly — a tarnished cell forfeits the per-cell
   *  first-try bonus. */
  /** @type {boolean[]} */
  let tarnishedCells = Array(9).fill(false);
  if (saved) {
    for (let i = 0; i < 9; i++) {
      const code = saved.picks[i];
      const c = code ? byCode.get(code) : null;
      solution[Math.floor(i / 3)][i % 3] = c ?? null;
    }
    wrongCount = saved.wrongCount;
    gaveUp = saved.gaveUp;
    revealedCodes = saved.revealedCodes.slice();
    tarnishedCells = saved.tarnishedCells
      ? saved.tarnishedCells.slice()
      : Array(9).fill(false);
  }

  /** @type {Country[]} */
  const allCountries = countries;
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
  const pickerInputEl = /** @type {HTMLInputElement} */ (
    document.getElementById('picker-input')
  );
  const pickerSuggestionsEl = /** @type {HTMLUListElement} */ (
    document.getElementById('picker-suggestions')
  );
  const colHeaderEls = document.querySelectorAll('.col-header');
  const zoomEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('zoom'));
  const zoomImg = zoomEl ? /** @type {HTMLImageElement | null} */ (zoomEl.querySelector('img')) : null;
  const zoomName = zoomEl ? /** @type {HTMLParagraphElement | null} */ (zoomEl.querySelector('p')) : null;
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  const resultEl = document.getElementById('result');
  const finalScoreLineEl = document.getElementById('final-score-line');
  const finalScoreEl = document.getElementById('final-score');
  const bestEl = document.getElementById('best');
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

  renderGrid();

  function isLocked() {
    return isGridLocked({ gaveUp, picks: solution.flat().map((c) => (c ? c.code : null)) });
  }

  function onCellActivate(row, col) {
    const userPick = solution[row][col];
    if (userPick) {
      openZoom(userPick);
      return;
    }
    const revealedCode = revealedCodes[row * 3 + col];
    if (revealedCode) {
      const c = byCode.get(revealedCode);
      if (c) openZoom(c);
      return;
    }
    if (isLocked()) return;
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

  function openPicker(row, col) {
    activeCell = { row, col };
    pickerCatsEl.textContent =
      `${tCat(puzzle.rows[row])} × ${tCat(puzzle.cols[col])}`;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    renderSuggestions();
    pickerEl.hidden = false;
    document.body.classList.add('picker-open');
    // iOS only pops the keyboard when focus moves to an already-visible element inside a user gesture.
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
      // mousedown fires before the input's blur, so the pick lands before blur-driven cleanup.
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
      if (!solution[row][col]) {
        wrongCount++;
        // A wrong pick on an empty cell tarnishes it — the cell can never
        // count toward the first-try bonus again, even if the player gets
        // it right on a later attempt.
        tarnishedCells[row * 3 + col] = true;
      }
      closePicker();
      shakeCell(row, col);
      focusCell(row, col);
      persistState();
      return;
    }
    solution = result.solution;
    closePicker();
    const filled = countFilled();
    renderGrid();
    persistState();
    if (filled === 9) {
      launchConfetti();
      finishRound();
    } else {
      focusNextEmpty();
    }
  }

  function shakeCell(row, col) {
    const td = /** @type {HTMLTableCellElement} */ (gridBodyEl.querySelector(
      `td[data-row="${row}"][data-col="${col}"]`,
    ));
    td.classList.remove('shake');
    void td.offsetWidth; // force a reflow so re-adding .shake restarts the animation.
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

  function focusNextEmpty() {
    if (isLocked()) return;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (solution[r][c]) continue;
        focusCell(r, c);
        return;
      }
    }
  }

  function renderCellContent(r, c) {
    const td = /** @type {HTMLTableCellElement} */ (
      gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
    );
    if (!td) return;
    const userPick = solution[r][c];
    const revealedCode = revealedCodes[r * 3 + c];
    const revealedCountry = !userPick && revealedCode ? byCode.get(revealedCode) ?? null : null;
    const country = userPick ?? revealedCountry;
    const revealed = !userPick && revealedCountry !== null;
    for (const [klass, shouldHave] of cellRenderClasses(country, { revealed })) {
      td.classList.toggle(klass, shouldHave);
    }
    td.innerHTML = '';
    if (country) {
      const img = document.createElement('img');
      img.src = `../../flags/svg/${country.code}.svg`;
      img.alt = countryName(country);
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
    document.body.classList.toggle('grid-locked', isLocked());
  }

  function persistState() {
    if (!store || !stateKey) return;
    const picks = solution.flat().map((c) => (c ? c.code : null));
    saveGridState(store, stateKey, {
      picks,
      wrongCount,
      gaveUp,
      revealedCodes,
      tarnishedCells,
    });
  }

  function finishRound() {
    if (!resultEl) return;
    const picksAsCountries = solution.flat();
    const score = computeGridScore({
      picks: picksAsCountries,
      tarnishedCells,
      puzzle,
    });
    if (finalScoreEl) finalScoreEl.textContent = String(score);
    // Tint relative to GRID_MAX_SCORE so a clean run with full bonuses
    // still reads as green even though the ceiling is no longer 100.
    if (finalScoreLineEl) finalScoreLineEl.style.color = scoreColor(score / GRID_MAX_SCORE);
    renderCellBreakdown();
    if (stateKey && bestEl) {
      const slug = stateKey.replace(/^flaggrid\.state\./, '');
      // The 3x3 no longer tracks time; we pass 0 to satisfy the shared
      // Result shape that the rest of the project's best-score plumbing
      // (nextBest, recordGridResult) was built around. Every new record
      // ties on time, so the score is the only ranking signal.
      const { best, isNew } = recordGridResult(localStorage, slug, {
        score,
        time: 0,
      });
      bestEl.textContent =
        `${t('grid.yourBest', 'Your best')}: ${best.score}`;
      if (isNew) {
        bestEl.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = t('game.newRecord', 'new record!');
        bestEl.appendChild(badge);
      }
    }
    if (playAgainEl) {
      playAgainEl.href = window.location.pathname + window.location.search;
      if (stateKey) playAgainEl.textContent = t('grid.retry', 'Retry');
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
      revealedCodes = fillEmptyCellsForGiveUp(puzzle, solution, allCountries);
      closePicker();
      renderGrid();
      persistState();
      finishRound();
    });
  }

  if (isLocked()) {
    finishRound();
  }

  /**
   * Per-cell list under the final score showing every cell's contribution
   * to the score. Three row shapes:
   *
   *   filled correctly  → flag + name + "+N"  (cellScore for the pick)
   *   give-up revealed   → flag + name + "−5" (muted; the engine answered)
   *   truly empty        → skipped (only reachable defensively — finishRound
   *                       runs on a full grid or a give-up that revealed all)
   *
   * The per-row numbers sum to the final score by construction (same
   * cellScore helper). That's the whole point: a player who clicks
   * around can reconcile "my score = sum of these rows" by eye.
   *
   * The breakdown is hidden entirely when no cells qualify (shouldn't
   * happen in practice but harmless).
   */
  function renderCellBreakdown() {
    if (!resultEl) return;
    /** @type {HTMLElement | null} */
    let listEl = resultEl.querySelector('.cell-breakdown');

    /** @type {Array<{ country: Country, total: number, revealed: boolean }>} */
    const entries = [];
    for (let i = 0; i < 9; i++) {
      const picked = solution[Math.floor(i / 3)][i % 3];
      const revealedCode = revealedCodes[i];
      const country = picked
        ?? (revealedCode ? byCode.get(revealedCode) ?? null : null);
      if (!country) continue;
      const revealed = !picked;
      const total = cellScore({
        filled: !!picked,
        firstTry: !tarnishedCells[i],
        obscurity: picked ? pickObscurity(puzzle, picked) : 0,
      });
      entries.push({ country, total, revealed });
    }

    if (entries.length === 0) {
      if (listEl) listEl.remove();
      return;
    }

    if (!listEl) {
      listEl = document.createElement('ul');
      listEl.className = 'cell-breakdown';
      finalScoreLineEl?.after(listEl);
    }
    listEl.replaceChildren();
    for (const { country, total, revealed } of entries) {
      const li = document.createElement('li');
      if (revealed) li.classList.add('revealed');
      const img = document.createElement('img');
      img.src = `../../flags/svg/${country.code}.svg`;
      img.alt = '';
      li.appendChild(img);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = countryName(country);
      li.appendChild(name);
      const points = document.createElement('span');
      points.className = 'points';
      points.textContent = total >= 0 ? `+${total}` : String(total);
      li.appendChild(points);
      listEl.appendChild(li);
    }
  }
}
