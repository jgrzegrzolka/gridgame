/**
 * Server-side shape gate for quiz-record configKey strings.
 *
 * The client builds these in flags/quizRecordConfigKey.js. The server
 * doesn't enumerate the known variants/modes (so we don't have to redeploy
 * the API every time a new variant ships in the client) — it just enforces
 * a tight shape + length cap so a malicious caller can't smuggle a 10KB key
 * into the doc. That deliberate blindness is why Feature V's `weird` /
 * `outlines` / `facts` decks record with no change here beyond this shape.
 *
 * TWO SHAPES ARE ACCEPTED, on purpose (Feature V Phase 1a):
 *   "<variant>:<mode>"           — current. The pool is always sovereign.
 *   "<variant>:<mode>:<sov|all>" — legacy, pre-Feature-V.
 *
 * The scope segment existed only for the "include territories" toggle,
 * which Feature V replaced with a separate `weird` deck. It is optional
 * rather than gone because a browser holding cached JS keeps POSTing the
 * 3-part shape for as long as its cache lives — rejecting those would drop
 * real finishes on the floor for no benefit. Phase 1c renames the stored
 * `:sov` keys and drops the `:all` ones; this regex can lose the optional
 * group once no client emits it.
 *
 * If the client-side join ever changes shape, update CONFIG_KEY_RE in
 * lockstep.
 *
 * Length cap of 40 chars: real keys top out around 22
 * ("south-america:60s:sov"); 40 leaves headroom for one more variant
 * naming the longest continent we'd ever realistically add.
 */

const CONFIG_KEY_RE = /^[a-z0-9-]{1,20}:[a-z0-9-]{1,10}(:(sov|all))?$/;
const CONFIG_KEY_MAX = 40;

/**
 * Derive `lowerWins` (the comparator direction) from a configKey's mode
 * segment. This is the server-trusted derivation: the leaderboard read
 * endpoint can't accept `lowerWins` from a query param without letting a
 * caller flip a competitor's ranking, so we re-derive from the configKey
 * the client already used to write.
 *
 *   '60s' (timed)      → false  // more correct wins
 *   'all' (endurance)  → true   // fewer mistakes wins
 *
 * Returns `null` for any other mode token — defensive against a new mode
 * shipping client-side without this map being updated. The endpoint
 * rejects null as `unknown_mode` so the missed wiring is caught loudly
 * rather than silently ranking the wrong direction.
 *
 * Accepts both configKey shapes (see CONFIG_KEY_RE). Mode sits at index 1
 * either way, so only the length gate cares.
 *
 * @param {string} configKey
 * @returns {boolean | null}
 */
function lowerWinsFromConfigKey(configKey) {
  const parts = String(configKey).split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const mode = parts[1];
  if (mode === '60s') return false;
  if (mode === 'all') return true;
  return null;
}

/**
 * Sustained answers-per-second a 60s round could conceivably produce. The best
 * real score in prod is 49 in a full 60 s (0.82/s), so this is ~2.4x the human
 * record — loose enough that no player can ever trip it, tight enough that a
 * physically impossible submission can't land.
 */
const MAX_ANSWERS_PER_SECOND = 2;

/**
 * Ceiling for a `count`-mode (endurance) score. That score is a MISTAKE count,
 * and `flagQuiz/page.js` re-deals a fresh 4-flag set after each wrong pick,
 * which keeps mistakes <= target; `targetFor` caps target at the pool size.
 * The largest pool is `countries` at 195, so 250 is the pool ceiling plus
 * headroom. Deliberately NOT a per-variant lookup: this module doesn't
 * enumerate variants (that's what lets new decks ship without an API deploy),
 * and this is a sanity bound, not a business rule. Bump it only if a deck ever
 * exceeds ~250 flags.
 */
const MAX_COUNT_MODE_SCORE = 250;

/**
 * Largest score this (configKey, durationMs) could legitimately produce, or
 * `null` if the shape/mode is unknown (the caller rejects those).
 *
 * The two modes are bounded by different physics, and getting this wrong is
 * how a scripted submission stored **189 correct answers in a 60-second
 * round** on 2026-07-07 and collected three skill badges from it. The old gate
 * was a flat `0..1000`. Note a pool-based cap would NOT have caught it: 189 is
 * under the 195-flag `countries` pool. A 60s score is bounded by TIME.
 *
 *   - `60s` (timed): you cannot answer more questions than you can get
 *     through. Scales with the clock, so a round that ended early bounds
 *     lower, and a future timed mode with a different budget needs no change
 *     here.
 *   - `all` (count): runs for as long as it takes, so time says nothing.
 *     Bounded by the pool instead.
 *
 * @param {string} configKey
 * @param {number} durationMs
 * @returns {number | null}
 */
function maxScoreForConfigKey(configKey, durationMs) {
  const parts = String(configKey).split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const mode = parts[1];
  if (mode === '60s') return Math.ceil((durationMs / 1000) * MAX_ANSWERS_PER_SECOND);
  if (mode === 'all') return MAX_COUNT_MODE_SCORE;
  return null;
}

module.exports = {
  CONFIG_KEY_RE,
  CONFIG_KEY_MAX,
  lowerWinsFromConfigKey,
  maxScoreForConfigKey,
  MAX_ANSWERS_PER_SECOND,
  MAX_COUNT_MODE_SCORE,
};
