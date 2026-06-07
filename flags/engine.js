/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./group.js').Continent} Continent */

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

/**
 * Colours the random-puzzle generator is allowed to pair with continents.
 * Every (continent × colour) cell must admit at least one country, so this
 * is the *narrow* palette — additions need a sanity check that every
 * continent has at least one flag carrying the new colour.
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
 * All colours that may appear on any flag in `countries.json` — the wider
 * data palette. This is `COLORS_FOR_RANDOM` plus the rare emblem-only
 * colours that don't have continent-wide coverage (currently just `violet`,
 * which only shows up on Dominica's sisserou parrot and Northern Mariana
 * Islands' wreath). Used by the findFlag chooser so the UI can offer a
 * violet filter (the existing `count > 0` filter keeps it from appearing
 * on empty continents), and by the palette validator in countries.test.js.
 * Not used by the random-puzzle generator — that path stays on the narrow
 * `COLORS_FOR_RANDOM` so it can't pick an unfillable (continent × colour)
 * pair.
 */
export const ALL_FLAG_COLORS = [...COLORS_FOR_RANDOM, 'violet'];

/**
 * Exact-N colour-count Categories the random puzzle generator is allowed to
 * pair with continents / colours / motifs on the row / column axes. Members
 * share `exclusiveGroup: 'colorCount'` so two different N values can never
 * appear on the same axis or across axes (axesConflict catches it). N=2 and
 * N=3 cover the distinctive cases — every continent in `flagsGamePool` has
 * at least one flag for each (South America has just 1 at N=2, which is
 * tight but `isPuzzleGeneratable`'s minPerCell already screens that). N=4
 * is plausible too but not as readable as a category ("exactly 4 colours"
 * blurs into "many colours"); a future PR can add `>=4` and reconsider.
 * N=1 has 0 candidates in the pool and N≥5 has 0 candidates on at least
 * one continent (Asia), so both stay out.
 */
export const COLOR_COUNTS_FOR_RANDOM = [2, 3];

/** Motifs the random puzzle generator (3×3 and 9×9 ticTacToe) is allowed
 * to pair with continents on the row / column axes. Some motifs appear on
 * flags from only one continent (e.g. `eu-member` is Europe-only) — those
 * are still allowed in the pool because `generateRandomPuzzle` retries up
 * to 200 times when an attempted puzzle has an unfillable cell. The
 * seed-success test in countries.test.js guards the retry headroom: if
 * the pool ever drifts to where 30+ seeds can't yield a valid puzzle, the
 * test fails. See ALL_MOTIFS below for motifs that can be filtered on
 * (findFlag / flagsdata) but aren't suitable for random pairing — today
 * that's just `union-jack` which has narrow coverage and no compelling
 * puzzle hook. */
export const MOTIFS_FOR_RANDOM = [
  'animal',
  'coat-of-arms',
  'weapon',
  'star-or-moon',
  'cross',
  'eu-member',
];

/** Every motif key that can appear in `country.motifs`. Used by the
 * findFlag chooser and the flagsdata filter bar so the UI can offer
 * every tagged motif as a filter. Superset of MOTIFS_FOR_RANDOM —
 * adds motifs that work as filters but can't anchor a random puzzle
 * (e.g. union-jack, which no Asian flag carries). */
export const ALL_MOTIFS = [
  ...MOTIFS_FOR_RANDOM,
  'union-jack',
];

/**
 * @param {string} color
 * @returns {Category}
 */
export function hasColor(color) {
  return {
    id: `hasColor:${color}`,
    label: color,
    predicate: (c) => c.colors.includes(color),
  };
}

/**
 * @param {number} n
 * @returns {Category}
 */
export function colorCount(n) {
  return {
    id: `colorCount:${n}`,
    label: `only ${n} colours`,
    predicate: (c) => c.colors.length === n,
    exclusiveGroup: 'colorCount',
  };
}

/**
 * @param {string} motif
 * @returns {Category}
 */
