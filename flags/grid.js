import { nextBest, loadBest, saveBest } from './quiz.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./group.js').Continent} Continent */
/** @typedef {import('./quiz.js').Result} Result */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} label
 * @property {(country: Country) => boolean} predicate
 * @property {string} [exclusiveGroup]
 */

/**
 * @typedef {Object} Puzzle
 * @property {Category[]} rows
 * @property {Category[]} cols
 */

/**
 * @typedef {Object} CellState
 * @property {boolean} filled
 * @property {boolean} valid
 * @property {boolean} duplicate
 */

/**
 * @typedef {Object} SolutionState
 * @property {CellState[][]} cells
 * @property {boolean} complete
 */

/**
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
 * @property {(Country | null)[][]} [solution]
 */

/**
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

/**
 * @param {string} name
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
 * @param {string} value
 * @param {string} [label]
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

/** @type {Continent[]} */
export const CONTINENTS_FOR_RANDOM = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
];

export const COLORS_FOR_RANDOM = [
  'red',
  'white',
  'blue',
  'green',
  'yellow',
  'black',
  'orange',
];

export const MOTIFS_FOR_RANDOM = [
  'animal',
  'coat-of-arms',
  'weapon',
  'star-or-moon',
  'cross',
];

/**
 * @param {string} color
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
 * @param {string} motif
 * @returns {Category}
 */
export function hasMotif(motif) {
  return {
    id: `hasMotif:${motif}`,
    label: `Has ${motif}`,
    predicate: (c) => Array.isArray(c.motifs) && c.motifs.includes(motif),
  };
}

/**
 * @template T
 * @param {T[]} pool
 * @param {number} n
 * @param {() => number} rng
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
 * Translate a category's display label by decoding its `id`. The factories
 * above bake an English label (`"Africa"`, `"Has red"`) onto every Category
 * so the engine stays pure of i18n; this is the boundary helper that page
 * code uses at render time to swap in the active language. Unknown id
 * prefixes fall through to the baked label so a stray category never
 * renders blank.
 *
 * Key conventions:
 *   `continent:<Name>` → `variant.<name-lower-kebab>` (reuses the flagQuiz
 *      variant translations — continents are translated as nouns, not as
 *      "Continent: Africa".)
 *   `hasColor:<x>`     → `game.has` interpolated with `color.<x>`.
 *   `hasMotif:<x>`     → `game.has` interpolated with `motif.<x>`.
 *
 * @param {Category} category
 * @param {(key: string, fallback: string) => string} translate
 * @returns {string}
 */
export function translateCategoryLabel(category, translate) {
  const colon = category.id.indexOf(':');
  if (colon < 0) return category.label;
  const kind = category.id.slice(0, colon);
  const value = category.id.slice(colon + 1);
  if (kind === 'continent') {
    const variantKey = value.toLowerCase().replace(/ /g, '-');
    return translate(`variant.${variantKey}`, category.label);
  }
  if (kind === 'hasColor') {
    return translate('game.has', 'Has {x}').replace('{x}', translate(`color.${value}`, value));
  }
  if (kind === 'hasMotif') {
    return translate('game.has', 'Has {x}').replace('{x}', translate(`motif.${value}`, value));
  }
  return category.label;
}

/**
 * Reverse of the factory functions: given an `id` like 'continent:Europe',
 * 'hasColor:red', 'hasMotif:weapon', or 'statehood:un_member', return a
 * Category with its predicate restored. Used for rehydrating puzzles loaded
 * from storage (storage strips functions during structured-clone).
 *
 * @param {string | null | undefined} id
 * @returns {Category | null}
 */
export function categoryFromId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('continent:')) return continent(/** @type {any} */ (id.slice('continent:'.length)));
  if (id.startsWith('hasColor:')) return hasColor(id.slice('hasColor:'.length));
  if (id.startsWith('hasMotif:')) return hasMotif(id.slice('hasMotif:'.length));
  if (id.startsWith('statehood:')) return statehood(id.slice('statehood:'.length));
  return null;
}

