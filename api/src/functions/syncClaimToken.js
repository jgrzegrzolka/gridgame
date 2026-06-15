const { app } = require('@azure/functions');
const QRCode = require('qrcode-svg');
const { signToken } = require('../lib/syncToken');
const { validateDeviceIdParam } = require('../lib/validate');
const { createRateLimiter, clientIp } = require('../lib/rateLimit');
const { isLocalRequestUrl } = require('../lib/requestHost');

// 10/min/IP. Minting a claim token is a deliberate "show QR" action;
// no legitimate flow needs more than a couple per minute.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

app.http('syncClaimToken', {
  route: 'v1/sync/claim/token',
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

    const secret = process.env.PASSKEY_HMAC_SECRET;
    if (!secret) {
      // The setting's still called PASSKEY_HMAC_SECRET from the
      // earlier Feature C iteration — same secret, new use. Rename
      // is purely cosmetic and not worth the SWA appsettings dance.
      context.error('PASSKEY_HMAC_SECRET env var is not set');
      return { status: 500, jsonBody: { error: 'server_error' } };
    }

    const token = signToken({
      secret,
      payload: { deviceId: v.value, scope: 'claim' },
      now: Date.now(),
    });

    // Build the URL the QR encodes — the scanning device opens this
    // directly. Origin is derived from the request so local dev
    // produces `http://localhost:4280/...` and prod produces
    // `https://www.yetanotherquiz.com/...`. The receiving page
    // (/profile/sync/) reads `?claim=` and runs the redeem flow.
    const origin = isLocalRequestUrl(req.url)
      ? new URL(req.url).origin
      : 'https://www.yetanotherquiz.com';
    const claimUrl = `${origin}/profile/sync/?claim=${encodeURIComponent(token)}`;

    const qr = new QRCode({
      content: claimUrl,
      padding: 2,
      width: 240,
      height: 240,
      color: '#2B1D24',      // var(--primary-color)
      background: '#ffffff',
      ecl: 'M',
      join: true,
    });

    return { status: 200, jsonBody: { token, claimUrl, qrSvg: qr.svg() } };
  },
});
