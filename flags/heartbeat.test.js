import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PING_INTERVAL_MS,
  CLIENT_STALE_MS,
  SERVER_QUIET_MS,
  thresholdsAreOrdered,
  heartbeatAction,
  quietPlayerIds,
} from './heartbeat.js';

test('the client gives up before the server evicts it', () => {
  // The whole point of the ordering. If the server timed out first, a merely
  // slow client would have its seat released underneath it — and in a draft
  // that re-elects the picker, so a hiccup could hand away your turn.
  assert.ok(thresholdsAreOrdered());
  assert.ok(PING_INTERVAL_MS < CLIENT_STALE_MS, 'a ping must have time to be answered');
  assert.ok(CLIENT_STALE_MS < SERVER_QUIET_MS, 'the client must self-heal before eviction');
});

test('the client self-heals inside one pick window', () => {
  // 45s is PICK_TIMEOUT_SECONDS. A client that goes stale at the worst moment
  // must be back before the pick it is missing has timed out, or the bug this
  // was built for survives the fix.
  assert.ok(CLIENT_STALE_MS < 45_000);
});

test('heartbeatAction: an unopened socket is idle, not stale', () => {
  // The reconnect backoff owns the not-yet-connected state. Calling it stale
  // would have the heartbeat fighting the backoff for the same socket.
  assert.equal(heartbeatAction(1_000_000, { lastRecvAt: null, lastPingAt: null }), 'idle');
});

test('heartbeatAction: pings on the first tick after connecting', () => {
  const now = 1_000_000;
  assert.equal(heartbeatAction(now, { lastRecvAt: now, lastPingAt: null }), 'ping');
});

test('heartbeatAction: stays idle between pings, then pings on the interval', () => {
  const now = 1_000_000;
  assert.equal(
    heartbeatAction(now, { lastRecvAt: now, lastPingAt: now - (PING_INTERVAL_MS - 1) }),
    'idle',
  );
  assert.equal(
    heartbeatAction(now, { lastRecvAt: now, lastPingAt: now - PING_INTERVAL_MS }),
    'ping',
  );
});

test('heartbeatAction: reconnects once the silence passes the stale threshold', () => {
  const now = 1_000_000;
  assert.equal(
    heartbeatAction(now, { lastRecvAt: now - (CLIENT_STALE_MS - 1), lastPingAt: now }),
    'idle',
  );
  assert.equal(
    heartbeatAction(now, { lastRecvAt: now - CLIENT_STALE_MS, lastPingAt: now }),
    'reconnect',
  );
});

test('heartbeatAction: reconnect outranks ping', () => {
  // Both conditions are true here: long silence AND a ping is due. Another ping
  // into a socket that has proved dead only costs a tick before recovery.
  const now = 1_000_000;
  assert.equal(
    heartbeatAction(now, { lastRecvAt: now - CLIENT_STALE_MS, lastPingAt: now - PING_INTERVAL_MS }),
    'reconnect',
  );
});

test('heartbeatAction: a healthy exchange never reconnects', () => {
  // Simulate 10 minutes of an idle-but-alive connection: every ping is answered
  // one tick later. This is the false-positive guard — a watcher sitting through
  // a long round sends nothing of its own, and must not be dropped for it.
  let lastRecvAt = 0;
  let lastPingAt = /** @type {number | null} */ (null);
  for (let now = 0; now <= 600_000; now += 5_000) {
    const action = heartbeatAction(now, { lastRecvAt, lastPingAt });
    assert.notEqual(action, 'reconnect', `spurious reconnect at t=${now}`);
    if (action === 'ping') {
      lastPingAt = now;
      lastRecvAt = now + 100; // the pong comes back
    }
  }
});

test('quietPlayerIds: only the ones past the threshold', () => {
  const now = 1_000_000;
  const lastSeen = new Map([
    ['fresh', now - 1_000],
    ['borderline', now - (SERVER_QUIET_MS - 1)],
    ['quiet', now - SERVER_QUIET_MS],
    ['ancient', now - 10 * SERVER_QUIET_MS],
  ]);
  assert.deepEqual(quietPlayerIds(now, lastSeen).sort(), ['ancient', 'quiet']);
});

test('quietPlayerIds: an empty map drops nobody', () => {
  assert.deepEqual(quietPlayerIds(1_000_000, new Map()), []);
});

test('quietPlayerIds: a client that pings on time is never swept', () => {
  // The server sweep must be strictly slower than the client ping, or a healthy
  // heartbeating seat gets evicted on a timing edge.
  const now = 1_000_000;
  const lastSeen = new Map([['steady', now - PING_INTERVAL_MS]]);
  assert.deepEqual(quietPlayerIds(now, lastSeen), []);
});
