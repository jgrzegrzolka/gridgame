/** @typedef {import('./group.js').Country} Country */

/**
 * One category in the grid. The `id` is a stable, debug-friendly handle for
 * the predicate (also used to recognise the same category across two
 * categories objects); `label` is what the UI renders; `predicate` decides
 * whether a country satisfies it.
 *
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} label
 * @property {(country: Country) => boolean} predicate
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
 * Build a random 3x3 puzzle with continent rows. One of the three column
 * slots is reserved for a motif (hasMotif) so motifs aren't drowned out
 * by the bigger colour pool; the other two slots are drawn from the
 * remaining motifs + all colours, so both motifs can still co-occur in
 * a single puzzle. The three resulting cols are then shuffled so the
 * reserved motif isn't always in the leftmost position.
 *
 * Pure shuffle — does no validity checking. Callers that need a solvable
 * puzzle should use `generateRandomPuzzle` instead.
 *
 * @param {() => number} [rng]  defaults to Math.random
 * @returns {Puzzle}
 */
export function randomPuzzle(rng = Math.random) {
  const rowNames = pickRandom(CONTINENTS_FOR_RANDOM, 3, rng);

  const motifCategories = MOTIFS_FOR_RANDOM.map(hasMotif);
  const colorCategories = COLORS_FOR_RANDOM.map(hasColor);

  const [reservedMotif] = pickRandom(motifCategories, 1, rng);
  const remainingPool = [
    ...motifCategories.filter((m) => m.id !== reservedMotif.id),
    ...colorCategories,
  ];
  const otherTwo = pickRandom(remainingPool, 2, rng);
  const cols = pickRandom([reservedMotif, ...otherTwo], 3, rng);

  return {
    rows: rowNames.map(continent),
    cols,
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
 * Returns true iff every cell in `puzzle` has at least `minPerCell`
 * countries that satisfy both row and column predicates. minPerCell = 1
 * means "no mutually-exclusive intersection"; minPerCell = 2 (the default)
 * also gives some slack against the no-duplicates constraint.
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
  return true;
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
 * Format the status line shown under the grid based on the current
 * game state. Returns an empty string for a clean mid-game state (no
 * mistakes yet) so the line stays invisible until there's something
 * to say. `solved` takes precedence over `gaveUp` — in practice the
 * page hides Give up once the grid is solved, but the precedence is
 * pinned here so callers don't have to.
 *
 * @param {Object} state
 * @param {number} state.filledCount  0–9 cells currently filled
 * @param {number} state.wrongCount   total rejected picks so far
 * @param {boolean} state.solved      all 9 cells filled
 * @param {boolean} state.gaveUp      user pressed Give up
 * @returns {string}
 */
export function formatGridStatus({ filledCount, wrongCount, solved, gaveUp }) {
  const wrongTail = wrongCount === 1 ? '1 wrong' : `${wrongCount} wrong`;
  if (solved) return `Solved! ${wrongTail}`;
  if (gaveUp) return `Gave up — ${filledCount}/9 filled, ${wrongTail}`;
  if (wrongCount === 0) return '';
  return wrongTail;
}
