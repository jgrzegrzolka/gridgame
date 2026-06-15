const { app } = require('@azure/functions');
const crypto = require('node:crypto');
const { generateRegistrationOptions } = require('@simplewebauthn/server');
const { validateDeviceIdParam } = require('../lib/validate');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { signToken } = require('../lib/passkeyToken');
const { getRpId } = require('../lib/passkeyRpId');

// 10/min/IP. WebAuthn registration is a deliberate action that
// happens at most once per device — tighter than the broader
// engagement-event budget. The cap stops a script flooding the
// endpoint to mine challenges.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

const RP_NAME = 'Yet Another Quiz';

app.http('passkeyRegisterBegin', {
  route: 'v1/passkey/register/begin',
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
    const v = validateDeviceIdParam(body && body.deviceId, 'invalid_deviceId');
    if (!v.ok) return { status: 400, jsonBody: { error: v.error } };

    const secret = process.env.PASSKEY_HMAC_SECRET;
    if (!secret) {
      context.error('PASSKEY_HMAC_SECRET env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const rpID = getRpId(req.url);
    // Mint identityId here, ride it through the round-trip in the
    // HMAC-signed token. Client doesn't see it on the wire — the
    // verify step decodes the token and uses the identityId from
    // there. (The client gets the final identityId in the verify
    // response so it can persist it to localStorage.)
    const identityId = crypto.randomUUID();
    const userIDBytes = Buffer.from(identityId, 'utf8');

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: userIDBytes,
      // userName surfaces in the platform passkey UI ("Save passkey
      // for <userName> on yetanotherquiz.com?"). Short slice of
      // deviceId is opaque-enough for a hobby site; a future version
      // could pull the user's chosen nickname from Feature H here.
      userName: v.value.slice(0, 16),
      attestationType: 'none', // we skip attestation-chain validation; standard for self-relying parties
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    const signedToken = signToken({
      secret,
      payload: {
        challenge: options.challenge,
        scope: 'register',
        deviceIdHint: v.value,
        identityId,
      },
      now: Date.now(),
    });

    return {
      status: 200,
      jsonBody: { options, signedToken },
    };
  },
});
