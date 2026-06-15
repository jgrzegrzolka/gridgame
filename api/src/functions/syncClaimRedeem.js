const { app } = require('@azure/functions');
const { verifyToken } = require('../lib/syncToken');
const { queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');

const DB_NAME = 'yetanotherquiz';

// 10/min/IP. Same envelope as the mint endpoint.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('syncClaimRedeem', {
  route: 'v1/sync/claim/redeem',
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
      secret, token: body.token, now: Date.now(), expectedScope: 'claim',
    });
    if (!tokenCheck.ok) return { status: 400, jsonBody: { error: tokenCheck.error } };
    const targetDeviceId = tokenCheck.payload.deviceId;

    // Look up the target device's nickname so the redeeming device
    // can confirm "you're about to link to <Name>" — a defence
    // against phishing-via-shared-QR. Profile is single-partition by
    // /deviceId, cheap.
    /** @type {string | null} */
    let targetNickname = null;
    try {
      const conn = process.env.COSMOS_CONN;
      if (conn) {
        const profileRes = await queryDocs({
          connString: conn,
          dbName: DB_NAME,
          containerName: 'profiles',
          query: 'SELECT c.nickname FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: targetDeviceId }],
          partitionKey: targetDeviceId,
        });
        if (profileRes.ok && profileRes.docs.length > 0 && typeof profileRes.docs[0].nickname === 'string') {
          targetNickname = profileRes.docs[0].nickname;
        }
      }
    } catch (err) {
      // Non-fatal: the redeem still succeeds; the client just won't
      // get to show a nickname preview.
      context.warn('profile lookup during claim redeem failed', err);
    }

    return {
      status: 200,
      jsonBody: { targetDeviceId, targetNickname },
    };
  },
});
