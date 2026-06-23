/**
 * Decide whether a quiz-finish should actually POST to
 * `/api/v1/quiz/record` (Feature S Phase 5).
 *
 * Pre-Phase-5 every finish (PB or not, give-up or not) hit the server.
 * That's ~5× more writes than the data demands — non-PB finishes only
 * bump `attempts` / `lastPlayedAt`, and give-ups bump fields nobody
 * consumes for achievements.
 *
 * Decision policy:
 *
 *   - **PB beat** → always push immediately. Daily leaderboard +
 *     personal-best display depend on the server seeing the new score.
 *   - **Give-up, no PB** → skip. Score is partial / zero, no
 *     achievement consumes the bump, no point paying for the write.
 *   - **Legitimate non-PB finish** → throttle: push only if
 *     `PUSH_THROTTLE_MS` has elapsed since the last successful push,
 *     so a player chaining several rounds of the same variant only
 *     touches the server occasionally.
 *
 * Net effect at hobby-site traffic: ~80-95% reduction in `quizRecords`
 * write volume. At 50k DAU it's the difference between ~1.2 writes/sec
 * sustained and ~0.1 writes/sec — both well within free-tier headroom,
 * but the lower number gives much more headroom for spikes.
 *
 * Trade-off: server's `attempts` counter (and the achievement counts
 * derived from it via `dailyMe`) lag actual plays by up to one
 * throttle window. "Played 100 rounds" type achievements trigger a
 * little later than the user's 100th real play. Acceptable per Jan's
 * "let's not worry about lost writes between phases" guidance — the
 * achievement still fires eventually.
 *
 * Pure decision + thin localStorage shim for the sentinel. Everything
 * injected (no globals) so tests stay clean.
 */

/**
 * Window between successful pushes for non-PB finishes. 30 minutes
 * matches the Phase 4.5 engagement-push throttle so a player who
 * chains a coffee click + a few quiz rounds in one sitting only
 * touches the server roughly once.
 */
export const PUSH_THROTTLE_MS = 30 * 60 * 1000;

/**
 * localStorage key for the sentinel. Unix-ms of last successful
 * push; 0 / missing means "never pushed".
 */
export const SENTINEL_KEY = 'gridgame.quizRecordPushedAt';

/**
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} Store
 */

/**
 * Decide whether to fire the POST.
 *
 * @param {{
 *   gaveUp: boolean,
 *   isNew: boolean,
 *   lastPushedAt: number,
 *   now: number,
 * }} args
 * @returns {boolean}
 */
export function shouldPushQuizRecord({ gaveUp, isNew, lastPushedAt, now }) {
  // PB beats are the only path that gates the daily leaderboard +
  // personal-best display. Always push them, regardless of throttle
  // or give-up status — a player who gave up mid-round but still
  // beat their PB on the answered questions deserves the record.
  if (isNew) return true;

  // Non-PB give-up: skip. The local PB bookkeeping already happened
  // client-side; the server upsert would only bump attempts/
  // lastPlayedAt, and we're not paying RU for a half-played round
  // that no achievement counts.
  if (gaveUp) return false;

  // Legitimate non-PB finish: throttle. Never-pushed (sentinel = 0)
  // always fires the first time so a brand-new device's first finish
  // hits the server.
  if (lastPushedAt <= 0) return true;
  return (now - lastPushedAt) >= PUSH_THROTTLE_MS;
}

/**
 * Read the last-pushed timestamp from localStorage. Returns 0 on any
 * failure or malformed value — same semantic as "never pushed", which
 * is the right default (next call fires).
 *
 * @param {Store} store
 * @returns {number}
 */
export function getLastQuizRecordPushedAt(store) {
  try {
    const raw = store.getItem(SENTINEL_KEY);
    if (typeof raw !== 'string' || raw.length === 0) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Stamp the sentinel after a successful push. Best-effort — a quota /
 * private-mode failure just means the next finish fires another push
 * sooner than 30 min, which is harmless.
 *
 * @param {Store} store
 * @param {number} now
 */
export function markQuizRecordPushed(store, now) {
  try { store.setItem(SENTINEL_KEY, String(now)); } catch { /* best-effort */ }
}
