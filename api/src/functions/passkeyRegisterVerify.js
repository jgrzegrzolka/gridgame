const { app } = require('@azure/functions');
const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const crypto = require('node:crypto');
const { insertDoc } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyToken, signToken } = require('../lib/passkeyToken');
const { getRpId, getExpectedOrigin } = require('../lib/passkeyRpId');
const { buildPasskeyDoc } = require('../lib/passkeyDoc');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'passkeys';

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('passkeyRegisterVerify', {
  route: 'v1/passkey/register/verify',
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
    if (!body.response || typeof body.response !== 'object') {
      return { status: 400, jsonBody: { error: 'invalid_response' } };
    }

    const secret = process.env.PASSKEY_HMAC_SECRET;
    if (!secret) {
      context.error('PASSKEY_HMAC_SECRET env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const tokenCheck = verifyToken({
      secret,
      token: body.signedToken,
      now: Date.now(),
      expectedScope: 'register',
    });
    if (!tokenCheck.ok) {
      return { status: 400, jsonBody: { error: tokenCheck.error } };
    }
    const { challenge, deviceIdHint, identityId } = tokenCheck.payload;
    if (!deviceIdHint || !identityId) {
      // Belt-and-braces: register tokens always carry both fields,
      // but a malformed payload that somehow validates HMAC shouldn't
      // crash later steps with `undefined`.
      return { status: 400, jsonBody: { error: 'invalid_token' } };
    }

    const rpID = getRpId(req.url);
    const expectedOrigin = getExpectedOrigin(req.url);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      context.warn('passkey registration verification threw', err);
      return { status: 400, jsonBody: { error: 'verification_failed' } };
    }

    if (!verification.verified || !verification.registrationInfo) {
      return { status: 400, jsonBody: { error: 'verification_failed' } };
    }

    const info = verification.registrationInfo;
    const credentialID = info.credential.id;
    const publicKey = Buffer.from(info.credential.publicKey).toString('base64url');
    const counter = info.credential.counter;
    const transports = Array.isArray(info.credential.transports) ? info.credential.transports : [];

    const built = buildPasskeyDoc({
      credentialID,
      identityId,
      publicKey,
      counter,
      transports,
      deviceIdHint,
      now: Date.now(),
    });
    if (!built.ok) {
      context.error('buildPasskeyDoc failed', built.error);
      return { status: 500, jsonBody: { error: 'server_error' } };
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
        partitionKey: credentialID,
        doc: built.doc,
      });
    } catch (err) {
      context.error('cosmos insert threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!result.ok) {
      // Collision on credentialID is essentially impossible in
      // practice (authenticator-generated, ≥128 bits of entropy), but
      // surface it cleanly if it ever happens.
      if (result.error === 'conflict') {
        return { status: 409, jsonBody: { error: 'credential_already_registered' } };
      }
      context.error('cosmos insert failed', result);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Issue a merge-scope token so the client can call /sync/preview
    // and /sync/merge with proof that this user just successfully
    // registered for the identity. targetDeviceId here equals the
    // registering deviceId — on first registration that's the only
    // device; the client only invokes the merge endpoints when a
    // *different* localStorage deviceId needs to be folded in (which
    // is the auth-on-second-device flow, not register).
    const mergeToken = signToken({
      secret,
      payload: {
        challenge: crypto.randomUUID(),
        scope: 'merge',
        identityId,
        targetDeviceId: deviceIdHint,
      },
      now: Date.now(),
    });

    return {
      status: 201,
      jsonBody: { identityId, credentialID, targetDeviceId: deviceIdHint, mergeToken },
    };
  },
});
