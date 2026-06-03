import { validateCell, findUltimateAssignment } from './grid.js';
import { findWinner } from './ticTacToe.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./grid.js').Puzzle} Puzzle */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./ticTacToe.js').Cell} Cell */

/**
 * @typedef {Object} SmallBoard
 * @property {Cell[][]} cells       Local 3x3 of sub-cells.
 * @property {Player | null} winner Player who claimed this small board (3-in-a-row inside it), or null.
 * @property {[number, number][] | null} winningLine The 3 (smallRow, smallCol) coords of the local 3-in-a-row.
 * @property {boolean} dead         True when no winner is possible — board is full, or its (row × col)
 *                                  pool of unused matching countries has been exhausted by global play.
 */

/**
 * @typedef {Object} UltimateGameState
 * @property {Puzzle} puzzle
 * @property {SmallBoard[][]} boards   Meta-3x3 of SmallBoards, indexed [bigRow][bigCol].
 * @property {Player} currentPlayer
 * @property {Player | null} winner    Meta-winner (3 small-board claims in a row), or null.
 * @property {[number, number][] | null} winningLine The 3 (bigRow, bigCol) coords of the meta 3-in-a-row.
 * @property {boolean} draw            Meta-draw: every meta-cell is claimed-or-dead and no meta-winner.
 * @property {boolean} [gaveUp]        True when a player invoked give-up; the board is frozen and empty
 *                                     sub-cells have been filled by applyUltimateGiveUp.
 */

/**
 * @typedef {Object} UltimateClaimOutcome
 * @property {'claimed' | 'miss-invalid' | 'miss-duplicate' | 'miss-taken'} kind
 * @property {UltimateGameState} nextState
 */

/** @returns {Cell} */
function emptyCell() {
  return { owner: null, country: null };
}

/** @returns {SmallBoard} */
function emptySmallBoard() {
  return {
    cells: [
      [emptyCell(), emptyCell(), emptyCell()],
      [emptyCell(), emptyCell(), emptyCell()],
      [emptyCell(), emptyCell(), emptyCell()],
    ],
    winner: null,
    winningLine: null,
    dead: false,
  };
}

/**
 * @param {Puzzle} puzzle
 * @param {Player} [firstPlayer]
 * @returns {UltimateGameState}
 */
export function newUltimateGame(puzzle, firstPlayer = 'X') {
  /** @type {SmallBoard[][]} */
  const boards = [];
  for (let br = 0; br < 3; br++) {
    /** @type {SmallBoard[]} */
    const row = [];
    for (let bc = 0; bc < 3; bc++) row.push(emptySmallBoard());
    boards.push(row);
  }
  return {
    puzzle,
    boards,
    currentPlayer: firstPlayer,
    winner: null,
    winningLine: null,
    draw: false,
    gaveUp: false,
  };
}

/** Meta-board winning lines — same 8 lines as a regular 3x3 tic-tac-toe. */
/** @type {[number, number][][]} */
const META_LINES = [
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
 * @param {SmallBoard[][]} boards
 * @returns {{ winner: Player | null, line: [number, number][] | null }}
 */
function findMetaWinner(boards) {
  for (const line of META_LINES) {
    const a = boards[line[0][0]][line[0][1]].winner;
    const b = boards[line[1][0]][line[1][1]].winner;
    const c = boards[line[2][0]][line[2][1]].winner;
    if (a && a === b && a === c) return { winner: a, line };
  }
  return { winner: null, line: null };
}

/** @param {SmallBoard} board */
function smallBoardLocked(board) {
  return board.winner !== null || board.dead;
}

/** @param {Cell[][]} cells */
function smallBoardFull(cells) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!cells[r][c].owner) return false;
    }
  }
  return true;
}

/** @param {SmallBoard[][]} boards @param {string} code */
function globalCodeUsed(boards, code) {
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const cells = boards[br][bc].cells;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (cells[r][c].country?.code === code) return true;
        }
      }
    }
  }
  return false;
}

/** @param {SmallBoard[][]} boards @returns {Set<string>} */
function collectGlobalUsedCodes(boards) {
  /** @type {Set<string>} */
  const used = new Set();
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const cells = boards[br][bc].cells;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const code = cells[r][c].country?.code;
          if (code) used.add(code);
        }
      }
    }
  }
  return used;
}

