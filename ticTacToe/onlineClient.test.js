import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialClientState,
  reduceServerMessage,
  canGiveUpOnline,
} from './onlineClient.js';

// Room-code / server-URL helpers moved to flags/roomNet.js — their tests live
// in flags/roomNet.test.js now. This file covers the TTT-specific reducer.

// ---- Reducer ----

test('reduceServerMessage: welcome sets myRole, game, peerPresent, peerId', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false });
  const r = reduceServerMessage(state, { type: 'welcome', you: 'O', game, peerPresent: true, peerId: 'alice' });
  assert.equal(r.state.myRole, 'O');
  assert.equal(r.state.game, game);
  assert.equal(r.state.peerPresent, true);
  assert.equal(r.state.peerId, 'alice');
  assert.deepEqual(r.effects, []);
});

test('reduceServerMessage: welcome with no peer yet leaves peerId null', () => {
  const r = reduceServerMessage(initialClientState(), {
    type: 'welcome', you: 'X', game: /** @type {any} */ ({}), peerPresent: false, peerId: null,
  });
  assert.equal(r.state.peerId, null);
});

test('reduceServerMessage: welcome with a finished (winner) game emits "finished" so refresh re-paints the result UI', () => {
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: 'X', draw: false });
  const r = reduceServerMessage(initialClientState(), {
    type: 'welcome', you: 'X', game, peerPresent: true, peerId: 'bob',
  });
  assert.ok(r.effects.some((e) => e.type === 'finished'),
    'without this, refresh-after-win leaves #result hidden and no action links');
});

test('reduceServerMessage: welcome with a drawn game also emits "finished"', () => {
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: true });
  const r = reduceServerMessage(initialClientState(), {
    type: 'welcome', you: 'O', game, peerPresent: true, peerId: 'alice',
  });
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceServerMessage: welcome with gaveUp=true emits gave-up with byMe=true when the persisted gaveUpBy matches us', () => {
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false, gaveUp: true, gaveUpBy: 'O' });
  const r = reduceServerMessage(initialClientState(), {
    type: 'welcome', you: 'O', game, peerPresent: true, peerId: 'bob',
  });
  assert.ok(r.effects.some((e) => e.type === 'gave-up' && /** @type {any} */ (e).byMe === true),
    'refresh-after-self-give-up should still say "You gave up", not "Opponent gave up"');
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceServerMessage: welcome with gaveUp=true emits gave-up with byMe=false when the opponent resigned', () => {
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false, gaveUp: true, gaveUpBy: 'X' });
  const r = reduceServerMessage(initialClientState(), {
    type: 'welcome', you: 'O', game, peerPresent: true, peerId: 'alice',
  });
  assert.ok(r.effects.some((e) => e.type === 'gave-up' && /** @type {any} */ (e).byMe === false));
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceServerMessage: welcome with gaveUp but no gaveUpBy (legacy snapshot) emits finished but skips gave-up — guards against stale persisted rooms', () => {
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false, gaveUp: true });
  const r = reduceServerMessage(initialClientState(), {
    type: 'welcome', you: 'X', game, peerPresent: true, peerId: 'bob',
  });
  assert.ok(r.effects.some((e) => e.type === 'finished'),
    'still finish the game so the result UI shows');
  assert.equal(r.effects.some((e) => e.type === 'gave-up'), false,
    'no gaveUpBy means we can\'t honestly attribute the resign — better to default than guess');
});

test('reduceServerMessage: state with kind=claimed updates game and emits no effects', () => {
  const state = { ...initialClientState(), myRole: /** @type {const} */ ('O') };
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: false });
  const r = reduceServerMessage(state, { type: 'state', kind: 'claimed', game });
  assert.equal(r.state.game, game);
  assert.deepEqual(r.effects, []);
});

