import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from './grid.js';
import {
  newGame,
  attemptClaim,
  findWinner,
  isGameOver,
  applyGiveUp,
  shouldFireTicTacToeConfetti,
  newlyWinningCells,
} from './ticTacToe.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./ticTacToe.js').Cell} Cell */
/** @typedef {import('./ticTacToe.js').GameState} GameState */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return {
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  };
}

const EUROPE = continent('Europe');
const ASIA = continent('Asia');
const AFRICA = continent('Africa');
const RED = hasColor('red');
const BLUE = hasColor('blue');
const GREEN = hasColor('green');

/** @type {import('./grid.js').Puzzle} */
const PUZZLE = {
  rows: [EUROPE, ASIA, AFRICA],
  cols: [RED, BLUE, GREEN],
};

// One country for each of the 9 cells in PUZZLE, code = "rc" so it's easy to read.
const FR = country({ code: '00', name: 'France', continent: 'Europe', colors: ['red'] });
const DE = country({ code: '01', name: 'Germany', continent: 'Europe', colors: ['blue'] });
const IT = country({ code: '02', name: 'Italy', continent: 'Europe', colors: ['green'] });
const JP = country({ code: '10', name: 'Japan', continent: 'Asia', colors: ['red'] });
const KR = country({ code: '11', name: 'Korea', continent: 'Asia', colors: ['blue'] });
const PK = country({ code: '12', name: 'Pakistan', continent: 'Asia', colors: ['green'] });
const KE = country({ code: '20', name: 'Kenya', continent: 'Africa', colors: ['red'] });
const NA = country({ code: '21', name: 'Namibia', continent: 'Africa', colors: ['blue'] });
const NG = country({ code: '22', name: 'Nigeria', continent: 'Africa', colors: ['green'] });

/**
 * @param {(Player | null)[][]} grid
 * @returns {GameState}
 */
function stateWithOwners(grid) {
  const state = newGame(PUZZLE);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const owner = grid[r][c];
      if (owner) {
        state.cells[r][c] = {
          owner,
          country: country({ code: `set-${r}${c}`, name: 'set' }),
        };
      }
    }
  }
  return state;
}

test('newGame produces empty 3x3 with X to move', () => {
  const s = newGame(PUZZLE);
  assert.equal(s.currentPlayer, 'X');
  assert.equal(s.winner, null);
  assert.equal(s.draw, false);
  assert.equal(isGameOver(s), false);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(s.cells[r][c].owner, null);
      assert.equal(s.cells[r][c].country, null);
    }
  }
});

test('attemptClaim claims cell when country satisfies row and column', () => {
  const s = newGame(PUZZLE);
  const out = attemptClaim(s, 0, 0, FR);
  assert.equal(out.kind, 'claimed');
  assert.equal(out.nextState.cells[0][0].owner, 'X');
  assert.equal(out.nextState.cells[0][0].country, FR);
  assert.equal(out.nextState.currentPlayer, 'O');
});

test('attemptClaim returns miss-invalid when country fails row predicate', () => {
  const s = newGame(PUZZLE);
  // JP is Asian + red; placed at row 0 (Europe) → row predicate fails.
  const out = attemptClaim(s, 0, 0, JP);
  assert.equal(out.kind, 'miss-invalid');
  assert.equal(out.nextState.cells[0][0].owner, null);
  assert.equal(out.nextState.currentPlayer, 'O');
});

test('attemptClaim returns miss-invalid when country fails column predicate', () => {
  const s = newGame(PUZZLE);
  // DE is European + blue; placed at col 0 (red) → col predicate fails.
  const out = attemptClaim(s, 0, 0, DE);
  assert.equal(out.kind, 'miss-invalid');
  assert.equal(out.nextState.cells[0][0].owner, null);
  assert.equal(out.nextState.currentPlayer, 'O');
});

