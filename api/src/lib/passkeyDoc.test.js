const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPasskeyDoc } = require('./passkeyDoc');

const BASE = {
  credentialID: 'cred-abc-xyz',
  identityId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  publicKey: 'pubkey-base64-content',
  counter: 0,
  deviceIdHint: '11111111-2222-3333-4444-555555555555',
  now: 1_750_000_000_000,
};

test('buildPasskeyDoc: happy path returns the canonical doc shape', () => {
  const r = buildPasskeyDoc(BASE);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc, {
    id: 'cred-abc-xyz',
    credentialID: 'cred-abc-xyz',
    identityId: BASE.identityId,
    publicKey: BASE.publicKey,
    counter: 0,
    transports: [],
    deviceIdHint: BASE.deviceIdHint,
    createdAt: BASE.now,
    v: 1,
  });
});

test('buildPasskeyDoc: id equals credentialID (single point-read pattern)', () => {
  const r = buildPasskeyDoc(BASE);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.id, r.doc.credentialID);
});

test('buildPasskeyDoc: transports are preserved when valid', () => {
  const r = buildPasskeyDoc({ ...BASE, transports: ['internal', 'hybrid'] });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc.transports, ['internal', 'hybrid']);
});

test('buildPasskeyDoc: transports default to [] when omitted', () => {
  const r = buildPasskeyDoc(BASE);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc.transports, []);
});

test('buildPasskeyDoc: junk transports (non-strings, empty) filtered out', () => {
  const r = buildPasskeyDoc({
    ...BASE,
    transports: /** @type {any} */ (['internal', null, '', 42, 'hybrid', {}]),
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc.transports, ['internal', 'hybrid']);
});

test('buildPasskeyDoc: transports list capped at 8 to bound storage', () => {
  const many = Array(20).fill('t');
  const r = buildPasskeyDoc({ ...BASE, transports: many });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.transports.length, 8);
});

test('buildPasskeyDoc: counter must be a non-negative integer', () => {
  for (const bad of [-1, 1.5, NaN, '0', null, undefined]) {
    const r = buildPasskeyDoc({ ...BASE, counter: /** @type {any} */ (bad) });
    assert.deepEqual(r, { ok: false, error: 'invalid_counter' }, `counter=${bad}`);
  }
});

test('buildPasskeyDoc: rejects empty credentialID / identityId / publicKey / deviceIdHint', () => {
  for (const key of ['credentialID', 'identityId', 'publicKey', 'deviceIdHint']) {
    const r = buildPasskeyDoc({ ...BASE, [key]: '' });
    assert.equal(r.ok, false, `key=${key}`);
    if (r.ok) throw new Error('unreachable');
    assert.equal(r.error, `invalid_${key}`);
  }
});

test('buildPasskeyDoc: v is always 1 — schema-version contract per infra/operations.md', () => {
  const r = buildPasskeyDoc(BASE);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.v, 1);
});
