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

/** @returns {Category[]} */
export function buildRandomCategoryPool() {
  return [
    ...CONTINENTS_FOR_RANDOM.map(continent),
    ...COLORS_FOR_RANDOM.map(hasColor),
    ...MOTIFS_FOR_RANDOM.map(hasMotif),
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

const MIN_QUERY_LENGTH = 3;

/**
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
    .filter((c) => {
      if (excludeCodes.has(c.code)) return false;
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.aliases) {
        for (const a of c.aliases) {
          if (a.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    })
    .slice(0, limit);
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
 * @property {number | null} finalTimeMs
 * @property {Array<string | null>} revealedCodes
 */

/**
 * @param {Pick<GridState, 'gaveUp' | 'finalTimeMs'>} state
 * @returns {boolean}
 */
export function isGridLocked({ gaveUp, finalTimeMs }) {
  return gaveUp || finalTimeMs !== null;
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
      typeof parsed.gaveUp === 'boolean' &&
      (parsed.finalTimeMs === null || typeof parsed.finalTimeMs === 'number')
    ) {
      return {
        picks: parsed.picks.map((/** @type {unknown} */ p) => (typeof p === 'string' ? p : null)),
        wrongCount: parsed.wrongCount,
        gaveUp: parsed.gaveUp,
        finalTimeMs: parsed.finalTimeMs,
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
