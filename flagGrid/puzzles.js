import { continent, hasColor, hasMotif } from '../flags/grid.js';

/** @typedef {import('../flags/grid.js').Puzzle} Puzzle */

/** @type {Puzzle} */
export const PUZZLE_1 = {
  rows: [continent('Europe'), continent('Asia'), continent('Africa')],
  cols: [hasColor('red'), hasMotif('animal'), hasMotif('coat-of-arms')],
};

/** @type {Puzzle} */
export const PUZZLE_2 = {
  rows: [continent('North America'), continent('Africa'), continent('Asia')],
  cols: [hasColor('red'), hasColor('white'), hasMotif('weapon')],
};

/** @type {Puzzle} */
export const PUZZLE_3 = {
  rows: [hasColor('red'), continent('Africa'), continent('South America')],
  cols: [hasColor('white'), hasColor('green'), hasMotif('star-or-moon')],
};

/** @type {Array<{ slug: string, label: string, puzzle: Puzzle }>} */
export const ARCHIVE = [
  { slug: '1', label: 'Game 1', puzzle: PUZZLE_1 },
  { slug: '2', label: 'Game 2', puzzle: PUZZLE_2 },
];
