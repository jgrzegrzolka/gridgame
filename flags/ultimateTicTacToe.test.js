import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continent, hasColor } from './engine.js';
import {
  newUltimateGame,
  attemptUltimateClaim,
  isUltimateGameOver,
  applyUltimateGiveUp,
  newlyWonSmallBoards,
  isMetaWinNewlyFormed,
} from './ultimateTicTacToe.js';
import { createCountry } from './group.js';

/** @typedef {import('./group.js').Country} Country */
/** @typedef {import('./ticTacToe.js').Player} Player */
/** @typedef {import('./ultimateTicTacToe.js').UltimateGameState} UltimateGameState */

/**
 * @param {Partial<Country> & { code: string, name: string }} fields
 * @returns {Country}
 */
function country(fields) {
  return createCountry({
    category: 'country',
    continent: 'Europe',
    statehood: 'un_member',
    ...fields,
  });
}

const EUROPE = continent('Europe');
const ASIA = continent('Asia');
const AFRICA = continent('Africa');
const RED = hasColor('red');
const BLUE = hasColor('blue');
const GREEN = hasColor('green');

/** @type {import('./engine.js').Puzzle} */
const PUZZLE = {
  rows: [EUROPE, ASIA, AFRICA],
  cols: [RED, BLUE, GREEN],
};

/**
 * Generate ~12 unique countries per (rowCat × colCat) pair — enough to fill any
 * one small board (9 needed) plus extras for global-duplicate edge cases. Each
 * country matches exactly one cell so we don't accidentally trip the
 * cross-board global-dup rule in tests that don't care about it.
 *
 * @returns {Country[]}
 */
function buildTestPool() {
  /** @type {Record<number, string>} */
  const continentName = { 0: 'Europe', 1: 'Asia', 2: 'Africa' };
  /** @type {Record<number, string>} */
  const colorName = { 0: 'red', 1: 'blue', 2: 'green' };
  /** @type {Country[]} */
  const out = [];
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      for (let i = 0; i < 12; i++) {
        out.push(country({
          code: `${br}${bc}-${i}`,
          name: `Country ${br}${bc}-${i}`,
          continent: /** @type {any} */ (continentName[br]),
          primaryColors: [colorName[bc]],
        }));
      }
    }
  }
  return out;
}

const POOL = buildTestPool();

/**
 * Pick the i-th country that fits small board (br, bc) in the standard test
 * pool. Indices 0..11 are stable per cell.
 *
 * @param {number} br @param {number} bc @param {number} i
 */
function countryFor(br, bc, i) {
  const c = POOL.find((co) => co.code === `${br}${bc}-${i}`);
  assert.ok(c, `pool missing country ${br}${bc}-${i}`);
  return c;
}

test('newUltimateGame: 3x3 of empty small boards, X to move, no winner', () => {
  const s = newUltimateGame(PUZZLE);
  assert.equal(s.currentPlayer, 'X');
  assert.equal(s.winner, null);
  assert.equal(s.draw, false);
  assert.equal(isUltimateGameOver(s), false);
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const b = s.boards[br][bc];
      assert.equal(b.winner, null);
      assert.equal(b.dead, false);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          assert.equal(b.cells[r][c].owner, null);
        }
      }
    }
  }
});

test('newUltimateGame: first player override is honoured', () => {
  const s = newUltimateGame(PUZZLE, 'O');
  assert.equal(s.currentPlayer, 'O');
});

test('attemptUltimateClaim: valid pick sets sub-cell owner and flips turn', () => {
  const s = newUltimateGame(PUZZLE);
  const c = countryFor(0, 0, 0);
  const out = attemptUltimateClaim(s, 0, 0, 1, 1, c, POOL);
  assert.equal(out.kind, 'claimed');
  assert.equal(out.nextState.boards[0][0].cells[1][1].owner, 'X');
  assert.equal(out.nextState.boards[0][0].cells[1][1].country, c);
  assert.equal(out.nextState.currentPlayer, 'O');
});