/** @param {Cell[][]} cells */
function cloneCells(cells) {
  return cells.map((row) => row.map((cell) => ({ ...cell })));
}

/** @param {SmallBoard[][]} boards @returns {SmallBoard[][]} */
function cloneBoards(boards) {
  return boards.map((row) => row.map((b) => ({ ...b, cells: cloneCells(b.cells) })));
}

/** @param {Player} p @returns {Player} */
function other(p) {
  return p === 'X' ? 'O' : 'X';
}

/**
 * Meta-draw check. Conservative definition agreed in design: every meta-cell
 * must be claimed-or-dead AND no meta-winner exists. We don't try to detect
 * earlier "no remaining winning line possible" draws — keeps the rule
 * predictable for players.
 *
 * @param {SmallBoard[][]} boards
 */
function isMetaDraw(boards) {
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      if (!smallBoardLocked(boards[br][bc])) return false;
    }
  }
  return true;
}

/**
 * Recompute the dead-by-exhaustion flag for every non-locked small board.
 * A board is dead when no remaining country in the pool matches its
 * (row × col) predicate AND isn't already used elsewhere on the 9×9.
 *
 * Must be called after any move because a country used in one small board
 * may have been the last unused candidate that fit another small board's
 * predicate (countries can match more than one row × col pair).
 *
 * @param {SmallBoard[][]} boards
 * @param {Puzzle} puzzle
 * @param {Country[]} countries
 */
function refreshDeadFlags(boards, puzzle, countries) {
  const used = collectGlobalUsedCodes(boards);
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const b = boards[br][bc];
      if (smallBoardLocked(b)) continue;
      if (smallBoardFull(b.cells)) {
        boards[br][bc] = { ...b, dead: true };
        continue;
      }
      const rowCat = puzzle.rows[br];
      const colCat = puzzle.cols[bc];
      let anyRemaining = false;
      for (const c of countries) {
        if (used.has(c.code)) continue;
        if (rowCat.predicate(c) && colCat.predicate(c)) {
          anyRemaining = true;
          break;
        }
      }
      if (!anyRemaining) boards[br][bc] = { ...b, dead: true };
    }
  }
}

/**
 * @param {UltimateGameState} state
 * @param {number} bigRow
 * @param {number} bigCol
 * @param {number} smallRow
 * @param {number} smallCol
 * @param {Country} country
 * @param {Country[]} countries
 * @returns {UltimateClaimOutcome}
 */
export function attemptUltimateClaim(state, bigRow, bigCol, smallRow, smallCol, country, countries) {
  if (state.winner || state.draw || state.gaveUp) {
    return { kind: 'miss-taken', nextState: state };
  }
  const board = state.boards[bigRow][bigCol];
  if (smallBoardLocked(board)) {
    return { kind: 'miss-taken', nextState: state };
  }
  if (board.cells[smallRow][smallCol].owner) {
    return { kind: 'miss-taken', nextState: state };
  }

  if (!validateCell(state.puzzle, bigRow, bigCol, country)) {
    return {
      kind: 'miss-invalid',
      nextState: { ...state, currentPlayer: other(state.currentPlayer) },
    };
  }

  if (globalCodeUsed(state.boards, country.code)) {
    return {
      kind: 'miss-duplicate',
      nextState: { ...state, currentPlayer: other(state.currentPlayer) },
    };
  }

  const boards = cloneBoards(state.boards);
  const justPlayed = boards[bigRow][bigCol];
  justPlayed.cells[smallRow][smallCol] = { owner: state.currentPlayer, country };
  const { winner: sbWinner, line: sbLine } = findWinner(justPlayed.cells);
  boards[bigRow][bigCol] = {
    ...justPlayed,
    winner: sbWinner,
    winningLine: sbLine,
  };

  refreshDeadFlags(boards, state.puzzle, countries);

  const { winner: metaWinner, line: metaLine } = findMetaWinner(boards);
  const draw = !metaWinner && isMetaDraw(boards);

  return {
    kind: 'claimed',
    nextState: {
      ...state,
      boards,
      winner: metaWinner,
      winningLine: metaLine,
      draw,
      currentPlayer: metaWinner || draw ? state.currentPlayer : other(state.currentPlayer),
    },
  };
}

/**
 * @param {UltimateGameState} state
 * @returns {boolean}
 */
