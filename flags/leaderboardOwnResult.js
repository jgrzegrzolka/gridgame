/**
 * Fold the round you have just finished into the leaderboard the server
 * sent back.
 *
 * The finish screen announces a new personal best and then, a beat later,
 * paints a board fetched from the server. Those two numbers came from
 * different places and could disagree: the board would say 51 while the
 * line above it said you had just scored 53. The write does go out (a PB
 * always pushes, see `quizRecordThrottle`), but "already written" and
 * "visible in the next read" are not the same claim — the read is a
 * rolling-window aggregate and can be served from cache, and either way
 * the player is looking at the screen before the round trip has settled.
 *
 * So the client patches what it knows: your own row shows the result you
 * are being congratulated for. Everyone else's rows are the server's word,
 * untouched.
 *
 * Pure — takes the fetched payload, returns a new one.
 */

import { beats } from './leaderboardRank.js';

/**
 * @typedef {{ deviceId: string, nickname: string | null, score: number, durationMs: number }} Row
 * @typedef {{ rank: number, score: number, durationMs: number }} SelfRow
 * @typedef {{ top?: Row[], you?: SelfRow | null }} Payload
 */

/**
 * Return `data` with the caller's own row upgraded to `{ score, durationMs }`
 * where that result outranks what the server reported.
 *
 * Only ever an upgrade. If the server's row is already better — a stronger
 * round earlier in the window, which is exactly what a 7-day board holds —
 * it stays, because the board shows your best in the window and not your
 * latest.
 *
 * Rows are re-sorted **only if a row actually changed**, and with a stable
 * sort, so a result that doesn't move you keeps the server's order intact
 * (including how it broke ties). A result that does move you rises to the
 * position it earns among the rows on screen; leaving it in place would
 * print a row above a worse one and make the ranking look broken.
 *
 * `you` — the out-of-top-ten self row — gets the same upgrade but keeps its
 * rank. We know your new score; we cannot know how many strangers it jumped
 * you past, and inventing a rank would be a worse lie than a stale one. The
 * next fetch settles it.
 *
 * @param {{
 *   data: Payload | null | undefined,
 *   deviceId: string | null,
 *   score: number,
 *   durationMs: number,
 *   lowerWins?: boolean,
 * }} args
 * @returns {Payload | null | undefined}
 */
export function withOwnResult({ data, deviceId, score, durationMs, lowerWins = false }) {
  if (!data || !deviceId || !Number.isFinite(score) || !Number.isFinite(durationMs)) return data;

  const fresh = { score, durationMs };
  const top = Array.isArray(data.top) ? data.top : [];

  let patched = false;
  const nextTop = top.map((row) => {
    if (!row || row.deviceId !== deviceId) return row;
    if (!beats(fresh, { score: row.score, durationMs: row.durationMs }, lowerWins)) return row;
    patched = true;
    return { ...row, score, durationMs };
  });

  if (patched) {
    // Stable by spec (ES2019), which is what keeps "no rank change" meaning
    // "no visible change" rather than "the same rows in some other order".
    nextTop.sort((a, b) => {
      if (beats(a, b, lowerWins)) return -1;
      if (beats(b, a, lowerWins)) return 1;
      return 0;
    });
  }

  const you = data.you ?? null;
  const nextYou = (you && beats(fresh, { score: you.score, durationMs: you.durationMs }, lowerWins))
    ? { ...you, score, durationMs }
    : you;

  return { ...data, top: nextTop, you: nextYou };
}
