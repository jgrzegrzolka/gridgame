/**
 * Pure validator for the daily-result submission body. No DOM, no I/O —
 * the function handler stays a thin shell around this so tests cover the
 * rules without spinning up Azure Functions or Cosmos.
 *
 * Returns { ok: true } or { ok: false, error: 'reason_code' }. The error
 * codes are stable strings so the client can localize if it ever needs to.
 */

const { CONFIG_KEY_RE, CONFIG_KEY_MAX } = require('./quizRecordKey');

const CODE_RE = /^[a-z]{2}$/;

const LIMITS = {
  PUZZLE_ID_MIN: 1,
  PUZZLE_ID_MAX: 9999,
  COUNT_MIN: 1,
  COUNT_MAX: 50,
  DURATION_MS_MIN: 1000,
  DURATION_MS_MAX: 6 * 60 * 60 * 1000,
  DEVICE_ID_MIN: 8,
  DEVICE_ID_MAX: 64,
  // Quiz-record bounds. Score-min of 0 covers "60s round, zero correct"
  // and "endurance round, zero mistakes" — both legitimate end states.
  // Score-max of 1000 leaves headroom past any plausible pool size
  // (largest variant is ~250 sovereign countries; ~500 with territories).
  QUIZ_SCORE_MIN: 0,
  QUIZ_SCORE_MAX: 1000,
  // 60s mode caps the round at ~60s of wall clock; endurance "all" mode
  // can in theory run longer. 6h matches the daily-result cap and keeps
  // a single human-plausible upper bound across endpoints.
  QUIZ_DURATION_MS_MIN: 0,
  QUIZ_DURATION_MS_MAX: 6 * 60 * 60 * 1000,
  // Nickname display bounds (Feature H2). 1 chars after trim because empty
  // strings should be sent as `null` (the "clear my nickname" signal).
  // 24 chars upper because that's enough for a real name + a short tag
  // and still fits the burger panel layout without wrapping.
  NICKNAME_MIN: 1,
  NICKNAME_MAX: 24,
};

function isInt(x, min, max) {
  return Number.isInteger(x) && x >= min && x <= max;
}

function isString(x, min, max) {
  return typeof x === 'string' && x.length >= min && x.length <= max;
}

function validateResult(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };

  if (!isInt(body.puzzleId, LIMITS.PUZZLE_ID_MIN, LIMITS.PUZZLE_ID_MAX)) {
    return { ok: false, error: 'invalid_puzzleId' };
  }
  if (!isInt(body.totalCount, LIMITS.COUNT_MIN, LIMITS.COUNT_MAX)) {
    return { ok: false, error: 'invalid_totalCount' };
  }
  if (!isInt(body.durationMs, LIMITS.DURATION_MS_MIN, LIMITS.DURATION_MS_MAX)) {
    return { ok: false, error: 'invalid_durationMs' };
  }
  if (!isString(body.deviceId, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: 'invalid_deviceId' };
  }
  if (!Array.isArray(body.foundCodes)) {
    return { ok: false, error: 'invalid_foundCodes' };
  }
  if (body.foundCodes.length > body.totalCount) {
    return { ok: false, error: 'too_many_codes' };
  }
  for (const code of body.foundCodes) {
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return { ok: false, error: 'invalid_code' };
    }
  }
  if (new Set(body.foundCodes).size !== body.foundCodes.length) {
    return { ok: false, error: 'duplicate_codes' };
  }

  // wrongCodes is OPTIONAL — older cached clients during a deploy
  // window won't send it. New clients always send (empty array if
  // the player gave up without typing anything wrong). When present,
  // same shape rules as foundCodes: 2-letter codes, deduped. No
  // length cap — a determined player could type many wrong real
  // countries (~250 sovereign + territories), but the body validator
  // doesn't need an explicit upper bound because the foundCodes
  // total cap (50) doesn't apply here.
  if (body.wrongCodes !== undefined) {
    if (!Array.isArray(body.wrongCodes)) {
      return { ok: false, error: 'invalid_wrongCodes' };
    }
    for (const code of body.wrongCodes) {
      if (typeof code !== 'string' || !CODE_RE.test(code)) {
        return { ok: false, error: 'invalid_wrong_code' };
      }
    }
    if (new Set(body.wrongCodes).size !== body.wrongCodes.length) {
      return { ok: false, error: 'duplicate_wrong_codes' };
    }
  }

  return { ok: true };
}

/**
 * Validate a single `deviceId`-shaped query parameter (8..64 char string).
 * Used by the read endpoints (`GET /api/v1/profile`, `GET /api/v1/ttt/result`)
 * to check the `id`, `deviceId`, or `opponentId` query before issuing a
 * point read against Cosmos. Returns `{ ok: true, value: <string> }` or
 * `{ ok: false, error: <code> }`.
 *
 * @param {unknown} raw
 * @param {string} fieldErrorCode  - what to return as `error` on failure
 *   (e.g. 'invalid_id', 'invalid_deviceId', 'invalid_opponentId') so the
 *   handler doesn't need to remap codes.
 */
function validateDeviceIdParam(raw, fieldErrorCode) {
  if (!isString(raw, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: fieldErrorCode };
  }
  return { ok: true, value: raw };
}

/**
 * Parse + validate the `{puzzleId}` URL path param for the stats GET.
 * Returns `{ ok: true, value: <int> }` or `{ ok: false, error: <code> }`.
 * The error code is stable for the client (matches the body validator
 * style) so the handler can pass it straight through to the response.
 *
 * @param {unknown} raw
 */