test('attemptClaim returns miss-duplicate when same country already used elsewhere', () => {
  // Place FR at (0,0), then try to put FR at (1,0) — even if it "fit", the
  // duplicate rule should block (FR doesn't actually satisfy row 1 here, but
  // duplicate check runs after validateCell, so we need a country that DOES
  // satisfy the target cell). Use a country that satisfies both but is already
  // on the board.
  let s = newGame(PUZZLE);
  s = attemptClaim(s, 0, 0, FR).nextState; // FR at (0,0), O's turn
  // O tries to place FR again at (1,0). FR is European, not Asian — would fail
  // validateCell first. So instead, set a scenario where the country IS valid
  // at the target cell. We need a country valid at two different cells. Build
  // one: a country in both Europe and Asia is impossible (single continent),
  // but colors are arrays — a flag with red AND blue could fit (0,0) and (0,1).
  const FR2 = country({ code: 'fr2', name: 'France-ish', continent: 'Europe', colors: ['red', 'blue'] });
  let s2 = newGame(PUZZLE);
  s2 = attemptClaim(s2, 0, 0, FR2).nextState; // claimed at (0,0)
  const out = attemptClaim(s2, 0, 1, FR2); // would satisfy Europe × blue, but duplicate
  assert.equal(out.kind, 'miss-duplicate');
  assert.equal(out.nextState.cells[0][1].owner, null);
  assert.equal(out.nextState.currentPlayer, 'X'); // O missed, back to X
});

test('attemptClaim returns miss-taken when target cell already owned', () => {
  let s = newGame(PUZZLE);
  s = attemptClaim(s, 0, 0, FR).nextState; // X claims (0,0), O's turn
  // O tries to play at (0,0) — already owned.
  const out = attemptClaim(s, 0, 0, JP);
  assert.equal(out.kind, 'miss-taken');
  assert.equal(out.nextState.currentPlayer, 'O', 'turn does not pass on miss-taken');
  assert.equal(out.nextState.cells[0][0].owner, 'X');
});

test('findWinner detects horizontal win', () => {
  const s = stateWithOwners([
    ['X', 'X', 'X'],
    ['O', 'O', null],
    [null, null, null],
  ]);
  const result = findWinner(s.cells);
  assert.equal(result.winner, 'X');
  assert.deepEqual(result.line, [[0, 0], [0, 1], [0, 2]]);
});

test('findWinner detects vertical win', () => {
  const s = stateWithOwners([
    ['X', 'O', null],
    ['X', 'O', null],
    ['X', null, null],
  ]);
  const result = findWinner(s.cells);
  assert.equal(result.winner, 'X');
  assert.deepEqual(result.line, [[0, 0], [1, 0], [2, 0]]);
});

test('findWinner detects main diagonal win', () => {
  const s = stateWithOwners([
    ['O', 'X', null],
    ['X', 'O', null],
    [null, null, 'O'],
  ]);
  const result = findWinner(s.cells);
  assert.equal(result.winner, 'O');
  assert.deepEqual(result.line, [[0, 0], [1, 1], [2, 2]]);
});

test('findWinner detects anti-diagonal win', () => {
  const s = stateWithOwners([
    [null, 'O', 'X'],
    [null, 'X', 'O'],
    ['X', null, null],
  ]);
  const result = findWinner(s.cells);
  assert.equal(result.winner, 'X');
  assert.deepEqual(result.line, [[0, 2], [1, 1], [2, 0]]);
});

test('findWinner returns null when no three-in-a-row', () => {
  const s = stateWithOwners([
    ['X', 'O', 'X'],
    ['X', 'O', 'O'],
    ['O', 'X', null],
  ]);
  const result = findWinner(s.cells);
  assert.equal(result.winner, null);
  assert.equal(result.line, null);
});

test('attemptClaim sets winner and locks current player when claim completes a line', () => {
  // X plays (0,0), (0,1), (0,2) with O blocking elsewhere — row 0 wins for X.
  let s = newGame(PUZZLE);
  s = attemptClaim(s, 0, 0, FR).nextState; // X
  s = attemptClaim(s, 1, 0, JP).nextState; // O
  s = attemptClaim(s, 0, 1, DE).nextState; // X
  s = attemptClaim(s, 1, 1, KR).nextState; // O
  const finalOut = attemptClaim(s, 0, 2, IT); // X — should win
  assert.equal(finalOut.kind, 'claimed');
  assert.equal(finalOut.nextState.winner, 'X');
  assert.deepEqual(finalOut.nextState.winningLine, [[0, 0], [0, 1], [0, 2]]);
  assert.equal(finalOut.nextState.currentPlayer, 'X', 'winner stays as currentPlayer');
  assert.equal(isGameOver(finalOut.nextState), true);
});