test('attemptUltimateClaim: country fails row predicate → miss-invalid, turn still flips', () => {
  const s = newUltimateGame(PUZZLE);
  // A country tagged Asia placed in a Europe row → miss-invalid.
  const asiaRed = countryFor(1, 0, 0);
  const out = attemptUltimateClaim(s, 0, 0, 0, 0, asiaRed, POOL);
  assert.equal(out.kind, 'miss-invalid');
  assert.equal(out.nextState.boards[0][0].cells[0][0].owner, null);
  assert.equal(out.nextState.currentPlayer, 'O');
});

test('attemptUltimateClaim: country fails column predicate → miss-invalid', () => {
  const s = newUltimateGame(PUZZLE);
  // Europe+blue placed in red column → miss-invalid.
  const euroBlue = countryFor(0, 1, 0);
  const out = attemptUltimateClaim(s, 0, 0, 0, 0, euroBlue, POOL);
  assert.equal(out.kind, 'miss-invalid');
  assert.equal(out.nextState.currentPlayer, 'O');
});

test('attemptUltimateClaim: global duplicate (same country in another small board) → miss-duplicate', () => {
  // Make a country valid for two different (row × col) pairs: Europe with both
  // red and blue. Place it once at (0,0) — small board (Europe × red) — then
  // try to play it again at (0,1) — small board (Europe × blue). The cross-
  // board duplicate rule must reject it.
  const multi = country({
    code: 'multi-eu-rb', name: 'Multi',
    continent: 'Europe', primaryColors: ['red', 'blue'],
  });
  const pool = [...POOL, multi];
  let s = newUltimateGame(PUZZLE);
  s = attemptUltimateClaim(s, 0, 0, 0, 0, multi, pool).nextState;
  // O tries to play the same country in a different small board.
  const out = attemptUltimateClaim(s, 0, 1, 0, 0, multi, pool);
  assert.equal(out.kind, 'miss-duplicate');
  assert.equal(out.nextState.boards[0][1].cells[0][0].owner, null);
  assert.equal(out.nextState.currentPlayer, 'X');
});

test('attemptUltimateClaim: clicking a cell with an owner → miss-taken, no turn flip', () => {
  let s = newUltimateGame(PUZZLE);
  s = attemptUltimateClaim(s, 0, 0, 0, 0, countryFor(0, 0, 0), POOL).nextState; // X plays
  // O tries to play in the same sub-cell.
  const out = attemptUltimateClaim(s, 0, 0, 0, 0, countryFor(0, 0, 1), POOL);
  assert.equal(out.kind, 'miss-taken');
  assert.equal(out.nextState.currentPlayer, 'O');
  assert.equal(out.nextState.boards[0][0].cells[0][0].owner, 'X');
});

test('completing 3-in-a-row in a small board sets winner + winningLine, locks the board', () => {
  // X plays sub-cells (0,0) (0,1) (0,2) in small board (0,0). O scatters
  // elsewhere to keep turns alternating.
  let s = newUltimateGame(PUZZLE);
  s = attemptUltimateClaim(s, 0, 0, 0, 0, countryFor(0, 0, 0), POOL).nextState; // X
  s = attemptUltimateClaim(s, 1, 1, 0, 0, countryFor(1, 1, 0), POOL).nextState; // O elsewhere
  s = attemptUltimateClaim(s, 0, 0, 0, 1, countryFor(0, 0, 1), POOL).nextState; // X
  s = attemptUltimateClaim(s, 1, 1, 0, 1, countryFor(1, 1, 1), POOL).nextState; // O
  const out = attemptUltimateClaim(s, 0, 0, 0, 2, countryFor(0, 0, 2), POOL);   // X wins board (0,0)
  assert.equal(out.kind, 'claimed');
  const board = out.nextState.boards[0][0];
  assert.equal(board.winner, 'X');
  assert.deepEqual(board.winningLine, [[0, 0], [0, 1], [0, 2]]);
  // Subsequent click on remaining empty cells of the locked board must be rejected.
  const locked = attemptUltimateClaim(out.nextState, 0, 0, 2, 2, countryFor(0, 0, 3), POOL);
  assert.equal(locked.kind, 'miss-taken');
});

