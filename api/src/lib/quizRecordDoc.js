/**
 * Pure builder + merge logic for the Cosmos document we keep in the
 * `quizRecords` container — one row per device that holds every
 * (variant, mode, includeAll) personal-best the player has set.
 *
 * Document shape:
 *   {
 *     id:        string,                  // same as deviceId — partition key + id
 *     deviceId:  string,
 *     records: {
 *       "countries:60s:sov": { score, durationMs, submittedAt },
 *       "africa:all:sov":    { score, durationMs, submittedAt },
 *       ...
 *     },
 *     updatedAt: number,                  // unix ms — when this doc last changed
 *   }
 *
 * Why one-doc-per-device:
 *   - PB check needs the previous entry anyway → one read returns
 *     everything we need to decide and the merged write.
 *   - 7 variants × 2 modes × 2 includeAll = 28 max entries, each ~80
 *     bytes — well under 2KB. Single-partition reads/writes stay cheap.
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
      [configKey]: { score: entry.score, durationMs: entry.durationMs, submittedAt: now },
    },
    updatedAt: now,
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
  if (!isPersonalBest(incumbent, entry, lowerWins)) {
    return { changed: false, doc: existing };
  }

  const records = { ...(existing.records || {}) };
  records[configKey] = { score: entry.score, durationMs: entry.durationMs, submittedAt: now };
  return {
    changed: true,
    doc: {
      ...existing,
      id: deviceId,
      deviceId,
      records,
      updatedAt: now,
    },
  };
}

module.exports = {
  buildQuizRecordDoc,
  isPersonalBest,
  mergeQuizRecord,
};