function validatePuzzleIdParam(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'invalid_puzzleId' };
  }
  const n = Number(raw);
  if (!isInt(n, LIMITS.PUZZLE_ID_MIN, LIMITS.PUZZLE_ID_MAX)) {
    return { ok: false, error: 'invalid_puzzleId' };
  }
  return { ok: true, value: n };
}

/**
 * Validate the body posted to /api/v1/quiz/record. Shape:
 *
 *   {
 *     deviceId:      string (8..64),
 *     configKey:     string (matches CONFIG_KEY_RE, length ≤ CONFIG_KEY_MAX),
 *     score:         int (0..1000),
 *     durationMs:    int (0..6h),
 *     lowerWins:     boolean,
 *   }
 *
 * `lowerWins` is sent by the client (it already knows the mode) so the
 * server doesn't have to maintain its own mode-to-comparator table. The
 * tradeoff is a malicious caller can flip the comparator to write a worse
 * score over a better one — acceptable because (a) only that one device's
 * record is affected, (b) there's no leaderboard reading this yet.
 *
 * `turnstileToken` is NOT required here (see CLAUDE.md: rate limiter alone
 * for v1 of this endpoint; revisit if abuse shows up).
 */
function validateQuizRecord(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };

  if (!isString(body.deviceId, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: 'invalid_deviceId' };
  }
  if (
    typeof body.configKey !== 'string' ||
    body.configKey.length > CONFIG_KEY_MAX ||
    !CONFIG_KEY_RE.test(body.configKey)
  ) {
    return { ok: false, error: 'invalid_configKey' };
  }
  if (!isInt(body.score, LIMITS.QUIZ_SCORE_MIN, LIMITS.QUIZ_SCORE_MAX)) {
    return { ok: false, error: 'invalid_score' };
  }
  if (!isInt(body.durationMs, LIMITS.QUIZ_DURATION_MS_MIN, LIMITS.QUIZ_DURATION_MS_MAX)) {
    return { ok: false, error: 'invalid_durationMs' };
  }
  if (typeof body.lowerWins !== 'boolean') {
    return { ok: false, error: 'invalid_lowerWins' };
  }
  return { ok: true };
}

/**
 * Validate the body posted to `PUT /api/v1/profile`. Shape:
 *
 *   {
 *     deviceId: string (8..64),
 *     nickname: null | string (1..NICKNAME_MAX after trim),
 *   }
 *
 * `null` is the explicit "clear my nickname" signal — the row stays in
 * Cosmos (so createdAt is preserved across a clear/set cycle), but the
 * stored value goes back to null. Display-side code already treats
 * `nickname == null` as "anonymous device".
 *
 * The trimmed string is returned in `value` so the handler doesn't have
 * to re-trim before writing; reduces the risk of "validated against the
 * trimmed length but stored the untrimmed value" drift.
 *
 * Per FEATURE.md: no character / charset / uniqueness restrictions —
 * nicknames are display-only and may collide. Moderation is out of
 * scope until profanity / impersonation become real problems.
 */
function validateProfileBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };

  if (!isString(body.deviceId, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: 'invalid_deviceId' };
  }

  if (body.nickname === null) {
    return { ok: true, value: { deviceId: body.deviceId, nickname: null } };
  }
  if (typeof body.nickname !== 'string') {
    return { ok: false, error: 'invalid_nickname' };
  }
  const trimmed = body.nickname.trim();
  if (trimmed.length < LIMITS.NICKNAME_MIN || trimmed.length > LIMITS.NICKNAME_MAX) {
    return { ok: false, error: 'invalid_nickname' };
  }
  return { ok: true, value: { deviceId: body.deviceId, nickname: trimmed } };
}

/**
 * Validate the body posted to `POST /api/v1/ttt/result`. Shape:
 *
 *   {
 *     deviceId:   string (8..64),
 *     opponentId: string (8..64),
 *     mode:       "3x3" | "9x9",
 *     outcome:    "win" | "loss" | "draw",
 *   }
 *
 * Squashes give-up cases into win/loss at the client — Feature G doesn't
 * track the give-up distinction (intentional simplification). `deviceId`
 * must differ from `opponentId` since a player can't play themselves online.
 *
 * Returns `{ ok: true, value: { deviceId, opponentId, mode, outcome } }`
 * on success so the handler doesn't have to re-extract the trusted fields.
 */
const TTT_MODES = new Set(['3x3', '9x9']);
const TTT_OUTCOMES = new Set(['win', 'loss', 'draw']);

function validateTttResultBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };
  if (!isString(body.deviceId, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: 'invalid_deviceId' };
  }
  if (!isString(body.opponentId, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: 'invalid_opponentId' };
  }
  if (body.deviceId === body.opponentId) {
    return { ok: false, error: 'self_match' };
  }
  if (typeof body.mode !== 'string' || !TTT_MODES.has(body.mode)) {
    return { ok: false, error: 'invalid_mode' };
  }
  if (typeof body.outcome !== 'string' || !TTT_OUTCOMES.has(body.outcome)) {
    return { ok: false, error: 'invalid_outcome' };
  }
  return {
    ok: true,
    value: {
      deviceId: body.deviceId,
      opponentId: body.opponentId,
      mode: body.mode,
      outcome: body.outcome,
    },
  };
}

module.exports = { validateResult, validatePuzzleIdParam, validateQuizRecord, validateProfileBody, validateTttResultBody, validateDeviceIdParam, LIMITS };
