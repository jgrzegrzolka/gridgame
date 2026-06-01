import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from './grid.js';
import { newGame, attemptClaim, findWinner, isGameOver } from './ticTacToe.js';

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
