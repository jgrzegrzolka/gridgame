import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTttOutcome } from './tttPairOutcome.js';

test('returns null when the game is still in progress (no winner, no draw, no give-up)', () => {
  assert.equal(deriveTttOutcome({}, 'X'), null);
  assert.equal(deriveTttOutcome({ winner: null, draw: false, gaveUp: false }, 'X'), null);
});

test('returns null when myRole is null (e.g. lobby state before role assignment)', () => {
  assert.equal(deriveTttOutcome({ winner: 'X' }, null), null);
});

test('draw beats every other branch (even a stale winner field)', () => {
  assert.equal(deriveTttOutcome({ draw: true }, 'X'), 'draw');
  assert.equal(deriveTttOutcome({ draw: true, winner: 'X' }, 'X'), 'draw');
});

test('winner === myRole → win', () => {
  assert.equal(deriveTttOutcome({ winner: 'X' }, 'X'), 'win');
  assert.equal(deriveTttOutcome({ winner: 'O' }, 'O'), 'win');
});

test('winner is set but not my role → loss', () => {
  assert.equal(deriveTttOutcome({ winner: 'O' }, 'X'), 'loss');
  assert.equal(deriveTttOutcome({ winner: 'X' }, 'O'), 'loss');
});

// The give-up branch is the regression Jan flagged on prod — pin it with
// both perspectives and both ways of identifying the resigner.

test('gaveUp + gaveUpBy === myRole → loss (I gave up)', () => {
  assert.equal(deriveTttOutcome({ gaveUp: true, gaveUpBy: 'X' }, 'X'), 'loss');
  assert.equal(deriveTttOutcome({ gaveUp: true, gaveUpBy: 'O' }, 'O'), 'loss');
});

test('gaveUp + gaveUpBy is opponent → win (opponent gave up)', () => {
  assert.equal(deriveTttOutcome({ gaveUp: true, gaveUpBy: 'O' }, 'X'), 'win');
  assert.equal(deriveTttOutcome({ gaveUp: true, gaveUpBy: 'X' }, 'O'), 'win');
});

test('gaveUp + no gaveUpBy + lastGaveUpByMe=true → loss (9×9 fallback path)', () => {
  // 9×9 doesn't stamp `gaveUpBy` on `UltimateGameState`; the page tracks
  // the resigner locally via `lastGaveUpByMe`.
  assert.equal(deriveTttOutcome({ gaveUp: true }, 'X', true), 'loss');
  assert.equal(deriveTttOutcome({ gaveUp: true }, 'O', true), 'loss');
});

test('gaveUp + no gaveUpBy + lastGaveUpByMe=false → win (9×9 fallback path)', () => {
  assert.equal(deriveTttOutcome({ gaveUp: true }, 'X', false), 'win');
  assert.equal(deriveTttOutcome({ gaveUp: true }, 'O', false), 'win');
});

test('gaveUp + neither gaveUpBy nor lastGaveUpByMe → null (don\'t guess)', () => {
  // Defensive: an incomplete give-up state should NOT silently report
  // an outcome — better to miss this game than to lie about the result.
  assert.equal(deriveTttOutcome({ gaveUp: true }, 'X'), null);
  assert.equal(deriveTttOutcome({ gaveUp: true }, 'X', null), null);
});

test('gaveUpBy wins over lastGaveUpByMe when both present (3×3 trusts server)', () => {
  // If server stamps gaveUpBy=X but a stale lastGaveUpByMe says false,
  // trust the server. (Shouldn't normally happen — pinning the precedence.)
  assert.equal(deriveTttOutcome({ gaveUp: true, gaveUpBy: 'X' }, 'X', false), 'loss');
});

// Mirror property — for every outcome from one player's perspective, the
// other player should see the opposite (or the same in the draw case).
// This is the property that goes wrong on the wire when one client reports
// and the other doesn't.

test('mirror: same game state from X\'s vs O\'s perspective gives the opposite outcome (or both draw)', () => {
  const cases = [
    { game: { winner: 'X' }, x: 'win', o: 'loss' },
    { game: { winner: 'O' }, x: 'loss', o: 'win' },
    { game: { draw: true }, x: 'draw', o: 'draw' },
    { game: { gaveUp: true, gaveUpBy: 'X' }, x: 'loss', o: 'win' },
    { game: { gaveUp: true, gaveUpBy: 'O' }, x: 'win', o: 'loss' },
  ];
  for (const c of cases) {
    assert.equal(deriveTttOutcome(c.game, 'X'), c.x, `X side of ${JSON.stringify(c.game)}`);
    assert.equal(deriveTttOutcome(c.game, 'O'), c.o, `O side of ${JSON.stringify(c.game)}`);
  }
});