export function hasMotif(motif) {
  return {
    id: `hasMotif:${motif}`,
    label: motif,
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
 * above bake an English label (`"Africa"`, `"red"`, `"weapon"`) onto every
 * Category so the engine stays pure of i18n; this is the boundary helper
 * that page code uses at render time to swap in the active language.
 * Unknown id prefixes fall through to the baked label so a stray category
 * never renders blank.
 *
 * Key conventions:
 *   `continent:<Name>` → `variant.<name-lower-kebab>` (reuses the flagQuiz
 *      variant translations — continents are translated as nouns, not as
 *      "Continent: Africa".)
 *   `hasColor:<x>`     → `color.<x>` (bare noun, no "Has " wrapper).
 *   `hasMotif:<x>`     → `motif.<x>` (bare noun, no "Has " wrapper).
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
    return translate(`color.${value}`, value);
  }
  if (kind === 'hasMotif') {
    return translate(`motif.${value}`, value);
  }
  if (kind === 'colorCount') {
    return translate(`filter.onlyN.${value}`, category.label);
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
  if (id.startsWith('colorCount:')) {
    const n = Number.parseInt(id.slice('colorCount:'.length), 10);
    if (Number.isInteger(n) && n >= 0) return colorCount(n);
    return null;
  }
  return null;
}

/** @returns {Category[]} */
export function buildRandomCategoryPool() {
  return [
    ...CONTINENTS_FOR_RANDOM.map(continent),
    ...COLORS_FOR_RANDOM.map(hasColor),
    ...MOTIFS_FOR_RANDOM.map(hasMotif),
    ...COLOR_COUNTS_FOR_RANDOM.map(colorCount),
  ];
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
 * Detect a degenerate (row × col) pair where one axis's predicate is fully
 * implied by the other's. The classic case is `motif:eu-member` × `continent:Europe`
 * — every EU member is European, so the cell reduces to "EU member" and the
 * continent constraint does no work. The player sees a 3×3 where one cell
 * reads "EU member" twice over, breaking the implied-conjunction model that
 * makes the rest of the grid feel like progress.
 *
 * The check is set-subset: for each cross-axis (r, c) pair, if
 * {countries matching r} ⊆ {countries matching c} (or vice versa), one
 * predicate implies the other and the puzzle should be retried with a
 * different category mix. Note: an empty match-set is trivially a subset
 * of everything — we exclude that case here because empty cells are
 * already caught by `isPuzzleGeneratable`'s minPerCell threshold, and
 * treating them as "implied" would muddy the failure signal.
 *
 * @param {Category[]} rows
 * @param {Category[]} cols
 * @param {Country[]} countries
 * @returns {boolean}
 */
export function axesImpliedPair(rows, cols, countries) {
  /** @type {Map<string, Set<string>>} */
  const matchCodes = new Map();
  for (const cat of [...rows, ...cols]) {
    if (matchCodes.has(cat.id)) continue;
    const codes = new Set();
    for (const c of countries) if (cat.predicate(c)) codes.add(c.code);
    matchCodes.set(cat.id, codes);
  }
  for (const r of rows) {
    const rs = /** @type {Set<string>} */ (matchCodes.get(r.id));
    if (rs.size === 0) continue;
    for (const c of cols) {
      if (r.id === c.id) continue;
      const cs = /** @type {Set<string>} */ (matchCodes.get(c.id));
      if (cs.size === 0) continue;
      // r ⊆ c — every flag matching r also matches c, so the c constraint
      // is no-op inside the (r, c) cell.
      if (rs.size <= cs.size && [...rs].every((code) => cs.has(code))) return true;
      // c ⊆ r — symmetric case.
      if (cs.size <= rs.size && [...cs].every((code) => rs.has(code))) return true;
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
 * Bounded by `maxBacktracks`. The solver is plain DFS with MRV ordering
 * and no constraint propagation, so adversarial candidate orderings can
 * still trigger long search trees on tight pools (the synthetic
 * denseSquarePool tests hit this). The cap turns "could hang for
 * minutes" into "returns null after a fixed amount of work" — give-up
 * callers already fall back to a greedy reveal on null, so this never
 * loses the player the reveal, just trades a slow exact answer for a
 * fast best-effort one. Default headroom is far above what any healthy
 * production puzzle needs.
 *
 * @param {Puzzle} puzzle
 * @param {(Country | null)[][][][]} preFilled 3×3×3×3 of claimed countries (or null when empty).
 * @param {Country[]} countries
 * @param {() => number} [rng]
 * @param {number} [maxBacktracks] Cap on backtrack-tree nodes visited; returns null if exceeded.
 * @returns {Country[][][][] | null}
 */
export function findUltimateAssignment(puzzle, preFilled, countries, rng = Math.random, maxBacktracks = 100_000) {
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

  let steps = 0;
  /** @param {number} i */
  function backtrack(i) {
    if (++steps > maxBacktracks) return false;
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
    if (axesImpliedPair(puzzle.rows, puzzle.cols, countries)) continue;
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
    if (axesImpliedPair(puzzle.rows, puzzle.cols, countries)) continue;
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

