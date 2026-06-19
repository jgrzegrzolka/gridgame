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
      // Two kinds have deterministic ids today: `daily_start`
      // (`daily_start:<dayId>:<puzzleId>`) and `quiz_play`
      // (`quiz_play:<dayId>:<mode>`). Both are intentionally idempotent
      // — a player who replays the same puzzle / quiz mode on the same
      // day writes one row, not N. The dedupe path is a SUCCESS from
      // the caller's perspective (the event IS recorded), so return 200
      // with `deduped: true` rather than 409: a 409 makes the browser
      // log a Conflict in DevTools every time the player finishes a
      // second quiz of the day, which reads as an error to anyone
      // looking at the console. Client still treats 409 as success as
      // defense-in-depth (stale cached clients during a deploy window). */
      return { status: 200, jsonBody: { ok: true, deduped: true } };
    }
    context.error('cosmos insert failed', result);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
