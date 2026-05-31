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