test('attemptClaim returns miss-taken with state unchanged after game is over', () => {
  // Build a winning state for X by walking the API.
  let s = newGame(PUZZLE);
  s = attemptClaim(s, 0, 0, FR).nextState;
  s = attemptClaim(s, 1, 0, JP).nextState;
  s = attemptClaim(s, 0, 1, DE).nextState;
  s = attemptClaim(s, 1, 1, KR).nextState;
  s = attemptClaim(s, 0, 2, IT).nextState;
  assert.equal(s.winner, 'X');

  const out = attemptClaim(s, 2, 2, NG);
  assert.equal(out.kind, 'miss-taken');
  assert.equal(out.nextState, s, 'state is returned unchanged');
});

test('applyGiveUp: fills every empty cell with a valid unused country and freezes the game', () => {
  // Empty board → all 9 cells get revealed picks, none used twice.
  const pool = [FR, DE, IT, JP, KR, PK, KE, NA, NG];
  const s = newGame(PUZZLE);
  const after = applyGiveUp(s, pool, () => 0);
  assert.equal(after.gaveUp, true);
  assert.equal(isGameOver(after), true, 'gave-up state is terminal');
  /** @type {Set<string>} */
  const seen = new Set();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = after.cells[r][c];
      assert.ok(cell.country, `cell (${r},${c}) should be filled`);
      assert.equal(cell.owner, null, 'revealed cells stay un-owned');
      assert.equal(cell.revealed, true, 'revealed flag is set');
      // Validate the row/col predicate match — the engine MUST honour the puzzle.
      assert.ok(PUZZLE.rows[r].predicate(/** @type {Country} */ (cell.country)));
      assert.ok(PUZZLE.cols[c].predicate(/** @type {Country} */ (cell.country)));
      assert.equal(seen.has(/** @type {Country} */ (cell.country).code), false, 'no duplicate across cells');
      seen.add(/** @type {Country} */ (cell.country).code);
    }
  }
});

test('applyGiveUp: preserves cells already claimed by players', () => {
  let s = newGame(PUZZLE);
  s = attemptClaim(s, 0, 0, FR).nextState; // X claims (0,0) with FR
  s = attemptClaim(s, 1, 1, KR).nextState; // O claims (1,1) with KR
  const pool = [FR, DE, IT, JP, KR, PK, KE, NA, NG];
  const after = applyGiveUp(s, pool, () => 0);
  // Player picks survive unchanged.
  assert.equal(after.cells[0][0].owner, 'X');
  assert.equal(after.cells[0][0].country, FR);
  assert.equal(after.cells[0][0].revealed, undefined);
  assert.equal(after.cells[1][1].owner, 'O');
  assert.equal(after.cells[1][1].country, KR);
  // The other seven cells were filled.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if ((r === 0 && c === 0) || (r === 1 && c === 1)) continue;
      assert.equal(after.cells[r][c].revealed, true);
      assert.equal(after.cells[r][c].owner, null);
      const cell = after.cells[r][c];
      assert.ok(cell.country && cell.country.code !== FR.code && cell.country.code !== KR.code,
        `(${r},${c}) must not reuse a country already on the board`);
    }
  }
});

test('applyGiveUp: leaves a cell empty when no candidate satisfies (row × col) — does not crash', () => {
  // Build a puzzle whose (0,0) intersection has zero candidates in the pool.
  // Asia × red has JP in the full pool, but the pool we hand to applyGiveUp
  // omits it — so (1,0) should end up empty rather than blow up.
  const sparsePool = [FR, DE, IT, /* no JP */ KR, PK, KE, NA, NG];
  const s = newGame(PUZZLE);
  const after = applyGiveUp(s, sparsePool, () => 0);
  assert.equal(after.gaveUp, true);
  // (1,0) has no candidate → stays empty, no crash.
  assert.equal(after.cells[1][0].country, null);
  assert.equal(after.cells[1][0].owner, null);
  // Other cells still filled.
  assert.ok(after.cells[0][0].country);
  assert.ok(after.cells[2][2].country);
});

test('applyGiveUp: is a no-op when the game is already over', () => {
  // Walk a real win for X.
  let s = newGame(PUZZLE);
  s = attemptClaim(s, 0, 0, FR).nextState;
  s = attemptClaim(s, 1, 0, JP).nextState;
  s = attemptClaim(s, 0, 1, DE).nextState;
  s = attemptClaim(s, 1, 1, KR).nextState;
  s = attemptClaim(s, 0, 2, IT).nextState;
  assert.equal(s.winner, 'X');
  const after = applyGiveUp(s, [FR, DE, IT, JP, KR, PK, KE, NA, NG], () => 0);
  assert.equal(after, s, 'returns the same state object — no work to do');
});

