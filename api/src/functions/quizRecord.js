const { app } = require('@azure/functions');
const { validateQuizRecord } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { mergeQuizRecord } = require('../lib/quizRecordDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'quizRecords';

// 10 writes/min/IP is plenty: a 60s round caps at one finish per ~60s,
// the endurance "all" mode runs slower, and a player switching between
// variants/modes still finishes well under 10/min. Tight enough to keep
// runaway scripts from filling the container.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('quizRecord', {
  route: 'v1/quiz/record',
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
    const v = validateQuizRecord(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Read the device's existing record doc (one row per device, partitioned
    // by deviceId — so the query is cheap and single-partition).
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: body.deviceId }],
        partitionKey: body.deviceId,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const existing = queryRes.docs[0] || null;
    const now = Date.now();

    const merge = mergeQuizRecord({
      existing,
      deviceId: body.deviceId,
      configKey: body.configKey,
      entry: { score: body.score, durationMs: body.durationMs },
      lowerWins: body.lowerWins,
      now,
    });

    // F5 — every finish writes: attempts + lastPlayedAt change on every
    // call, PB-or-not, so the prior "skip on non-PB" short-circuit is
    // gone. The 204 contract for the client is unchanged: it always
    // fires after every round and never has to interpret the response.
    let insertRes;
    try {
      insertRes = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: body.deviceId,
        doc: merge.doc,
        upsert: true,
      });
    } catch (err) {
      context.error('cosmos upsert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    if (insertRes.ok) return { status: 204 };
    context.error('cosmos upsert failed', insertRes);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