/** @returns {Category[]} */
export function buildRandomCategoryPool() {
  return [
    ...CONTINENTS_FOR_RANDOM.map(continent),
    ...COLORS_FOR_RANDOM.map(hasColor),
    ...MOTIFS_FOR_RANDOM.map(hasMotif),
  ];
}

/**
 * The 9 cell signatures of a puzzle, each formed as `rowId|colId`. Used to
 * compare puzzles for repeated cell content — e.g. "continent:Africa|hasColor:red"
 * appearing in two different daily puzzles means the player will see the same
 * cell prompt twice across the rotation.
 *
 * @param {Puzzle} puzzle
 * @returns {string[]}
 */
export function puzzlePairs(puzzle) {
  /** @type {string[]} */
  const out = [];
  for (const r of puzzle.rows) {
    for (const c of puzzle.cols) {
      out.push(`${r.id}|${c.id}`);
    }
  }
  return out;
}

/**
 * Checks whether two puzzles share any cell (rowCat × colCat) pair. The
 * row/col axes are unordered for this comparison: a `hasColor:red`
 * column in one puzzle still collides with a `hasColor:red` row in the
 * other if their cross partner matches. We compare both axis orientations
 * for that reason.
 *
 * @param {Puzzle} a
 * @param {Puzzle} b
 * @returns {string[]}
 */
export function sharedPuzzlePairs(a, b) {
  const aPairs = new Set(puzzlePairs(a));
  /** @type {Set<string>} */
  const dupes = new Set();
  for (const p of puzzlePairs(b)) {
    if (aPairs.has(p)) dupes.add(p);
    const [bRow, bCol] = p.split('|');
    const swapped = `${bCol}|${bRow}`;
    if (aPairs.has(swapped)) dupes.add(p);
  }
  return [...dupes];
}

/**
 * A puzzle "mixes category families" when its 6 categories are not all
 * colors and not all continents. Pure-color puzzles (red × white × ...)
 * and pure-continent puzzles (Europe × Asia × ...) collapse the game into
 * a single dimension; we want every daily puzzle to combine at least two
 * families (continent + color, continent + motif, color + motif, ...).
 *
 * @param {Puzzle} puzzle
 * @returns {boolean}
 */
export function puzzleMixesCategoryFamilies(puzzle) {
  const all = [...puzzle.rows, ...puzzle.cols];
  const allColors = all.every((c) => c.id.startsWith('hasColor:'));
  const allContinents = all.every((c) => c.id.startsWith('continent:'));
  return !allColors && !allContinents;
}

/**
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
 * @param {() => number} [rng]
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
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @returns {Country[][] | null}
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
 * Find a complete 81-distinct country assignment for an Ultimate (9×9)
 * puzzle, respecting any sub-cells already populated in `preFilled`.
 *
 * Returns the 3×3×3×3 grid of countries (indexed `[bigRow][bigCol][r][c]`)
 * or null if no consistent assignment exists. Uses backtracking with the
 * MRV (most-constrained-first) heuristic; each cell's candidate list is
 * shuffled with `rng` so repeat calls produce different solutions.
 *
 * Generation guarantees an 81-distinct solution exists on an empty board
 * (via `hasUltimatePuzzleSolution`), so this returns non-null for the
 * give-up-on-empty case. With claimed cells the result can be null if
 * the player has steered the puzzle into an infeasible state — callers
 * must handle that.
 *
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][][][]} preFilled 3×3×3×3 of claimed countries (or null when empty).
 * @param {Country[]} countries
 * @param {() => number} [rng]
 * @returns {Country[][][][] | null}
 */
