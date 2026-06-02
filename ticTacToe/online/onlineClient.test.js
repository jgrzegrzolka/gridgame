import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_ALPHABET,
  ROOM_LEN,
  generateCode,
  isValidRoomCode,
  serverUrlFor,
  initialClientState,
  reduceServerMessage,
  getOrCreatePlayerId,
} from './onlineClient.js';

// ---- Room code generation ----

test('generateCode: returns ROOM_LEN characters', () => {
  const code = generateCode(() => 0);
  assert.equal(code.length, ROOM_LEN);
});

test('generateCode: every character is from the curated alphabet', () => {
  // Drive rng across the alphabet so we hit several indices.
  const seq = [0, 0.1, 0.3, 0.5, 0.9];
  let i = 0;
  const code = generateCode(() => seq[i++ % seq.length]);
  for (const ch of code) {
    assert.ok(ROOM_ALPHABET.includes(ch), `unexpected char in code: ${ch}`);
  }
});

test('generateCode: alphabet excludes ambiguous characters (I, O, L, 0, 1)', () => {
  for (const ch of 'IOL01') {
    assert.equal(ROOM_ALPHABET.includes(ch), false, `${ch} should not be in alphabet`);
  }
});

// ---- Validation ----

test('isValidRoomCode: accepts 5 uppercase alphanumeric characters', () => {
  assert.equal(isValidRoomCode('ABCDE'), true);
  assert.equal(isValidRoomCode('XY7Z9'), true);
});

test('isValidRoomCode: rejects wrong length and case', () => {
  assert.equal(isValidRoomCode('ABCD'), false);
  assert.equal(isValidRoomCode('ABCDEF'), false);
  assert.equal(isValidRoomCode('abcde'), false);
  assert.equal(isValidRoomCode(''), false);
  assert.equal(isValidRoomCode('ABCD!'), false);
});

// ---- Server URL selection ----

test('serverUrlFor: localhost goes to local dev server', () => {
  assert.equal(serverUrlFor('localhost'), 'ws://localhost:1999/parties/main/');
  assert.equal(serverUrlFor('127.0.0.1'), 'ws://127.0.0.1:1999/parties/main/');
});

test('serverUrlFor: anything else goes to the deployed wss URL', () => {
  const expected = 'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/main/';
  assert.equal(serverUrlFor('jgrzegrzolka.github.io'), expected);
  assert.equal(serverUrlFor('192.168.0.5'), expected);
});

// ---- Reducer ----

test('reduceServerMessage: welcome sets myRole, game, and peerPresent', () => {
  const state = initialClientState();
  const game = /** @type {any} */ ({ currentPlayer: 'O', winner: null, draw: false });
  const r = reduceServerMessage(state, { type: 'welcome', you: 'O', game, peerPresent: false });
  assert.equal(r.state.myRole, 'O');
  assert.equal(r.state.game, game);
  assert.equal(r.state.peerPresent, false);
  assert.deepEqual(r.effects, []);
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

test('reduceServerMessage: rejected sets a statusOverride and emits "close"', () => {
  const state = initialClientState();
  const r = reduceServerMessage(state, { type: 'rejected', reason: 'room-full' });
  assert.equal(r.state.statusOverride, 'Room is full');
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceServerMessage: rejected with room-not-found gets a guiding message', () => {
  const r = reduceServerMessage(initialClientState(), { type: 'rejected', reason: 'room-not-found' });
  assert.match(/** @type {string} */ (r.state.statusOverride), /not found/i);
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceServerMessage: rejected with code-collision gets a clear message', () => {
  const r = reduceServerMessage(initialClientState(), { type: 'rejected', reason: 'code-collision' });
  assert.match(/** @type {string} */ (r.state.statusOverride), /already taken/i);
  assert.deepEqual(r.effects, [{ type: 'close' }]);
});

test('reduceServerMessage: rejected with an unknown reason falls back to a generic message', () => {
  const r = reduceServerMessage(initialClientState(), { type: 'rejected', reason: 'mystery' });
  assert.equal(r.state.statusOverride, 'Rejected: mystery');
});

test('reduceServerMessage: unknown message type is a no-op', () => {
  const state = initialClientState();
  const r = reduceServerMessage(state, { type: 'something-new' });
  assert.equal(r.state, state);
  assert.deepEqual(r.effects, []);
});

// ---- getOrCreatePlayerId ----

/**
 * @param {Record<string, string>} [initial]
 */
function fakeStore(initial = {}) {
  /** @type {Map<string, string>} */
  const data = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem: (k) => (data.has(k) ? /** @type {string} */ (data.get(k)) : null),
    /** @param {string} k @param {string} v */
    setItem: (k, v) => { data.set(k, v); },
    _dump: () => Object.fromEntries(data),
  };
}

test('getOrCreatePlayerId: generates a fresh id on first call and persists it', () => {
  const store = fakeStore();
  const id = getOrCreatePlayerId(store, () => 'uuid-1');
  assert.equal(id, 'uuid-1');
  assert.equal(store._dump()['gridgame.player.id'], 'uuid-1');
});

test('getOrCreatePlayerId: returns the existing id on subsequent calls without regenerating', () => {
  const store = fakeStore({ 'gridgame.player.id': 'existing-id' });
  let generated = 0;
  const id = getOrCreatePlayerId(store, () => { generated++; return 'new-id'; });
  assert.equal(id, 'existing-id');
  assert.equal(generated, 0, 'must not call the generator when an id already exists');
});
