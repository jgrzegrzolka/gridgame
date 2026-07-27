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
 * The reachability question ("did we get an answer?") and the aliveness
 * answer ("is the room still active?") are collapsed into one bool: any
 * failure to obtain a confident `true` reads as dead. That is the safe
 * direction — offering a resume that lands the returner in a bounce is worse
 * than hiding one they could have taken.
 */

/**
 * The minimal shape of the fetch response the probe reads — narrower than the
 * platform `Response`, so tests can hand in a plain object without staging a
 * full `Response`.
 * @typedef {{ ok: boolean, json(): Promise<any> }} ProbeResponse
 * @typedef {(url: string, init?: { cache?: string }) => Promise<ProbeResponse>} ProbeFetch
 */

/**
 * @param {string} url  the full probe URL, including the room code path
 *   segment (e.g. built from `httpServerUrlFor(hostname, 'party') + code`).
 * @param {ProbeFetch} fetchImpl  the fetch implementation to use; injected
 *   so the rule is testable without a network.
 * @returns {Promise<boolean>}  true iff the server confirmed the room alive.
 */
export async function probeRoomAlive(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.alive === true;
  } catch {
    return false;
  }
}