export function findUltimateAssignment(puzzle, preFilled, countries, rng = Math.random) {
  /** @type {(Country | null)[][][][]} */
  const result = preFilled.map((bigRow) =>
    bigRow.map((board) => board.map((row) => row.slice())),
  );
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {Array<{ br: number, bc: number, r: number, c: number, candidates: Country[] }>} */
  const empties = [];

  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const rowCat = puzzle.rows[br];
      const colCat = puzzle.cols[bc];
      // Every sub-cell of small board (br, bc) sees the same candidate
      // pool initially — the (row × col) predicate is identical across
      // the 9 sub-cells of one small board.
      const valid = countries.filter(
        (co) => rowCat.predicate(co) && colCat.predicate(co),
      );
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const claimed = preFilled[br][bc][r][c];
          if (claimed) {
            used.add(claimed.code);
          } else {
            empties.push({ br, bc, r, c, candidates: shuffleInPlace(valid.slice(), rng) });
          }
        }
      }
    }
  }

  // Drop already-claimed countries from each empty cell's domain. MRV
  // sort favours the most-constrained empty cells first — without it,
  // the search blows up on thin (row × col) pairs because we'd try
  // wide-pool cells first, burn through countries needed elsewhere, and
  // dead-end deep in the tree.
  for (const e of empties) {
    e.candidates = e.candidates.filter((co) => !used.has(co.code));
  }
  empties.sort((a, b) => a.candidates.length - b.candidates.length);

  /** @param {number} i */
  function backtrack(i) {
    if (i === empties.length) return true;
    const { br, bc, r, c, candidates } = empties[i];
    for (const co of candidates) {
      if (used.has(co.code)) continue;
      result[br][bc][r][c] = co;
      used.add(co.code);
      if (backtrack(i + 1)) return true;
      used.delete(co.code);
      result[br][bc][r][c] = null;
    }
    return false;
  }

  if (!backtrack(0)) return null;
  return /** @type {Country[][][][]} */ (result);
}

/**
 * Fisher–Yates shuffle in place. Internal helper for randomizing
 * candidate orderings inside backtracking solvers.
 *
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @param {number} [minPerCell]
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

/**
 * Hall-marriage check for 9×9 (Ultimate) playability: returns true iff there
 * exist 81 distinct countries (or `perCell × 9` in general) that satisfy
 * every (row × col) cell, with `perCell` distinct countries assigned per cell
 * and no country shared between cells.
 *
 * Proof of correctness — Hall's defect theorem (the b-matching generalization):
 * a perfect assignment respecting per-cell demand exists iff for every
 * non-empty subset S of cells, the union of their candidate countries
 * (the countries that match at least one cell in S) has size ≥
 * perCell × |S|. With only 9 cells there are 2^9 − 1 = 511 subsets to check —
 * cheap enough to run inside a puzzle-generation loop.
 *
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 * @param {number} [perCell] Slots per cell — defaults to 9 (the small-board size).
 * @returns {boolean}
 */
export function hasUltimatePuzzleSolution(puzzle, countries, perCell = 9) {
  /** @type {Set<string>[]} 9 cells in row-major order, each holding the codes of every country that fits its (row × col) predicate. */
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      /** @type {Set<string>} */
      const set = new Set();
      for (const co of countries) {
        if (puzzle.rows[r].predicate(co) && puzzle.cols[c].predicate(co)) {
          set.add(co.code);
        }
      }
      cells.push(set);
    }
  }
  for (let mask = 1; mask < (1 << 9); mask++) {
    let size = 0;
    /** @type {Set<string>} */
    const union = new Set();
    for (let i = 0; i < 9; i++) {
      if (mask & (1 << i)) {
        size++;
        for (const code of cells[i]) union.add(code);
      }
    }
    if (union.size < size * perCell) return false;
  }
  return true;
}

