const { app } = require('@azure/functions');
const { generateAuthenticationOptions } = require('@simplewebauthn/server');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { signToken } = require('../lib/passkeyToken');
const { getRpId } = require('../lib/passkeyRpId');

// 30/min/IP — looser than register (auth is the more common
// repeat-action; on a fresh device the user may need to retry once
// or twice if their passkey UI hiccups) but still tight enough to
// rate-limit challenge mining.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

app.http('passkeyAuthBegin', {
  route: 'v1/passkey/auth/begin',
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

    const secret = process.env.PASSKEY_HMAC_SECRET;
    if (!secret) {
      context.error('PASSKEY_HMAC_SECRET env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const rpID = getRpId(req.url);

    // No allowCredentials — we're "discoverable credential" auth.
    // The platform passkey UI shows the user every credential they
    // have for this RP and lets them pick. Server learns the chosen
    // credentialID from the assertion at verify time. This is also
    // what makes second-device claim possible: the user just picks
    // their existing passkey from their iCloud/Google Password
    // Manager sync.
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });

    const signedToken = signToken({
      secret,
      payload: {
        challenge: options.challenge,
        scope: 'auth',
      },
      now: Date.now(),
    });

    return {
      status: 200,
      jsonBody: { options, signedToken },
    };
  },
});
