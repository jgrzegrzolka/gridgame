import { validateCell } from './engine.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./engine.js').Puzzle} Puzzle */

/** @typedef {'X' | 'O'} Player */

/**
 * @typedef {Object} Cell
 * @property {Player | null} owner
 * @property {Country | null} country
 * @property {boolean} [revealed]  - true when the country was filled in by
 *   the give-up reveal (not by a player claim). owner stays null.
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
 * @property {Player | null} [gaveUpBy] - the role that called give-up.
 *   Set by onlineRoom.js so a refresh-restore can paint "You gave up"
 *   vs "Opponent gave up" without depending on a live `state` effect.
 *   Engine's applyGiveUp leaves this undefined — the room layer stamps
 *   it because that's where the role lives.
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

/** @returns {Cell[][]} a fresh 3×3 board of empty cells. */
function emptyBoard() {
  return [
    [emptyCell(), emptyCell(), emptyCell()],
    [emptyCell(), emptyCell(), emptyCell()],
    [emptyCell(), emptyCell(), emptyCell()],
  ];
}

/**
 * @param {Puzzle} puzzle
 * @param {Player} [firstPlayer]
 * @returns {GameState}
 */
export function newGame(puzzle, firstPlayer = 'X') {
  return {
    puzzle,
    cells: emptyBoard(),
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
 * Give-up reveal, shared by the two-player and solo variants (CLAUDE.md
 * "same mechanism = same code"). Walks every empty cell (owner null, no
 * country yet), picks a valid country that hasn't been used anywhere on the
 * board, and writes it with owner=null + revealed=true. Returns fresh cells.
 *
 * The global pool is the full country set, far larger than 9 cells, so the
 * reveal can always find fresh countries in practice. We still defensively
 * skip a cell whose (row × col) intersection genuinely has zero countries
 * left (e.g. a degenerate test puzzle), rather than crash.
 *
 * @param {Puzzle} puzzle
 * @param {Cell[][]} sourceCells
 * @param {Country[]} countries
 * @param {() => number} random
 * @returns {Cell[][]}
 */
function revealBoard(puzzle, sourceCells, countries, random) {
  /** @type {Set<string>} */
  const used = new Set();
  for (const row of sourceCells) {
    for (const cell of row) {
      if (cell.country) used.add(cell.country.code);
    }
  }
  const cells = cloneCells(sourceCells);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (cells[r][c].owner || cells[r][c].country) continue;
      const candidates = countries.filter(
        (country) => validateCell(puzzle, r, c, country) && !used.has(country.code),
      );
      if (candidates.length === 0) continue;
      const picked = candidates[Math.floor(random() * candidates.length)];
      cells[r][c] = { owner: null, country: picked, revealed: true };
      used.add(picked.code);
    }
  }
  return cells;
}

/**
 * Every country that would have been a valid answer for one cell — the full
 * set the give-up reveal drew its single example from. `validateCell` already
 * encodes "matches this cell's row category AND its column category", so this
 * is that filter over the whole country pool, in source order (the caller
 * sorts for display). Pure, unit-tested; the tap-a-revealed-cell "all matches"
 * sheet is thin DOM glue on top (matchSheet.js).
 *
 * @param {Puzzle} puzzle
 * @param {number} row
 * @param {number} col
 * @param {Country[]} countries
 * @returns {Country[]}
 */
export function matchingCountriesForCell(puzzle, row, col, countries) {
  return countries.filter((country) => validateCell(puzzle, row, col, country));
}

/**
 * What tapping a cell should do, from its state and whether the game is over.
 * Shared by all three boards (solo, offline, online) so the dispatch can't
 * drift — the inspection actions are the same everywhere; the caller applies
 * its own turn gating on `'play'`.
 *
 * - `'matches'` — open the all-matches sheet. A give-up reveal cell (the example
 *   flag is one of many) OR **any empty cell once the game is over**: a win ends
 *   the board with cells still blank (a give-up fills them), so this is what lets
 *   those intersections disclose what would have fit, the way solo already does.
 * - `'zoom'` — a player-claimed cell; enlarge its single flag, over or not.
 * - `'play'` — an empty, still-live cell; the caller opens the picker (online
 *   first checks it's the tapper's turn).
 *
 * @param {{ country?: unknown, revealed?: unknown }} cell
 * @param {boolean} isOver
 * @returns {'matches' | 'zoom' | 'play'}
 */
export function cellTapAction(cell, isOver) {
  if (cell.revealed) return 'matches';
  if (cell.country) return 'zoom';
  if (isOver) return 'matches';
  return 'play';
}

/**
 * Two-player give-up. No-op when the game is already over
 * (winner/draw/already-gaveUp); otherwise reveals every empty cell and
 * freezes the board with gaveUp=true.
 *
 * @param {GameState} state
 * @param {Country[]} countries
 * @param {() => number} [random]
 * @returns {GameState}
 */
export function applyGiveUp(state, countries, random = Math.random) {
  if (isGameOver(state)) return state;
  return { ...state, cells: revealBoard(state.puzzle, state.cells, countries, random), gaveUp: true };
}

