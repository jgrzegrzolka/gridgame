import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showBotSeat } from './botSeat.js';
import { MAX_SEATS } from '../flags/partyRoom.js';

test('the host sees the empty seat in the lobby', () => {
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: 1 }), true);
});

test('a guest never sees it — adding a seat is the host call', () => {
  assert.equal(showBotSeat({ isHost: false, inLobby: true, seatCount: 1 }), false);
});

test('it is gone once the game is running', () => {
  assert.equal(showBotSeat({ isHost: true, inLobby: false, seatCount: 1 }), false);
});

test('a full room hides the seat rather than offering a dead one', () => {
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: MAX_SEATS - 1 }), true);
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: MAX_SEATS }), false);
  // Over the cap can only happen if the server's limit moves under a stale
  // client; the seat stays hidden rather than offering a seat that would bounce.
  assert.equal(showBotSeat({ isHost: true, inLobby: true, seatCount: MAX_SEATS + 3 }), false);
});
