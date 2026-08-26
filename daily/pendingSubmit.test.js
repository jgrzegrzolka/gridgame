import test from 'node:test';
import assert from 'node:assert';
import {
  STORAGE_KEY, MAX_ATTEMPTS, savePending, loadPending, clearPending, countPending, isPending,
} from './pendingSubmit.js';

/** Minimal localStorage stand-in. */
function fakeStore(initial = {}) {
  const map = { ...initial };
  return {
    map,
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
  };
}

const payload = (n = 82) => ({
  n,
  foundCodes: ['am', 'az'],
  wrongCodes: ['tr'],
  totalCount: 13,
  durationMs: 3_800_000,
  deviceId: '7012d6ba-997e-4f55-b1fc-836f72ee59a9',
});

test('loadPending: empty store yields no entries', () => {
  assert.deepStrictEqual(loadPending(fakeStore()), []);
});

test('savePending then loadPending round-trips the payload', () => {
  const store = fakeStore();
  savePending(store, payload());
  const out = loadPending(store);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].foundCodes, ['am', 'az']);
  assert.deepStrictEqual(out[0].wrongCodes, ['tr']);
  assert.strictEqual(out[0].n, 82);
  assert.strictEqual(out[0].totalCount, 13);
  assert.strictEqual(out[0].durationMs, 3_800_000);
  assert.strictEqual(out[0].deviceId, '7012d6ba-997e-4f55-b1fc-836f72ee59a9');
});

test('savePending: re-saving the same puzzle replaces rather than duplicates', () => {
  const store = fakeStore();
  savePending(store, payload());
  savePending(store, { ...payload(), totalCount: 9 });
  const out = loadPending(store);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].totalCount, 9);
});

test('savePending: keeps separate puzzles side by side', () => {
  const store = fakeStore();
  savePending(store, payload(82));
  savePending(store, payload(81));
  assert.strictEqual(countPending(store), 2);
});

test('clearPending: drops only the named puzzle', () => {
  const store = fakeStore();
  savePending(store, payload(82));
  savePending(store, payload(81));
  clearPending(store, 82);
  const out = loadPending(store);
  assert.deepStrictEqual(out.map((p) => p.n), [81]);
});

test('clearPending: clearing an absent puzzle is a no-op', () => {
  const store = fakeStore();
  savePending(store, payload(82));
  clearPending(store, 4);
  assert.strictEqual(countPending(store), 1);
});

test('savePending: counts attempts so a permanently-invalid payload stops retrying', () => {
  const store = fakeStore();
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    savePending(store, payload());
    assert.strictEqual(countPending(store), 1, `still offered after ${i + 1} attempt(s)`);
  }
  savePending(store, payload());
  assert.deepStrictEqual(loadPending(store), [], 'exhausted payloads stop being offered');
});

test('savePending: the attempt counter survives a reload', () => {
  const store = fakeStore();
  savePending(store, payload());
  const raw = JSON.parse(store.getItem(STORAGE_KEY));
  assert.strictEqual(raw['82'].a, 1);
  savePending(store, payload());
  assert.strictEqual(JSON.parse(store.getItem(STORAGE_KEY))['82'].a, 2);
});

test('loadPending: a corrupt blob degrades to empty, never throws', () => {
  assert.deepStrictEqual(loadPending(fakeStore({ [STORAGE_KEY]: 'not json' })), []);
  assert.deepStrictEqual(loadPending(fakeStore({ [STORAGE_KEY]: '[1,2,3]' })), []);
  assert.deepStrictEqual(loadPending(fakeStore({ [STORAGE_KEY]: '{"82":null}' })), []);
});

test('loadPending: an entry missing required fields is skipped', () => {
  const store = fakeStore();
  savePending(store, { ...payload(), deviceId: '' });
  assert.deepStrictEqual(loadPending(store), []);
  const store2 = fakeStore();
  savePending(store2, { ...payload(), totalCount: 0 });
  assert.deepStrictEqual(loadPending(store2), []);
});

test('savePending: a throwing store degrades silently', () => {
  const store = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
    removeItem: () => {},
  };
  assert.doesNotThrow(() => savePending(store, payload()));
});

test('isPending: true only while the puzzle is parked', () => {
  const store = fakeStore();
  assert.strictEqual(isPending(store, 82), false);
  savePending(store, payload(82));
  assert.strictEqual(isPending(store, 82), true);
  assert.strictEqual(isPending(store, 81), false);
  clearPending(store, 82);
  assert.strictEqual(isPending(store, 82), false);
});

test('isPending: false once the attempt count is exhausted', () => {
  const store = fakeStore();
  for (let i = 0; i < MAX_ATTEMPTS; i++) savePending(store, payload(82));
  assert.strictEqual(isPending(store, 82), false);
});
