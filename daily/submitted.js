/**
 * Tracks which daily puzzles this browser has already POSTed to the
 * server. Stored as a sorted JSON array of integers under
 * `localStorage.gridgame.submittedPuzzles` — a set semantically, an
 * array on the wire because Sets don't JSON.stringify.
 *
 * Why this exists separately from scores.js:
 * The server stores only the player's *first* attempt per puzzle
 * (`dailyResult` 409s on duplicate `(puzzleId, deviceId)`) — that's
 * what keeps the "top X% got everything" stat honest. Replays must
 * still update the local score (players replay to learn) but must
 * NOT re-POST. This module is the gate: the client checks
 * `hasSubmitted(store, n)` before posting and marks the puzzle with
 * `markSubmitted(store, n)` on any 204 or 409 response.
 *
 * Why a separate localStorage key instead of piggybacking on the
 * scores.js record: orthogonal concerns. Submission state isn't the
 * player's score and shouldn't be at risk of being lost the next
 * time we extend the score schema.
 */

const STORAGE_KEY = 'gridgame.submittedPuzzles';

/**
 * @param {{ getItem(key: string): string | null }} store
 * @returns {Set<number>}
 */
function loadSet(store) {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set();
    for (const x of parsed) {
      if (Number.isInteger(x) && x >= 1) out.add(x);
    }
    return out;
  } catch {
    return new Set();
  }
}

/**
 * @param {{ getItem(key: string): string | null }} store
 * @param {number} n
 * @returns {boolean}
 */
export function hasSubmitted(store, n) {
  if (!Number.isInteger(n) || n < 1) return false;
  return loadSet(store).has(n);
}

/**
 * Idempotent — marking an already-submitted puzzle is a no-op.
 *
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} store
 * @param {number} n
 */
export function markSubmitted(store, n) {
  if (!Number.isInteger(n) || n < 1) return;
  try {
    const set = loadSet(store);
    if (set.has(n)) return;
    set.add(n);
    const sorted = [...set].sort((a, b) => a - b);
    store.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // localStorage may throw in private mode / zero quota — silent degrade.
    // The cost of a missed mark is one duplicate POST that the server 409s.
  }
}