export function isUltimateGameOver(state) {
  return state.winner !== null || state.draw || Boolean(state.gaveUp);
}

/**
 * Give-up reveal for the 9x9 ultimate game.
 *
 * The empty-board case (the one a player hits most often) is solved by
 * `findUltimateAssignment` — a backtracking solver that constructs the
 * 81-distinct assignment generation already proved exists via Hall's
 * condition. The previous implementation here did a greedy fill that
 * could starve thin (row × col) pools and surface duplicates marked
 * "exhausted", even though a valid assignment was always reachable.
 *
 * Partial-claim case: if the player has steered the board into a state
 * where no 81-distinct completion exists (move validation in
 * `attemptUltimateClaim` may not catch every dead-end), the solver
 * returns null and we fall back to greedy fill with `.exhausted` marks
 * so the UI can render "this slot had no fresh answer left" in black.
 *
 * No-op when the game is already over.
 *
 * @param {UltimateGameState} state
 * @param {Country[]} countries
 * @param {() => number} [random]
 * @returns {UltimateGameState}
 */
export function applyUltimateGiveUp(state, countries, random = Math.random) {
  if (isUltimateGameOver(state)) return state;
  const boards = cloneBoards(state.boards);

  // Snapshot already-claimed sub-cells as the preFilled grid the solver
  // must respect. Empty sub-cells map to null.
  /** @type {(Country | null)[][][][]} */
  const preFilled = boards.map((row) =>
    row.map((board) => board.cells.map((cellRow) =>
      cellRow.map((cell) => (cell.owner ? cell.country : null)),
    )),
  );
  const assignment = findUltimateAssignment(state.puzzle, preFilled, countries, random);

  if (assignment) {
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const board = boards[br][bc];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            if (board.cells[r][c].owner) continue;
            const picked = assignment[br][bc][r][c];
            if (picked) {
              board.cells[r][c] = { owner: null, country: picked, revealed: true };
            }
          }
        }
      }
    }
    return { ...state, boards, gaveUp: true };
  }

  // Solver failed — fall back to greedy fill with .exhausted marks. This
  // only fires when player claims have left no valid completion.
  const used = collectGlobalUsedCodes(boards);
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const rowCat = state.puzzle.rows[br];
      const colCat = state.puzzle.cols[bc];
      const board = boards[br][bc];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (board.cells[r][c].owner) continue;
          const allValid = countries.filter(
            (country) => rowCat.predicate(country) && colCat.predicate(country),
          );
          if (allValid.length === 0) continue;
          const fresh = allValid.filter((country) => !used.has(country.code));
          if (fresh.length > 0) {
            const picked = fresh[Math.floor(random() * fresh.length)];
            board.cells[r][c] = { owner: null, country: picked, revealed: true };
            used.add(picked.code);
          } else {
            const picked = allValid[Math.floor(random() * allValid.length)];
            board.cells[r][c] = { owner: null, country: picked, revealed: true, exhausted: true };
          }
        }
      }
    }
  }
  return { ...state, boards, gaveUp: true };
}

/**
 * Small board coords [br, bc] whose 3-in-a-row line just appeared in the
 * transition from `prev` to `next`. Used by the 9x9 page to fire a
 * one-shot shake on the freshly-won small-board cells.
 *
 * Once a small board's `winningLine` is non-null it stays non-null for
 * the rest of the game, so the result is non-empty only for boards
 * that flipped from "no line yet" to "line just formed" this turn.
 *
 * @param {UltimateGameState} prev
 * @param {UltimateGameState} next
 * @returns {[number, number][]}
 */
export function newlyWonSmallBoards(prev, next) {
  /** @type {[number, number][]} */
  const out = [];
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const p = prev.boards[br][bc];
      const n = next.boards[br][bc];
      if (n.winningLine && !p.winningLine) out.push([br, bc]);
    }
  }
  return out;
}

/**
 * True iff the meta (big) 3-in-a-row line just appeared in this turn's
 * transition. The 9x9 page uses this to fire a one-shot shake across
 * every cell of the three winning small boards.
 *
 * @param {UltimateGameState} prev
 * @param {UltimateGameState} next
 * @returns {boolean}
 */
export function isMetaWinNewlyFormed(prev, next) {
  return Boolean(next.winningLine) && !prev.winningLine;
}
