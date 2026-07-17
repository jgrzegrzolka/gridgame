/**
 * Pure validator for the daily-result submission body. No DOM, no I/O —
 * the function handler stays a thin shell around this so tests cover the
 * rules without spinning up Azure Functions or Cosmos.
 *
 * Returns { ok: true } or { ok: false, error: 'reason_code' }. The error
 * codes are stable strings so the client can localize if it ever needs to.
 */

const { CONFIG_KEY_RE, CONFIG_KEY_MAX, maxScoreForConfigKey } = require('./quizRecordKey');
const { sanitizeNickname } = require('./sanitizeNickname');
const { isOffensiveNickname } = require('./blockedNicknames');

// A daily-puzzle answer can be any flag in the set, not just a 2-letter
// sovereign country. Since #724 let manual puzzles use non-sovereign flags,
// the codes a client legitimately submits also include:
//   - subdivisions / territories:  gb-eng, gb-sct, es-ct, sh-ac  (xx-yyy)
//   - supranational / org flags:    asean, cefta, eac, arab       (2-5 letters)
// Every code in flags/countries.json matches this; a stricter 2-letter-only
// gate rejected e.g. England (gb-eng) with 400 invalid_code, which killed the
// whole finish flow (no submit -> no stats, no missed-flags overlay). This is
// still a shape/bounds check, not a membership check (it always accepted
// non-existent combos like "zz" too).
const CODE_RE = /^[a-z]{2,5}(-[a-z]{2,3})?$/;

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
  //
  // QUIZ_SCORE_MAX is only a backstop now. The real cap is per-mode and comes
  // from `maxScoreForConfigKey` (time-derived for 60s, pool-derived for
  // endurance); validateQuizRecord takes the min of the two. This flat cap
  // used to be the ONLY gate, and at 1000 it accepted a scripted submission of
  // 189 correct answers in a 60-second round (2026-07-07) — which then earned
  // three skill badges. Note that a pool-based cap would not have helped: 189
  // is under the 195-flag `countries` pool. A 60s score is bounded by time.
  QUIZ_SCORE_MIN: 0,
  QUIZ_SCORE_MAX: 1000,
  // 60s mode caps the round at ~60s of wall clock; endurance "all" mode
  // can in theory run longer. 6h matches the daily-result cap and keeps
  // a single human-plausible upper bound across endpoints.
  QUIZ_DURATION_MS_MIN: 0,
  QUIZ_DURATION_MS_MAX: 6 * 60 * 60 * 1000,
  // Nickname display bounds (Feature H2). 1 chars after trim because empty
  // strings should be sent as `null` (the "clear my nickname" signal).
  // 32 chars upper: a wink at the programmer crowd (matches the Discord cap
  // and lots of common SQL VARCHAR conventions). Roomy enough for a name +
  // a tag. The leaderboard row ellipsises long names via `text-overflow:
  // ellipsis; white-space: nowrap` so even a max-length name renders
  // without busting the layout.
  NICKNAME_MIN: 1,
  NICKNAME_MAX: 32,
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
 * Optional identityId: when absent (undefined / null / empty) returns
 * `{ ok: true, value: null }` so callers can use the same `if (!v.ok)`
 * branch. When present, must match the deviceId shape (same length
 * bounds — both are UUID-or-similar opaque strings). Used by the
 * write endpoints that gained identityId support in Feature C phase 3.
 *
 * @param {unknown} raw
 * @param {string} fieldErrorCode
 */