test('strict alternation: claiming a small board still flips the turn (no extra turn)', () => {
  let s = newUltimateGame(PUZZLE);
  s = attemptUltimateClaim(s, 0, 0, 0, 0, countryFor(0, 0, 0), POOL).nextState; // X
  s = attemptUltimateClaim(s, 1, 1, 0, 0, countryFor(1, 1, 0), POOL).nextState; // O
  s = attemptUltimateClaim(s, 0, 0, 0, 1, countryFor(0, 0, 1), POOL).nextState; // X
  s = attemptUltimateClaim(s, 1, 1, 0, 1, countryFor(1, 1, 1), POOL).nextState; // O
  s = attemptUltimateClaim(s, 0, 0, 0, 2, countryFor(0, 0, 2), POOL).nextState; // X wins (0,0)
  assert.equal(s.boards[0][0].winner, 'X');
  assert.equal(s.currentPlayer, 'O', 'turn passes after a small-board claim — no extra X move');
});

test('small board fills with no 3-in-a-row → dead = true', () => {
  // Play 9 sub-cells in board (0,0) alternating X/O in a pattern that avoids
  // any 3-in-a-row. The "draw" pattern:
  //   X O X
  //   X O O
  //   O X X
  // After 9 moves the board is full with no 3-in-a-row.
  /** @type {Array<{ r: number, c: number, p: Player }>} */
  const seq = [
    { r: 0, c: 0, p: 'X' }, { r: 0, c: 1, p: 'O' },
    { r: 0, c: 2, p: 'X' }, { r: 1, c: 1, p: 'O' },
    { r: 1, c: 0, p: 'X' }, { r: 1, c: 2, p: 'O' },
    { r: 2, c: 1, p: 'X' }, { r: 2, c: 0, p: 'O' },
    { r: 2, c: 2, p: 'X' },
  ];
  let s = newUltimateGame(PUZZLE);
  for (let i = 0; i < seq.length; i++) {
    // To keep alternation aligned with the desired owner per cell, simulate
    // by setting the cell directly via attemptUltimateClaim under known
    // currentPlayer. Use sequential country indices for the small board.
    const move = seq[i];
    assert.equal(s.currentPlayer, move.p, `step ${i}: expected ${move.p}'s turn`);
    s = attemptUltimateClaim(s, 0, 0, move.r, move.c, countryFor(0, 0, i), POOL).nextState;
  }
  const board = s.boards[0][0];
  assert.equal(board.winner, null);
  assert.equal(board.dead, true);
});

test('small board exhausts when its (row × col) candidate pool is consumed elsewhere', () => {
  // (Europe × blue) has only one matching country in this pool: a single
  // multi-match Spain-like flag. (Europe × red) has its own set. We play the
  // multi-match country in (Europe × red) — global no-dup then strips the
  // ONLY candidate from (Europe × blue), forcing it dead-by-exhaustion.
  const ONLY = country({
    code: 'only-eu-rb', name: 'Only',
    continent: 'Europe', primaryColors: ['red', 'blue'],
  });
  const FILLER = country({
    code: 'filler-eu-r', name: 'Filler',
    continent: 'Europe', primaryColors: ['red'],
  });
  // POOL has its own (0,1) — Europe × blue — entries; remove them so the
  // ONLY country is genuinely the last candidate for that small board.
  const restricted = POOL.filter((c) => !c.code.startsWith('01-'));
  const pool = [...restricted, ONLY, FILLER];
  let s = newUltimateGame(PUZZLE);
  // X plays ONLY in (Europe × red) at sub-cell (0,0). (Europe × blue) now has
  // no remaining valid + unused candidate.
  const out = attemptUltimateClaim(s, 0, 0, 0, 0, ONLY, pool);
  assert.equal(out.kind, 'claimed');
  assert.equal(out.nextState.boards[0][1].dead, true,
    '(Europe × blue) should be dead — its only candidate was used in (Europe × red)');
  assert.equal(out.nextState.boards[0][0].dead, false,
    '(Europe × red) still has filler candidates and is not dead');
});

