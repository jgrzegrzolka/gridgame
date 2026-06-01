import { continent, hasColor, hasMotif } from '../flags/grid.js';

/** @typedef {import('../flags/grid.js').Puzzle} Puzzle */

/**
 * Fixed puzzles used by the numbered flagGrid variants. Each puzzle's
 * solvability against the real countries.json is asserted in
 * flags/countries.test.js so a data drift that empties a cell shows up
 * at test time rather than as a stuck game.
 *
 * @type {Puzzle}
 */
export const PUZZLE_1 = {
  rows: [continent('Europe'), continent('Asia'), continent('Africa')],
  cols: [hasColor('red'), hasMotif('animal'), hasMotif('coat-of-arms')],
};

/** @type {Puzzle} */
export const PUZZLE_2 = {
  rows: [continent('North America'), continent('Africa'), continent('Asia')],
  cols: [hasColor('red'), hasColor('white'), hasMotif('weapon')],
};

/**
 * Catalogue of every numbered puzzle, in chronological order. The
 * archive page reads this list to render its index, and the menu's
 * "Current" link still points at the latest entry by hand. When a new
 * puzzle ships, add an entry here and create flagGrid/<slug>/index.html
 * alongside it.
 *
 * @type {Array<{ slug: string, label: string, puzzle: Puzzle }>}
 */
export const ARCHIVE = [
  { slug: '1', label: 'Game 1', puzzle: PUZZLE_1 },
  { slug: '2', label: 'Game 2', puzzle: PUZZLE_2 },
];
