/**
 * Pure builder for the Cosmos document we insert into `engagementEvents`
 * when a player fires an engagement event (a share, a custom-puzzle play,
 * a daily-puzzle start). One container holds three event `kind`s; the id
 * scheme and the payload shape are per-kind, validated here.
 *
 * Container shape (from FEATURE.md Feature M Part B):
 *   container:  engagementEvents
 *   partition:  /deviceId
 *   TTL:        31_536_000 (1 year, matches dailyResults)
 *   throughput: autoscale 100–1000 RU/s
 *
 * Doc shape:
 *   {
 *     id,           per-kind scheme below
 *     deviceId,     partition key
 *     kind,         'daily_start' | 'findflag_play' | 'share'
 *     dayId,        warsawDayNumber (integer) — matches streakCompute's axis
 *     occurredAt,   ms since epoch
 *     payload,      tagged union, per-kind shape below
 *     local?,       only present when caller passes local: true
 *     v: 1
 *   }
 *
 * Per-kind id schemes:
 *   daily_start:   "daily_start:{dayId}:{puzzleId}"   — deterministic
 *                  (one fire per device/day/puzzle; 409 is the natural
 *                  "already recorded" guard).
 *   findflag_play: "findflag_play:{uuid}"             — non-deterministic
 *                  (multiple custom-puzzle plays per day are distinct).
 *   share:         "share:{uuid}"                      — non-deterministic
 *                  (multiple shares per day are distinct).
 *   quiz_play:     "quiz_play:{dayId}:{mode}"          — deterministic
 *                  (one row per device/day/mode; 409 is idempotent
 *                  when the player plays the same mode again on the
 *                  same day. Drives the 60s-streak achievements via
 *                  engagementStreakCompute.)
 *
 * Per-kind payload contracts:
 *   daily_start:   { puzzleId: number }
 *   findflag_play: { filter: string, mode: 'random' | 'custom' }
 *   share:         { surface: 'daily'|'findflag'|'flagquiz'|'ttt',
 *                    contextHint?: string }
 *   quiz_play:     { mode: '60s' | 'all' }
 *
 * Unknown payload fields are stripped — defense against future shape
 * drift. The validator returns the first error code it hits; the
 * handler maps that to a 400 with the same code so callers can
 * distinguish invalid_kind vs invalid_payload vs invalid_deviceId.
 *
 * Time + uuid are injected (not Date.now / crypto.randomUUID inside)
 * so tests can pin both. Stays pure.
 */

const KINDS = /** @type {const} */ (['daily_start', 'findflag_play', 'share', 'quiz_play']);
const SHARE_SURFACES = /** @type {const} */ (['daily', 'findflag', 'flagquiz', 'ttt']);
const FINDFLAG_MODES = /** @type {const} */ (['random', 'custom']);
const QUIZ_PLAY_MODES = /** @type {const} */ (['60s', 'all']);

const MAX_FILTER_LEN = 256;
const MAX_CONTEXT_HINT_LEN = 128;

/**
 * @typedef {'daily_start' | 'findflag_play' | 'share' | 'quiz_play'} EventKind
 * @typedef {{ puzzleId: number }} DailyStartPayload
 * @typedef {{ filter: string, mode: 'random' | 'custom' }} FindFlagPlayPayload
 * @typedef {{
 *   surface: 'daily' | 'findflag' | 'flagquiz' | 'ttt',
 *   contextHint?: string
 * }} SharePayload
 * @typedef {{ mode: '60s' | 'all' }} QuizPlayPayload
 * @typedef {DailyStartPayload | FindFlagPlayPayload | SharePayload | QuizPlayPayload} EventPayload
 *
 * @typedef {{
 *   deviceId: string,
 *   kind: EventKind,
 *   payload: unknown,
 *   dayId: number,
 *   occurredAt: number,
 *   local?: boolean,
 *   uuid: string,
 * }} BuildArgs
 *
 * @typedef {| { ok: true, doc: Record<string, unknown> }
 *           | { ok: false, error: string }
 *          } BuildResult
 */

/**
 * @param {BuildArgs} args
 * @returns {BuildResult}
 */
