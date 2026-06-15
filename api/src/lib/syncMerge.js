/**
 * Per-container merge logic for /profile/sync/ "link this device"
 * (Feature C phase 3 — the auto-merge approach we landed on).
 *
 * When a user authenticates on device B with a passkey that was
 * registered on device A, device B's localStorage `deviceId` is
 * replaced with device A's `deviceId`. Before that swap, the server
 * walks every per-device container and merges device B's data into
 * device A's namespace so nothing is lost:
 *
 *   - dailyResults     primary's row wins on overlap; non-overlap rows transfer
 *   - quizRecords      per configKey: better PB wins, attempts sum
 *   - tttPairs         per opponent: counters sum, newer lastPlayedAt wins
 *   - engagementEvents rows transfer with target deviceId (idempotent for daily_start)
 *   - profiles         nicknameChoice ∈ {'target','source'} resolves conflict; absent
 *                      conflict, source's value transfers if target has none
 *
 * After merge, every former-source row gets deleted. Cosmos system
 * fields are stripped on write (insertDoc rejects them on read-back).
 *
 * Pure-ish: takes already-read rows + resolutions, returns the writes
 * (upserts) and deletes the caller should perform. No I/O here — the
 * handler issues the actual Cosmos operations. Keeps merge logic
 * unit-testable without a Cosmos client.
 */

const COUNTERS = ['wins', 'losses', 'draws'];
const SYSTEM_FIELDS = ['_rid', '_self', '_etag', '_attachments', '_ts'];

/**
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
function stripSystem(doc) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.includes(k)) out[k] = v;
  }
  return out;
}

/**
 * @typedef {{
 *   container: string,
 *   partitionKey: unknown,
 *   doc: Record<string, unknown>,
 * }} UpsertOp
 *
 * @typedef {{
 *   container: string,
 *   partitionKey: unknown,
 *   id: string,
 * }} DeleteOp
 *
 * @typedef {{
 *   upserts: UpsertOp[],
 *   deletes: DeleteOp[],
 * }} ContainerPlan
 */

// ---- dailyResults --------------------------------------------------------

/**
 * @param {{
 *   targetRows: Array<Record<string, unknown>>,
 *   sourceRows: Array<Record<string, unknown>>,
 *   targetDeviceId: string,
 *   sourceDeviceId: string,
 *   primary: 'target' | 'source',
 * }} args
 * @returns {ContainerPlan}
 */
function planDailyMerge({ targetRows, sourceRows, targetDeviceId, sourceDeviceId, primary }) {
  /** @type {UpsertOp[]} */
  const upserts = [];
  /** @type {DeleteOp[]} */
  const deletes = [];

  const targetByPuzzle = new Map();
  for (const row of targetRows) {
    if (typeof row.puzzleId === 'number') targetByPuzzle.set(row.puzzleId, row);
  }

  for (const src of sourceRows) {
    if (typeof src.puzzleId !== 'number') continue;
    const puzzleId = src.puzzleId;
    const existing = targetByPuzzle.get(puzzleId);
    if (existing) {
      // Overlap — primary wins.
      if (primary === 'source') {
        // Rewrite target's row with source's content under the
        // target deviceId. id stays "{puzzleId}:{targetDeviceId}".
        const stripped = stripSystem(src);
        stripped.id = `${puzzleId}:${targetDeviceId}`;
        stripped.deviceId = targetDeviceId;
        upserts.push({
          container: 'dailyResults',
          partitionKey: puzzleId,
          doc: stripped,
        });
      }
      // Primary === target → keep target row, no upsert.
    } else {
      // Non-overlap — transfer source row to target's deviceId.
      const stripped = stripSystem(src);
      stripped.id = `${puzzleId}:${targetDeviceId}`;
      stripped.deviceId = targetDeviceId;
      upserts.push({
        container: 'dailyResults',
        partitionKey: puzzleId,
        doc: stripped,
      });
    }
    // Either way, delete source's row (puzzleId partition).
    deletes.push({
      container: 'dailyResults',
      partitionKey: puzzleId,
      id: `${puzzleId}:${sourceDeviceId}`,
    });
  }

  return { upserts, deletes };
}

