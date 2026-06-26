/**
 * Decide whether a quiz-finish should actually POST to
 * `/api/v1/quiz/record` (Feature S Phase 5).
 *
 * Pre-Phase-5 every finish (PB or not, give-up or not) hit the server.
 * That's ~5× more writes than the data demands — non-PB finishes only
 * bump `attempts` / `lastPlayedAt`.
 *
 * Decision policy:
 *
 *   - **All-time PB beat** → always push immediately. Personal-best
 *     display depends on the server seeing the new score.
 *   - **No real engagement** (zero picks of either kind) → skip. The
 *     attempts bump would represent a non-play; nothing should count it.
 *   - **Today-PB candidate** → push. This is the leaderboard-affecting
 *     case: a finish that the server's `mergeDailyLeaderboard` would
 *     write (first of the UTC day for this configKey, or beats the
 *     score we last saw the server accept). Without this gate, a
 *     non-all-time-PB finish on a niche config (e.g. oceania:all) gets
 *     dropped by the 30 min throttle and leaves the leaderboard
 *     looking empty even though the player just played. Cache lives in
 *     localStorage at `gridgame.quizDayBest:<configKey>`; we update it
 *     after a successful push and let it self-heal otherwise.
 *   - **Real non-PB finish** → throttle: push only if
 *     `PUSH_THROTTLE_MS` has elapsed since the last successful push,
 *     so a player chaining several rounds of the same variant only
 *     touches the server occasionally for the attempts counter bump.
 *
 * The `engaged` signal is computed once at the call site via
 * `flags/quizEngagement.js#madeAnyQuizPick` — same gate used by the
 * 60s day-log bump in `flagQuiz/page.js`. Centralising the
 * engagement check there means the two consumers can't drift apart
 * (which they did when this gate used `gaveUp` and the day-log gate
 * used pick count — pre-fix they disagreed in two of four cases).
 *
 * Net effect at hobby-site traffic: ~80-95% reduction in `quizRecords`
 * write volume vs pre-Phase-5. Adding the today-PB-candidate trigger
 * raises the push count slightly above the pure 30 min throttle, but
 * only for finishes that would change a leaderboard row server-side —
 * exactly the writes we don't want to drop.
 *
 * Trade-off: server's `attempts` counter (and the achievement counts
 * derived from it via `dailyMe`) lag actual plays by up to one
 * throttle window. "Played 100 rounds" type achievements trigger a
 * little later than the user's 100th real play. Acceptable per Jan's
 * "let's not worry about lost writes between phases" guidance — the
 * achievement still fires eventually.
 *
 * Pure decision + thin localStorage shim for the sentinel + per-config
 * day-best cache. Everything injected (no globals) so tests stay clean.
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
 * Prefix for the per-config "today's best score we believe the server
 * has" cache. One key per configKey the device has ever pushed for.
 */
export const DAY_BEST_KEY_PREFIX = 'gridgame.quizDayBest:';

/**
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} Store
 */

/**
 * @typedef {{ date: string, score: number, durationMs: number }} DayBest
 */

/**
 * UTC YYYY-MM-DD for `now`. Must match the server's
 * `dailyLeaderboardDoc.todayDateKey` exactly — the day-best cache only
 * works if the client and server agree on which UTC day a finish
 * lands in.
 *
 * @param {number} now
 * @returns {string}
 */
export function utcDateKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Score-then-time comparator matching the server's leaderboard ORDER BY.
 * Mirrors `api/src/lib/leaderboardRank.js#beats`. Inlined rather than
 * shared because the server is CommonJS under `api/` and the client is
 * ESM under `flags/` — cross-folder import would need a build step we
 * don't have. Kept as a private helper; the public surface is
 * `computeTodayPbCandidate`.
 *
 * @param {{ score: number, durationMs: number }} a
 * @param {{ score: number, durationMs: number }} b
 * @param {boolean} lowerWins
 * @returns {boolean}
 */
