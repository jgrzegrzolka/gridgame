/** @typedef {import('./group.js').Country} Country */

/**
 * One category in the grid. The `id` is a stable, debug-friendly handle for
 * the predicate (also used to recognise the same category across two
 * categories objects); `label` is what the UI renders; `predicate` decides
 * whether a country satisfies it.
 *
 * `exclusiveGroup` (optional) tags categories whose values are mutually
 * exclusive per country — a country has at most one `continent`, at most
 * one `statehood`, etc. Two categories with the same `exclusiveGroup` but
 * different ids on OPPOSITE axes always produce an empty cell (no country
 * can satisfy both), so random-puzzle generation rejects such layouts
 * symbolically via `axesConflict`. Same exclusiveGroup on the same axis is
 * fine — different rows of the puzzle don't intersect with each other.
 *
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} label
 * @property {(country: Country) => boolean} predicate
 * @property {string} [exclusiveGroup]
 */

/**
 * A 3x3 puzzle. Each cell at (r, c) is solved by a country that satisfies
 * both `rows[r]` and `cols[c]`.
 *
 * @typedef {Object} Puzzle
 * @property {Category[]} rows  length 3
 * @property {Category[]} cols  length 3
 */

/**
 * The state of one cell in a solution.
 *
 * @typedef {Object} CellState
 * @property {boolean} filled
 * @property {boolean} valid      country satisfies both row and column predicates
 * @property {boolean} duplicate  same country appears in another filled cell
 */

/**
 * The overall state of a solution.
 *
 * @typedef {Object} SolutionState
 * @property {CellState[][]} cells  3x3, indexed [row][col]
 * @property {boolean} complete     every cell filled, every cell valid, no duplicates
 */

/**
 * Does the candidate country satisfy both predicates of the cell at (row, col)?
 * An empty cell (null country) is not valid.
 *
 * @param {Puzzle} puzzle
 * @param {number} row
 * @param {number} col
 * @param {Country | null} country
 * @returns {boolean}
 */
export function validateCell(puzzle, row, col, country) {
  if (!country) return false;
  return puzzle.rows[row].predicate(country) && puzzle.cols[col].predicate(country);
}

/**
 * Compute the per-cell state of a solution. A solution is a 3x3 grid where
 * each entry is either a Country (the player's pick for that cell) or null
 * (empty cell). Duplicate detection compares by `country.code`.
 *
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][]} solution
 * @returns {SolutionState}
 */
export function solutionState(puzzle, solution) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const country = solution[r][c];
      if (country) counts.set(country.code, (counts.get(country.code) ?? 0) + 1);
    }
  }

  /** @type {CellState[][]} */
  const cells = [];
  let complete = true;
  for (let r = 0; r < 3; r++) {
    /** @type {CellState[]} */
    const row = [];
    for (let c = 0; c < 3; c++) {
      const country = solution[r][c];
      const filled = country !== null && country !== undefined;
      const valid = validateCell(puzzle, r, c, country);
      const duplicate = filled && (counts.get(/** @type {Country} */ (country).code) ?? 0) > 1;
      row.push({ filled, valid, duplicate });
      if (!filled || !valid || duplicate) complete = false;
    }
    cells.push(row);
  }

  return { cells, complete };
}

/**
 * @typedef {Object} PickOutcome
 * @property {boolean} accepted
 * @property {(Country | null)[][]} [solution]  new solution when accepted
 */

/**
 * Decides whether `country` can be placed at (row, col) in `solution`.
 * Rejects if the cell is already filled (placed cells are locked), if the
 * country fails either predicate, or if it duplicates a country already
 * placed in another cell. On accept, returns a fresh solution with the
 * pick applied; the input is never mutated.
 *
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][]} solution
 * @param {number} row
 * @param {number} col
 * @param {Country} country
 * @returns {PickOutcome}
 */
