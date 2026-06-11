const test = require('node:test');
const assert = require('node:assert/strict');
const { mergePairResult } = require('./tttPairDoc');

const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OPP = '11111111-2222-3333-4444-555555555555';
const NOW = 1_700_000_000_000;

test('first write (no existing): all counters 0 except the bumped slot, v: 1', () => {
  const doc = mergePairResult({
    existing: null,
    deviceId: DEVICE,
    opponentId: OPP,
    mode: '3x3',
    outcome: 'win',
    now: NOW,
  });
  assert.deepEqual(doc, {
    id: `${DEVICE}:${OPP}`,
    deviceId: DEVICE,
    opponentId: OPP,
    m3x3: { wins: 1, losses: 0, draws: 0 },
    m9x9: { wins: 0, losses: 0, draws: 0 },
    lastPlayedAt: NOW,
    v: 1,
  });
});

test('loss bumps the losses slot, not wins', () => {
  const doc = mergePairResult({
    existing: null, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'loss', now: NOW,
  });
  assert.equal(doc.m3x3.losses, 1);
  assert.equal(doc.m3x3.wins, 0);
});

test('draw bumps the draws slot', () => {
  const doc = mergePairResult({
    existing: null, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'draw', now: NOW,
  });
  assert.equal(doc.m3x3.draws, 1);
});

test('9x9 outcome bumps m9x9 only — m3x3 stays at zero', () => {
  const doc = mergePairResult({
    existing: null, deviceId: DEVICE, opponentId: OPP,
    mode: '9x9', outcome: 'win', now: NOW,
  });
  assert.deepEqual(doc.m3x3, { wins: 0, losses: 0, draws: 0 });
  assert.equal(doc.m9x9.wins, 1);
});

test('subsequent write increments the right counter and preserves the others', () => {
  const existing = {
    id: `${DEVICE}:${OPP}`,
    deviceId: DEVICE,
    opponentId: OPP,
    m3x3: { wins: 3, losses: 1, draws: 2 },
    m9x9: { wins: 0, losses: 1, draws: 0 },
    lastPlayedAt: NOW - 1000,
    v: 1,
  };
  const doc = mergePairResult({
    existing, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'win', now: NOW,
  });
  assert.deepEqual(doc.m3x3, { wins: 4, losses: 1, draws: 2 });
  // 9x9 untouched, lastPlayedAt bumped.
  assert.deepEqual(doc.m9x9, { wins: 0, losses: 1, draws: 0 });
  assert.equal(doc.lastPlayedAt, NOW);
});

test('partial existing row (missing m9x9, missing draws bucket) is normalised to zeros', () => {
  // Defensive: an out-of-band edit or a future migration that adds a
  // bucket shouldn't NaN the merge.
  const existing = {
    id: `${DEVICE}:${OPP}`,
    deviceId: DEVICE,
    opponentId: OPP,
    m3x3: { wins: 5, losses: 2 },  // no draws bucket
    // no m9x9 at all
    v: 1,
  };
  const doc = mergePairResult({
    existing, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'draw', now: NOW,
  });
  assert.equal(doc.m3x3.wins, 5);
  assert.equal(doc.m3x3.losses, 2);
  assert.equal(doc.m3x3.draws, 1, 'missing bucket starts at 0 then gets +1');
  assert.deepEqual(doc.m9x9, { wins: 0, losses: 0, draws: 0 });
});

test('garbage counter (NaN, negative, string) is treated as 0 — never propagates', () => {
  const existing = {
    m3x3: { wins: 'lots', losses: -5, draws: NaN },
  };
  const doc = mergePairResult({
    existing, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'win', now: NOW,
  });
  assert.deepEqual(doc.m3x3, { wins: 1, losses: 0, draws: 0 });
});

test('id is always "{deviceId}:{opponentId}" and matches the partition key', () => {
  const doc = mergePairResult({
    existing: null, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'win', now: NOW,
  });
  assert.equal(doc.id, `${DEVICE}:${OPP}`);
  assert.equal(doc.deviceId, DEVICE);
});

test('v is always 1 — schema-version contract per infra/operations.md', () => {
  const fresh = mergePairResult({
    existing: null, deviceId: DEVICE, opponentId: OPP,
    mode: '3x3', outcome: 'win', now: 1,
  });
  const update = mergePairResult({
    existing: { m3x3: { wins: 1 }, v: 1 },
    deviceId: DEVICE, opponentId: OPP, mode: '3x3', outcome: 'loss', now: 2,
  });
  assert.equal(fresh.v, 1);
  assert.equal(update.v, 1);
});
