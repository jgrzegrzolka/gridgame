import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_ALPHABET,
  ROOM_LEN,
  generateCode,
  isValidRoomCode,
  serverUrlFor,
} from './roomNet.js';

// ---- Room code generation ----

test('generateCode: returns ROOM_LEN characters from the curated alphabet', () => {
  const seq = [0, 0.1, 0.3, 0.5, 0.9];
  let i = 0;
  const code = generateCode(() => seq[i++ % seq.length]);
  assert.equal(code.length, ROOM_LEN);
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

test('serverUrlFor: localhost and LAN IPs go to a local dev server on port 1999', () => {
  assert.equal(serverUrlFor('localhost'), 'ws://localhost:1999/parties/main/');
  assert.equal(serverUrlFor('127.0.0.1'), 'ws://127.0.0.1:1999/parties/main/');
  assert.equal(serverUrlFor('192.168.0.5'), 'ws://192.168.0.5:1999/parties/main/');
});

test('serverUrlFor: production hostnames go to the deployed Cloudflare PartyKit', () => {
  const prod = 'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/main/';
  assert.equal(serverUrlFor('jgrzegrzolka.github.io'), prod);
  assert.equal(serverUrlFor('yetanotherquiz.com'), prod);
  assert.equal(serverUrlFor('www.yetanotherquiz.com'), prod);
});

test('serverUrlFor: party arg routes to the ultimate and party namespaces', () => {
  assert.equal(serverUrlFor('localhost', 'ultimate'), 'ws://localhost:1999/parties/ultimate/');
  assert.equal(serverUrlFor('localhost', 'party'), 'ws://localhost:1999/parties/party/');
  assert.equal(serverUrlFor('yetanotherquiz.com', 'party'),
    'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/party/');
});
