/**
 * Room-lobby networking primitives shared by every PartyKit-backed game on the
 * site — tic-tac-toe (3×3 and 9×9) and Flag Party. These are domain-agnostic:
 * a room code, its validation, and the WebSocket URL for a given host + party.
 *
 * Promoted here from `ticTacToe/onlineClient.js` when Flag Party arrived as the
 * second (non-TTT) consumer — per CLAUDE.md, shared code moves to `flags/` once
 * a real second consumer exists, rather than being cross-imported from another
 * feature folder. `ticTacToe/onlineClient.js` re-exports these so its own
 * callers are unchanged.
 */

/** Alphabet for room codes — no ambiguous characters (no I/O/L/0/1). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_LEN = 5;

const ROOM_CODE_RE = /^[A-Z0-9]{5}$/;

/**
 * @param {() => number} [rng]
 * @returns {string}
 */
export function generateCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < ROOM_LEN; i++) {
    code += ROOM_ALPHABET[Math.floor(rng() * ROOM_ALPHABET.length)];
  }
  return code;
}

/**
 * Cheap surface check — the server is the real authority on whether a code
 * corresponds to an existing room. This just keeps the lobby UI from sending
 * garbage and gives a friendlier error than waiting for a connection failure.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  return ROOM_CODE_RE.test(code);
}

/** Production hostnames that should hit the deployed PartyKit. */
const PROD_HOSTNAMES = new Set([
  'jgrzegrzolka.github.io',
  'yetanotherquiz.com',
  'www.yetanotherquiz.com',
]);

/**
 * Which WebSocket URL the client should connect to.
 * The deployed site (GitHub Pages or the custom domain) goes to the
 * Cloudflare-hosted PartyKit. Anywhere else (localhost, 127.0.0.1, LAN IPs
 * like 192.168.x.x when you open the dev server from another device)
 * connects to a partykit dev server running on port 1999 on the same host.
 *
 * `party` selects which PartyKit party class handles the room — 'main' for
 * the 3×3 server, 'ultimate' for the 9×9 server, 'party' for Flag Party.
 * Rooms in different parties don't share state, so the same room code can
 * exist in more than one.
 *
 * @param {string} hostname
 * @param {string} [party]
 * @returns {string}
 */
export function serverUrlFor(hostname, party = 'main') {
  if (PROD_HOSTNAMES.has(hostname)) {
    return `wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/${party}/`;
  }
  return `ws://${hostname}:1999/parties/${party}/`;
}