export function tryPick(puzzle, solution, row, col, country) {
  if (solution[row][col]) {
    return { accepted: false };
  }
  if (!validateCell(puzzle, row, col, country)) {
    return { accepted: false };
  }
  for (let r = 0; r < solution.length; r++) {
    for (let c = 0; c < solution[r].length; c++) {
      if (r === row && c === col) continue;
      if (solution[r][c]?.code === country.code) {
        return { accepted: false };
      }
    }
  }
  const next = solution.map((rowArr) => rowArr.slice());
  next[row][col] = country;
  return { accepted: true, solution: next };
}

// ---------------------------------------------------------------------------
// Starter categories. Today we can only express predicates over the fields
// already on Country (continent, statehood) — useful for proving the engine
// end-to-end but boring as a real game. Interesting categories (flag
// colours, motifs, population) need new data fields on countries.json and
// will land later. See flagGrid/NOTES.md.
// ---------------------------------------------------------------------------

/**
 * Category: country is in the given continent.
 *
 * @param {string} name e.g. "Europe", "Asia"
 * @returns {Category}
 */
export function continent(name) {
  return {
    id: `continent:${name}`,
    label: name,
    predicate: (c) => c.continent === name,
    exclusiveGroup: 'continent',
  };
}

/**
 * Category: country has the given `statehood` value.
 *
 * @param {string} value e.g. "un_member", "territory", "un_observer"
 * @param {string} [label] optional display label (defaults to a humanised id)
 * @returns {Category}
 */
export function statehood(value, label) {
  return {
    id: `statehood:${value}`,
    label: label ?? value.replace(/_/g, ' '),
    predicate: (c) => c.statehood === value,
    exclusiveGroup: 'statehood',
  };
}

/**
 * Continent names the random-puzzle generator draws from for the row axis.
 */
export const CONTINENTS_FOR_RANDOM = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
];

/**
 * Flag-colour palette the random-puzzle generator draws from for the col
 * axis. Must match the canonical palette tagged on each country in
 * countries.json (see scripts/add-flag-colors.mjs).
 */
export const COLORS_FOR_RANDOM = [
  'red',
  'white',
  'blue',
  'green',
  'yellow',
  'black',
  'orange',
];

/**
 * Flag-motif palette. Each entry yields a hasMotif() category. Tagged on
 * countries via scripts/add-flag-motifs.mjs.
 */
export const MOTIFS_FOR_RANDOM = [
  'animal',
  'coat-of-arms',
  'weapon',
  'star-or-moon',
];

/**
 * Category: country's flag contains the given colour. Countries with no
 * `colors` field (or empty) never match.
 *
 * @param {string} color one of COLORS_FOR_RANDOM
 * @returns {Category}
 */
export function hasColor(color) {
  return {
    id: `hasColor:${color}`,
    label: `Has ${color}`,
    predicate: (c) => Array.isArray(c.colors) && c.colors.includes(color),
  };
}

/**
 * Category: country's flag depicts the given motif. Countries with no
 * `motifs` field (or empty) never match.
 *
 * @param {string} motif one of MOTIFS_FOR_RANDOM
 * @returns {Category}
 */
export function hasMotif(motif) {
  return {
    id: `hasMotif:${motif}`,
    label: `Has ${motif}`,
    predicate: (c) => Array.isArray(c.motifs) && c.motifs.includes(motif),
  };
}

// ---------------------------------------------------------------------------
// Random puzzles.
// ---------------------------------------------------------------------------

/**
 * Pick `n` distinct elements from `pool` using a partial Fisher–Yates shuffle.
 * Does not mutate the input.
 *
 * @template T
 * @param {T[]} pool
 * @param {number} n
 * @param {() => number} rng  returns a value in [0, 1)
 * @returns {T[]}
 */