function buildEngagementDoc({ deviceId, kind, payload, dayId, occurredAt, local, uuid }) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    return { ok: false, error: 'invalid_deviceId' };
  }
  if (!/** @type {readonly string[]} */ (KINDS).includes(kind)) {
    return { ok: false, error: 'invalid_kind' };
  }
  if (!Number.isInteger(dayId)) {
    return { ok: false, error: 'invalid_dayId' };
  }
  if (!Number.isInteger(occurredAt) || occurredAt <= 0) {
    return { ok: false, error: 'invalid_occurredAt' };
  }
  if (typeof uuid !== 'string' || uuid.length === 0) {
    return { ok: false, error: 'invalid_uuid' };
  }
  const cleaned = validateAndCleanPayload(kind, payload);
  if (!cleaned.ok) return cleaned;

  /** @type {Record<string, unknown>} */
  const doc = {
    id: makeId(kind, dayId, cleaned.payload, uuid),
    deviceId,
    kind,
    dayId,
    occurredAt,
    payload: cleaned.payload,
    v: 1,
  };
  if (local === true) doc.local = true;
  return { ok: true, doc };
}

/**
 * @param {EventKind} kind
 * @param {unknown} payload
 * @returns {| { ok: true, payload: EventPayload }
 *            | { ok: false, error: string }}
 */
function validateAndCleanPayload(kind, payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'invalid_payload' };
  }
  const p = /** @type {Record<string, unknown>} */ (payload);

  if (kind === 'daily_start') {
    if (!Number.isInteger(p.puzzleId) || /** @type {number} */ (p.puzzleId) <= 0) {
      return { ok: false, error: 'invalid_payload' };
    }
    return { ok: true, payload: { puzzleId: /** @type {number} */ (p.puzzleId) } };
  }

  if (kind === 'findflag_play') {
    if (
      typeof p.filter !== 'string' ||
      p.filter.length === 0 ||
      p.filter.length > MAX_FILTER_LEN
    ) {
      return { ok: false, error: 'invalid_payload' };
    }
    if (!/** @type {readonly string[]} */ (FINDFLAG_MODES).includes(/** @type {string} */ (p.mode))) {
      return { ok: false, error: 'invalid_payload' };
    }
    return {
      ok: true,
      payload: {
        filter: /** @type {string} */ (p.filter),
        mode: /** @type {'random' | 'custom'} */ (p.mode),
      },
    };
  }

  if (kind === 'quiz_play') {
    if (!/** @type {readonly string[]} */ (QUIZ_PLAY_MODES).includes(/** @type {string} */ (p.mode))) {
      return { ok: false, error: 'invalid_payload' };
    }
    return {
      ok: true,
      payload: { mode: /** @type {'60s' | 'all'} */ (p.mode) },
    };
  }

  // share
  if (!/** @type {readonly string[]} */ (SHARE_SURFACES).includes(/** @type {string} */ (p.surface))) {
    return { ok: false, error: 'invalid_payload' };
  }
  /** @type {SharePayload} */
  const out = { surface: /** @type {SharePayload['surface']} */ (p.surface) };
  if (p.contextHint !== undefined) {
    if (
      typeof p.contextHint !== 'string' ||
      p.contextHint.length === 0 ||
      p.contextHint.length > MAX_CONTEXT_HINT_LEN
    ) {
      return { ok: false, error: 'invalid_payload' };
    }
    out.contextHint = p.contextHint;
  }
  return { ok: true, payload: out };
}

/**
 * @param {EventKind} kind
 * @param {number} dayId
 * @param {EventPayload} payload
 * @param {string} uuid
 * @returns {string}
 */
function makeId(kind, dayId, payload, uuid) {
  if (kind === 'daily_start') {
    return `daily_start:${dayId}:${/** @type {DailyStartPayload} */ (payload).puzzleId}`;
  }
  if (kind === 'quiz_play') {
    // Deterministic per (device, day, mode) — a player who plays five
    // 60s rounds today writes one row, not five. 409 on conflict is
    // the idempotent "already recorded" case (same shape as
    // daily_start).
    return `quiz_play:${dayId}:${/** @type {{ mode: string }} */ (payload).mode}`;
  }
  return `${kind}:${uuid}`;
}

module.exports = { buildEngagementDoc, KINDS, SHARE_SURFACES, FINDFLAG_MODES, QUIZ_PLAY_MODES };
