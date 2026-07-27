/**
 * Whether a room is worth offering back to a returning player. The device
 * remembers the last room it was in (`activeRoom.js`), and after the room
 * empties out that memory is the ONLY thing still pointing at a game nobody is
 * in — walking back into it alone with the old scoreboard reads as broken.
 *
 * "Alive" here means: some human is present and the server has heard from a
 * client recently enough that the room is not effectively abandoned. Bots
 * cannot drive the clock, and a room whose humans all left is dead regardless
 * of how many bot seats stayed.
 *
 * Pure over a room-shaped object and an injected `now`, so the rule tests
 * without a WebSocket and reads the same on the server (`onRequest`) and — in
 * principle — on any future client-side derivation.
 */

/**
 * How long the server may go without any inbound message before the room is
 * treated as abandoned. The client heartbeat pings every 15s (see
 * `flags/heartbeat.js`), so a room with anyone connected refreshes far inside
 * this window; the threshold's job is to catch the moment nobody is left.
 *
 * 60s comfortably straddles two heartbeat gaps — a single dropped ping does
 * not flicker a live room to dead — and is short enough that a stale room
 * discovered a few minutes after everyone gave up correctly answers "no".
 */
export const ROOM_STALE_MS = 60_000;

/**
 * Whether any human seat currently has a live socket in the room. Bots are
 * server-driven (`flags/partyBot.js`): they buzz, they score, they sit in
 * `present` — but they cannot host, cannot advance a phase, and cannot answer
 * the door for a returning human. A room with only bots present is empty for
 * every purpose that matters here.
 *
 * @param {{ seats: Map<string, { bot?: boolean }>, present: Set<string> }} room
 * @returns {boolean}
 */
export function anyHumanPresent(room) {
  for (const pid of room.present) {
    const seat = room.seats.get(pid);
    if (seat && seat.bot !== true) return true;
  }
  return false;
}

/**
 * @param {{ seats: Map<string, { bot?: boolean }>, present: Set<string>, lastActiveAt: number | null }} room
 * @param {number} now
 * @param {number} [staleMs]  overrides {@link ROOM_STALE_MS}, for tests and
 *   for surfaces that want a different tolerance.
 * @returns {boolean}
 */
export function isRoomAlive(room, now, staleMs = ROOM_STALE_MS) {
  if (room.lastActiveAt == null) return false;
  if (now - room.lastActiveAt > staleMs) return false;
  return anyHumanPresent(room);
}
