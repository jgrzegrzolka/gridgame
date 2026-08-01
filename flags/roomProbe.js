/**
 * Ask the party server whether a room is worth resuming, without opening a
 * WebSocket. The client uses this to decide whether to paint the "resume the
 * room you were in" shortcut on the start screen — the device remembers a
 * room code for up to six hours, but by then the room may have emptied out.
 *
 * The corresponding handler is `onRequest` on `party/partyGameServer.js`. Body
 * shape from the server: `{ alive: boolean, playerCount: number, phase:
 * string | null }`. Only `alive` is read here; the others exist for future
 * captions and for eyeballing with `curl`.
 *
 * ## Why this returns three states and not a boolean
 *
 * "Did we get an answer?" and "is the room alive?" are different questions,
 * and this used to collapse them into one bool: anything short of a confident
 * `true` read as dead. That is the right call for HIDING the button — offering
 * a resume that lands the returner in a bounce is worse than hiding one they
 * could have taken.
 *
 * It is the wrong call for FORGETTING the room, which is what the caller also
 * did with the same bool. A cold PartyKit start, a dropped request or a CORS
 * hiccup would answer "not alive" for a room that was perfectly fine and full
 * of the player's friends — and the caller would erase the stored code, so no
 * later visit could recover it. An uncertain signal was driving an irreversible
 * action.
 *
 * So: `'dead'` means the server said so and can be acted on destructively;
 * `'unknown'` means we never got a trustworthy answer and only justifies
 * hiding, which the next paint can undo.
 */

/**
 * The minimal shape of the fetch response the probe reads — narrower than the
 * platform `Response`, so tests can hand in a plain object without staging a
 * full `Response`.
 * @typedef {{ ok: boolean, json(): Promise<any> }} ProbeResponse
 * @typedef {(url: string, init?: { cache?: string }) => Promise<ProbeResponse>} ProbeFetch
 * @typedef {'alive' | 'dead' | 'unknown'} RoomProbeStatus
 */

/**
 * @param {string} url  the full probe URL, including the room code path
 *   segment (e.g. built from `httpServerUrlFor(hostname, 'party') + code`).
 * @param {ProbeFetch} fetchImpl  the fetch implementation to use; injected
 *   so the rule is testable without a network.
 * @returns {Promise<RoomProbeStatus>}  `'alive'` / `'dead'` only when the
 *   server actually said so; `'unknown'` for every failure to obtain a
 *   trustworthy answer (unreachable, non-2xx, unparseable, or a body without
 *   an `alive` boolean).
 */
export async function probeRoomStatus(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    // A non-2xx is the server failing to answer, not the room answering "no".
    if (!res.ok) return 'unknown';
    const body = await res.json();
    if (!body || typeof body.alive !== 'boolean') return 'unknown';
    return body.alive ? 'alive' : 'dead';
  } catch {
    // Unreachable, or a body that would not parse. Either way we learned
    // nothing about the room.
    return 'unknown';
  }
}