function beats(a, b, lowerWins) {
  if (lowerWins) {
    if (a.score < b.score) return true;
    if (a.score > b.score) return false;
  } else {
    if (a.score > b.score) return true;
    if (a.score < b.score) return false;
  }
  return a.durationMs < b.durationMs;
}

/**
 * Would this finish change today's row in `dailyLeaderboards`
 * server-side? True iff (a) we have no day-best for today yet (first
 * finish of the UTC day for this config — server will insert a row),
 * or (b) the finish beats the day-best we cached after the last
 * successful push (server will update its row).
 *
 * Cache miss / stale date are treated as candidates: a wasted push is
 * cheap, a missed leaderboard write is the bug we're fixing.
 *
 * @param {{
 *   dayBest: DayBest | null,
 *   entry: { score: number, durationMs: number },
 *   lowerWins: boolean,
 *   now: number,
 * }} args
 * @returns {boolean}
 */
export function computeTodayPbCandidate({ dayBest, entry, lowerWins, now }) {
  const today = utcDateKey(now);
  if (!dayBest || dayBest.date !== today) return true;
  return beats(entry, dayBest, lowerWins);
}

/**
 * Decide whether to fire the POST.
 *
 * `engaged` comes from `flags/quizEngagement.js#madeAnyQuizPick` at
 * the call site. `isTodayPbCandidate` comes from
 * `computeTodayPbCandidate` at the call site (which knows the
 * lookup + comparator inputs).
 *
 * @param {{
 *   engaged: boolean,
 *   isNew: boolean,
 *   isTodayPbCandidate: boolean,
 *   lastPushedAt: number,
 *   now: number,
 * }} args
 * @returns {boolean}
 */
export function shouldPushQuizRecord({ engaged, isNew, isTodayPbCandidate, lastPushedAt, now }) {
  // All-time PB beats: always push, regardless of throttle or
  // engagement. A player who gave up mid-round but still beat their
  // PB on the answered questions deserves the record.
  if (isNew) return true;

  // No real engagement (zero picks): skip. The server upsert would
  // only bump attempts/lastPlayedAt, and no achievement should count
  // a non-played round.
  if (!engaged) return false;

  // Today-PB candidate: push to keep the daily leaderboard correct.
  // This is the case the pure 30-min throttle previously dropped,
  // which caused empty leaderboards on niche configs (e.g. oceania-all)
  // when the player had recently pushed for some other config.
  if (isTodayPbCandidate) return true;

  // Real non-PB, non-leaderboard-affecting finish: throttle. Keeps the
  // server's attempts/lastPlayedAt counters moving for achievement
  // logic without flooding writes. Never-pushed (sentinel = 0) always
  // fires the first time so a brand-new device's first finish hits
  // the server.
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

/**
 * Read the per-config "today's best we believe the server has" cache.
 * Returns null on cache miss, malformed JSON, or any storage error —
 * `computeTodayPbCandidate` treats null as "first of day", which
 * forces a push that self-heals the cache on success.
 *
 * @param {Store} store
 * @param {string} configKey
 * @returns {DayBest | null}
 */
export function getQuizDayBest(store, configKey) {
  try {
    const raw = store.getItem(DAY_BEST_KEY_PREFIX + configKey);
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const obj = JSON.parse(raw);
    if (
      obj && typeof obj === 'object' &&
      typeof obj.date === 'string' &&
      typeof obj.score === 'number' &&
      typeof obj.durationMs === 'number'
    ) {
      return { date: obj.date, score: obj.score, durationMs: obj.durationMs };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Stamp the per-config day-best after a successful push that we
 * believe changed today's row. Best-effort (quota / private mode).
 *
 * @param {Store} store
 * @param {string} configKey
 * @param {DayBest} dayBest
 */
export function setQuizDayBest(store, configKey, dayBest) {
  try {
    store.setItem(DAY_BEST_KEY_PREFIX + configKey, JSON.stringify(dayBest));
  } catch { /* best-effort */ }
}
