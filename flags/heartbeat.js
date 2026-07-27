/**
 * Liveness for the PartyKit WebSocket connections.
 *
 * The problem this exists for: a WebSocket that dies badly does NOT fire
 * `close`. A phone that sleeps, a tab the OS freezes, a wifi-to-cellular
 * handoff — any of these can leave a socket half-open, where the client
 * believes it is connected (no reconnect banner, no error) and the server
 * believes the seat is present. The server keeps fanning broadcasts into a
 * socket nobody is reading, and the player sits looking at whichever screen
 * they were on when it died while the rest of the table moves on. It surfaced
 * as a Flag Party report: one player still watching the round's standings
 * while everyone else had moved to the draft pick.
 *
 * Nothing detected this before, on either side. Neither end sent anything on an
 * idle connection, so "silent" and "dead" were indistinguishable — and during a
 * long round a watching seat is legitimately silent for minutes.
 *
 * The fix is traffic: the client pings on an interval, the server pongs, and
 * each side treats a long enough silence as a dead connection. Pure decision
 * functions here, wiring in `flagParty/page.js` (client) and
 * `party/partyGameServer.js` (server), so the thresholds and the rules that
 * order them are testable and stated once for both ends.
 */

/** How often the client pings an otherwise idle connection. */
export const PING_INTERVAL_MS = 15_000;

/**
 * How long the client tolerates hearing NOTHING before it gives up on the
 * socket and reconnects. Roughly two and a half missed pings — long enough that
 * an ordinary mobile stall doesn't trigger it (a false reconnect is worse than
 * the bug: it drops a seat mid-question for a player whose connection was fine),
 * short enough to self-heal inside a single 45s pick window.
 */
export const CLIENT_STALE_MS = 40_000;

/**
 * How long the server tolerates silence from a heartbeat-capable connection
 * before closing it, so `room.present` stops counting a ghost. That matters
 * beyond tidiness: `present` gates the auto-reveal (a question waits on every
 * present seat) and seeds the picker rotation, so a ghost seat stalls the table.
 *
 * Deliberately LONGER than {@link CLIENT_STALE_MS} — see
 * {@link thresholdsAreOrdered} for why the order is load-bearing.
 */
export const SERVER_QUIET_MS = 45_000;

/**
 * The client must give up before the server evicts it, and the invariant is
 * worth stating rather than leaving implied in two constants.
 *
 * If the server evicted first, a merely-slow client would have its seat torn
 * down underneath it — and in Flag Party that is not a cosmetic loss: dropping
 * the seat that holds the draft pick re-elects a new picker (`applyRepick`), so
 * a two-second network hiccup could hand someone else your turn. With the
 * client reacting first it reconnects on its own, `welcome` resyncs it, and the
 * seat is never released at all. The server timeout is the backstop for a
 * client that is genuinely gone and will never reconnect.
 *
 * @returns {boolean}
 */
export function thresholdsAreOrdered() {
  return PING_INTERVAL_MS < CLIENT_STALE_MS && CLIENT_STALE_MS < SERVER_QUIET_MS;
}

/**
 * What the client's heartbeat tick should do right now.
 *
 *   'reconnect' — nothing has arrived for `staleMs`; treat the socket as dead.
 *   'ping'      — time to poke the server (also the first tick after connect).
 *   'idle'      — recently heard from, recently pinged; do nothing.
 *
 * `reconnect` outranks `ping` deliberately: once the silence is long enough,
 * another ping into the same dead socket only delays the recovery by one tick.
 *
 * A null `lastRecvAt` means "no connection established yet" and yields 'idle' —
 * the caller has nothing to ping through, and treating an unopened socket as
 * stale would fight the reconnect backoff that owns that state.
 *
 * @param {number} now
 * @param {{ lastRecvAt: number | null, lastPingAt: number | null }} marks
 * @param {{ pingIntervalMs?: number, staleMs?: number }} [opts]
 * @returns {'reconnect' | 'ping' | 'idle'}
 */
export function heartbeatAction(now, marks, opts = {}) {
  const pingIntervalMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
  const staleMs = opts.staleMs ?? CLIENT_STALE_MS;
  const { lastRecvAt, lastPingAt } = marks;
  if (lastRecvAt == null) return 'idle';
  if (now - lastRecvAt >= staleMs) return 'reconnect';
  if (lastPingAt == null || now - lastPingAt >= pingIntervalMs) return 'ping';
  return 'idle';
}

/**
 * Which connections the server should close for going quiet.
 *
 * Only ever called with connections that have proved they heartbeat (see
 * `heartbeatCapable` in the server). A client on an older build never pings, so
 * including it here would evict a perfectly healthy seat every `quietMs` — the
 * regression this capability gate exists to prevent. Old clients keep the
 * pre-heartbeat behaviour exactly: never swept, only released by a real socket
 * close.
 *
 * @param {number} now
 * @param {Map<string, number>} lastSeen  playerId -> ms of its last message
 * @param {number} [quietMs]
 * @returns {string[]} playerIds to drop
 */
export function quietPlayerIds(now, lastSeen, quietMs = SERVER_QUIET_MS) {
  /** @type {string[]} */
  const out = [];
  for (const [playerId, at] of lastSeen) {
    if (now - at >= quietMs) out.push(playerId);
  }
  return out;
}