/**
 * Confetti rule for any Tic-Tac-Toe page (offline, solo, online).
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

/**
 * Cells that were just claimed — i.e. gained a country since the previous
 * render. The pages use this to fire the one-shot flip-in on a correct pick.
 *
 * Why a diff and not "every filled cell": all three boards rebuild every cell's
 * `<img>` on every render (`td.innerHTML = ''`), and the online board re-renders
 * on **every** server message. A CSS animation keyed off `.cell.owned` would
 * therefore re-fire on all nine flags whenever anything happened — the opponent
 * moving, a peer reconnecting, a status line changing. Same trap, same cure, as
 * `newlyWinningCells` above.
 *
 * Two rules baked in rather than left to callers, because they are the domain's
 * and not the DOM's:
 *
 *   - **`revealed` cells never count.** Give-up hands you all nine at once and
 *     they already have their own `revealed-bounce`; flipping them would double
 *     up, and worse, would dress "here is the answer you didn't get" in the
 *     animation that means "you got it".
 *   - **A first render claims nothing.** With no previous state (a refresh, or a
 *     joiner arriving mid-game) every filled cell would otherwise flip at once.
 *     Restoring a board is not playing it.
 *
 * Shape-compatible with both `GameState` and `SoloState` — it reads `country`,
 * which both fill, not `owner`, which only the two-player boards use.
 *
 * @param {{ cells: Cell[][] } | null | undefined} prev
 * @param {{ cells: Cell[][] }} next
 * @returns {[number, number][]}
 */
export function newlyClaimedCells(prev, next) {
  /** @type {[number, number][]} */
  const fresh = [];
  if (!prev || !prev.cells) return fresh;
  for (let r = 0; r < next.cells.length; r++) {
    for (let c = 0; c < next.cells[r].length; c++) {
      const after = next.cells[r][c];
      if (!after.country || after.revealed) continue;
      const before = prev.cells[r] && prev.cells[r][c];
      if (before && before.country) continue;
      fresh.push([r, c]);
    }
  }
  return fresh;
}

// ---- Solo variant --------------------------------------------------------
//
// A one-player puzzle on the same board: no turns, no three-in-a-row. The
// player fills every cell with a valid, non-duplicate flag and wins when all
// nine are filled. It reuses the shared cell mechanics (validateCell, the
// duplicate guard, the give-up reveal via revealBoard) but has its own tiny
// reducer because the two-player attemptClaim bakes in turn-flipping and
// line-win detection — filling one row with a single owner would falsely
// "win" a line in that model. Kept beside the two-player engine so the shared
// primitives (emptyBoard, codeUsed, boardFull, revealBoard) stay one copy.

/**
 * @typedef {Object} SoloState
 * @property {Puzzle} puzzle
 * @property {Cell[][]} cells
 * @property {boolean} solved  - true once all nine cells are filled.
 * @property {boolean} [gaveUp] - true when the player invoked give-up; the
 *   board is then frozen and empty cells filled by applySoloGiveUp.
 */

/**
 * @typedef {Object} SoloClaimOutcome
 * @property {'claimed' | 'miss-invalid' | 'miss-duplicate' | 'miss-taken'} kind
 * @property {SoloState} nextState
 */

/**
 * @param {Puzzle} puzzle
 * @returns {SoloState}
 */
export function newSoloGame(puzzle) {
  return { puzzle, cells: emptyBoard(), solved: false, gaveUp: false };
}

/**
 * True when nothing has happened on this board yet — no claim, no give-up
 * reveal. Reads `country` rather than `owner` so a revealed cell (owner stays
 * null, country gets filled) counts as touched, and so the same check serves
 * both the two-player `GameState` and the solo `SoloState`, which share the
 * cell shape but not the owner semantics.
 *
 * Used by the "No statistics" toggle to decide whether flipping it may re-deal
 * the board immediately or must wait for the next one — re-dealing is a page
 * reload, which on a board with progress would silently throw that progress away.
 *
 * @param {{ cells: Cell[][] }} state
 * @returns {boolean}
 */
export function boardIsUntouched(state) {
  return state.cells.every((row) => row.every((cell) => cell.country === null));
}

/**
 * @param {SoloState} state
 * @returns {boolean}
 */
export function isSoloOver(state) {
  return state.solved || Boolean(state.gaveUp);
}

/**
 * Try to fill (row, col) with `country`. A valid, unused country claims the
 * cell; an invalid or duplicate pick is a miss that leaves state untouched
 * (no turn to flip, no penalty) so the caller can just shake and let the
 * player try again. Claiming the last empty cell sets solved=true.
 *
 * @param {SoloState} state
 * @param {number} row
 * @param {number} col
 * @param {Country} country
 * @returns {SoloClaimOutcome}
 */
export function attemptSoloClaim(state, row, col, country) {
  if (isSoloOver(state) || state.cells[row][col].owner) {
    return { kind: 'miss-taken', nextState: state };
  }
  if (!validateCell(state.puzzle, row, col, country)) {
    return { kind: 'miss-invalid', nextState: state };
  }
  if (codeUsed(state.cells, country.code)) {
    return { kind: 'miss-duplicate', nextState: state };
  }
  const cells = cloneCells(state.cells);
  // owner 'X' just marks the cell filled — solo has a single player, so the
  // render never applies the X/O colour wash (see solo/page.js).
  cells[row][col] = { owner: 'X', country };
  return { kind: 'claimed', nextState: { ...state, cells, solved: boardFull(cells) } };
}

/**
 * Solo give-up. No-op once solved / already gave up; otherwise reveals every
 * empty cell and freezes the board with gaveUp=true.
 *
 * @param {SoloState} state
 * @param {Country[]} countries
 * @param {() => number} [random]
 * @returns {SoloState}
 */
export function applySoloGiveUp(state, countries, random = Math.random) {
  if (isSoloOver(state)) return state;
  return { ...state, cells: revealBoard(state.puzzle, state.cells, countries, random), gaveUp: true };
}