/**
 * Random-search the category space for a puzzle that admits a full 81-distinct
 * country assignment (i.e. one valid country per sub-cell across all 9 small
 * boards). Pulls candidate puzzles via `randomPuzzle`, skips axis conflicts,
 * and gates on `hasUltimatePuzzleSolution`. The stronger constraint thins out
 * the eligible category space — observed ~55 attempts on average — so the
 * default attempt budget is higher than `generateRandomPuzzle`'s.
 *
 * @param {Country[]} countries
 * @param {{ rng?: () => number, maxAttempts?: number }} [options]
 * @returns {Puzzle}
 */
export function generateUltimateRandomPuzzle(countries, options = {}) {
  const { rng = Math.random, maxAttempts = 500 } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const puzzle = randomPuzzle(rng);
    if (axesConflict(puzzle.rows, puzzle.cols)) continue;
    if (hasUltimatePuzzleSolution(puzzle, countries)) {
      return puzzle;
    }
  }
  throw new Error(
    `Could not generate a 9×9-solvable puzzle after ${maxAttempts} attempts`,
  );
}

const MIN_QUERY_LENGTH = 3;

const NON_COMBINING_FOLD_MAP = /** @type {const} */ ({
  'ł': 'l', 'đ': 'd', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss',
});
const NON_COMBINING_FOLD_RE = /[łđøæœß]/g;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Normalize a string for diacritic-insensitive matching: lowercase, strip
 * combining accents (NFD then drop U+0300–U+036F), and fold a few
 * non-combining Latin letters (ł, đ, ø, æ, œ, ß) to their closest ASCII
 * equivalents.
 *
 * The picker accepts "lodz" for "Łódź", "wlochy" for "Włochy", and "espana"
 * for "España" because we apply this fold to both the query and every
 * candidate name/alias before the substring/equality check. ł and friends
 * need the manual map because they aren't combining-mark sequences — NFD
 * leaves them as single codepoints.
 *
 * @param {string} s
 * @returns {string}
 */
export function foldDiacritics(s) {
  const stripped = s.toLowerCase().normalize('NFD').replace(COMBINING_MARKS_RE, '');
  return stripped.replace(
    NON_COMBINING_FOLD_RE,
    (ch) => /** @type {Record<string, string>} */ (NON_COMBINING_FOLD_MAP)[ch] ?? ch,
  );
}

/**
 * @param {Country[]} allCountries
 * @param {string} query
 * @param {{ limit?: number, excludeCodes?: Set<string> }} [options]
 * @returns {Country[]}
 */
export function suggest(allCountries, query, options = {}) {
  const { limit = 8, excludeCodes = new Set() } = options;
  const trimmed = query.trim();
  // Keep the "must type 3 chars" rule against the raw input, not the folded
  // form — otherwise typing "ß" alone (folds to "ss") would inch over the
  // threshold and surprise the user.
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const q = foldDiacritics(trimmed);
  return allCountries
    .filter((c) => {
      if (excludeCodes.has(c.code)) return false;
      if (foldDiacritics(c.name).includes(q)) return true;
      if (c.aliases) {
        for (const a of c.aliases) {
          if (foldDiacritics(a).includes(q)) return true;
        }
      }
      return false;
    })
    .slice(0, limit);
}

/**
 * Returns the country to auto-submit when the user has typed an exact full
 * country name (or one of its aliases) and the suggestion list has no
 * ambiguity; otherwise null.
 *
 * Ambiguity check is matches.length === 1 — so typing "Niger" while both
 * Niger and Nigeria match the substring waits for a deliberate pick rather
 * than guessing for the user.
 *
 * @template {{ name: string, aliases?: string[] }} T
 * @param {T[]} matches
 * @param {string} query
 * @returns {T | null}
 */
export function exactSingleMatch(matches, query) {
  if (matches.length !== 1) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  const typed = foldDiacritics(trimmed);
  const m = matches[0];
  if (foldDiacritics(m.name) === typed) return m;
  if (m.aliases) {
    for (const a of m.aliases) {
      if (foldDiacritics(a) === typed) return m;
    }
  }
  return null;
}

