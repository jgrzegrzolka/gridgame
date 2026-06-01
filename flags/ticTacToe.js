import { validateCell } from './grid.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Puzzle} Puzzle */

/** @typedef {'X' | 'O'} Player */

/**
 * @typedef {Object} Cell
 * @property {Player | null} owner
 * @property {Country | null} country
 */

/**
 * @typedef {Object} GameState
 * @property {Puzzle} puzzle
 * @property {Cell[][]} cells
 * @property {Player} currentPlayer
 * @property {Player | null} winner
 * @property {[number, number][] | null} winningLine
 * @property {boolean} draw
 */

/**
 * @typedef {Object} ClaimOutcome
 * @property {'claimed' | 'miss-invalid' | 'miss-duplicate' | 'miss-taken'} kind
 * @property {GameState} nextState
 */

/** @returns {Cell} */
function emptyCell() {
  return { owner: null, country: null };
}

/**
 * @param {Puzzle} puzzle
 * @returns {GameState}
 */
export function newGame(puzzle) {
  return {
    puzzle,
    cells: [
      [emptyCell(), emptyCell(), emptyCell()],
      [emptyCell(), emptyCell(), emptyCell()],
      [emptyCell(), emptyCell(), emptyCell()],
    ],
    currentPlayer: 'X',
    winner: null,
    winningLine: null,
    draw: false,
  };
}

/** @type {[number, number][][]} */
const LINES = [
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
];

/**
 * @param {Cell[][]} cells
 * @returns {{ winner: Player | null, line: [number, number][] | null }}
 */
export function findWinner(cells) {
  for (const line of LINES) {
    const a = cells[line[0][0]][line[0][1]].owner;
    const b = cells[line[1][0]][line[1][1]].owner;
    const c = cells[line[2][0]][line[2][1]].owner;
    if (a && a === b && a === c) {
      return { winner: a, line };
    }
  }
  return { winner: null, line: null };
}

/**
 * @param {Cell[][]} cells
 * @returns {boolean}
 */
function boardFull(cells) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!cells[r][c].owner) return false;
    }
  }
  return true;
}

/**
 * @param {Cell[][]} cells
 * @param {string} code
 * @returns {boolean}
 */
function codeUsed(cells, code) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (cells[r][c].country?.code === code) return true;
    }
  }
  return false;
}

/**
 * @param {Cell[][]} cells
 * @returns {Cell[][]}
 */
function cloneCells(cells) {
  return cells.map((row) => row.map((cell) => ({ ...cell })));
}

/**
 * @param {Player} p
 * @returns {Player}
 */
function other(p) {
  return p === 'X' ? 'O' : 'X';
}

/**
 * @param {GameState} state
 * @param {number} row
 * @param {number} col
 * @param {Country} country
 * @returns {ClaimOutcome}
 */
export function attemptClaim(state, row, col, country) {
  if (state.winner || state.draw || state.cells[row][col].owner) {
    return { kind: 'miss-taken', nextState: state };
  }

  if (!validateCell(state.puzzle, row, col, country)) {
    return {
      kind: 'miss-invalid',
      nextState: { ...state, currentPlayer: other(state.currentPlayer) },
    };
  }

  if (codeUsed(state.cells, country.code)) {
    return {
      kind: 'miss-duplicate',
      nextState: { ...state, currentPlayer: other(state.currentPlayer) },
    };
  }

  const cells = cloneCells(state.cells);
  cells[row][col] = { owner: state.currentPlayer, country };
  const { winner, line } = findWinner(cells);
  const draw = !winner && boardFull(cells);
  return {
    kind: 'claimed',
    nextState: {
      ...state,
      cells,
      winner,
      winningLine: line,
      draw,
      currentPlayer: winner || draw ? state.currentPlayer : other(state.currentPlayer),
    },
  };
}

/**
 * @param {GameState} state
 * @returns {boolean}
 */
export function isGameOver(state) {
  return state.winner !== null || state.draw;
}
