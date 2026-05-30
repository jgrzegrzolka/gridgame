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
 * Category: country's name starts with the given letter (case-insensitive).
 * Useful as a "boring but always satisfiable" category for v0 puzzles that
 * use the existing data only.
 *
 * @param {string} letter single character; case-insensitive
 * @returns {Category}
 */
export function nameStartsWith(letter) {
  const upper = letter.toUpperCase();
  return {
    id: `nameStartsWith:${upper}`,
    label: `Starts with ${upper}`,
    predicate: (c) => c.name.toUpperCase().startsWith(upper),
  };
}

// ---------------------------------------------------------------------------
// Picker autocomplete.
// ---------------------------------------------------------------------------

const MIN_QUERY_LENGTH = 3;

/**
 * Return countries whose name starts with the given query, case-insensitive,
 * capped at `limit` results. Returns an empty list while the trimmed query is
 * shorter than MIN_QUERY_LENGTH so the picker dropdown stays empty until the
 * player has typed something substantive.
 *
 * @param {Country[]} allCountries
 * @param {string} query
 * @param {number} [limit] max results (default 8)
 * @returns {Country[]}
 */
export function suggest(allCountries, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];
  return allCountries
    .filter((c) => c.name.toLowerCase().startsWith(q))
    .slice(0, limit);
}
