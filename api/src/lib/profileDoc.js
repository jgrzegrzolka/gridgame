/**
 * Pure builder for the Cosmos document we keep in the `profiles` container —
 * one row per device, holding the player's chosen nickname (or null = the
 * default "anonymous device" state).
 *
 * Document shape (per FEATURE.md Feature H2 + Feature S Phase 1a):
 *   {
 *     id:                  string,         // == deviceId — partition key + id
 *     deviceId:            string,
 *     nickname:            string | null,  // null = "anonymous device", display falls back to no name
 *     nicknameAuto:        boolean,        // true when the row exists but the user hasn't chosen a
 *                                          //   name (display falls back to defaultNickname(deviceId)).
 *                                          //   Derived from `nickname`: null/empty = auto, real string
 *                                          //   = user-customised. Lets the leaderboard render a "🎲
 *                                          //   auto-generated" hint and lets later phases tell
 *                                          //   "auto-created row" apart from "user actively cleared
 *                                          //   their nickname after picking one."
 *     createdAt:           number,         // unix ms — first-ever profile write for this device. Preserved
 *                                          //   across subsequent writes by the read-then-upsert flow in
 *                                          //   functions/profile.js; this builder is the pure half.
 *     updatedAt:           number,         // unix ms — most recent profile write
 *     deletionRequestedAt: number | null,  // unix ms — only set when the user posts to
 *                                          //   /api/v1/profile/requestDeletion. Manual purge runs
 *                                          //   on rows where this is set AND no game-data writes
 *                                          //   have arrived since (the "cancel on return" promise
 *                                          //   in the privacy page). Preserved across nickname
 *                                          //   edits; the only way to clear it is to play again.
 *     linkedAt:            number | null,  // unix ms — stamped by syncMerge when a second device
 *                                          //   was linked to this deviceId. Both the device that
 *                                          //   showed the QR (target) and the one that scanned
 *                                          //   (source, post-deviceId-swap) share this deviceId
 *                                          //   afterwards, so the linkedAt marker is what either
 *                                          //   browser uses to discover the linked state.
 *                                          //   Preserved across nickname edits.
 *     v:                   1,              // schema version. See infra/operations.md "Cosmos data migration policy".
 *   }
 *
 * Why createdAt is preserved (vs. stamped fresh on every write): future
 * UI may want a "playing since" or "verified browser age" signal, and a
 * nickname change shouldn't reset that. The cost is one cheap point-read
 * before each upsert — nickname writes are infrequent (a user sets it
 * once, maybe edits it later) so the extra round-trip is irrelevant.
 *
 * Why this is a pure builder (no Cosmos calls inside): keeps the merge
 * semantics testable without spinning up the REST client, and lets the
 * handler stay a thin shell — same pattern as `dailyResultDoc` and
 * `quizRecordDoc`.
 */

/**
 * Build the Cosmos doc to upsert.
 *
 * `requestDeletion` is the new-write signal from the requestDeletion endpoint:
 * `true` stamps `deletionRequestedAt = now`, `false` (the default for a normal
 * nickname write) preserves whatever the existing row holds. There's no path
 * to clear it through this builder — cancel-on-return is decided at manual
 * purge time, not by client writes.
 *
 * `linkedAt` is preserved from `existing` so a nickname edit doesn't erase
 * the link marker (which is written by syncMerge, not by this endpoint).
 *
 * @param {{
 *   existing: { createdAt?: number, deletionRequestedAt?: number | null, linkedAt?: number | null } | null,
 *   deviceId: string,
 *   nickname: string | null,
 *   now: number,
 *   requestDeletion?: boolean,
 * }} input
 */
function buildProfileDoc({ existing, deviceId, nickname, now, requestDeletion = false }) {
  const createdAt = (existing && typeof existing.createdAt === 'number')
    ? existing.createdAt
    : now;
  const existingDeletion = (existing && typeof existing.deletionRequestedAt === 'number')
    ? existing.deletionRequestedAt
    : null;
  const deletionRequestedAt = requestDeletion ? now : existingDeletion;
  const linkedAt = (existing && typeof existing.linkedAt === 'number')
    ? existing.linkedAt
    : null;
  // Auto = no nickname picked. A non-empty user-supplied string flips this to
  // false; clearing back to null reverts to auto. Derived (not stored as a
  // separate input) so the source of truth is `nickname` and the two fields
  // can't drift.
  const nicknameAuto = typeof nickname !== 'string' || nickname.length === 0;
  return {
    id: deviceId,
    deviceId,
    nickname,
    nicknameAuto,
    createdAt,
    updatedAt: now,
    deletionRequestedAt,
    linkedAt,
    v: 1,
  };
}

/**
 * Interpret a Cosmos `profiles` row for the `nicknameAuto` signal —
 * what the read endpoints (`getProfile`, downstream renderers) should
 * report to the client. Three cases the caller throws at us:
 *
 *   1. Row exists AND has the field set → trust the stored value.
 *      Reading lets future writes (or hand-edits) carry richer
 *      semantics than the simple "derived from nickname" default.
 *   2. Row exists but the field is missing → legacy row from before
 *      Feature S Phase 1a. Fall back to deriving from `nickname`:
 *      null/empty = auto, real string = customised. Same rule the
 *      builder applies, so a legacy row reads identically to one a
 *      fresh write would have produced.
 *   3. No row → the device has never written a profile. Reads as auto
 *      (matches the client-side `defaultNickname` fallback).
 *
 * @param {{ nicknameAuto?: unknown } | null | undefined} row
 * @param {string | null | undefined} nickname
 * @returns {boolean}
 */
function deriveNicknameAuto(row, nickname) {
  if (row && typeof row.nicknameAuto === 'boolean') return row.nicknameAuto;
  return typeof nickname !== 'string' || nickname.length === 0;
}

/**
 * Map an `insertDoc` result into the HTTP response shape for
 * `POST /api/v1/profile/ensure`. Three branches:
 *
 *   - `{ ok: true }` → 201 Created, the row is fresh.
 *   - `{ ok: false, error: 'conflict' }` → 200 OK, the row already
 *     existed (race with a concurrent ensure, or a returning device
 *     whose localStorage sentinel was cleared). Treated as success
 *     because the caller's postcondition is "row exists," not "this
 *     call wrote it."
 *   - Anything else → 500 server_error.
 *
 * Extracted from `functions/profileEnsure.js` so the three-way decision
 * can be unit-tested without spinning up Cosmos. Coupling: relies on
 * `cosmos.js#insertDoc`'s result shape — both modules are internal,
 * acceptable.
 *
 * @param {{ ok: true } | { ok: false, error?: string }} insertResult
 * @returns {{ status: 201 | 200 | 500, body: Record<string, unknown> }}
 */
function decideEnsureResponse(insertResult) {
  if (insertResult.ok) return { status: 201, body: { ok: true, created: true } };
  if (insertResult.error === 'conflict') return { status: 200, body: { ok: true, created: false } };
  return { status: 500, body: { error: 'server_error' } };
}

module.exports = { buildProfileDoc, deriveNicknameAuto, decideEnsureResponse };