/**
 * Count how many puzzleIds appear in BOTH targetRows and sourceRows —
 * the conflict count surfaced in the preview wizard.
 *
 * @param {{
 *   targetRows: Array<Record<string, unknown>>,
 *   sourceRows: Array<Record<string, unknown>>,
 * }} args
 * @returns {{ count: number, puzzleIds: number[] }}
 */
function countDailyConflicts({ targetRows, sourceRows }) {
  const targetSet = new Set(
    targetRows
      .map((r) => r.puzzleId)
      .filter((p) => typeof p === 'number'),
  );
  /** @type {number[]} */
  const conflicts = [];
  for (const src of sourceRows) {
    if (typeof src.puzzleId !== 'number') continue;
    if (targetSet.has(src.puzzleId)) conflicts.push(src.puzzleId);
  }
  return { count: conflicts.length, puzzleIds: conflicts.sort((a, b) => a - b) };
}

// ---- quizRecords ---------------------------------------------------------

/**
 * @param {string} configKey
 * @returns {boolean}
 */
function inferLowerWins(configKey) {
  // configKey shape per Feature K: "<variant>:<mode>:<scope>" where
  // mode = "all" → count-of-mistakes (lower wins) and "60s" or any
  // timed → score (higher wins). Mirrors lowerWinsFromConfigKey in
  // quizRecordKey.js without depending on that module here.
  const parts = configKey.split(':');
  return parts[1] === 'all';
}

/**
 * @param {{ score: number, durationMs: number } | null | undefined} a
 * @param {{ score: number, durationMs: number } | null | undefined} b
 * @param {boolean} lowerWins
 * @returns {{ score: number, durationMs: number }}
 */
function pickBetterEntry(a, b, lowerWins) {
  if (!a) return /** @type {any} */ (b);
  if (!b) return /** @type {any} */ (a);
  if (lowerWins) {
    if (b.score < a.score) return b;
    if (a.score < b.score) return a;
  } else {
    if (b.score > a.score) return b;
    if (a.score > b.score) return a;
  }
  // Tie on score — faster wins, mirroring isPersonalBest.
  if (b.durationMs < a.durationMs) return b;
  return a;
}

/**
 * @param {{
 *   targetRow: Record<string, any> | null,
 *   sourceRow: Record<string, any> | null,
 *   targetDeviceId: string,
 *   sourceDeviceId: string,
 *   now: number,
 * }} args
 * @returns {ContainerPlan}
 */
function planQuizMerge({ targetRow, sourceRow, targetDeviceId, sourceDeviceId, now }) {
  /** @type {UpsertOp[]} */
  const upserts = [];
  /** @type {DeleteOp[]} */
  const deletes = [];

  if (!sourceRow) {
    return { upserts, deletes };
  }

  // Drop source's row no matter what — we're consolidating under
  // target.
  deletes.push({
    container: 'quizRecords',
    partitionKey: sourceDeviceId,
    id: sourceDeviceId,
  });

  const tgtRecords = targetRow && typeof targetRow.records === 'object' && targetRow.records
    ? /** @type {Record<string, any>} */ (targetRow.records)
    : {};
  const srcRecords = sourceRow && typeof sourceRow.records === 'object' && sourceRow.records
    ? /** @type {Record<string, any>} */ (sourceRow.records)
    : {};

  /** @type {Record<string, any>} */
  const merged = { ...tgtRecords };
  const allKeys = new Set([...Object.keys(tgtRecords), ...Object.keys(srcRecords)]);
  for (const k of allKeys) {
    const tgt = tgtRecords[k];
    const src = srcRecords[k];
    if (!tgt && !src) continue;
    const lowerWins = inferLowerWins(k);
    const best = pickBetterEntry(tgt, src, lowerWins);
    const tgtAttempts = tgt && typeof tgt.attempts === 'number' ? tgt.attempts : 0;
    const srcAttempts = src && typeof src.attempts === 'number' ? src.attempts : 0;
    const tgtLast = tgt && typeof tgt.lastPlayedAt === 'number' ? tgt.lastPlayedAt : 0;
    const srcLast = src && typeof src.lastPlayedAt === 'number' ? src.lastPlayedAt : 0;
    merged[k] = {
      score: best.score,
      durationMs: best.durationMs,
      submittedAt: /** @type {any} */ (best).submittedAt
        ?? (tgt && tgt.submittedAt) ?? (src && src.submittedAt) ?? now,
      attempts: tgtAttempts + srcAttempts,
      lastPlayedAt: Math.max(tgtLast, srcLast),
    };
  }

  /** @type {Record<string, unknown>} */
  const doc = {
    ...(targetRow ? stripSystem(targetRow) : {}),
    id: targetDeviceId,
    deviceId: targetDeviceId,
    records: merged,
    updatedAt: now,
    v: 1,
  };
  upserts.push({
    container: 'quizRecords',
    partitionKey: targetDeviceId,
    doc,
  });
  return { upserts, deletes };
}

