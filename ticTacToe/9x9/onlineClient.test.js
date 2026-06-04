import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialUltimateClientState,
  reduceUltimateServerMessage,
  canGiveUpUltimateOnline,
} from './onlineClient.js';

// ---- Reducer ----

test('reduceUltimateServerMessage: welcome sets myRole, game, peerPresent', () => {
  const state = initialUltimateClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false, boards: [] });
  const r = reduceUltimateServerMessage(state, { type: 'welcome', you: 'O', game, peerPresent: false });
  assert.equal(r.state.myRole, 'O');
  assert.equal(r.state.game, game);
  assert.equal(r.state.peerPresent, false);
  assert.deepEqual(r.effects, []);
});

test('reduceUltimateServerMessage: kind=claimed updates game and emits no effects', () => {
  const state = { ...initialUltimateClientState(), myRole: /** @type {const} */ ('O') };
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: false });
  const r = reduceUltimateServerMessage(state, { type: 'state', kind: 'claimed', game });
  assert.equal(r.state.game, game);
  assert.deepEqual(r.effects, []);
});

test('reduceUltimateServerMessage: kind=miss-invalid emits a shake with the full 4-tuple', () => {
  const state = initialUltimateClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'X', winner: null, draw: false });
  const r = reduceUltimateServerMessage(state, {
    type: 'state', kind: 'miss-invalid',
    bigRow: 1, bigCol: 2, smallRow: 0, smallCol: 1,
    game,
  });
  assert.deepEqual(r.effects, [{
    type: 'shake', bigRow: 1, bigCol: 2, smallRow: 0, smallCol: 1,
  }]);
});

test('reduceUltimateServerMessage: kind=miss-duplicate also emits a shake', () => {
  const state = initialUltimateClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'X' });
  const r = reduceUltimateServerMessage(state, {
    type: 'state', kind: 'miss-duplicate',
    bigRow: 0, bigCol: 0, smallRow: 2, smallCol: 2,
    game,
  });
  assert.deepEqual(r.effects, [{
    type: 'shake', bigRow: 0, bigCol: 0, smallRow: 2, smallCol: 2,
  }]);
});

test('reduceUltimateServerMessage: a meta-winning state emits "finished"', () => {
  const state = initialUltimateClientState();
  const game = /** @type {any} */ ({ winner: 'O', draw: false, winningLine: [[0, 0], [0, 1], [0, 2]] });
  const r = reduceUltimateServerMessage(state, { type: 'state', kind: 'claimed', game });
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceUltimateServerMessage: a meta-draw state emits "finished"', () => {
  const state = initialUltimateClientState();
  const game = /** @type {any} */ ({ winner: null, draw: true });
  const r = reduceUltimateServerMessage(state, { type: 'state', kind: 'claimed', game });
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceUltimateServerMessage: kind=give-up emits gave-up with byMe true when resigner is us', () => {
  const state = { ...initialUltimateClientState(), myRole: /** @type {const} */ ('O') };
  const game = /** @type {any} */ ({ gaveUp: true });
  const r = reduceUltimateServerMessage(state, { type: 'state', kind: 'give-up', game, who: 'O' });
  assert.ok(r.effects.some((e) => e.type === 'gave-up' && /** @type {any} */ (e).byMe === true));
  assert.ok(r.effects.some((e) => e.type === 'finished'));
});

test('reduceUltimateServerMessage: kind=give-up emits gave-up with byMe=false when opponent resigned', () => {
  const state = { ...initialUltimateClientState(), myRole: /** @type {const} */ ('X') };
  const game = /** @type {any} */ ({ gaveUp: true });
  const r = reduceUltimateServerMessage(state, { type: 'state', kind: 'give-up', game, who: 'O' });
  assert.ok(r.effects.some((e) => e.type === 'gave-up' && /** @type {any} */ (e).byMe === false));
});

test('reduceUltimateServerMessage: kind=rematch emits "rematch-started"', () => {
  const state = initialUltimateClientState();
  const game = /** @type {any} */ ({ winner: null, draw: false });
  const r = reduceUltimateServerMessage(state, { type: 'state', kind: 'rematch', game });
  assert.ok(r.effects.some((e) => e.type === 'rematch-started'));
});

test('reduceUltimateServerMessage: peer-joined / peer-left flip peerPresent', () => {
  const joined = reduceUltimateServerMessage(initialUltimateClientState(), { type: 'peer-joined' });
  assert.equal(joined.state.peerPresent, true);
  const left = reduceUltimateServerMessage({ ...initialUltimateClientState(), peerPresent: true }, { type: 'peer-left' });
  assert.equal(left.state.peerPresent, false);
});

test('reduceUltimateServerMessage: rejected sets statusOverride and emits "close"', () => {
  const r = reduceUltimateServerMessage(initialUltimateClientState(), { type: 'rejected', reason: 'room-full' });
  assert.equal(r.state.statusOverride, 'Room is full');
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceUltimateServerMessage: unknown message type is a no-op', () => {
  const state = initialUltimateClientState();
  const r = reduceUltimateServerMessage(state, { type: 'something-new' });
  assert.equal(r.state, state);
  assert.deepEqual(r.effects, []);
});

// ---- canGiveUpUltimateOnline ----

/**
 * @param {Partial<{ winner: 'X'|'O'|null, draw: boolean, gaveUp: boolean, currentPlayer: 'X'|'O' }>} [overrides]
 */
function liveGame(overrides = {}) {
  return /** @type {any} */ ({
    currentPlayer: 'O', winner: null, draw: false, gaveUp: false, ...overrides,
  });
}

test('canGiveUpUltimateOnline: false on the bare lobby state', () => {
  assert.equal(canGiveUpUltimateOnline(initialUltimateClientState()), false);
});

test('canGiveUpUltimateOnline: false without a peer', () => {
  const state = {
    ...initialUltimateClientState(),
    myRole: /** @type {const} */ ('X'),
    game: liveGame(),
    peerPresent: false,
  };
  assert.equal(canGiveUpUltimateOnline(state), false);
});

test('canGiveUpUltimateOnline: true when role + peer + live game are all in place', () => {
  const state = {
    ...initialUltimateClientState(),
    myRole: /** @type {const} */ ('O'),
    game: liveGame(),
    peerPresent: true,
  };
  assert.equal(canGiveUpUltimateOnline(state), true);
});

test('canGiveUpUltimateOnline: false once the meta game has a winner / draw / gaveUp', () => {
  const base = {
    ...initialUltimateClientState(),
    myRole: /** @type {const} */ ('O'),
    peerPresent: true,
  };
  assert.equal(canGiveUpUltimateOnline({ ...base, game: liveGame({ winner: 'X' }) }), false);
  assert.equal(canGiveUpUltimateOnline({ ...base, game: liveGame({ draw: true }) }), false);
  assert.equal(canGiveUpUltimateOnline({ ...base, game: liveGame({ gaveUp: true }) }), false);
});