test('reduceServerMessage: state with kind=miss-invalid emits a shake at the given coords', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: false });
  const r = reduceServerMessage(state, { type: 'state', kind: 'miss-invalid', row: 1, col: 2, game });
  assert.deepEqual(r.effects, [{ type: 'shake', row: 1, col: 2 }]);
});

test('reduceServerMessage: state with kind=miss-duplicate also emits a shake', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: false });
  const r = reduceServerMessage(state, { type: 'state', kind: 'miss-duplicate', row: 0, col: 0, game });
  assert.deepEqual(r.effects, [{ type: 'shake', row: 0, col: 0 }]);
});

test('reduceServerMessage: a winning state emits the "finished" effect', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: 'O', draw: false, winningLine: [[0, 0], [0, 1], [0, 2]] });
  const r = reduceServerMessage(state, { type: 'state', kind: 'claimed', game });
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceServerMessage: a drawn state emits the "finished" effect', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: true });
  const r = reduceServerMessage(state, { type: 'state', kind: 'claimed', game });
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceServerMessage: kind=give-up emits gave-up with byMe=true when the resigner is us', () => {
  const state = { ...initialClientState(), myRole: /** @type {const} */ ('O') };
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false, gaveUp: true });
  const r = reduceServerMessage(state, { type: 'state', kind: 'give-up', game, who: 'O' });
  assert.ok(r.effects.some((e) => e.type === 'gave-up' && /** @type {any} */ (e).byMe === true));
  assert.ok(r.effects.some((e) => e.type === 'finished'), 'a gave-up state is terminal → finished fires');
  assert.equal(r.state.game, game);
});

test('reduceServerMessage: kind=give-up emits gave-up with byMe=false when the opponent resigned', () => {
  const state = { ...initialClientState(), myRole: /** @type {const} */ ('X') };
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false, gaveUp: true });
  const r = reduceServerMessage(state, { type: 'state', kind: 'give-up', game, who: 'O' });
  assert.ok(r.effects.some((e) => e.type === 'gave-up' && /** @type {any} */ (e).byMe === false));
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceServerMessage: state with kind=rematch emits the "rematch-started" effect', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: false });
  const r = reduceServerMessage(state, { type: 'state', kind: 'rematch', game });
  assert.ok(r.effects.some((e) => e.type === 'rematch-started'));
  assert.equal(r.state.game, game);
});

test('reduceServerMessage: peer-joined carries peerId — alice learns about bob', () => {
  const state = { ...initialClientState(), myRole: /** @type {const} */ ('X') };
  const r = reduceServerMessage(state, { type: 'peer-joined', peerId: 'bob' });
  assert.equal(r.state.peerPresent, true);
  assert.equal(r.state.peerId, 'bob');
});

test('reduceServerMessage: peer-left keeps peerId sticky so a late result still has an opponent id', () => {
  const state = { ...initialClientState(), peerPresent: true, peerId: 'bob' };
  const r = reduceServerMessage(state, { type: 'peer-left' });
  assert.equal(r.state.peerPresent, false);
  assert.equal(r.state.peerId, 'bob');
});

test('reduceServerMessage: peer-joined toggles peerPresent without touching game state', () => {
  const game = /** @type {any} */ ({ currentPlayer: 'O' });
  const state = { ...initialClientState(), game };
  const r = reduceServerMessage(state, { type: 'peer-joined' });
  assert.equal(r.state.peerPresent, true);
  assert.equal(r.state.game, game);
  assert.deepEqual(r.effects, []);
});

test('reduceServerMessage: peer-left flips peerPresent back to false', () => {
  const state = { ...initialClientState(), peerPresent: true };
  const r = reduceServerMessage(state, { type: 'peer-left' });
  assert.equal(r.state.peerPresent, false);
  assert.deepEqual(r.effects, []);
});

// statusOverride is now an unresolved `{ key, fallback, params? }` so a
// soft language switch can re-translate it. The reducer's job is to
// route the wire-protocol reason code to the right key + fallback; the
// page picks the language at paint time via `setStatusKey`.