test('meta 3-in-a-row of claimed small boards sets the meta winner', () => {
  // X claims all three small boards along the top meta-row: (0,0), (0,1),
  // (0,2). Each claim is a 3-in-a-row on the top row of its small board. O
  // scatters one move per "wasted" small board on the bottom meta-row so we
  // never accidentally form 3-in-a-row anywhere except where X means to.
  /** @type {UltimateGameState} */
  let s = newUltimateGame(PUZZLE);

  /** @type {[number, number][]} Where O drops their next move. Each O move lands in a fresh small board, sub-cell (0,0). */
  const oScatter = [[1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]];
  let oIdx = 0;
  /** @param {UltimateGameState} st */
  function playO(st) {
    const [br, bc] = oScatter[oIdx++];
    const out = attemptUltimateClaim(st, br, bc, 0, 0, countryFor(br, bc, 0), POOL);
    assert.equal(out.kind, 'claimed', `O move into (${br},${bc}) should land cleanly`);
    return out.nextState;
  }

  // Board (0,0): X plays the top row across three moves; O lands one in (1,0),
  // (1,1), (1,2) between them (so each O move is in a different small board
  // and can't accumulate into a 3-in-a-row).
  s = attemptUltimateClaim(s, 0, 0, 0, 0, countryFor(0, 0, 0), POOL).nextState; // X
  s = playO(s);                                                                  // O → (1,0)
  s = attemptUltimateClaim(s, 0, 0, 0, 1, countryFor(0, 0, 1), POOL).nextState; // X
  s = playO(s);                                                                  // O → (1,1)
  s = attemptUltimateClaim(s, 0, 0, 0, 2, countryFor(0, 0, 2), POOL).nextState; // X claims (0,0)
  assert.equal(s.boards[0][0].winner, 'X');

  // Board (0,1):
  s = playO(s);                                                                  // O → (1,2)
  s = attemptUltimateClaim(s, 0, 1, 0, 0, countryFor(0, 1, 0), POOL).nextState; // X
  s = playO(s);                                                                  // O → (2,0)
  s = attemptUltimateClaim(s, 0, 1, 0, 1, countryFor(0, 1, 1), POOL).nextState; // X
  s = playO(s);                                                                  // O → (2,1)
  s = attemptUltimateClaim(s, 0, 1, 0, 2, countryFor(0, 1, 2), POOL).nextState; // X claims (0,1)
  assert.equal(s.boards[0][1].winner, 'X');

  // Board (0,2): final claim completes the meta-3-in-a-row.
  s = playO(s);                                                                  // O → (2,2)
  s = attemptUltimateClaim(s, 0, 2, 0, 0, countryFor(0, 2, 0), POOL).nextState; // X
  // O has now scattered into all 6 chosen squares — but they're each lone moves
  // in their own boards, so none of them form 3-in-a-row. From here on, O has
  // to pick somewhere; route O into board (1,0) extra cells to keep them busy
  // without filling rows (sub-cells (1,1) and (2,2) — diagonals from the (0,0)
  // already there are fine because they don't connect a third).
  let out = attemptUltimateClaim(s, 1, 0, 1, 1, countryFor(1, 0, 1), POOL); // O
  assert.equal(out.kind, 'claimed');
  s = out.nextState;
  s = attemptUltimateClaim(s, 0, 2, 0, 1, countryFor(0, 2, 1), POOL).nextState; // X
  out = attemptUltimateClaim(s, 1, 0, 0, 2, countryFor(1, 0, 2), POOL);          // O — (1,0) cells are now (0,0) (1,1) (0,2): not a line
  assert.equal(out.kind, 'claimed');
  s = out.nextState;
  const final = attemptUltimateClaim(s, 0, 2, 0, 2, countryFor(0, 2, 2), POOL); // X claims (0,2) → meta-win
  assert.equal(final.kind, 'claimed');
  assert.equal(final.nextState.winner, 'X');
  assert.deepEqual(final.nextState.winningLine, [[0, 0], [0, 1], [0, 2]]);
  assert.equal(isUltimateGameOver(final.nextState), true);
});

