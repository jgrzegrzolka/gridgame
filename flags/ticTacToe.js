import { validateCell } from './grid.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Puzzle} Puzzle */

/** @typedef {'X' | 'O'} Player */

/**
 * @typedef {Object} Cell
 * @property {Player | null} owner
 * @property {Country | null} country
 * @property {boolean} [revealed]  - true when the country was filled in by
 *   the give-up reveal (not by a player claim). owner stays null.
 * @property {boolean} [exhausted] - 9x9 only; true when even the give-up
 *   reveal had to reuse a country that's already shown elsewhere because
 *   no fresh valid country was available globally. Always implies revealed.
 */

/**
 * @typedef {Object} GameState
 * @property {Puzzle} puzzle
 * @property {Cell[][]} cells
 * @property {Player} currentPlayer
 * @property {Player | null} winner
 * @property {[number, number][] | null} winningLine
 * @property {boolean} draw
 * @property {boolean} [gaveUp] - true when a player invoked give-up. The
 *   board is then frozen (no further claims) and any empty cells have
 *   been filled by applyGiveUp with revealed: true.
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
 * @param {Player} [firstPlayer]
 * @returns {GameState}
 */
export function newGame(puzzle, firstPlayer = 'X') {
  return {
    puzzle,
    cells: [
      [emptyCell(), emptyCell(), emptyCell()],
      [emptyCell(), emptyCell(), emptyCell()],
      [emptyCell(), emptyCell(), emptyCell()],
    ],
    currentPlayer: firstPlayer,
    winner: null,
    winningLine: null,
    draw: false,
    gaveUp: false,
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
  if (state.winner || state.draw || state.gaveUp || state.cells[row][col].owner) {
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
  return state.winner !== null || state.draw || Boolean(state.gaveUp);
}

/**
 * Give-up reveal. Walks every empty cell, picks a valid country that hasn't
 * been used anywhere on the board, and writes it with owner=null +
 * revealed=true. Returns a fresh state with gaveUp=true.
 *
 * No-op when the game is already over (winner/draw/already-gaveUp). The 3x3
 * variant has no concept of "exhausted" — its global pool is the full
 * country set, which is far larger than 9 cells. We still defensively skip
 * a cell whose (row × col) intersection genuinely has zero countries left
 * (e.g. a degenerate test puzzle), rather than crash.
 *
 * @param {GameState} state
 * @param {Country[]} countries
 * @param {() => number} [random]
 * @returns {GameState}
 */
export function applyGiveUp(state, countries, random = Math.random) {
  if (isGameOver(state)) return state;
  /** @type {Set<string>} */
  const used = new Set();
  for (const row of state.cells) {
    for (const cell of row) {
      if (cell.country) used.add(cell.country.code);
    }
  }
  const cells = cloneCells(state.cells);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (cells[r][c].owner) continue;
      const candidates = countries.filter(
        (country) => validateCell(state.puzzle, r, c, country) && !used.has(country.code),
      );
      if (candidates.length === 0) continue;
      const picked = candidates[Math.floor(random() * candidates.length)];
      cells[r][c] = { owner: null, country: picked, revealed: true };
      used.add(picked.code);
    }
  }
  return { ...state, cells, gaveUp: true };
}

/**
 * Confetti rule for any Tic-Tac-Toe page (3x3, 9x9, online).
 *
 * Offline (myRole omitted/null): there is no "you" — the game has a
 * winner from the local player's perspective regardless of which mark
 * won, so fire on any X/O win.
 *
 * Online (myRole = 'X' | 'O'): only celebrate when *you* win; the loser
 * gets the "Opponent wins" label without confetti.
 *
 * Draws and give-ups never fire (winner is null in both cases).
 *
 * @param {{ winner: Player | null, myRole?: Player | null }} params
 * @returns {boolean}
 */
export function shouldFireTicTacToeConfetti({ winner, myRole = null }) {
  if (winner !== 'X' && winner !== 'O') return false;
  if (myRole === null || myRole === undefined) return true;
  return winner === myRole;
}

/**
 * Cells that just transitioned into a winning line this turn — empty
 * unless the game went from "no winner" to "winner exists". The 3x3
 * pages use this to fire a one-shot shake animation on the winning
 * three cells without re-shaking on later re-renders.
 *
 * Once a 3-in-a-row exists the game is over and `winningLine` cannot
 * change again, so the "prev had a line" case always returns empty.
 *
 * @param {{ winningLine: [number, number][] | null }} prev
 * @param {{ winningLine: [number, number][] | null }} next
 * @returns {[number, number][]}
 */
export function newlyWinningCells(prev, next) {
  if (!next.winningLine) return [];
  if (prev.winningLine) return [];
  return next.winningLine;
}
