/**
 * Server-side shape gate for quiz-record configKey strings.
 *
 * The client builds these in flags/quizRecordConfigKey.js as
 * `"<variant>:<mode>:<sov|all>"`. The server doesn't enumerate the known
 * variants/modes (so we don't have to redeploy the API every time a new
 * variant ships in the client) — it just enforces a tight shape + length
 * cap so a malicious caller can't smuggle a 10KB key into the doc.
 *
 * If the client-side join ever changes shape, update CONFIG_KEY_RE in
 * lockstep.
 *
 * Length cap of 40 chars: real keys top out around 22
 * ("south-america:60s:sov"); 40 leaves headroom for one more variant
 * naming the longest continent we'd ever realistically add.
 */

const CONFIG_KEY_RE = /^[a-z0-9-]{1,20}:[a-z0-9-]{1,10}:(sov|all)$/;
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
 * @param {string} configKey
 * @returns {boolean | null}
 */
function lowerWinsFromConfigKey(configKey) {
  const parts = String(configKey).split(':');
  if (parts.length !== 3) return null;
  const mode = parts[1];
  if (mode === '60s') return false;
  if (mode === 'all') return true;
  return null;
}

module.exports = { CONFIG_KEY_RE, CONFIG_KEY_MAX, lowerWinsFromConfigKey };