test('no moves accepted after the meta game is over', () => {
  /** @type {UltimateGameState} */
  let s = newUltimateGame(PUZZLE);
  // Quickest possible meta-win: synthesize a finished state directly by
  // marking boards (0,0), (0,1), (0,2) as X-claimed and the rest empty.
  // We do this through normal moves to keep the invariant valid.
  // Reuse a compact win path from the previous test isn't worth re-typing —
  // instead we hand-mutate (the engine is the SUT, not the constructor).
  s = {
    ...s,
    boards: s.boards.map((row, br) => row.map((b, bc) => {
      if (br === 0) return { ...b, winner: /** @type {Player} */ ('X'), winningLine: null, dead: false };
      return b;
    })),
    winner: 'X',
    winningLine: [[0, 0], [0, 1], [0, 2]],
  };
  const out = attemptUltimateClaim(s, 1, 1, 0, 0, countryFor(1, 1, 0), POOL);
  assert.equal(out.kind, 'miss-taken');
  assert.equal(out.nextState, s);
});

test('isUltimateGameOver reflects winner and draw', () => {
  const s = newUltimateGame(PUZZLE);
  assert.equal(isUltimateGameOver(s), false);
  assert.equal(isUltimateGameOver({ ...s, winner: 'X' }), true);
  assert.equal(isUltimateGameOver({ ...s, draw: true }), true);
});

test('isUltimateGameOver: gaveUp marks the state terminal', () => {
  const s = newUltimateGame(PUZZLE);
  assert.equal(isUltimateGameOver({ ...s, gaveUp: true }), true);
});

test('applyUltimateGiveUp: fills all 81 empty sub-cells with valid revealed countries, no duplicates while supply allows', () => {
  // POOL has 12 countries per (br × bc) pair → plenty to fill 9 sub-cells per
  // small board (108 needed in total) without ever falling back to exhausted.
  const s = newUltimateGame(PUZZLE);
  const after = applyUltimateGiveUp(s, POOL, () => 0);
  assert.equal(after.gaveUp, true);
  assert.equal(isUltimateGameOver(after), true);
  /** @type {Set<string>} */
  const seen = new Set();
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const board = after.boards[br][bc];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const cell = board.cells[r][c];
          assert.ok(cell.country, `(${br},${bc},${r},${c}) should be filled`);
          assert.equal(cell.owner, null, 'revealed cells stay un-owned');
          assert.equal(cell.revealed, true);
          assert.equal(cell.exhausted, undefined, 'no exhausted flag when pool is plentiful');
          assert.ok(PUZZLE.rows[br].predicate(/** @type {Country} */ (cell.country)));
          assert.ok(PUZZLE.cols[bc].predicate(/** @type {Country} */ (cell.country)));
          assert.equal(seen.has(/** @type {Country} */ (cell.country).code), false,
            `country ${/** @type {Country} */ (cell.country).code} reused at (${br},${bc},${r},${c})`);
          seen.add(/** @type {Country} */ (cell.country).code);
        }
      }
    }
  }
  assert.equal(seen.size, 81, '81 distinct countries on the reveal');
});

test('applyUltimateGiveUp: preserves player-claimed sub-cells', () => {
  let s = newUltimateGame(PUZZLE);
  const c000 = countryFor(0, 0, 0);
  const c110 = countryFor(1, 1, 0);
  s = attemptUltimateClaim(s, 0, 0, 0, 0, c000, POOL).nextState;        // X
  s = attemptUltimateClaim(s, 1, 1, 0, 0, c110, POOL).nextState;        // O
  const after = applyUltimateGiveUp(s, POOL, () => 0);
  const xCell = after.boards[0][0].cells[0][0];
  assert.equal(xCell.owner, 'X');
  assert.equal(xCell.country, c000);
  assert.equal(xCell.revealed, undefined);
  const oCell = after.boards[1][1].cells[0][0];
  assert.equal(oCell.owner, 'O');
  assert.equal(oCell.country, c110);
});

