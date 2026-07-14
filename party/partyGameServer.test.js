import { test } from 'node:test';
import assert from 'node:assert/strict';
import PartyGameServer from './partyGameServer.js';

/**
 * These tests cover the server's orchestration seam around the pure reducer —
 * specifically the watchdog alarm that force-advances the room when the host's
 * tab never sends the transition. The reducer itself (applyRevealTimeout /
 * applyNextTimeout) is unit-tested in flags/partyRoom.test.js; here we prove the
 * durable-object glue actually wires the alarm to those transitions, so a game
 * can't stall at a reveal (the final board especially) if the host goes silent.
 */

/**
 * Mock connection that records every send().
 * @param {string} id
 */
function mockConn(id) {
  /** @type {string[]} */
  const sent = [];
  return {
    id,
    send: (/** @type {string} */ data) => { sent.push(data); },
    close: () => {},
    /** @returns {string[]} */
    get sent() { return sent; },
  };
}

/** In-memory party.storage with a single alarm slot, plus call counters so a
 *  test can assert the watchdog was (or wasn't) re-pointed. */
function mockStorage() {
  const data = new Map();
  let alarm = null;
  let setCalls = 0;
  let deleteCalls = 0;
  return {
    /** @param {string} k */
    get: async (k) => data.get(k),
    /** @param {string} k @param {any} v */
    put: async (k, v) => { data.set(k, v); },
    /** @param {string} k */
    delete: async (k) => { data.delete(k); },
    /** @param {number} t */
    setAlarm: async (t) => { alarm = t; setCalls += 1; },
    deleteAlarm: async () => { alarm = null; deleteCalls += 1; },
    getAlarm: async () => alarm,
    get setAlarmCalls() { return setCalls; },
    get deleteAlarmCalls() { return deleteCalls; },
  };
}

/** @param {Array<{ id: string }>} conns */
function mockParty(conns, storage = mockStorage()) {
  return {
    storage,
    /** @param {string} id */
    getConnection: (id) => conns.find((c) => c.id === id),
    getConnections: () => conns,
  };
}

/**
 * @param {string} pid
 * @param {'create' | 'join'} [intent]
 */
function ctxFor(pid, intent) {
  const url = new URL('wss://example.test/parties/main/ABC12');
  url.searchParams.set('pid', pid);
  if (intent) url.searchParams.set('intent', intent);
  return { request: /** @type {any} */ ({ url: url.toString() }) };
}

/**
 * Latest message of a given type sent to a connection (scans from the end).
 * @param {ReturnType<typeof mockConn>} conn
 * @param {string} type
 */
function lastMsg(conn, type) {
  for (let i = conn.sent.length - 1; i >= 0; i--) {
    const m = JSON.parse(conn.sent[i]);
    if (m.type === type) return m;
  }
  return null;
}

test('starting a game arms the question watchdog', async () => {
  const host = mockConn('h');
  const party = mockParty([host]);
  const srv = new PartyGameServer(party);
  await srv.onStart();
  await srv.onConnect(host, ctxFor('solo', 'create'));
  await srv.onMessage(JSON.stringify({ type: 'start' }), host);
  assert.ok(await party.storage.getAlarm(), 'an alarm is pending during the question');
});

test('watchdog delivers the final board when the host never sends the last next', async () => {
  const host = mockConn('h');
  const party = mockParty([host]);
  const srv = new PartyGameServer(party);
  await srv.onStart();
  await srv.onConnect(host, ctxFor('solo', 'create'));
  await srv.onMessage(JSON.stringify({ type: 'start' }), host);

  // Solo game: buzzing auto-reveals server-side (all present have answered), but
  // reveal -> next is normally the host page's clock. Here the host tab is
  // "asleep" — it never sends `next` — so every reveal is advanced by the
  // watchdog (onAlarm) instead. The game must still reach the final board.
  let finalMsg = null;
  for (let i = 0; i < 40 && !finalMsg; i++) {
    const question = lastMsg(host, 'question');
    assert.ok(question, `round ${i}: a question was dealt`);
    await srv.onMessage(JSON.stringify({ type: 'buzz', choice: question.options[0] }), host);
    await srv.onAlarm(); // host's `next` never comes; the watchdog advances the reveal
    finalMsg = lastMsg(host, 'final');
  }
  assert.ok(finalMsg, 'the watchdog drove the game to the final board with no host next');
  assert.ok(Array.isArray(finalMsg.scoreboard) && finalMsg.scoreboard.length === 1);
  assert.equal(await party.storage.getAlarm(), null, 'the alarm is cleared once at the final board');
});

test('watchdog is a no-op once the room has already advanced', async () => {
  const host = mockConn('h');
  const party = mockParty([host]);
  const srv = new PartyGameServer(party);
  await srv.onStart();
  await srv.onConnect(host, ctxFor('solo', 'create'));
  await srv.onMessage(JSON.stringify({ type: 'start' }), host);
  // Reveal round 0, then let the host advance it normally.
  const q0 = lastMsg(host, 'question');
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: q0.options[0] }), host); // -> reveal
  await srv.onMessage(JSON.stringify({ type: 'next' }), host); // host advances -> question 1
  const countType = (/** @type {string} */ type) =>
    host.sent.filter((s) => JSON.parse(s).type === type).length;
  const questionsBefore = countType('question');
  await srv.onAlarm(); // a stale reveal alarm fires after the host already moved on
  // The alarm found the room in the question phase (not reveal), so its
  // applyNextTimeout was a no-op — no duplicate question, no skipped round.
  assert.equal(countType('question'), questionsBefore, 'no extra round dealt');
});

test('a mid-question buzz does not re-point the watchdog (keeps the question window)', async () => {
  const alice = mockConn('a');
  const bob = mockConn('b');
  const party = mockParty([alice, bob]);
  const srv = new PartyGameServer(party);
  await srv.onStart();
  await srv.onConnect(alice, ctxFor('alice', 'create'));
  await srv.onConnect(bob, ctxFor('bob', 'join'));
  await srv.onMessage(JSON.stringify({ type: 'start' }), alice);
  const setAfterStart = party.storage.setAlarmCalls;

  const q0 = lastMsg(alice, 'question');
  // Only Alice buzzes — the phase stays 'question', so the alarm must NOT be
  // reset (a buzz can't extend the answer window for the other player).
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: q0.options[0] }), alice);
  assert.equal(party.storage.setAlarmCalls, setAfterStart, 'a non-revealing buzz leaves the alarm alone');

  // Bob completes the round -> reveal -> the watchdog re-points to the reveal deadline.
  await srv.onMessage(JSON.stringify({ type: 'buzz', choice: q0.options[0] }), bob);
  assert.equal(party.storage.setAlarmCalls, setAfterStart + 1, 'the reveal transition re-arms the alarm');
});
