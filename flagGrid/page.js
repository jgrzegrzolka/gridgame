import {
  tryPick,
  suggest,
  formatGridStatus,
  cellRenderClasses,
  pulseShake,
} from '../flags/grid.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/grid.js').Puzzle} Puzzle */

/**
 * Fetch countries.json, build a puzzle from the variant's `puzzleFor`
 * callback, then mount the UI. Any error during fetch or puzzle generation
 * is surfaced in the #status element.
 *
 * @param {(countries: Country[]) => Puzzle} puzzleFor
 */
export function bootFlagGrid(puzzleFor) {
  fetch('../../flags/countries.json')
    .then((r) => r.json())
    .then((countries) => {
      const puzzle = puzzleFor(countries);
      runFlagGrid({ puzzle, countries });
    })
    .catch((err) => {
      const statusEl = document.getElementById('status');
      if (statusEl) statusEl.textContent = 'Failed to load: ' + err.message;
    });
}

/**
 * Mount the Flag Grid UI against the markup in the variant's index.html
 * for the given puzzle and pre-fetched country list. Variants differ in
 * which puzzle they supply; most will use bootFlagGrid() which handles
 * the fetch + puzzle decision for them.
 *
 * @param {{ puzzle: Puzzle, countries: Country[] }} config
 */
export function runFlagGrid({ puzzle, countries }) {
  /** @type {(Country | null)[][]} */
  let solution = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];

  /** @type {Country[]} */
  const allCountries = countries;
  /** @type {{ row: number, col: number } | null} */
  let activeCell = null;
  /** @type {Country | null} */
  let topMatch = null;
  let wrongCount = 0;
  let gaveUp = false;

  const statusEl = document.getElementById('status');
  const gridBodyEl = document.getElementById('grid-body');
  const pickerEl = /** @type {HTMLDialogElement} */ (document.getElementById('picker'));
  const pickerInputEl = /** @type {HTMLInputElement} */ (document.getElementById('picker-input'));
  const suggestionsEl = document.getElementById('suggestions');
  const colHeaderEls = document.querySelectorAll('.col-header');
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));

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

  renderGrid();

  function openPicker(row, col) {
    if (gaveUp) return;
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
    // Clicks on cells reopen the picker via their own handler; let them.
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
      // Only count picks on still-empty cells. Tapping a locked cell
      // can't reach pickCountry today (openPicker bails) but guard
      // anyway so the counter stays honest.
      if (!solution[row][col]) wrongCount++;
      shakeCell(row, col);
      renderGrid();
      return;
    }
    solution = result.solution;
    renderGrid();
  }

  function shakeCell(row, col) {
    const td = gridBodyEl.querySelector(
      `td[data-row="${row}"][data-col="${col}"]`,
    );
    td.classList.remove('shake');
    // Force reflow so re-adding the class restarts the animation even if
    // it was already running.
    void td.offsetWidth;
    pulseShake(td);
  }

  function renderGrid() {
    let filledCount = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const td = /** @type {HTMLTableCellElement} */ (
          gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
        );
        const country = solution[r][c];
        // Apply ONLY the renderer-owned classes — interaction
        // transients like .shake stay put across renders. See
        // cellRenderClasses in flags/grid.js.
        for (const [klass, shouldHave] of cellRenderClasses(country)) {
          td.classList.toggle(klass, shouldHave);
        }
        td.innerHTML = '';
        if (!country) continue;
        filledCount++;
        const img = document.createElement('img');
        img.src = `../../flags/svg/${country.code}.svg`;
        img.alt = country.name;
        td.appendChild(img);
      }
    }
    const solved = filledCount === 9;
    statusEl.classList.toggle('complete', solved);
    statusEl.textContent = formatGridStatus({
      filledCount,
      wrongCount,
      solved,
      gaveUp,
    });
    if (giveUpEl) giveUpEl.hidden = solved || gaveUp;
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (gaveUp) return;
      gaveUp = true;
      if (pickerEl.open) pickerEl.close();
      renderGrid();
    });
  }
}