test('reduceServerMessage: rejected sets a statusOverride and emits "close"', () => {
  const state = initialClientState();
  const r = reduceServerMessage(state, { type: 'rejected', reason: 'room-full' });
  assert.deepEqual(r.state.statusOverride, { key: 'ttt.reject.roomFull', fallback: 'Room is full' });
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceServerMessage: rejected with room-not-found gets a guiding message', () => {
  const r = reduceServerMessage(initialClientState(), { type: 'rejected', reason: 'room-not-found' });
  assert.equal(r.state.statusOverride?.key, 'ttt.reject.roomNotFound');
  assert.match(/** @type {string} */ (r.state.statusOverride?.fallback), /not found/i);
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceServerMessage: rejected with code-collision gets a clear message', () => {
  const r = reduceServerMessage(initialClientState(), { type: 'rejected', reason: 'code-collision' });
  assert.equal(r.state.statusOverride?.key, 'ttt.reject.codeCollision');
  assert.match(/** @type {string} */ (r.state.statusOverride?.fallback), /already taken/i);
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceServerMessage: rejected with an unknown reason carries the raw reason as a template param', () => {
  // The generic fallback's `{reason}` placeholder is substituted by the
  // page at paint time, so the reducer pins it in `params` to keep the
  // language-agnostic raw reason available for the substitution.
  const r = reduceServerMessage(initialClientState(), { type: 'rejected', reason: 'mystery' });
  assert.deepEqual(r.state.statusOverride, {
    key: 'ttt.reject.fallback',
    fallback: 'Rejected: {reason}',
    params: { reason: 'mystery' },
  });
});

test('reduceServerMessage: unknown message type is a no-op', () => {
  const state = initialClientState();
  const r = reduceServerMessage(state, { type: 'something-new' });
  assert.equal(r.state, state);
  assert.deepEqual(r.effects, []);
});

// ---- canGiveUpOnline ----

/**
 * @param {Partial<{ winner: 'X'|'O'|null, draw: boolean, gaveUp: boolean, currentPlayer: 'X'|'O' }>} [overrides]
 */
function liveGame(overrides = {}) {
  return /** @type {any} */ ({
    currentPlayer: 'O', winner: null, draw: false, gaveUp: false, ...overrides,
  });
}

test('canGiveUpOnline: false on the bare lobby state (no role, no game, no peer)', () => {
  assert.equal(canGiveUpOnline(initialClientState()), false);
});

test('canGiveUpOnline: false when the player has joined a room but the opponent has not arrived yet', () => {
  const state = {
    ...initialClientState(),
    myRole: /** @type {const} */ ('X'),
    game: liveGame(),
    peerPresent: false,
  };
  assert.equal(canGiveUpOnline(state), false, 'lonely host cannot give up');
});

test('canGiveUpOnline: true when role + peer + a live game are all in place', () => {
  const state = {
    ...initialClientState(),
    myRole: /** @type {const} */ ('O'),
    game: liveGame(),
    peerPresent: true,
  };
  assert.equal(canGiveUpOnline(state), true);
});

test('canGiveUpOnline: false once the game has a winner', () => {
  const state = {
    ...initialClientState(),
    myRole: /** @type {const} */ ('O'),
    game: liveGame({ winner: 'X' }),
    peerPresent: true,
  };
  assert.equal(canGiveUpOnline(state), false);
});

test('canGiveUpOnline: false on a draw', () => {
  const state = {
    ...initialClientState(),
    myRole: /** @type {const} */ ('O'),
    game: liveGame({ draw: true }),
    peerPresent: true,
  };
  assert.equal(canGiveUpOnline(state), false);
});

test('canGiveUpOnline: false once either side has already conceded', () => {
  const state = {
    ...initialClientState(),
    myRole: /** @type {const} */ ('O'),
    game: liveGame({ gaveUp: true }),
    peerPresent: true,
  };
  assert.equal(canGiveUpOnline(state), false);
});

