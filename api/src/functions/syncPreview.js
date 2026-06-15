const { app } = require('@azure/functions');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyToken } = require('../lib/passkeyToken');
const { validateDeviceIdParam } = require('../lib/validate');
const { countDailyConflicts, detectProfileConflict } = require('../lib/syncMerge');

const DB_NAME = 'yetanotherquiz';

// 10/min/IP. Same envelope as register/verify (the auth endpoint that
// issues the merge token) — they're the same conceptual flow.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('syncPreview', {
  route: 'v1/sync/preview',
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
      secret, token: body.mergeToken, now: Date.now(), expectedScope: 'merge',
    });
    if (!tokenCheck.ok) return { status: 400, jsonBody: { error: tokenCheck.error } };
    const { targetDeviceId } = tokenCheck.payload;
    if (!targetDeviceId) {
      return { status: 400, jsonBody: { error: 'invalid_token' } };
    }

    const sourceCheck = validateDeviceIdParam(body.sourceDeviceId, 'invalid_sourceDeviceId');
    if (!sourceCheck.ok) return { status: 400, jsonBody: { error: sourceCheck.error } };
    const sourceDeviceId = sourceCheck.value;

    // Same-device "merge" is a no-op — bail early so the client
    // (which may not check) doesn't get a confusing report.
    if (sourceDeviceId === targetDeviceId) {
      return {
        status: 200,
        jsonBody: { sameDevice: true, daily: null, profile: null },
      };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Daily conflict detection: query both deviceIds' rows (cross-
    // partition since dailyResults partitions by /puzzleId). Project
    // only puzzleId — that's all we need.
    let dailyTarget, dailySource;
    try {
      [dailyTarget, dailySource] = await Promise.all([
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'dailyResults',
          query: 'SELECT c.puzzleId FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: targetDeviceId }],
          enableCrossPartition: true,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'dailyResults',
          query: 'SELECT c.puzzleId FROM c WHERE c.deviceId = @did',
          parameters: [{ name: '@did', value: sourceDeviceId }],
          enableCrossPartition: true,
        }),
      ]);
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!dailyTarget.ok || !dailySource.ok) {
      context.error('daily preview query failed', dailyTarget, dailySource);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const dailyConflict = countDailyConflicts({
      targetRows: dailyTarget.docs,
      sourceRows: dailySource.docs,
    });

    // Profile conflict detection: each container partitioned by
    // /deviceId, so single-partition reads.
    let profTarget, profSource;
    try {
      [profTarget, profSource] = await Promise.all([
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'profiles',
          query: 'SELECT c.nickname FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: targetDeviceId }],
          partitionKey: targetDeviceId,
        }),
        queryDocs({
          connString: conn, dbName: DB_NAME, containerName: 'profiles',
          query: 'SELECT c.nickname FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: sourceDeviceId }],
          partitionKey: sourceDeviceId,
        }),
      ]);
    } catch (err) {
      context.error('profile preview query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!profTarget.ok || !profSource.ok) {
      context.error('profile preview query failed', profTarget, profSource);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const profileConflict = detectProfileConflict({
      targetRow: profTarget.docs[0] || null,
      sourceRow: profSource.docs[0] || null,
    });

    return {
      status: 200,
      jsonBody: {
        sameDevice: false,
        // null if no conflict, otherwise { count, puzzleIds: [first few] }.
        daily: dailyConflict.count > 0
          ? { count: dailyConflict.count, samplePuzzleIds: dailyConflict.puzzleIds.slice(0, 6) }
          : null,
        // null if no conflict, otherwise { target, source } nicknames.
        profile: profileConflict,
      },
    };
  },
});