// ---- tttPairs ------------------------------------------------------------

/**
 * @param {{ wins?: number, losses?: number, draws?: number } | undefined | null} from
 */
function normalisedCounters(from) {
  /** @type {{ wins: number, losses: number, draws: number }} */
  const out = { wins: 0, losses: 0, draws: 0 };
  if (from && typeof from === 'object') {
    for (const k of COUNTERS) {
      const v = /** @type {any} */ (from)[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        /** @type {any} */ (out)[k] = Math.floor(v);
      }
    }
  }
  return out;
}

/**
 * @param {{
 *   targetRows: Array<Record<string, any>>,
 *   sourceRows: Array<Record<string, any>>,
 *   targetDeviceId: string,
 *   sourceDeviceId: string,
 * }} args
 * @returns {ContainerPlan}
 */
function planTttMerge({ targetRows, sourceRows, targetDeviceId, sourceDeviceId }) {
  /** @type {UpsertOp[]} */
  const upserts = [];
  /** @type {DeleteOp[]} */
  const deletes = [];

  const targetByOpp = new Map();
  for (const r of targetRows) {
    if (typeof r.opponentId === 'string') targetByOpp.set(r.opponentId, r);
  }

  for (const src of sourceRows) {
    if (typeof src.opponentId !== 'string') continue;
    const opponentId = src.opponentId;
    const tgt = targetByOpp.get(opponentId);
    const tgtM3 = normalisedCounters(tgt && tgt.m3x3);
    const tgtM9 = normalisedCounters(tgt && tgt.m9x9);
    const srcM3 = normalisedCounters(src.m3x3);
    const srcM9 = normalisedCounters(src.m9x9);
    /** @type {Record<string, number>} */
    const m3x3 = { wins: tgtM3.wins + srcM3.wins, losses: tgtM3.losses + srcM3.losses, draws: tgtM3.draws + srcM3.draws };
    /** @type {Record<string, number>} */
    const m9x9 = { wins: tgtM9.wins + srcM9.wins, losses: tgtM9.losses + srcM9.losses, draws: tgtM9.draws + srcM9.draws };
    const tgtLast = tgt && typeof tgt.lastPlayedAt === 'number' ? tgt.lastPlayedAt : 0;
    const srcLast = typeof src.lastPlayedAt === 'number' ? src.lastPlayedAt : 0;
    /** @type {string | undefined} */
    let lastOutcome;
    if (srcLast >= tgtLast && typeof src.lastOutcome === 'string') {
      lastOutcome = src.lastOutcome;
    } else if (tgt && typeof tgt.lastOutcome === 'string') {
      lastOutcome = tgt.lastOutcome;
    }

    /** @type {Record<string, unknown>} */
    const doc = {
      id: `${targetDeviceId}:${opponentId}`,
      deviceId: targetDeviceId,
      opponentId,
      m3x3,
      m9x9,
      lastPlayedAt: Math.max(tgtLast, srcLast),
      v: 1,
    };
    if (lastOutcome) doc.lastOutcome = lastOutcome;

    upserts.push({
      container: 'tttPairs',
      partitionKey: targetDeviceId,
      doc,
    });
    deletes.push({
      container: 'tttPairs',
      partitionKey: sourceDeviceId,
      id: `${sourceDeviceId}:${opponentId}`,
    });
  }

  return { upserts, deletes };
}

// ---- engagementEvents ----------------------------------------------------