function pickRandom(pool, n, rng) {
  const arr = pool.slice();
  for (let i = 0; i < n && i < arr.length; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/**
 * Unified pool of categories for random puzzles: every continent, every
 * canonical colour, every canonical motif. Both axes draw from this same
 * pool — there's no fixed "rows are continents" structure any more.
 *
 * Returns a fresh array so callers can shuffle without affecting future
 * calls.
 *
 * @returns {Category[]}
 */
export function buildRandomCategoryPool() {
  return [
    ...CONTINENTS_FOR_RANDOM.map(continent),
    ...COLORS_FOR_RANDOM.map(hasColor),
    ...MOTIFS_FOR_RANDOM.map(hasMotif),
  ];
}

/**
 * Detects the structural conflict that makes a puzzle provably unsolvable:
 * two categories with the same `exclusiveGroup` but different ids on
 * opposite axes (e.g. `continent:Africa` on rows and `continent:Europe`
 * on cols → every cell at that row × col intersection has zero candidates).
 *
 * Pure symbolic check — no country lookup, no empirical counting. The
 * empirical solvability gate is `isPuzzleGeneratable`.
 *
 * @param {Category[]} rows
 * @param {Category[]} cols
 * @returns {boolean}
 */
export function axesConflict(rows, cols) {
  for (const r of rows) {
    if (!r.exclusiveGroup) continue;
    for (const c of cols) {
      if (r.exclusiveGroup === c.exclusiveGroup && r.id !== c.id) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Build a random 3x3 puzzle by drawing 6 distinct categories from the
 * unified pool and placing 3 on each axis. No bias for type — continents,
 * colours, motifs can all land on either axis. By construction the 6
 * categories are distinct across the whole puzzle (no duplicate row/col
 * labels).
 *
 * Pure shuffle — does no validity checking. Callers that need a solvable
 * puzzle should use `generateRandomPuzzle` instead, which gates on
 * `axesConflict` (symbolic) plus `isPuzzleGeneratable` (empirical).
 *
 * @param {() => number} [rng]  defaults to Math.random
 * @returns {Puzzle}
 */
export function randomPuzzle(rng = Math.random) {
  const six = pickRandom(buildRandomCategoryPool(), 6, rng);
  return {
    rows: six.slice(0, 3),
    cols: six.slice(3, 6),
  };
}

/**
 * For every cell in the puzzle, count how many of the given countries
 * satisfy both the row and column predicates. Returns a 3x3 array.
 *
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @returns {number[][]}
 */
export function puzzleCellCounts(puzzle, countries) {
  /** @type {number[][]} */
  const counts = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      for (const country of countries) {
        if (puzzle.rows[r].predicate(country) && puzzle.cols[c].predicate(country)) {
          counts[r][c]++;
        }
      }
    }
  }
  return counts;
}

/**
 * Search for a no-duplicate solution: a 3x3 of distinct Country objects
 * where every cell's country satisfies both the row and column predicate.
 * Returns null if no such assignment exists.
 *
 * Backtracking with a most-constrained-first cell order (fewest candidates
 * first). Distinctness is enforced by tracking the placed country codes —
 * matches the no-duplicates rule used by tryPick and solutionState.
 *
 * Pure: does not mutate inputs.
 *
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @returns {Country[][] | null}  3x3 solution on success, null on failure
 */
export function findPuzzleSolution(puzzle, countries) {
  /** @type {Country[][][]} */
  const candidates = [];
  for (let r = 0; r < 3; r++) {
    /** @type {Country[][]} */
    const row = [];
    for (let c = 0; c < 3; c++) {
      row.push(
        countries.filter(
          (co) => puzzle.rows[r].predicate(co) && puzzle.cols[c].predicate(co),
        ),
      );
    }
    candidates.push(row);
  }

  /** @type {Array<{ r: number, c: number }>} */
  const cellOrder = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cellOrder.push({ r, c });
  cellOrder.sort(
    (a, b) => candidates[a.r][a.c].length - candidates[b.r][b.c].length,
  );

  /** @type {(Country | null)[][]} */
  const solution = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  /** @type {Set<string>} */
  const used = new Set();

  /** @param {number} i */
  function backtrack(i) {
    if (i === cellOrder.length) return true;
    const { r, c } = cellOrder[i];
    for (const co of candidates[r][c]) {
      if (used.has(co.code)) continue;
      solution[r][c] = co;
      used.add(co.code);
      if (backtrack(i + 1)) return true;
      used.delete(co.code);
      solution[r][c] = null;
    }
    return false;
  }

  if (!backtrack(0)) return null;
  return /** @type {Country[][]} */ (solution);
}

/**
 * Returns true iff (a) every cell in `puzzle` has at least `minPerCell`
 * candidate countries AND (b) a no-duplicate assignment of 9 distinct
 * countries exists where each cell's pick satisfies its row and column
 * predicates.
 *
 * minPerCell is the UX-quality gate: ≥2 means the player can wrong-pick
 * one country per cell and still finish. The solvability check is the
 * hard correctness gate — without it, even a ≥2-per-cell puzzle could be
 * unsolvable because the same handful of countries crowds every cell and
 * the no-duplicates rule has no consistent assignment.
 *
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @param {number} [minPerCell] default 2
 * @returns {boolean}
 */
export function isPuzzleGeneratable(puzzle, countries, minPerCell = 2) {
  const counts = puzzleCellCounts(puzzle, countries);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (counts[r][c] < minPerCell) return false;
    }
  }
  return findPuzzleSolution(puzzle, countries) !== null;
}

/**
 * Generate a random puzzle that's actually playable: re-rolls the shuffle
 * until isPuzzleGeneratable returns true, or until maxAttempts is hit (at
 * which point we throw — caller probably gave us too thin a country list,
 * or the pools are too restrictive).
 *
 * @param {Country[]} countries
 * @param {{ rng?: () => number, minPerCell?: number, maxAttempts?: number }} [options]
 * @returns {Puzzle}
 */
export function generateRandomPuzzle(countries, options = {}) {
  const { rng = Math.random, minPerCell = 2, maxAttempts = 200 } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const puzzle = randomPuzzle(rng);
    if (axesConflict(puzzle.rows, puzzle.cols)) continue;
    if (isPuzzleGeneratable(puzzle, countries, minPerCell)) {
      return puzzle;
    }
  }
  throw new Error(
    `Could not generate a random puzzle with >= ${minPerCell} countries per cell after ${maxAttempts} attempts`,
  );
}