test('attemptClaim is rejected after give-up (board is frozen)', () => {
  const s = applyGiveUp(newGame(PUZZLE), [FR, DE, IT, JP, KR, PK, KE, NA, NG], () => 0);
  // Even with an empty owner check, gaveUp must close the door first. There
  // are no empty cells here (give-up fills all 9), so use a synthetic empty:
  const synthetic = { ...s, cells: s.cells.map((row, r) => row.map((cell, c) => (
    r === 2 && c === 2 ? { owner: null, country: null } : cell
  ))) };
  const out = attemptClaim(synthetic, 2, 2, NG);
  assert.equal(out.kind, 'miss-taken', 'gaveUp must reject claims even on a still-empty cell');
});

test('draw when board fills with no winner', () => {
  // Construct a full board with no 3-in-a-row by writing owners directly,
  // then run findWinner + boardFull semantics through one final attemptClaim
  // on the last cell.
  let s = newGame(PUZZLE);
  // Fill 8 cells via stateWithOwners so the 9th can be claimed normally.
  s = stateWithOwners([
    ['X', 'O', 'X'],
    ['X', 'O', 'O'],
    ['O', 'X', null],
  ]);
  s.currentPlayer = 'X';
  // X claims the last cell at (2,2) with NG — Africa × green, valid.
  const out = attemptClaim(s, 2, 2, NG);
  assert.equal(out.kind, 'claimed');
  assert.equal(out.nextState.winner, null);
  assert.equal(out.nextState.draw, true);
  assert.equal(isGameOver(out.nextState), true);
  assert.equal(out.nextState.currentPlayer, 'X', 'turn does not flip on draw');
});

// shouldFireTicTacToeConfetti
// Rule: a win (winner is 'X' or 'O') fires confetti; draws and give-ups
// (winner === null) never do. When myRole is provided (online), the
// browser only celebrates *its own* win — the loser sees no confetti.
// When myRole is absent (offline 3x3, 9x9, or anywhere with no notion
// of "you"), any winner fires.

test('shouldFireTicTacToeConfetti: offline (no myRole) fires on any X or O win', () => {
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'X' }), true);
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'O' }), true);
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'X', myRole: null }), true);
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'O', myRole: null }), true);
});

test('shouldFireTicTacToeConfetti: draws and give-ups never fire (winner is null)', () => {
  assert.equal(shouldFireTicTacToeConfetti({ winner: null }), false);
  assert.equal(shouldFireTicTacToeConfetti({ winner: null, myRole: 'X' }), false);
  assert.equal(shouldFireTicTacToeConfetti({ winner: null, myRole: 'O' }), false);
});

test('shouldFireTicTacToeConfetti: online fires only when you (myRole) won', () => {
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'X', myRole: 'X' }), true,
    'you played X and X won — celebrate');
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'O', myRole: 'O' }), true);
});

test('shouldFireTicTacToeConfetti: online does NOT fire when the opponent won', () => {
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'X', myRole: 'O' }), false,
    'opponent winning should not show confetti on your screen');
  assert.equal(shouldFireTicTacToeConfetti({ winner: 'O', myRole: 'X' }), false);
});

// newlyWinningCells
// Drives the one-shot win-line shake animation: returns the cells to
// animate on the transition `prev → next`, empty otherwise.

test('newlyWinningCells: returns the new line when prev had no winner and next has one', () => {
  const prev = { winningLine: null };
  const next = { winningLine: /** @type {[number, number][]} */ ([[0, 0], [1, 1], [2, 2]]) };
  assert.deepEqual(newlyWinningCells(prev, next), [[0, 0], [1, 1], [2, 2]]);
});

test('newlyWinningCells: returns empty when no winner exists yet (next.winningLine is null)', () => {
  assert.deepEqual(newlyWinningCells({ winningLine: null }, { winningLine: null }), []);
});

test('newlyWinningCells: returns empty on re-renders where the line was already present', () => {
  // The game is over and winningLine is unchanged — re-rendering should
  // not retrigger the shake. (3x3 freezes, but offline page may still
  // render once more on play-again wiring; this guards that case too.)
  const line = /** @type {[number, number][]} */ ([[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(newlyWinningCells({ winningLine: line }, { winningLine: line }), []);
});
