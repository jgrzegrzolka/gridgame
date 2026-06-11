const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'tttPairs';

// 60 reads/min/IP — a TTT room may fetch the head-to-head row on
// every welcome + after every finished result, plus rematch cycles.
// Generous enough to never block normal play; tight enough to stop a
// script enumerating every (deviceId, opponentId) combination.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

/** Mirror of the `mergePairResult` doc shape — the empty default that the
 *  client should render when no row exists yet (first game between this
 *  pair). Saves the caller having to special-case 404 vs zero-counters. */
const EMPTY_PAIR = Object.freeze({
  m3x3: { wins: 0, losses: 0, draws: 0 },
  m9x9: { wins: 0, losses: 0, draws: 0 },
});

app.http('getTttResult', {
  route: 'v1/ttt/result',
  methods: ['GET'],
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

    const dv = validateDeviceIdParam(req.query.get('deviceId'), 'invalid_deviceId');
    if (!dv.ok) return { status: 400, jsonBody: { error: dv.error } };
    const ov = validateDeviceIdParam(req.query.get('opponentId'), 'invalid_opponentId');
    if (!ov.ok) return { status: 400, jsonBody: { error: ov.error } };
    if (dv.value === ov.value) {
      return { status: 400, jsonBody: { error: 'self_match' } };
    }
    const deviceId = dv.value;
    const opponentId = ov.value;
    const docId = `${deviceId}:${opponentId}`;

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT c.deviceId, c.opponentId, c.m3x3, c.m9x9, c.lastPlayedAt FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: docId }],
        partitionKey: deviceId,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const row = queryRes.docs[0];
    if (!row) {
      return {
        status: 200,
        jsonBody: { deviceId, opponentId, ...EMPTY_PAIR, lastPlayedAt: null },
      };
    }
    return { status: 200, jsonBody: row };
  },
});
