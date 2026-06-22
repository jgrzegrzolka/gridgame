const { app } = require('@azure/functions');
const { validateDeviceIdParam } = require('../lib/validate');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { buildProfileDoc } = require('../lib/profileDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'profiles';

// Hard ceiling on the JSON body size. Today's anticipated shape
// (engagement counters + 60s-streak day log + achievement IDs) lands
// well under 10KB even for power users; 100KB gives multi-year headroom
// and keeps a misbehaving / malicious client from filling a profile row
// with arbitrary data. JSON.stringify(blob).length is the measure —
// not byte length — to keep validation cheap and consistent regardless
// of multibyte content.
const MAX_BLOB_JSON_LEN = 100 * 1024;

// 12 writes/min/IP. Sync-blob writes are background (driven by client
// state changes in Phase 3+), not user-clicks — generous enough for a
// player who chains several actions in a minute, tight enough to stop a
// script from filling the container.
const limiter = createRateLimiter({ limit: 12, windowMs: 60_000 });

/**
 * POST /api/v1/profile/sync-blob
 *
 * Stores the client-owned roaming state blob on the device's profile row.
 * Feature S Phase 2 plumbing: Phases 3-5 wire callers that push achievement
 * counters, 60s-streak day log, and other per-device state once it moves
 * from Cosmos containers into localStorage.
 *
 * Why separate from PUT /api/v1/profile:
 *  - No Turnstile — background call, not user-input.
 *  - The body is opaque JSON, not a user-typed string we'd want to moderate.
 *  - Different rate-limit shape (more frequent, smaller).
 *
 * Why upsert-and-preserve vs. partial-patch:
 *  - Cosmos' core SQL API supports `upsert: true` with full doc replacement
 *    cheaper than the `PATCH` operation, and the doc is already small.
 *  - `buildProfileDoc` preserves `createdAt`, `linkedAt`,
 *    `deletionRequestedAt`, and the existing nickname / nicknameAuto via
 *    its read-then-write contract, so writing the blob doesn't churn
 *    those fields.
 *  - The pre-write read also doubles as our "row exists" check: a
 *    sync-blob write against a device that has no profile yet auto-
 *    creates the row (with nickname=null), so the endpoint works for
 *    edge cases where ensureProfile hasn't fired yet on a fresh device.
 */
app.http('profileSyncBlob', {
  route: 'v1/profile/sync-blob',
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
    const deviceId = v.value;

    // The blob itself: must be an object (incl. {}), never an array or
    // primitive. Arrays would survive JSON round-trip but would invite
    // ambiguity ("is this a list of blobs?"); requiring an object keeps
    // the shape decision explicit and lets future versions add metadata
    // siblings (`v`, `updatedAt`, etc.) without breaking the contract.
    if (
      body.blob === null
      || typeof body.blob !== 'object'
      || Array.isArray(body.blob)
    ) {
      return { status: 400, jsonBody: { error: 'invalid_blob' } };
    }
    const blob = body.blob;

    // Size cap: serialise once, measure, and bail if the JSON form is
    // larger than the ceiling. This is the only place we serialise the
    // blob (Cosmos will re-serialise on its own), so the cost is one
    // string conversion per write — acceptable.
    let blobJsonLen;
    try {
      blobJsonLen = JSON.stringify(blob).length;
    } catch {
      return { status: 400, jsonBody: { error: 'invalid_blob' } };
    }
    if (blobJsonLen > MAX_BLOB_JSON_LEN) {
      return { status: 413, jsonBody: { error: 'blob_too_large' } };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Read existing row so the builder preserves createdAt, linkedAt,
    // deletionRequestedAt, and the current nickname/nicknameAuto.
    // Missing row → builder treats existing=null and creates a fresh
    // profile with nickname:null + nicknameAuto:true (the sync-blob
    // write doubles as an implicit ensureProfile for fresh devices).
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: deviceId }],
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
    const existing = queryRes.docs[0] || null;
    const nickname = existing && typeof existing.nickname === 'string' ? existing.nickname : null;

    const doc = buildProfileDoc({
      existing,
      deviceId,
      nickname,
      now: Date.now(),
      syncBlob: blob,
    });

    let upsertRes;
    try {
      upsertRes = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: deviceId,
        doc,
        upsert: true,
      });
    } catch (err) {
      context.error('cosmos upsert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (upsertRes.ok) return { status: 204 };
    context.error('cosmos upsert failed', upsertRes);
    return { status: 500, jsonBody: { error: 'server_error' } };
  },
});
