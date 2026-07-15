import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMatchStrip, formatRecord, otherRole, offlineActive } from './matchStrip.js';

// ---- describeMatchStrip ----

test('describeMatchStrip: fresh lobby state has no game and no opponent', () => {
  const d = describeMatchStrip({ game: null, myRole: null, peerPresent: false, peerId: null });
  assert.deepEqual(d, { hasGame: false, over: false, oppPresent: false, youActive: false, oppActive: false });
});

test('describeMatchStrip: waiting (game present, no peer) marks neither card active', () => {
  const d = describeMatchStrip({
    game: { currentPlayer: 'X', winner: null, draw: false },
    myRole: 'X',
    peerPresent: false,
    peerId: null,
  });
  assert.equal(d.hasGame, true);
  assert.equal(d.oppPresent, false);
  assert.equal(d.youActive, false);
  assert.equal(d.oppActive, false);
});

test('describeMatchStrip: peerPresent but peerId still null is not oppPresent', () => {
  // A brief window can have peerPresent flip before peerId is known; the
  // opponent card must not render an avatar seeded from a null id.
  const d = describeMatchStrip({
    game: { currentPlayer: 'X', winner: null, draw: false },
    myRole: 'X',
    peerPresent: true,
    peerId: null,
  });
  assert.equal(d.oppPresent, false);
});

test('describeMatchStrip: your turn activates your card only', () => {
  const d = describeMatchStrip({
    game: { currentPlayer: 'X', winner: null, draw: false },
    myRole: 'X',
    peerPresent: true,
    peerId: 'peer-1',
  });
  assert.equal(d.oppPresent, true);
  assert.equal(d.youActive, true);
  assert.equal(d.oppActive, false);
});

test('describeMatchStrip: opponent turn activates opponent card only', () => {
  const d = describeMatchStrip({
    game: { currentPlayer: 'O', winner: null, draw: false },
    myRole: 'X',
    peerPresent: true,
    peerId: 'peer-1',
  });
  assert.equal(d.youActive, false);
  assert.equal(d.oppActive, true);
});

test('describeMatchStrip: finished game (winner) marks over and no active card', () => {
  const d = describeMatchStrip({
    game: { currentPlayer: 'O', winner: 'X', draw: false },
    myRole: 'X',
    peerPresent: true,
    peerId: 'peer-1',
  });
  assert.equal(d.over, true);
  assert.equal(d.youActive, false);
  assert.equal(d.oppActive, false);
});

test('describeMatchStrip: draw and gaveUp both count as over', () => {
  const base = { myRole: 'X', peerPresent: true, peerId: 'peer-1' };
  assert.equal(describeMatchStrip({ ...base, game: { currentPlayer: 'X', draw: true } }).over, true);
  assert.equal(describeMatchStrip({ ...base, game: { currentPlayer: 'X', gaveUp: true } }).over, true);
});

test('describeMatchStrip: no active card until roles are known', () => {
  const d = describeMatchStrip({
    game: { currentPlayer: 'X', winner: null, draw: false },
    myRole: null,
    peerPresent: true,
    peerId: 'peer-1',
  });
  assert.equal(d.youActive, false);
  assert.equal(d.oppActive, false);
});

// ---- formatRecord ----

test('formatRecord: null / undefined record returns null', () => {
  assert.equal(formatRecord(null), null);
  assert.equal(formatRecord(undefined), null);
});

test('formatRecord: an all-zero record returns null (no "0 : 0" for new pairs)', () => {
  assert.equal(formatRecord({ wins: 0, losses: 0, draws: 0 }), null);
});

test('formatRecord: wins:losses from the local perspective, no draws', () => {
  assert.deepEqual(formatRecord({ wins: 2, losses: 1, draws: 0 }), { score: '2 : 1', draws: 0 });
});

test('formatRecord: draws-only pairing still shows (score 0 : 0 with draws)', () => {
  assert.deepEqual(formatRecord({ wins: 0, losses: 0, draws: 3 }), { score: '0 : 0', draws: 3 });
});

test('formatRecord: carries the draw count through for the caller to label', () => {
  assert.deepEqual(formatRecord({ wins: 5, losses: 4, draws: 1 }), { score: '5 : 4', draws: 1 });
});

// ---- otherRole ----

test('otherRole: swaps X and O, null for anything else', () => {
  assert.equal(otherRole('X'), 'O');
  assert.equal(otherRole('O'), 'X');
  assert.equal(otherRole(null), null);
  assert.equal(otherRole(undefined), null);
});

// ---- offlineActive ----

test('offlineActive: returns the current player mid-game', () => {
  assert.equal(offlineActive({ currentPlayer: 'X', winner: null, draw: false }), 'X');
  assert.equal(offlineActive({ currentPlayer: 'O', winner: null, draw: false }), 'O');
});

test('offlineActive: null once the game is over (winner / draw / gaveUp)', () => {
  assert.equal(offlineActive({ currentPlayer: 'X', winner: 'X' }), null);
  assert.equal(offlineActive({ currentPlayer: 'O', draw: true }), null);
  assert.equal(offlineActive({ currentPlayer: 'X', gaveUp: true }), null);
});

test('offlineActive: null for no game or an unset current player', () => {
  assert.equal(offlineActive(null), null);
  assert.equal(offlineActive(undefined), null);
  assert.equal(offlineActive({ currentPlayer: null }), null);
});