// ---------------------------------------------------------------------------
// Picker autocomplete.
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 3;

/**
 * Return countries whose name contains the given query as a substring,
 * case-insensitive, capped at `limit` results. Returns an empty list while the
 * trimmed query is shorter than MIN_QUERY_LENGTH so the picker dropdown stays
 * empty until the player has typed something substantive. Codes in
 * `excludeCodes` are filtered out before the limit is applied so already-placed
 * countries don't show up.
 *
 * @param {Country[]} allCountries
 * @param {string} query
 * @param {{ limit?: number, excludeCodes?: Set<string> }} [options]
 * @returns {Country[]}
 */
export function suggest(allCountries, query, options = {}) {
  const { limit = 8, excludeCodes = new Set() } = options;
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];
  return allCountries
    .filter((c) => !excludeCodes.has(c.code) && c.name.toLowerCase().includes(q))
    .slice(0, limit);
}

/**
 * Add a transient `.shake` class to a cell-like element and wire a
 * one-shot listener that removes it when the cell's `animationend`
 * event fires. Use this when an interaction needs to flash a visual
 * pulse and then leave no trace — without the auto-remove the class
 * (and its `::before` overlay) would stay painted forever now that
 * renderGrid no longer wipes interaction transients.
 *
 * Caller is responsible for any reflow needed to restart an animation
 * that's already running (`void el.offsetWidth` after `classList.remove`).
 * That trick is real-DOM-specific and intentionally kept out here so
 * the function stays node-testable against a hand-rolled fake.
 *
 * @param {{
 *   classList: { add(c: string): void, remove(c: string): void },
 *   addEventListener(type: string, handler: () => void, options?: { once?: boolean }): void,
 * }} cell
 */
export function pulseShake(cell) {
  cell.addEventListener(
    'animationend',
    () => cell.classList.remove('shake'),
    { once: true },
  );
  cell.classList.add('shake');
}

