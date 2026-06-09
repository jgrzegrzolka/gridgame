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

module.exports = { CONFIG_KEY_RE, CONFIG_KEY_MAX };
