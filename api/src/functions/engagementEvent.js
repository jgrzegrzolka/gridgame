const { app } = require('@azure/functions');
const crypto = require('node:crypto');
const { buildEngagementDoc } = require('../lib/engagementDoc');
const { insertDoc } = require('../lib/cosmos');
const { validateDeviceIdParam } = require('../lib/validate');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { isLocalRequestUrl } = require('../lib/requestHost');
const { warsawDayNumber } = require('../lib/warsawDay');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'engagementEvents';

// 60 events/min/IP. Most players will be well under one per minute; the
// limit is generous enough to handle a player who shares one game and
// starts the next a few seconds later, tight enough to slow a script
// flooding the endpoint.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

app.http('engagementEvent', {
  route: 'v1/event',
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

    const v = validateDeviceIdParam(body.deviceId, 'invalid_deviceId');
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const now = Date.now();
    const dayId = warsawDayNumber(now);
    if (dayId === null) {
      context.error('warsawDayNumber returned null');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Server-trusted local-dev marker — same pattern as dailyResult.js.
    // Reading the host from req.url (not a body field) so a malicious
    // client can't spoof it to opt their events out of analytics.
    const local = isLocalRequestUrl(req.url) ? true : undefined;

    const built = buildEngagementDoc({
      deviceId: v.value,
      kind: body.kind,
      payload: body.payload,
      dayId,
      occurredAt: now,
      local,
      uuid: crypto.randomUUID(),
    });
    if (!built.ok) {
      return { status: 400, jsonBody: { error: built.error } };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    let result;
    try {
      result = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: v.value,
        doc: built.doc,
      });
    } catch (err) {
      context.error('cosmos insert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    if (result.ok) {
      return { status: 201, jsonBody: { ok: true, id: built.doc.id } };
    }
    if (result.error === 'conflict') {
      // Only the daily_start kind has a deterministic id; the conflict
      // is the expected idempotent path when the same device fires
      // again for the same (day, puzzle). Surface as 409 so the client
      // can treat it as a no-op success.
      return { status: 409, jsonBody: { error: 'already_recorded' } };
    }
    context.error('cosmos insert failed', result);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