/**
 * @param {{
 *   targetRows: Array<Record<string, any>>,
 *   sourceRows: Array<Record<string, any>>,
 *   targetDeviceId: string,
 *   sourceDeviceId: string,
 * }} args
 * @returns {ContainerPlan}
 */
function planEventsMerge({ targetRows, sourceRows, targetDeviceId, sourceDeviceId }) {
  /** @type {UpsertOp[]} */
  const upserts = [];
  /** @type {DeleteOp[]} */
  const deletes = [];

  const targetIds = new Set(targetRows.map((r) => r.id).filter((id) => typeof id === 'string'));

  for (const src of sourceRows) {
    if (typeof src.id !== 'string') continue;
    // Same row id in target's partition would dedupe — only insert
    // if target doesn't already have it. (Relevant for daily_start
    // which has a deterministic id; uuid-based kinds will never
    // collide.)
    if (!targetIds.has(src.id)) {
      const stripped = stripSystem(src);
      stripped.deviceId = targetDeviceId;
      upserts.push({
        container: 'engagementEvents',
        partitionKey: targetDeviceId,
        doc: stripped,
      });
    }
    deletes.push({
      container: 'engagementEvents',
      partitionKey: sourceDeviceId,
      id: src.id,
    });
  }

  return { upserts, deletes };
}

// ---- profiles ------------------------------------------------------------

/**
 * @param {{
 *   targetRow: Record<string, any> | null,
 *   sourceRow: Record<string, any> | null,
 *   targetDeviceId: string,
 *   sourceDeviceId: string,
 *   nicknameChoice: 'target' | 'source',
 *   now: number,
 * }} args
 * @returns {ContainerPlan}
 */
function planProfileMerge({ targetRow, sourceRow, targetDeviceId, sourceDeviceId, nicknameChoice, now }) {
  /** @type {UpsertOp[]} */
  const upserts = [];
  /** @type {DeleteOp[]} */
  const deletes = [];

  if (sourceRow) {
    deletes.push({
      container: 'profiles',
      partitionKey: sourceDeviceId,
      id: sourceDeviceId,
    });
  }

  const tgtNick = targetRow && typeof targetRow.nickname === 'string' ? targetRow.nickname : null;
  const srcNick = sourceRow && typeof sourceRow.nickname === 'string' ? sourceRow.nickname : null;

  let nickname = null;
  if (tgtNick && srcNick) {
    nickname = nicknameChoice === 'source' ? srcNick : tgtNick;
  } else {
    nickname = tgtNick || srcNick;
  }

  // No-op upsert if target already carries the chosen nickname (no
  // material change). Source row, if present, still gets deleted —
  // that branch is in `deletes` already.
  if (targetRow && targetRow.nickname === nickname) {
    return { upserts, deletes };
  }
  // No-op if neither row exists.
  if (!targetRow && !sourceRow) {
    return { upserts, deletes };
  }

  /** @type {Record<string, unknown>} */
  const doc = {
    ...(targetRow ? stripSystem(targetRow) : {}),
    id: targetDeviceId,
    deviceId: targetDeviceId,
    nickname,
    updatedAt: now,
    v: 1,
  };
  if (!targetRow && !doc.createdAt) doc.createdAt = now;

  upserts.push({
    container: 'profiles',
    partitionKey: targetDeviceId,
    doc,
  });
  return { upserts, deletes };
}

/**
 * Detect whether the two profile rows disagree on nickname (the only
 * case where the wizard needs to ask).
 *
 * @param {{ targetRow: any, sourceRow: any }} args
 * @returns {| null | { target: string, source: string }}
 */
function detectProfileConflict({ targetRow, sourceRow }) {
  const tgt = targetRow && typeof targetRow.nickname === 'string' ? targetRow.nickname : null;
  const src = sourceRow && typeof sourceRow.nickname === 'string' ? sourceRow.nickname : null;
  if (tgt && src && tgt !== src) return { target: tgt, source: src };
  return null;
}

module.exports = {
  planDailyMerge,
  countDailyConflicts,
  planQuizMerge,
  planTttMerge,
  planEventsMerge,
  planProfileMerge,
  detectProfileConflict,
  stripSystem,
  // Exposed for tests
  inferLowerWins,
  pickBetterEntry,
};
