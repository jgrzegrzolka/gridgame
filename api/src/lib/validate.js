/**
 * Pure validator for the daily-result submission body. No DOM, no I/O —
 * the function handler stays a thin shell around this so tests cover the
 * rules without spinning up Azure Functions or Cosmos.
 *
 * Returns { ok: true } or { ok: false, error: 'reason_code' }. The error
 * codes are stable strings so the client can localize if it ever needs to.
 */

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

module.exports = { validateResult, validatePuzzleIdParam, LIMITS };
