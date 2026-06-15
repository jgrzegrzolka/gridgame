const test = require('node:test');
const assert = require('node:assert/strict');
const { signToken, verifyToken, TTL_MS } = require('./passkeyToken');

const SECRET = 'a'.repeat(96); // mock 48-byte hex secret
const NOW = 1_750_000_000_000;

test('signToken + verifyToken round-trips the payload', () => {
  const tok = signToken({
    secret: SECRET,
    payload: { challenge: 'abc123', scope: 'register', deviceIdHint: 'dev-1' },
    now: NOW,
  });
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'register' });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.payload.challenge, 'abc123');
  assert.equal(r.payload.scope, 'register');
  assert.equal(r.payload.deviceIdHint, 'dev-1');
  assert.equal(r.payload.expiresAt, NOW + TTL_MS);
});

test('verifyToken rejects tampered body (HMAC mismatch)', () => {
  const tok = signToken({
    secret: SECRET,
    payload: { challenge: 'abc123', scope: 'register' },
    now: NOW,
  });
  const [body, sig] = tok.split('.');
  // Re-encode the body with a swapped challenge but keep the original signature.
  const tampered = `${body.slice(0, -3)}XXX.${sig}`;
  const r = verifyToken({ secret: SECRET, token: tampered, now: NOW, expectedScope: 'register' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('verifyToken rejects tampered signature', () => {
  const tok = signToken({
    secret: SECRET,
    payload: { challenge: 'abc123', scope: 'register' },
    now: NOW,
  });
  const [body] = tok.split('.');
  const tampered = `${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const r = verifyToken({ secret: SECRET, token: tampered, now: NOW, expectedScope: 'register' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('verifyToken rejects token signed with a different secret', () => {
  const tok = signToken({
    secret: 'wrongsecret'.repeat(8),
    payload: { challenge: 'abc123', scope: 'register' },
    now: NOW,
  });
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'register' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('verifyToken rejects expired token', () => {
  const tok = signToken({
    secret: SECRET,
    payload: { challenge: 'abc123', scope: 'register' },
    now: NOW,
  });
  const tooLate = NOW + TTL_MS + 1;
  const r = verifyToken({ secret: SECRET, token: tok, now: tooLate, expectedScope: 'register' });
  assert.deepEqual(r, { ok: false, error: 'expired_token' });
});

test('verifyToken rejects scope mismatch — register token reused on auth flow', () => {
  const tok = signToken({
    secret: SECRET,
    payload: { challenge: 'abc123', scope: 'register' },
    now: NOW,
  });
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'auth' });
  assert.deepEqual(r, { ok: false, error: 'scope_mismatch' });
});

test('verifyToken rejects malformed token (no dot)', () => {
  const r = verifyToken({ secret: SECRET, token: 'no-dot-here', now: NOW, expectedScope: 'register' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('verifyToken rejects empty / non-string token', () => {
  for (const bad of ['', null, undefined, 42, {}]) {
    const r = verifyToken({ secret: SECRET, token: bad, now: NOW, expectedScope: 'register' });
    assert.deepEqual(r, { ok: false, error: 'invalid_token' }, `token=${bad}`);
  }
});

test('verifyToken rejects token whose decoded payload has no challenge', () => {
  // Hand-craft a token with valid HMAC but a payload missing challenge.
  const crypto = require('node:crypto');
  const bad = { scope: 'register', expiresAt: NOW + 60_000 };
  const body = Buffer.from(JSON.stringify(bad)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest()
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tok = `${body}.${sig}`;
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'register' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('signToken: two consecutive calls with same payload produce identical tokens (deterministic given inputs)', () => {
  const a = signToken({ secret: SECRET, payload: { challenge: 'abc', scope: 'register' }, now: NOW });
  const b = signToken({ secret: SECRET, payload: { challenge: 'abc', scope: 'register' }, now: NOW });
  assert.equal(a, b);
});
