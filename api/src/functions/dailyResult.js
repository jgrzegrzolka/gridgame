const { app } = require('@azure/functions');
const { validateResult } = require('../lib/validate');
const { insertDoc } = require('../lib/cosmos');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'dailyResults';

app.http('dailyResult', {
  route: 'v1/daily/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_json' } };
    }
    const v = validateResult(body);
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const doc = {
      id: `${body.puzzleId}:${body.deviceId}`,
      puzzleId: body.puzzleId,
      deviceId: body.deviceId,
      foundCodes: body.foundCodes,
      totalCount: body.totalCount,
      durationMs: body.durationMs,
      submittedAt: Date.now(),
    };

    let result;
    try {
      result = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: body.puzzleId,
        doc,
      });
    } catch (err) {
      context.error('cosmos request threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    if (result.ok) return { status: 204 };
    if (result.error === 'conflict') {
      return { status: 409, jsonBody: { error: 'already_submitted' } };
    }
    context.error('cosmos insert failed', result);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
