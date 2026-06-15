const { app } = require('@azure/functions');
const { queryDocs, insertDoc, deleteDoc } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyToken } = require('../lib/syncToken');
const { validateDeviceIdParam } = require('../lib/validate');
const {
  planDailyMerge,
  planQuizMerge,
  planTttMerge,
  planEventsMerge,
  planProfileMerge,
} = require('../lib/syncMerge');

const DB_NAME = 'yetanotherquiz';

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

app.http('syncMerge', {
  route: 'v1/sync/merge',
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
    if (!body || typeof body !== 'object') {
      return { status: 400, jsonBody: { error: 'invalid_body' } };
    }

    const secret = process.env.PASSKEY_HMAC_SECRET;
    if (!secret) {
      context.error('PASSKEY_HMAC_SECRET env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const tokenCheck = verifyToken({
      secret, token: body.claimToken, now: Date.now(), expectedScope: 'claim',
    });
    if (!tokenCheck.ok) return { status: 400, jsonBody: { error: tokenCheck.error } };
    const targetDeviceId = tokenCheck.payload.deviceId;

    const sourceCheck = validateDeviceIdParam(body.sourceDeviceId, 'invalid_sourceDeviceId');
    if (!sourceCheck.ok) return { status: 400, jsonBody: { error: sourceCheck.error } };
    const sourceDeviceId = sourceCheck.value;

    if (sourceDeviceId === targetDeviceId) {
      return { status: 200, jsonBody: { merged: true, noop: true } };
    }

    // Resolutions from the client's wizard. Default to 'target' for
    // both — the safer choice when the client doesn't surface a
    // wizard (no conflict detected) or when a malformed payload omits
    // the field.
    const dailyPrimary = body.resolutions && body.resolutions.daily === 'source' ? 'source' : 'target';
    const nicknameChoice = body.resolutions && body.resolutions.nickname === 'source' ? 'source' : 'target';

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const now = Date.now();

    // Read every container we need to merge, both deviceIds in
    // parallel. dailyResults is the only cross-partition read here;
    // the rest are single-partition by /deviceId.
    let dailyTgt, dailySrc, quizTgt, quizSrc, tttTgt, tttSrc, eventsTgt, eventsSrc, profileTgt, profileSrc;
    try {
      [dailyTgt, dailySrc, quizTgt, quizSrc, tttTgt, tttSrc, eventsTgt, eventsSrc, profileTgt, profileSrc] = await Promise.all([
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'dailyResults',
          query: 'SELECT * FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: targetDeviceId }],
          enableCrossPartition: true,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'dailyResults',
          query: 'SELECT * FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: sourceDeviceId }],
          enableCrossPartition: true,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'quizRecords',
          query: 'SELECT * FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: targetDeviceId }],
          partitionKey: targetDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'quizRecords',
          query: 'SELECT * FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: sourceDeviceId }],
          partitionKey: sourceDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'tttPairs',
          query: 'SELECT * FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: targetDeviceId }],
          partitionKey: targetDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'tttPairs',
          query: 'SELECT * FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: sourceDeviceId }],
          partitionKey: sourceDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'engagementEvents',
          query: 'SELECT * FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: targetDeviceId }],
          partitionKey: targetDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'engagementEvents',
          query: 'SELECT * FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: sourceDeviceId }],
          partitionKey: sourceDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'profiles',
          query: 'SELECT * FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: targetDeviceId }],
          partitionKey: targetDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'profiles',
          query: 'SELECT * FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: sourceDeviceId }],
          partitionKey: sourceDeviceId,
        }),
      ]);
    } catch (err) {
      context.error('cosmos read fan-out threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    for (const r of [dailyTgt, dailySrc, quizTgt, quizSrc, tttTgt, tttSrc, eventsTgt, eventsSrc, profileTgt, profileSrc]) {
      if (!r.ok) {
        context.error('one of the merge reads failed', r);
        return { status: 500, jsonBody: { error: 'server_error' } };
      }
    }

    // Build the merge plan across all five containers.
    /** @type {Array<import('../lib/syncMerge').ContainerPlan>} */
    const plans = [
      planDailyMerge({
        targetRows: dailyTgt.docs, sourceRows: dailySrc.docs,
        targetDeviceId, sourceDeviceId, primary: dailyPrimary,
      }),
      planQuizMerge({
        targetRow: quizTgt.docs[0] || null, sourceRow: quizSrc.docs[0] || null,
        targetDeviceId, sourceDeviceId, now,
      }),
      planTttMerge({
        targetRows: tttTgt.docs, sourceRows: tttSrc.docs,
        targetDeviceId, sourceDeviceId,
      }),
      planEventsMerge({
        targetRows: eventsTgt.docs, sourceRows: eventsSrc.docs,
        targetDeviceId, sourceDeviceId,
      }),
      planProfileMerge({
        targetRow: profileTgt.docs[0] || null, sourceRow: profileSrc.docs[0] || null,
        targetDeviceId, sourceDeviceId, nicknameChoice, now,
      }),
    ];

    // Execute upserts first, then deletes. Each operation is
    // independent; one failure doesn't roll back others. Best-effort
    // semantics — failures are logged and surfaced in the response
    // counts so the client can decide whether to retry.
    let upsertCount = 0;
    let upsertFailures = 0;
    let deleteCount = 0;
    let deleteFailures = 0;

    for (const plan of plans) {
      for (const op of plan.upserts) {
        try {
          const res = await insertDoc({
            connString: conn, dbName: DB_NAME, containerName: op.container,
            partitionKey: op.partitionKey, doc: op.doc, upsert: true,
          });
          if (res.ok) upsertCount += 1;
          else upsertFailures += 1;
        } catch (err) {
          context.warn('merge upsert threw', { container: op.container, err });
          upsertFailures += 1;
        }
      }
    }

    for (const plan of plans) {
      for (const op of plan.deletes) {
        try {
          const res = await deleteDoc({
            connString: conn, dbName: DB_NAME, containerName: op.container,
            partitionKey: op.partitionKey, id: op.id,
          });
          if (res.ok) deleteCount += 1;
          else if (res.error === 'not_found') deleteCount += 1; // idempotent
          else deleteFailures += 1;
        } catch (err) {
          context.warn('merge delete threw', { container: op.container, err });
          deleteFailures += 1;
        }
      }
    }

    return {
      status: 200,
      jsonBody: {
        merged: true,
        upserts: upsertCount,
        upsertFailures,
        deletes: deleteCount,
        deleteFailures,
      },
    };
  },
});
