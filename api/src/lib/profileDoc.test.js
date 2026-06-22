const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProfileDoc, deriveNicknameAuto, decideEnsureResponse } = require('./profileDoc');

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
    nicknameAuto: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletionRequestedAt: null,
    linkedAt: null,
    syncBlob: null,
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

test('linkedAt is preserved from existing — a nickname edit must not erase the link marker', () => {
  // linkedAt is written by syncMerge (sync.linked container of truth on
  // the server). Editing nickname must not silently clear it, or the
  // user could "lose" their link state by changing display name.
  const doc = buildProfileDoc({
    existing: { createdAt: 1_600_000_000_000, linkedAt: 1_680_000_000_000 },
    deviceId: DEVICE_ID,
    nickname: 'New name',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.linkedAt, 1_680_000_000_000);
});

test('linkedAt defaults to null when neither existing nor input provides it', () => {
  const fresh = buildProfileDoc({ existing: null, deviceId: DEVICE_ID, nickname: 'A', now: 1 });
  assert.equal(fresh.linkedAt, null);
});

// ---------------------------------------------------------------------------
// nicknameAuto (Feature S Phase 1a) — derived from `nickname`, never stored
// as a separate input. Captures whether the user has actively picked a name.
// ---------------------------------------------------------------------------

test('nicknameAuto is true when nickname is null (auto-created or cleared)', () => {
  const doc = buildProfileDoc({
    existing: null,
    deviceId: DEVICE_ID,
    nickname: null,
    now: 1_700_000_000_000,
  });
  assert.equal(doc.nicknameAuto, true);
});

test('nicknameAuto is true when nickname is an empty string (defensive — same as null)', () => {
  // An empty string survives JSON round-trip differently than null but means
  // the same thing for display: no name picked. Treating both as auto keeps
  // the flag honest under client-side edge cases.
  const doc = buildProfileDoc({
    existing: null,
    deviceId: DEVICE_ID,
    nickname: '',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.nicknameAuto, true);
});

test('nicknameAuto is false when the user supplies a real nickname', () => {
  const doc = buildProfileDoc({
    existing: null,
    deviceId: DEVICE_ID,
    nickname: 'Alice',
    now: 1_700_000_000_000,
  });
  assert.equal(doc.nicknameAuto, false);
});

test('clearing a chosen nickname (Alice → null) flips nicknameAuto back to true', () => {
  // Symmetry with the customise path: the flag follows the nickname value,
  // it doesn't latch on first user-set. Lets a player who regrets their
  // pick reset to the default without leaving a stale "you chose this"
  // marker on their row.
  const doc = buildProfileDoc({
    existing: { createdAt: 1_600_000_000_000 },
    deviceId: DEVICE_ID,
    nickname: null,
    now: 1_700_000_000_000,
  });
  assert.equal(doc.nicknameAuto, true);
});

// ---------------------------------------------------------------------------
// deriveNicknameAuto — read-side interpreter. Trusts a stored value when
// present, falls back to the builder's derivation rule otherwise.
// ---------------------------------------------------------------------------

test('deriveNicknameAuto trusts the stored value when the row has the field', () => {
  // The stored value wins even when it would disagree with the nickname:
  // future writes (or hand-edits) can carry richer semantics than the
  // simple null/non-null rule.
  assert.equal(deriveNicknameAuto({ nicknameAuto: true }, 'Alice'), true);
  assert.equal(deriveNicknameAuto({ nicknameAuto: false }, null), false);
});

test('deriveNicknameAuto falls back to nickname-derived rule on legacy rows (no nicknameAuto field)', () => {
  // Rows written before Feature S Phase 1a won't have the field. Reading
  // them should match what a fresh write would have produced for the
  // same nickname.
  assert.equal(deriveNicknameAuto({}, null), true);
  assert.equal(deriveNicknameAuto({}, ''), true);
  assert.equal(deriveNicknameAuto({}, 'Alice'), false);
});

test('deriveNicknameAuto returns true when no row exists (device never wrote a profile)', () => {
  // Matches the client-side `defaultNickname` fallback — a device with
  // no Cosmos row is, by definition, on its deterministic default.
  assert.equal(deriveNicknameAuto(null, null), true);
  assert.equal(deriveNicknameAuto(undefined, null), true);
});

test('deriveNicknameAuto ignores non-boolean stored values (defensive against malformed rows)', () => {
  // If the field is somehow a string or number, fall through to the
  // nickname rule rather than coerce — safer than honouring junk.
  assert.equal(deriveNicknameAuto(/** @type {any} */ ({ nicknameAuto: 'true' }), 'Alice'), false);
  assert.equal(deriveNicknameAuto(/** @type {any} */ ({ nicknameAuto: 1 }), null), true);
});

// ---------------------------------------------------------------------------
// decideEnsureResponse — three-branch insert-result-to-HTTP-response map.
// ---------------------------------------------------------------------------

test('decideEnsureResponse: ok → 201 created:true', () => {
  assert.deepEqual(
    decideEnsureResponse({ ok: true }),
    { status: 201, body: { ok: true, created: true } },
  );
});

test('decideEnsureResponse: conflict → 200 created:false (idempotent / race-safe)', () => {
  // The caller promised "this device now has a row." A conflict means
  // another request (concurrent ensure, or a returning device with a
  // cleared localStorage sentinel) already created it. Postcondition
  // satisfied → success.
  assert.deepEqual(
    decideEnsureResponse({ ok: false, error: 'conflict' }),
    { status: 200, body: { ok: true, created: false } },
  );
});

test('decideEnsureResponse: any other failure → 500 server_error', () => {
  for (const error of ['cosmos_error', 'unknown', undefined]) {
    assert.deepEqual(
      decideEnsureResponse(/** @type {any} */ ({ ok: false, error })),
      { status: 500, body: { error: 'server_error' } },
      `error=${error}`,
    );
  }
});

// ---------------------------------------------------------------------------
// syncBlob (Feature S Phase 2) — opaque JSON carrier for per-device roaming
// state (achievement counters, day logs, etc.). The builder's job is to
// distinguish "not touching the blob" (preserve existing) from "explicit
// caller decision to set/clear" (honour the value).
// ---------------------------------------------------------------------------

test('syncBlob: defaults to null on a fresh row when caller omits it', () => {
  const doc = buildProfileDoc({
    existing: null, deviceId: DEVICE_ID, nickname: null, now: 1,
  });
  assert.equal(doc.syncBlob, null);
});

test('syncBlob: preserves existing blob when caller omits the field (nickname-only edit)', () => {
  // A nickname edit must NOT wipe the client's roaming achievement state —
  // the builder's contract is "don't touch fields the caller didn't pass."
  const existing = { createdAt: 1, syncBlob: { engagement: { shareCount: 5 } } };
  const doc = buildProfileDoc({
    existing, deviceId: DEVICE_ID, nickname: 'New name', now: 2,
  });
  assert.deepEqual(doc.syncBlob, { engagement: { shareCount: 5 } });
});

test('syncBlob: caller-supplied blob wins (sync-blob endpoint set it)', () => {
  const existing = { createdAt: 1, syncBlob: { engagement: { shareCount: 5 } } };
  const fresh = { engagement: { shareCount: 10 }, quiz60sDayLog: [19000] };
  const doc = buildProfileDoc({
    existing, deviceId: DEVICE_ID, nickname: null, now: 2, syncBlob: fresh,
  });
  assert.deepEqual(doc.syncBlob, fresh);
});

test('syncBlob: explicit null from caller honours the clear (not the same as omitted)', () => {
  // Distinguishing "didn't pass" from "passed null" matters: a future
  // "reset my sync state" endpoint needs to be able to clear the blob,
  // and there's no other in-band signal that means "definitely clear."
  const existing = { createdAt: 1, syncBlob: { engagement: { shareCount: 5 } } };
  const doc = buildProfileDoc({
    existing, deviceId: DEVICE_ID, nickname: null, now: 2, syncBlob: null,
  });
  assert.equal(doc.syncBlob, null);
});

test('syncBlob: legacy row missing the field → preserved as null (defensive)', () => {
  // Profile rows written before Feature S Phase 2 won't have syncBlob.
  // Treating missing-on-existing as "start at null" matches the fresh-row
  // case and means a nickname edit on a legacy row populates the field
  // without surprising the caller.
  const existing = { createdAt: 1 };
  const doc = buildProfileDoc({
    existing, deviceId: DEVICE_ID, nickname: 'Alice', now: 2,
  });
  assert.equal(doc.syncBlob, null);
});
