import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_ALPHABET,
  ROOM_LEN,
  generateCode,
  isValidRoomCode,
  normalizeRoomCodeInput,
  serverUrlFor,
  httpServerUrlFor,
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

// ---- Join-field normalisation ----

test('normalizeRoomCodeInput: upper-cases and drops punctuation and spaces', () => {
  assert.equal(normalizeRoomCodeInput('66bke'), '66BKE');
  assert.equal(normalizeRoomCodeInput('66-bk e'), '66BKE');
  assert.equal(normalizeRoomCodeInput('  ab cd  '), 'ABCD');
});

test('normalizeRoomCodeInput: caps at ROOM_LEN', () => {
  assert.equal(normalizeRoomCodeInput('ABCDEFGH').length, ROOM_LEN);
  assert.equal(normalizeRoomCodeInput('ABCDEFGH'), 'ABCDE');
});

test('normalizeRoomCodeInput: a pasted invite link yields its trailing code', () => {
  assert.equal(normalizeRoomCodeInput('https://www.yetanotherquiz.com/flagParty/?r=66BKE'), '66BKE');
  assert.equal(normalizeRoomCodeInput('https://www.yetanotherquiz.com/ticTacToe/?room=xy7z9'), 'XY7Z9');
  assert.equal(normalizeRoomCodeInput('/flagParty/66BKE\n'), '66BKE');
});

// A link whose tail is NOT a 5-run falls back to stripping, which is the only
// sane thing left — better a wrong-length code the user can see and fix than a
// silently truncated one.
test('normalizeRoomCodeInput: a link with no trailing 5-run falls back to stripping', () => {
  assert.equal(normalizeRoomCodeInput('https://example.com/'), 'HTTPS');
});

// Typed input never takes the link path, so an ordinary sentence cannot
// accidentally resolve to the code buried at its end.
test('normalizeRoomCodeInput: plain text without / or = always takes the strip path', () => {
  assert.equal(normalizeRoomCodeInput('code 66BKE'), 'CODE6');
});

test('normalizeRoomCodeInput: nullish and empty input yield an empty string', () => {
  assert.equal(normalizeRoomCodeInput(''), '');
  assert.equal(normalizeRoomCodeInput(/** @type {any} */ (null)), '');
  assert.equal(normalizeRoomCodeInput(/** @type {any} */ (undefined)), '');
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

test('serverUrlFor: party arg routes to the named party namespace', () => {
  assert.equal(serverUrlFor('localhost', 'party'), 'ws://localhost:1999/parties/party/');
  assert.equal(serverUrlFor('yetanotherquiz.com', 'party'),
    'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/party/');
});

test('httpServerUrlFor: same routing as serverUrlFor but with an http(s) scheme', () => {
  // The liveness probe is a plain GET, not a WebSocket upgrade — same origin
  // and path as the WS URL, just http/https instead of ws/wss.
  assert.equal(httpServerUrlFor('localhost', 'party'), 'http://localhost:1999/parties/party/');
  assert.equal(httpServerUrlFor('192.168.0.5', 'party'), 'http://192.168.0.5:1999/parties/party/');
  assert.equal(httpServerUrlFor('www.yetanotherquiz.com', 'party'),
    'https://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/party/');
  assert.equal(httpServerUrlFor('jgrzegrzolka.github.io', 'party'),
    'https://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/party/');
});
