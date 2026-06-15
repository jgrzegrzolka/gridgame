const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEngagementDoc } = require('./engagementDoc');

const BASE = {
  deviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  dayId: 20598,
  occurredAt: 1_750_000_000_000,
  uuid: '11111111-2222-3333-4444-555555555555',
};

// ----- daily_start ---------------------------------------------------------

test('daily_start: builds doc with deterministic id', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'daily_start',
    payload: { puzzleId: 7 },
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.id, 'daily_start:20598:7');
  assert.equal(r.doc.deviceId, BASE.deviceId);
  assert.equal(r.doc.kind, 'daily_start');
  assert.equal(r.doc.dayId, BASE.dayId);
  assert.equal(r.doc.occurredAt, BASE.occurredAt);
  assert.deepEqual(r.doc.payload, { puzzleId: 7 });
  assert.equal(r.doc.v, 1);
  assert.equal(r.doc.local, undefined);
});

test('daily_start: id is deterministic across uuid changes (uuid ignored for daily_start)', () => {
  const r1 = buildEngagementDoc({
    ...BASE,
    kind: 'daily_start',
    payload: { puzzleId: 7 },
    uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  });
  const r2 = buildEngagementDoc({
    ...BASE,
    kind: 'daily_start',
    payload: { puzzleId: 7 },
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) throw new Error('unreachable');
  assert.equal(r1.doc.id, r2.doc.id);
});

test('daily_start: rejects missing puzzleId', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'daily_start',
    payload: {},
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('daily_start: rejects non-integer puzzleId', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'daily_start',
    payload: { puzzleId: 7.5 },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('daily_start: rejects zero / negative puzzleId', () => {
  for (const puzzleId of [0, -1, -100]) {
    const r = buildEngagementDoc({
      ...BASE,
      kind: 'daily_start',
      payload: { puzzleId },
    });
    assert.deepEqual(r, { ok: false, error: 'invalid_payload' }, `puzzleId=${puzzleId}`);
  }
});

test('daily_start: strips unknown payload fields', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'daily_start',
    payload: { puzzleId: 7, sneaky: 'value', another: 42 },
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc.payload, { puzzleId: 7 });
});

// ----- findflag_play -------------------------------------------------------

test('findflag_play: builds doc with uuid id', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'findflag_play',
    payload: { filter: 'motif:bird,continent:Asia', mode: 'custom' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.id, `findflag_play:${BASE.uuid}`);
  assert.equal(r.doc.kind, 'findflag_play');
  assert.deepEqual(r.doc.payload, { filter: 'motif:bird,continent:Asia', mode: 'custom' });
});

test('findflag_play: id changes per uuid (multiple plays per day are distinct)', () => {
  const r1 = buildEngagementDoc({
    ...BASE,
    kind: 'findflag_play',
    payload: { filter: 'a', mode: 'random' },
    uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  });
  const r2 = buildEngagementDoc({
    ...BASE,
    kind: 'findflag_play',
    payload: { filter: 'a', mode: 'random' },
    uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) throw new Error('unreachable');
  assert.notEqual(r1.doc.id, r2.doc.id);
});

test('findflag_play: accepts both modes', () => {
  for (const mode of ['random', 'custom']) {
    const r = buildEngagementDoc({
      ...BASE,
      kind: 'findflag_play',
      payload: { filter: 'x', mode },
    });
    assert.equal(r.ok, true, `mode=${mode}`);
  }
});

test('findflag_play: rejects unknown mode', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'findflag_play',
    payload: { filter: 'x', mode: 'extreme' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('findflag_play: rejects empty filter', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'findflag_play',
    payload: { filter: '', mode: 'random' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('findflag_play: rejects oversized filter', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'findflag_play',
    payload: { filter: 'a'.repeat(257), mode: 'random' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

// ----- share ---------------------------------------------------------------

test('share: builds doc with uuid id', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'daily', contextHint: '7' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.id, `share:${BASE.uuid}`);
  assert.equal(r.doc.kind, 'share');
  assert.deepEqual(r.doc.payload, { surface: 'daily', contextHint: '7' });
});

test('share: contextHint is optional — absent in payload when not provided', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'daily' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc.payload, { surface: 'daily' });
  assert.equal('contextHint' in /** @type {object} */ (r.doc.payload), false);
});

test('share: accepts all four surfaces', () => {
  for (const surface of ['daily', 'findflag', 'flagquiz', 'ttt']) {
    const r = buildEngagementDoc({
      ...BASE,
      kind: 'share',
      payload: { surface },
    });
    assert.equal(r.ok, true, `surface=${surface}`);
  }
});

test('share: rejects unknown surface', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'instagram' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('share: rejects empty contextHint', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'daily', contextHint: '' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('share: rejects oversized contextHint', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'daily', contextHint: 'x'.repeat(129) },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('share: strips unknown payload fields', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'daily', contextHint: '7', leaked: 'no' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.deepEqual(r.doc.payload, { surface: 'daily', contextHint: '7' });
});

// ----- top-level validation ------------------------------------------------

test('rejects unknown kind', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: /** @type {any} */ ('mystery'),
    payload: {},
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_kind' });
});

test('rejects empty deviceId', () => {
  const r = buildEngagementDoc({
    ...BASE,
    deviceId: '',
    kind: 'share',
    payload: { surface: 'daily' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_deviceId' });
});

test('rejects non-integer dayId', () => {
  const r = buildEngagementDoc({
    ...BASE,
    dayId: 20598.5,
    kind: 'share',
    payload: { surface: 'daily' },
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_dayId' });
});

test('rejects non-positive occurredAt', () => {
  for (const occurredAt of [0, -1, -1000]) {
    const r = buildEngagementDoc({
      ...BASE,
      occurredAt,
      kind: 'share',
      payload: { surface: 'daily' },
    });
    assert.deepEqual(r, { ok: false, error: 'invalid_occurredAt' }, `occurredAt=${occurredAt}`);
  }
});

test('rejects null payload', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: null,
  });
  assert.deepEqual(r, { ok: false, error: 'invalid_payload' });
});

test('local: true is stamped onto the doc', () => {
  const r = buildEngagementDoc({
    ...BASE,
    kind: 'share',
    payload: { surface: 'daily' },
    local: true,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  assert.equal(r.doc.local, true);
});

test('local: false / undefined leaves field absent', () => {
  for (const local of [false, undefined]) {
    const r = buildEngagementDoc({
      ...BASE,
      kind: 'share',
      payload: { surface: 'daily' },
      local,
    });
    assert.equal(r.ok, true, `local=${local}`);
    if (!r.ok) throw new Error('unreachable');
    assert.equal('local' in r.doc, false, `local=${local}`);
  }
});