test('applyUltimateGiveUp: falls back to an already-used country and flags exhausted when the (row × col) pool is empty', () => {
  // Pool has exactly ONE country valid for (Europe × red) — a country we
  // assign by hand at (0,0,0,0). The remaining 8 sub-cells of (Europe × red)
  // have no unused candidate left. They must still get filled, but with
  // exhausted=true so the UI can paint a black background.
  /** @type {Country} */
  const ONLY = country({
    code: 'eu-r-only', name: 'OnlyEuropeRed',
    continent: 'Europe', primaryColors: ['red'],
  });
  // Build a pool that:
  //   - has the ONLY Europe×red country,
  //   - has plenty of fillers for the other 8 small boards (so they're
  //     not contributing exhausted noise to the assertion).
  const fillers = POOL.filter((c) => !c.code.startsWith('00-'));
  const pool = [...fillers, ONLY];
  let s = newUltimateGame(PUZZLE);
  // Place ONLY at (0,0,0,0) via attemptUltimateClaim — this consumes the
  // single Europe×red candidate globally.
  s = attemptUltimateClaim(s, 0, 0, 0, 0, ONLY, pool).nextState;
  const after = applyUltimateGiveUp(s, pool, () => 0);
  assert.equal(after.gaveUp, true);
  // (0,0,0,0) is the player-claimed cell — untouched.
  assert.equal(after.boards[0][0].cells[0][0].country, ONLY);
  assert.equal(after.boards[0][0].cells[0][0].owner, 'X');
  // The other 8 sub-cells of (0,0): the only valid Europe×red country is
  // already on the board → every one of them gets it back as exhausted.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 0 && c === 0) continue;
      const cell = after.boards[0][0].cells[r][c];
      assert.equal(cell.country, ONLY, `(${r},${c}) falls back to ONLY`);
      assert.equal(cell.revealed, true);
      assert.equal(cell.exhausted, true, `(${r},${c}) flagged exhausted because no fresh candidate exists`);
      assert.equal(cell.owner, null);
    }
  }
  // Another small board (1,1 — Asia×blue) still has fresh fillers, so it
  // should fill *without* the exhausted flag.
  const otherBoard = after.boards[1][1];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = otherBoard.cells[r][c];
      assert.ok(cell.country, `expected (1,1,${r},${c}) to be filled`);
      assert.equal(cell.exhausted, undefined, `(1,1,${r},${c}) should not be exhausted — pool is plentiful`);
    }
  }
});

test('applyUltimateGiveUp: leaves a sub-cell empty when neither fresh nor exhausted candidate exists', () => {
  // Tear the (Europe × red) pool down to zero: filter out POOL's 00-* entries
  // and don't add anything to replace them. (0,0) has no valid country at all.
  const sparsePool = POOL.filter((c) => !c.code.startsWith('00-'));
  const s = newUltimateGame(PUZZLE);
  const after = applyUltimateGiveUp(s, sparsePool, () => 0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = after.boards[0][0].cells[r][c];
      assert.equal(cell.country, null, `(0,0,${r},${c}) must stay empty — no candidate exists`);
      assert.equal(cell.exhausted, undefined);
      assert.equal(cell.revealed, undefined);
    }
  }
  // Other boards are still filled normally.
  assert.ok(after.boards[1][1].cells[0][0].country);
});

test('applyUltimateGiveUp: is a no-op when the game is already over', () => {
  const s = /** @type {UltimateGameState} */ ({ ...newUltimateGame(PUZZLE), winner: 'X' });
  const after = applyUltimateGiveUp(s, POOL, () => 0);
  assert.equal(after, s);
});

test('attemptUltimateClaim is rejected after give-up', () => {
  const s = applyUltimateGiveUp(newUltimateGame(PUZZLE), POOL, () => 0);
  // The board may be fully filled by give-up, but even if a synthetic empty
  // existed, gaveUp must block the claim.
  const synthetic = { ...s, boards: s.boards.map((row) => row.map((b) => ({
    ...b, cells: b.cells.map((r) => r.map((cell) => ({ ...cell, owner: null, country: null }))),
  }))) };
  const out = attemptUltimateClaim(synthetic, 0, 0, 0, 0, countryFor(0, 0, 0), POOL);
  assert.equal(out.kind, 'miss-taken');
});