/**
 * Returns the renderer-owned classes for a single grid cell, given
 * the country placed there (or null for empty). Each entry is
 * `[className, shouldHave]`, intended to be applied with
 * `classList.toggle(className, shouldHave)` — that way the renderer
 * touches ONLY the classes it owns, and transient interaction
 * classes (e.g. `.shake` added by a rejected pick) survive a render
 * pass instead of getting wiped by a blanket `className = '...'`
 * assignment.
 *
 * The returned set is intentionally narrow. If you want to add a new
 * data-driven class, add it here AND in flags/grid.test.js's allowlist.
 * Anything driven by user interaction (animation pulses, hover state,
 * keyboard focus) does NOT belong here — those are owned by the
 * interaction handlers, not the renderer.
 *
 * @param {Country | null | undefined} country
 * @returns {Array<[string, boolean]>}
 */
export function cellRenderClasses(country) {
  const filled = country !== null && country !== undefined;
  return [['filled', filled]];
}

/**
 * Compute the 0–100 final score for a grid round. Anchors at 100 for a
 * clean 9/9 solve and decays from there. Penalties subtracted from 100:
 *
 *  - 3 points per wrong pick — light, since some wrongs are expected.
 *  - 10 points per empty cell at end — heaviest penalty (≈3.3× a wrong),
 *    because an empty cell means the player didn't even attempt that
 *    intersection.
 *
 * Clamped to [0, 100] so a rough round bottoms out instead of going
 * negative. The 9-cell penalty only accounts for 90 of the 100 points,
 * so an untouched board would otherwise land at 10 — we floor that
 * case at 0 explicitly: no engagement, no score.
 *
 * @param {Object} state
 * @param {number} state.filledCount  0–9 cells filled (correct picks)
 * @param {number} state.wrongCount   total rejected picks
 * @returns {number}
 */
export function computeGridScore({ filledCount, wrongCount }) {
  if (filledCount === 0) return 0;
  const emptyCount = 9 - filledCount;
  const raw = 100 - 3 * wrongCount - 10 * emptyCount;
  return Math.max(0, Math.min(100, raw));
}

/**
 * @typedef {Object} GridState
 * @property {Array<string | null>} picks  9 country codes (or null per empty cell)
 * @property {number} wrongCount
 * @property {boolean} gaveUp
 * @property {number | null} finalTimeMs  null while mid-game; ms total when finished
 */

/**
 * Is the round over? True iff the player gave up or filled all nine
 * cells (the latter being the moment finalTimeMs is set). Multiple
 * surfaces consume this — the give-up button hides, the picker refuses
 * to open, and the page body gets a `grid-locked` class that the CSS
 * uses to drop the cell hover/pointer cues so a finished board doesn't
 * look interactable.
 *
 * @param {Pick<GridState, 'gaveUp' | 'finalTimeMs'>} state
 * @returns {boolean}
 */
export function isGridLocked({ gaveUp, finalTimeMs }) {
  return gaveUp || finalTimeMs !== null;
}

/**
 * Read a persisted grid state from any Storage-like object. Returns
 * null when the key is missing, the value is unparseable, or the
 * parsed shape doesn't look like a GridState. Never throws — defensive
 * against quota errors or stale schemas from older builds.
 *
 * @param {{ getItem(key: string): string | null }} store
 * @param {string} key
 * @returns {GridState | null}
 */
export function loadGridState(store, key) {
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.picks) &&
      parsed.picks.length === 9 &&
      typeof parsed.wrongCount === 'number' &&
      typeof parsed.gaveUp === 'boolean' &&
      (parsed.finalTimeMs === null || typeof parsed.finalTimeMs === 'number')
    ) {
      return {
        picks: parsed.picks.map((p) => (typeof p === 'string' ? p : null)),
        wrongCount: parsed.wrongCount,
        gaveUp: parsed.gaveUp,
        finalTimeMs: parsed.finalTimeMs,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist a grid state to any Storage-like object. Silently no-ops if
 * the store throws (private-mode localStorage with zero quota, etc.).
 *
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {string} key
 * @param {GridState} state
 */
export function saveGridState(store, key, state) {
  try {
    store.setItem(key, JSON.stringify(state));
  } catch {
    // Storage may be disabled or full — degrade gracefully.
  }
}