/**
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
 * @param {Country | null | undefined} country
 * @param {{ revealed?: boolean }} [options]
 * @returns {Array<[string, boolean]>}
 */
export function cellRenderClasses(country, options = {}) {
  const filled = country !== null && country !== undefined;
  return [
    ['filled', filled],
    ['revealed', Boolean(options.revealed)],
  ];
}

/**
 * Picks a valid country for each empty cell, excluding any country already
 * used in the user's picks or in earlier reveals.
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][]} solution
 * @param {Country[]} countries
 * @param {() => number} [random]
 * @returns {Array<string | null>}
 */
export function fillEmptyCellsForGiveUp(puzzle, solution, countries, random = Math.random) {
  /** @type {Array<string | null>} */
  const result = Array(9).fill(null);
  const used = new Set();
  for (const row of solution) for (const c of row) if (c) used.add(c.code);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (solution[r][c]) continue;
      const candidates = countries.filter(
        (country) => validateCell(puzzle, r, c, country) && !used.has(country.code),
      );
      if (candidates.length === 0) continue;
      const picked = candidates[Math.floor(random() * candidates.length)];
      result[r * 3 + c] = picked.code;
      used.add(picked.code);
    }
  }
  return result;
}

const WRONG_PICK_PENALTY = 3;
const EMPTY_CELL_PENALTY = 10;

/**
 * @param {Object} state
 * @param {number} state.filledCount
 * @param {number} state.wrongCount
 * @returns {number}
 */
export function computeGridScore({ filledCount, wrongCount }) {
  if (filledCount === 0) return 0;
  const emptyCount = 9 - filledCount;
  const raw = 100 - WRONG_PICK_PENALTY * wrongCount - EMPTY_CELL_PENALTY * emptyCount;
  return Math.max(0, Math.min(100, raw));
}

/**
 * @typedef {Object} GridState
 * @property {Array<string | null>} picks
 * @property {number} wrongCount
 * @property {boolean} gaveUp
 * @property {Array<string | null>} revealedCodes
 */

/**
 * A round is locked once the player either gave up or filled every
 * cell (the picker only commits valid picks, so a fully-filled board
 * is by construction a solved board). Replaces the old finalTimeMs
 * signal — the 3x3 doesn't carry a timer any more.
 *
 * @param {Pick<GridState, 'gaveUp' | 'picks'>} state
 * @returns {boolean}
 */
export function isGridLocked({ gaveUp, picks }) {
  return gaveUp || picks.every((p) => p !== null);
}

/**
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
      typeof parsed.gaveUp === 'boolean'
    ) {
      return {
        picks: parsed.picks.map((/** @type {unknown} */ p) => (typeof p === 'string' ? p : null)),
        wrongCount: parsed.wrongCount,
        gaveUp: parsed.gaveUp,
        revealedCodes:
          Array.isArray(parsed.revealedCodes) && parsed.revealedCodes.length === 9
            ? parsed.revealedCodes.map((/** @type {unknown} */ p) => (typeof p === 'string' ? p : null))
            : Array(9).fill(null),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{ setItem(key: string, value: string): void }} store
 * @param {string} key
 * @param {GridState} state
 */
export function saveGridState(store, key, state) {
  try {
    store.setItem(key, JSON.stringify(state));
  } catch {
    // localStorage may throw in private mode / zero quota; degrade silently.
  }
}

/**
 * @param {string} slug
 * @returns {string}
 */
export function gridBestKey(slug) {
  return `flaggrid.best.${slug}`;
}

/**
 * @param {import('./quiz.js').BestStore} store
 * @param {string} slug
 * @param {Result} current
 * @returns {{ best: Result, isNew: boolean }}
 */
export function recordGridResult(store, slug, current) {
  const key = gridBestKey(slug);
  const outcome = nextBest(loadBest(store, key), current);
  if (outcome.isNew) saveBest(store, key, outcome.best);
  return outcome;
}
