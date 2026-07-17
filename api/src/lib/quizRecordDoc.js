/**
 * Pure builder + merge logic for the Cosmos document we keep in the
 * `quizRecords` container — one row per device that holds every
 * (variant, mode) personal-best the player has set.
 *
 * Document shape:
 *   {
 *     id:        string,                  // same as deviceId — partition key + id
 *     deviceId:  string,
 *     records: {
 *       "countries:60s": { score, durationMs, submittedAt, attempts, lastPlayedAt },
 *       "africa:all":    { score, durationMs, submittedAt, attempts, lastPlayedAt },
 *       "weird:60s":     { score, durationMs, submittedAt, attempts, lastPlayedAt },
 *       ...
 *     },
 *     updatedAt: number,                  // unix ms — when this doc last changed
 *     v:         1,                       // schema version, set unconditionally on every write.
 *                                         //   See infra/operations.md "Cosmos data migration policy".
 *   }
 *
 * Sub-entry fields:
 *   - score / durationMs / submittedAt:  the personal best. Only updated when this finish
 *                                        beats the incumbent (isPersonalBest=true).
 *   - attempts:                          total finishes ever recorded for this configKey,
 *                                        including non-PB finishes. Bumps on every finish.
 *   - lastPlayedAt:                      most recent finish time, PB or not. Different from
 *                                        `submittedAt` (which freezes at the PB's set time).
 *
 * Keys are `"<variant>:<mode>"`. Pre-Feature-V docs also carry legacy
 * `"<variant>:<mode>:<sov|all>"` keys, which stay readable until the Phase 1c
 * backfill renames the `:sov` ones and drops the `:all` ones. Nothing here
 * parses the key — it's an opaque map key to this module.
 *
 * Why one-doc-per-device:
 *   - PB check needs the previous entry anyway → one read returns
 *     everything we need to decide and the merged write.
 *   - 8 variants × 2 modes = 16 max entries, each ~120 bytes (with attempts +
 *     lastPlayedAt) — well under 2KB, with room for the legacy keys still
 *     sitting alongside them pre-backfill.
 *   - Future "show me all my records" is one read, no fan-out.
 *
 * Why the merge logic lives here (and not in flags/quiz.js's `nextBest`):
 *   - api/ is CommonJS, flags/quiz.js is ESM and pulls in DOM-adjacent
 *     helpers. The merge is ~5 lines; copying it keeps the boundary clean.
 *   - Tests pin the semantics (better score wins; equal score + lower
 *     time tiebreaks) so drift from nextBest would be caught loudly.
 */

/**
 * Build a fresh doc for a device that has no record yet.
 *
 * @param {{ deviceId: string, configKey: string, entry: { score: number, durationMs: number }, now: number }} input
 */
function buildQuizRecordDoc({ deviceId, configKey, entry, now }) {
  return {
    id: deviceId,
    deviceId,
    records: {
      [configKey]: {
        score: entry.score,
        durationMs: entry.durationMs,
        submittedAt: now,
        attempts: 1,
        lastPlayedAt: now,
      },
    },
    updatedAt: now,
    v: 1,
  };
}

/**
 * Decide whether `candidate` should displace `incumbent`.
 *
 *   - No incumbent → candidate wins.
 *   - lowerWins=true (count mode: fewer mistakes) → candidate.score < incumbent.score.
 *   - lowerWins=false (timed mode: more correct) → candidate.score > incumbent.score.
 *   - Equal score → faster durationMs wins (tiebreaker; mirrors nextBest()).
 *
 * @param {{ score: number, durationMs: number } | null | undefined} incumbent
 * @param {{ score: number, durationMs: number }} candidate
 * @param {boolean} lowerWins
 * @returns {boolean}
 */
function isPersonalBest(incumbent, candidate, lowerWins) {
  if (!incumbent) return true;
  if (lowerWins) {
    if (candidate.score < incumbent.score) return true;
  } else {
    if (candidate.score > incumbent.score) return true;
  }
  if (candidate.score === incumbent.score && candidate.durationMs < incumbent.durationMs) {
    return true;
  }
  return false;
}

/**
 * Merge a new (configKey, entry) into the existing doc — or build a
 * fresh one if `existing` is null. Returns
 *   { changed: true, doc }   — caller should upsert `doc`
 *   { changed: false, doc }  — caller can skip the write; existing PB stands
 *
 * The handler reads + merges + upserts atomically enough for our scale
 * (single-device writes, no contention). If two tabs both finish a round
 * at once, the last write wins — fine, the loser's score is just rejected
 * on the next round end if it wasn't actually a PB.
 *
 * @param {{
 *   existing: { id: string, deviceId: string, records: Record<string, any>, updatedAt: number } | null,
 *   deviceId: string,
 *   configKey: string,
 *   entry: { score: number, durationMs: number },
 *   lowerWins: boolean,
 *   now: number,
 * }} args
 */
function mergeQuizRecord({ existing, deviceId, configKey, entry, lowerWins, now }) {
  if (!existing) {
    return {
      changed: true,
      doc: buildQuizRecordDoc({ deviceId, configKey, entry, now }),
    };
  }

  const incumbent = existing.records ? existing.records[configKey] : null;
  const isPb = isPersonalBest(incumbent, entry, lowerWins);

  // `attempts` defaults to 0 when the sub-entry doesn't have the field yet
  // (pre-F5 docs encountered between deploy and backfill). The backfill
  // script raises stale sub-entries to `attempts: 1` to avoid the off-by-one.
  const prevAttempts = (incumbent && typeof incumbent.attempts === 'number') ? incumbent.attempts : 0;

  const records = { ...(existing.records || {}) };
  records[configKey] = {
    // PB fields: keep incumbent's unless this finish beats them.
    score:       isPb ? entry.score      : (incumbent ? incumbent.score      : entry.score),
    durationMs:  isPb ? entry.durationMs : (incumbent ? incumbent.durationMs : entry.durationMs),
    submittedAt: isPb ? now              : (incumbent ? incumbent.submittedAt : now),
    // Engagement fields: bumped on every finish, PB or not.
    attempts:    prevAttempts + 1,
    lastPlayedAt: now,
  };
  // `changed` is now always `true` because attempts/lastPlayedAt change on
  // every finish. Kept on the return shape for API stability — callers can
  // ignore it and always upsert.
  return {
    changed: true,
    doc: {
      ...existing,
      id: deviceId,
      deviceId,
      records,
      updatedAt: now,
      v: 1,
    },
  };
}

module.exports = {
  buildQuizRecordDoc,
  isPersonalBest,
  mergeQuizRecord,
};