function validateOptionalIdentityId(raw, fieldErrorCode) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
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
 *     score:         int, 0..maxScoreForConfigKey(configKey, durationMs)
 *                    (time-derived for 60s, pool-derived for endurance)
 *     durationMs:    int (0..6h),
 *     lowerWins:     boolean,
 *   }
 *
 * `lowerWins` is sent by the client (it already knows the mode) so the
 * server doesn't have to maintain its own mode-to-comparator table. The
 * tradeoff is a malicious caller can flip the comparator to write a worse
 * score over their personal-record row. Acceptable because only that one
 * device's record is affected. The Feature K daily-leaderboard write path
 * (`quizRecord.js`'s `writeDailyLeaderboardIfPb`) ignores this body field
 * and derives `lowerWins` from the configKey itself, so a flipped client
 * can't poison anyone else's ranking.
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
  if (!isInt(body.durationMs, LIMITS.QUIZ_DURATION_MS_MIN, LIMITS.QUIZ_DURATION_MS_MAX)) {
    return { ok: false, error: 'invalid_durationMs' };
  }
  // Score bound is per-mode, derived from the configKey + duration. The flat
  // 0..1000 cap this replaced accepted 189 correct answers in a 60-second
  // round (a real scripted submission, 2026-07-07 — the best human score on
  // record is 49), which then earned three skill badges. `durationMs` is
  // validated first because the 60s bound is derived from it.
  const maxScore = maxScoreForConfigKey(body.configKey, body.durationMs);
  if (maxScore === null) {
    // Mode we don't know how to bound. Refuse rather than fall back to a
    // permissive cap — an unbounded mode is exactly how the last one got in.
    return { ok: false, error: 'invalid_score' };
  }
  if (!isInt(body.score, LIMITS.QUIZ_SCORE_MIN, Math.min(LIMITS.QUIZ_SCORE_MAX, maxScore))) {
    return { ok: false, error: 'invalid_score' };
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

  // Step 1: strip / reject characters that have no display-name use.
  // Bidi overrides, zero-width chars, and control characters get
  // rejected outright; internal whitespace collapses to single spaces.
  const sanitised = sanitizeNickname(body.nickname);
  if (!sanitised.ok) {
    return { ok: false, error: sanitised.error };
  }
  const cleaned = sanitised.value;

  // Step 2: length on the cleaned string (collapsing might have shrunk
  // it; rejecting now means the client sees the same length the server
  // would have stored).
  if (cleaned.length < LIMITS.NICKNAME_MIN || cleaned.length > LIMITS.NICKNAME_MAX) {
    return { ok: false, error: 'invalid_nickname' };
  }

  // Step 3: soft moderation. Substring match against a curated EN + PL
  // blocklist; catches the common casual asshat, not a real anti-abuse
  // system. See blockedNicknames.js for documented limits.
  if (isOffensiveNickname(cleaned)) {
    return { ok: false, error: 'offensive_nickname' };
  }

  return { ok: true, value: { deviceId: body.deviceId, nickname: cleaned } };
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
// `9x9` is still accepted even though the 9×9 board was removed: a tab opened
// before the removal can still POST a result, and a 400 would be a worse
// answer than a quiet accept. `tttPairDoc.mergePairResult` ignores the result
// rather than counting it, so nothing lands in the 3×3 counters. Drop this
// once no such tab can plausibly still be open.
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

/**
 * Validate the `{configKey}` URL path param for the leaderboard GET. Uses
 * the same shape gate as the quizRecord writer (CONFIG_KEY_RE) so a
 * malicious caller can't ask for "../../" or a 10KB key. Returns
 * `{ ok: true, value: <string> }` or `{ ok: false, error: <code> }`.
 *
 * @param {unknown} raw
 */
function validateConfigKeyParam(raw) {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > CONFIG_KEY_MAX ||
    !CONFIG_KEY_RE.test(raw)
  ) {
    return { ok: false, error: 'invalid_configKey' };
  }
  return { ok: true, value: raw };
}

/**
 * Validate the body posted to `POST /api/v1/profile/requestDeletion`. Shape:
 *
 *   {
 *     deviceId: string (8..64),
 *   }
 *
 * The endpoint just sets `deletionRequestedAt` on the profile row — no
 * nickname, no other fields. Keeping the body minimal so a future "this
 * isn't actually my deviceId" check can be slotted in cleanly.
 */
function validateProfileDeletionBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_required' };
  if (!isString(body.deviceId, LIMITS.DEVICE_ID_MIN, LIMITS.DEVICE_ID_MAX)) {
    return { ok: false, error: 'invalid_deviceId' };
  }
  return { ok: true, value: { deviceId: body.deviceId } };
}

module.exports = { validateResult, validatePuzzleIdParam, validateQuizRecord, validateProfileBody, validateProfileDeletionBody, validateTttResultBody, validateDeviceIdParam, validateOptionalIdentityId, validateConfigKeyParam, LIMITS };
