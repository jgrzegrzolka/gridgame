const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProfileDoc } = require('./profileDoc');

const DEVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('first write (no existing row): createdAt = updatedAt = now, nickname stored as given', () => {
  const doc = buildProfileDoc({
    existing: null,
    deviceId: DEVICE_ID,
    nickname: 'Alice',
    now: 1_700_000_000_000,
  });
  assert.deepEqual(doc, {
    id: DEVICE_ID,
    deviceId: DEVICE_ID,
    nickname: 'Alice',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletionRequestedAt: null,
    v: 1,
  });
});

test('subsequent write preserves the prior createdAt and bumps updatedAt', () => {
  const doc = buildProfileDoc({
    existing: { createdAt: 1_600_000_000_000 },
    deviceId: DEVICE_ID,
    nickname: 'Alice 2.0',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.createdAt, 1_600_000_000_000, 'createdAt must survive the upsert');
  assert.equal(doc.updatedAt, 1_700_000_000_000);
  assert.equal(doc.nickname, 'Alice 2.0');
});

test('null nickname clears the display name but keeps createdAt + v', () => {
  const doc = buildProfileDoc({
    existing: { createdAt: 1_600_000_000_000 },
    deviceId: DEVICE_ID,
    nickname: null,
    now: 1_700_000_000_000,
  });
  assert.equal(doc.nickname, null);
  assert.equal(doc.createdAt, 1_600_000_000_000);
  assert.equal(doc.v, 1);
});

test('existing row missing createdAt falls back to now (defensive: protects against malformed rows)', () => {
  // Could happen if someone hand-edits a row or a future migration drops
  // the field by mistake. Treating "missing" as "first write" is safer
  // than NaN-ing the doc.
  const doc = buildProfileDoc({
    existing: /** @type {any} */ ({}),
    deviceId: DEVICE_ID,
    nickname: 'Bob',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.createdAt, 1_700_000_000_000);
});

test('id always equals deviceId (Cosmos uses id+pk and both must match for the row to be one)', () => {
  const doc = buildProfileDoc({
    existing: null,
    deviceId: DEVICE_ID,
    nickname: 'Alice',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.id, doc.deviceId);
});

test('v is always 1 on a fresh writer — schema-version contract per infra/operations.md', () => {
  const fresh = buildProfileDoc({ existing: null, deviceId: DEVICE_ID, nickname: 'A', now: 1 });
  const update = buildProfileDoc({ existing: { createdAt: 1 }, deviceId: DEVICE_ID, nickname: 'A', now: 2 });
  assert.equal(fresh.v, 1);
  assert.equal(update.v, 1);
});

test('requestDeletion=true on a fresh row stamps deletionRequestedAt to now', () => {
  const doc = buildProfileDoc({
    existing: null,
    deviceId: DEVICE_ID,
    nickname: null,
    now: 1_700_000_000_000,
    requestDeletion: true,
  });
  assert.equal(doc.deletionRequestedAt, 1_700_000_000_000);
});

test('a normal nickname write preserves an existing deletionRequestedAt — only playing again clears it', () => {
  // Cancel-on-return is decided at manual purge time (any newer game-data
  // write wins over the flag), NOT inside this builder. So even a nickname
  // save while a deletion is pending must NOT silently clear the flag.
  const doc = buildProfileDoc({
    existing: { createdAt: 1_600_000_000_000, deletionRequestedAt: 1_650_000_000_000 },
    deviceId: DEVICE_ID,
    nickname: 'New name',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.deletionRequestedAt, 1_650_000_000_000);
});

test('requestDeletion=true re-stamps the flag even if one was already set', () => {
  // Idempotent re-request: user clicks Request data removal again. The
  // updatedAt and deletionRequestedAt both move forward, so the "is the
  // flag still the latest write?" check at purge time stays meaningful.
  const doc = buildProfileDoc({
    existing: { createdAt: 1_600_000_000_000, deletionRequestedAt: 1_650_000_000_000 },
    deviceId: DEVICE_ID,
    nickname: 'Alice',
    now: 1_700_000_000_000,
    requestDeletion: true,
  });
  assert.equal(doc.deletionRequestedAt, 1_700_000_000_000);
});
