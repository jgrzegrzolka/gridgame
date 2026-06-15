const { app } = require('@azure/functions');
const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { insertDoc, queryDocs } = require('../lib/cosmos');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { verifyToken } = require('../lib/passkeyToken');
const { getRpId, getExpectedOrigin } = require('../lib/passkeyRpId');

const DB_NAME = 'yetanotherquiz';
const CONTAINER_NAME = 'passkeys';

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

app.http('passkeyAuthVerify', {
  route: 'v1/passkey/auth/verify',
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
      expectedScope: 'auth',
    });
    if (!tokenCheck.ok) {
      return { status: 400, jsonBody: { error: tokenCheck.error } };
    }
    const { challenge } = tokenCheck.payload;

    const credentialID = body.response.id;
    if (typeof credentialID !== 'string' || credentialID.length === 0) {
      return { status: 400, jsonBody: { error: 'invalid_credentialID' } };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.error('COSMOS_CONN env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    // Point-read: partition + id both equal credentialID, so this is
    // the cheapest possible Cosmos op. queryDocs handles the
    // partition-scoped lookup cleanly.
    let queryRes;
    try {
      queryRes = await queryDocs({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: credentialID }],
        partitionKey: credentialID,
      });
    } catch (err) {
      context.error('cosmos query threw', err);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (!queryRes.ok) {
      context.error('cosmos query failed', queryRes);
      return { status: 500, jsonBody: { error: 'server_error' } };
    }
    if (queryRes.docs.length === 0) {
      return { status: 404, jsonBody: { error: 'credential_not_found' } };
    }
    const stored = queryRes.docs[0];

    const rpID = getRpId(req.url);
    const expectedOrigin = getExpectedOrigin(req.url);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: stored.credentialID,
          publicKey: Buffer.from(stored.publicKey, 'base64url'),
          counter: typeof stored.counter === 'number' ? stored.counter : 0,
          transports: Array.isArray(stored.transports) ? stored.transports : undefined,
        },
        requireUserVerification: false,
      });
    } catch (err) {
      context.warn('passkey authentication verification threw', err);
      return { status: 400, jsonBody: { error: 'verification_failed' } };
    }

    if (!verification.verified) {
      return { status: 400, jsonBody: { error: 'verification_failed' } };
    }

    // Bump the counter to defend against replay. Upsert because the
    // row already exists; the deterministic id keeps it on the same
    // partition.
    const updated = {
      ...stored,
      counter: verification.authenticationInfo.newCounter,
    };
    // Strip Cosmos system fields before upsert — they're read-only
    // and including them causes a 400.
    for (const k of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
      delete updated[k];
    }
    try {
      const res = await insertDoc({
        connString: conn,
        dbName: DB_NAME,
        containerName: CONTAINER_NAME,
        partitionKey: credentialID,
        doc: updated,
        upsert: true,
      });
      if (!res.ok) {
        context.error('cosmos counter-update upsert failed', res);
        // Don't fail the auth — replay protection degrades to "we
        // didn't bump this time", but the assertion itself was valid.
      }
    } catch (err) {
      context.warn('cosmos counter-update threw — auth still succeeds', err);
    }

    return {
      status: 200,
      jsonBody: { identityId: stored.identityId, credentialID },
    };
  },
});
