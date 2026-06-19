const { app } = require('@azure/functions');
const { validateTttResultBody } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyTurnstile } = require('../lib/turnstile');
const { mergePairResult, mirrorOutcome } = require('../lib/tttPairDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'tttPairs';

// 10 writes/min/IP — a single online TTT game lasts ~30s minimum, so
// ten reports per minute already covers a rapid-rematch session. Higher
// values let one IP grief the head-to-head row of any pair they've ever
// played; tighter values would block normal play.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('tttResult', {
  route: 'v1/ttt/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const rl = limiter.check(clientIp(req), Date.now());
    if (!rl.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
        jsonBody: { error: 'rate_limited' },
      };
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json' } };
    }
    const v = validateTttResultBody(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const ts = await verifyTurnstile({
      secret: process.env.TURNSTILE_SECRET,
      token: body.turnstileToken,
      remoteIp: clientIp(req),
    });
    if (!ts.ok) {
      if (ts.reason === 'missing_secret') {
        context.warn('TURNSTILE_SECRET not set — skipping verification (dev mode)');
      } else {
        context.warn('turnstile verification failed', { reason: ts.reason });
        return { status: 403, jsonBody: { error: 'turnstile_failed' } };
      }
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const { deviceId, opponentId, mode, outcome } = v.value;
    const now = Date.now();

    // Two upserts per POST so the (deviceId → opponentId) row and the
    // mirror (opponentId → deviceId) row stay in lockstep. Client-side
    // contract: only the room CREATOR posts (see ticTacToe/page.js
    // `reportFinishedResult`), so a single POST per game replaces the
    // previous "both clients post" design — which let one side's POST
    // drop (rate-limit, disconnect, give-up bug) and leave the rows
    // out of sync forever. Mirror-of-the-mirror is the same outcome
    // (pinned in tttPairDoc.test.js), so a stale client that still
    // double-posts won't double-bump anyone.
    const primary = await upsertPairRow({
      conn,
      context,
      ownerId: deviceId,
      otherId: opponentId,
      mode,
      outcome,
      now,
    });
    if (!primary.ok) return primary.response;

    const mirror = await upsertPairRow({
      conn,
      context,
      ownerId: opponentId,
      otherId: deviceId,
      mode,
      outcome: mirrorOutcome(outcome),
      now,
    });
    if (!mirror.ok) {
      // Primary landed but mirror failed — the pair is now in the
      // split-brain state the mirror-write was meant to prevent.
      // Surface as 500 so the client knows to retry (today: fire-and-
      // forget, so the row stays asymmetric until the next game's POST
      // overwrites both sides). Logging captures the drift for later
      // reconciliation.
      context.error('mirror upsert failed after primary succeeded', { deviceId, opponentId, mode, outcome });
      return mirror.response;
    }

    return { status: 204 };
  },
});

/**
 * Read existing head-to-head row + merge the new outcome + upsert. Pure
 * I/O wrapper around `mergePairResult` so the handler can call it once
 * for the reporter's row and once for the mirror.
 *
 * @returns {Promise<{ ok: true } | { ok: false, response: { status: number, jsonBody: { error: string } } }>}
 */
async function upsertPairRow({ conn, context, ownerId, otherId, mode, outcome, now }) {
  const docId = `${ownerId}:${otherId}`;
  let queryRes;
  try {
    queryRes = await queryDocs({
      connString: conn,
      dbName: DB_NAME,
      containerName: CONTAINER_NAME,
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: docId }],
      partitionKey: ownerId,
    });
  } catch (err) {
    context.error('cosmos query threw', err);
    return { ok: false, response: { status: 500, jsonBody: { error: 'server_error' } } };
  }
  if (!queryRes.ok) {
    context.error('cosmos query failed', queryRes);
    return { ok: false, response: { status: 500, jsonBody: { error: 'server_error' } } };
  }
  const existing = queryRes.docs[0] || null;
  const doc = mergePairResult({
    existing,
    deviceId: ownerId,
    opponentId: otherId,
    mode,
    outcome,
    now,
  });
  let upsertRes;
  try {
    upsertRes = await insertDoc({
      connString: conn,
      dbName: DB_NAME,
      containerName: CONTAINER_NAME,
      partitionKey: ownerId,
      doc,
      upsert: true,
    });
  } catch (err) {
    context.error('cosmos upsert threw', err);
    return { ok: false, response: { status: 500, jsonBody: { error: 'server_error' } } };
  }
  if (upsertRes.ok) return { ok: true };
  context.error('cosmos upsert failed', upsertRes);
  return { ok: false, response: { status: 500, jsonBody: { error: 'server_error' } } };
}