// newlyWonSmallBoards / isMetaWinNewlyFormed
// These drive the one-shot win-line shake animation in the 9x9 page —
// they answer "which small boards just got won this turn?" and "did the
// big-board 3-in-a-row line just appear this turn?". Constructed states
// only populate the fields the detectors actually read.

/**
 * Build a meta-3x3 grid of small-board stubs from a 3x3 of winningLine
 * values. `null` → board has no line yet; a `[number, number][]` → that
 * board has the given winning line. Other SmallBoard fields are unused
 * by the detectors so they're left undefined and cast away.
 *
 * @param {([number, number][] | null)[][]} grid
 * @returns {import('./ultimateTicTacToe.js').UltimateGameState}
 */
function stateWithBoardLines(grid) {
  return /** @type {any} */ ({
    boards: grid.map((row) => row.map((winningLine) => ({ winningLine }))),
    winningLine: null,
  });
}

test('newlyWonSmallBoards: empty when no board changed', () => {
  const s = stateWithBoardLines([
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  assert.deepEqual(newlyWonSmallBoards(s, s), []);
});

test('newlyWonSmallBoards: empty when a board that was already won stays won', () => {
  const lineA = /** @type {[number, number][]} */ ([[0, 0], [0, 1], [0, 2]]);
  const prev = stateWithBoardLines([
    [lineA, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  // Same line is still present after the next move — no shake retrigger.
  const next = stateWithBoardLines([
    [lineA, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  assert.deepEqual(newlyWonSmallBoards(prev, next), []);
});

test('newlyWonSmallBoards: returns the coord of the small board that flipped to won this turn', () => {
  const prev = stateWithBoardLines([
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  const next = stateWithBoardLines([
    [null, null, null],
    [null, [[1, 0], [1, 1], [1, 2]], null],
    [null, null, null],
  ]);
  assert.deepEqual(newlyWonSmallBoards(prev, next), [[1, 1]]);
});

test('newlyWonSmallBoards: returns multiple coords if more than one board flipped at once', () => {
  // A single move can't normally win two small boards, but the detector
  // is defined per-board so a contrived state covers the contract.
  const prev = stateWithBoardLines([
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  const next = stateWithBoardLines([
    [[[0, 0], [0, 1], [0, 2]], null, null],
    [null, null, null],
    [null, null, [[2, 2], [1, 2], [0, 2]]],
  ]);
  assert.deepEqual(newlyWonSmallBoards(prev, next), [[0, 0], [2, 2]]);
});

test('isMetaWinNewlyFormed: false when there is no meta line yet', () => {
  const s = stateWithBoardLines([
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ]);
  assert.equal(isMetaWinNewlyFormed(s, s), false);
});

test('isMetaWinNewlyFormed: true when the meta line transitions from null to present', () => {
  const prev = /** @type {any} */ ({ boards: [], winningLine: null });
  const next = /** @type {any} */ ({ boards: [], winningLine: [[0, 0], [1, 1], [2, 2]] });
  assert.equal(isMetaWinNewlyFormed(prev, next), true);
});

test('isMetaWinNewlyFormed: false on re-renders where the meta line was already present', () => {
  const line = [[0, 0], [1, 1], [2, 2]];
  const prev = /** @type {any} */ ({ boards: [], winningLine: line });
  const next = /** @type {any} */ ({ boards: [], winningLine: line });
  assert.equal(isMetaWinNewlyFormed(prev, next), false);
});

// TODO: an end-to-end give-up-on-empty-board regression test against the
// real countries.json belongs here (would have caught the duplicate-
// surfacing bug that was fixed in this commit) but generation is too
// slow with the current random-search-with-Hall-checks approach to keep
// in the suite. Tracked in a follow-up GitHub issue — needs a faster
// generation strategy or a pre-baked puzzle fixture first.
