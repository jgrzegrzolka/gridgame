const test = require('node:test');
const assert = require('node:assert/strict');
const { signToken, verifyToken, DEFAULT_TTL_MS } = require('./syncToken');

const SECRET = 'a'.repeat(96);
const NOW = 1_780_000_000_000;
const DEV = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('signToken + verifyToken round-trip carries the deviceId', () => {
  const tok = signToken({
    secret: SECRET,
    payload: { deviceId: DEV, scope: 'claim' },
    now: NOW,
  });
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'claim' });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.payload.deviceId, DEV);
  assert.equal(r.payload.scope, 'claim');
  assert.equal(r.payload.expiresAt, NOW + DEFAULT_TTL_MS);
});

test('verifyToken rejects tampered body', () => {
  const tok = signToken({ secret: SECRET, payload: { deviceId: DEV, scope: 'claim' }, now: NOW });
  const [body, sig] = tok.split('.');
  const tampered = `${body.slice(0, -3)}XXX.${sig}`;
  const r = verifyToken({ secret: SECRET, token: tampered, now: NOW, expectedScope: 'claim' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('verifyToken rejects token signed with wrong secret', () => {
  const tok = signToken({ secret: 'wrong'.repeat(20), payload: { deviceId: DEV, scope: 'claim' }, now: NOW });
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'claim' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('verifyToken rejects expired token', () => {
  const tok = signToken({ secret: SECRET, payload: { deviceId: DEV, scope: 'claim' }, now: NOW });
  const r = verifyToken({
    secret: SECRET, token: tok, now: NOW + DEFAULT_TTL_MS + 1, expectedScope: 'claim',
  });
  assert.deepEqual(r, { ok: false, error: 'expired_token' });
});

test('verifyToken rejects malformed token', () => {
  for (const bad of ['', 'no-dot', null, undefined, 42, {}]) {
    const r = verifyToken({ secret: SECRET, token: bad, now: NOW, expectedScope: 'claim' });
    assert.deepEqual(r, { ok: false, error: 'invalid_token' }, `bad=${bad}`);
  }
});

test('verifyToken rejects payload with no deviceId', () => {
  const crypto = require('node:crypto');
  const bad = { scope: 'claim', expiresAt: NOW + 1000 };
  const body = Buffer.from(JSON.stringify(bad)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest()
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tok = `${body}.${sig}`;
  const r = verifyToken({ secret: SECRET, token: tok, now: NOW, expectedScope: 'claim' });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
});

test('signToken is deterministic for same inputs', () => {
  const a = signToken({ secret: SECRET, payload: { deviceId: DEV, scope: 'claim' }, now: NOW });
  const b = signToken({ secret: SECRET, payload: { deviceId: DEV, scope: 'claim' }, now: NOW });
  assert.equal(a, b);
});
