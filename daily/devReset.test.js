import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEV_RESET_STORAGE_KEYS,
  clearBrowserState,
  clearCosmosLocalRows,
  mountDevReset,
} from './devReset.js';

/** A fetch stub that returns a happy empty response. Used by tests that
 * only care about the mount/click flow, not the network shape. */
const okFetch = /** @type {any} */ (async () => ({ ok: true, json: async () => ({}) }));

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    /** @param {string} k */
    getItem(k) { return m.has(k) ? /** @type {string} */ (m.get(k)) : null; },
    /** @param {string} k @param {string} v */
    setItem(k, v) { m.set(k, v); },
    /** @param {string} k */
    removeItem(k) { m.delete(k); },
    _map: m,
  };
}

function makeDoc() {
  /** @type {any} */
  const doc = {};
  doc.createElement = (tag) => {
    /** @type {any} */
    const el = {
      tag,
      className: '',
      textContent: '',
      title: '',
      type: '',
      disabled: false,
      children: [],
      attrs: {},
      listeners: {},
      ownerDocument: doc,
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(evt, fn) { this.listeners[evt] = fn; },
    };
    return el;
  };
  return doc;
}

test('clearBrowserState removes the four known keys and leaves others alone', () => {
  const s = fakeStorage({
    'gridgame.deviceId': 'abc',
    'gridgame.submittedPuzzles': '[1,2]',
    'daily.scores': '{}',
    'gridgame.ideas.reviewed': '[5]',
    'unrelated.key': 'keep',
  });
  clearBrowserState(s);
  for (const k of DEV_RESET_STORAGE_KEYS) {
    assert.equal(s.getItem(k), null, `${k} should be cleared`);
  }
  assert.equal(s.getItem('unrelated.key'), 'keep');
});

test('clearBrowserState swallows removeItem errors silently', () => {
  const s = {
    removeItem() { throw new Error('quota'); },
  };
  // Just shouldn't throw.
  clearBrowserState(/** @type {any} */ (s));
});

test('clearBrowserState accepts a custom key list (for future-proofing)', () => {
  const s = fakeStorage({ 'custom.key': 'x', 'gridgame.deviceId': 'y' });
  clearBrowserState(s, ['custom.key']);
  assert.equal(s.getItem('custom.key'), null);
  // Default key NOT cleared because we used a custom list.
  assert.equal(s.getItem('gridgame.deviceId'), 'y');
});

test('clearCosmosLocalRows POSTs to the expected route and returns parsed JSON', async () => {
  let called;
  const fakeFetch = async (url, opts) => {
    called = { url, opts };
    return { ok: true, status: 200, json: async () => ({ deleted: 3, scanned: 3, failed: [] }) };
  };
  const result = await clearCosmosLocalRows(/** @type {any} */ (fakeFetch));
  assert.equal(called.url, '/api/v1/dev/clear-local-rows');
  assert.equal(called.opts.method, 'POST');
  assert.deepEqual(result, { deleted: 3, scanned: 3, failed: [] });
});

test('clearCosmosLocalRows throws on non-ok HTTP status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => clearCosmosLocalRows(/** @type {any} */ (fakeFetch)), /HTTP 500/);
});

test('mountDevReset is a no-op on a non-localhost hostname', () => {
  const doc = makeDoc();
  const root = doc.createElement('div');
  const result = mountDevReset({
    rootEl: root,
    hostname: 'www.yetanotherquiz.com',
    doc,
    storage: fakeStorage(),
    fetchImpl: okFetch,
    reload: () => {},
    confirmFn: () => true,
  });
  assert.equal(result, null);
  assert.equal(root.children.length, 0);
});

test('mountDevReset injects a toolbar with two buttons on localhost', () => {
  const doc = makeDoc();
  const root = doc.createElement('div');
  const wrap = mountDevReset({
    rootEl: root,
    hostname: 'localhost',
    doc,
    storage: fakeStorage(),
    fetchImpl: okFetch,
    reload: () => {},
    confirmFn: () => true,
  });
  assert.ok(wrap);
  assert.equal(wrap.className, 'dev-reset');
  assert.equal(wrap.children.length, 2);
  assert.equal(wrap.children[0].textContent, 'Reset browser');
  assert.equal(wrap.children[1].textContent, 'Clear Cosmos local rows');
  assert.equal(root.children[0], wrap);
});

test('mountDevReset matches 127.0.0.1 and ::1 (matches the Turnstile bypass set)', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    const doc = makeDoc();
    const root = doc.createElement('div');
    const wrap = mountDevReset({
      rootEl: root, hostname: host, doc,
      storage: fakeStorage(),
      fetchImpl: okFetch,
      reload: () => {}, confirmFn: () => true,
    });
    assert.ok(wrap, `should mount on ${host}`);
  }
});

test('Reset-browser click clears storage and triggers reload (after confirm)', () => {
  const doc = makeDoc();
  const root = doc.createElement('div');
  const storage = fakeStorage({
    'gridgame.deviceId': 'abc',
    'gridgame.submittedPuzzles': '[7]',
  });
  let reloaded = 0;
  const wrap = mountDevReset({
    rootEl: root, hostname: 'localhost', doc, storage,
    fetchImpl: okFetch,
    reload: () => { reloaded++; },
    confirmFn: () => true,
  });
  wrap.children[0].listeners.click();
  assert.equal(storage.getItem('gridgame.deviceId'), null);
  assert.equal(storage.getItem('gridgame.submittedPuzzles'), null);
  assert.equal(reloaded, 1);
});

test('Reset-browser click is a no-op when confirm() returns false', () => {
  const doc = makeDoc();
  const root = doc.createElement('div');
  const storage = fakeStorage({ 'gridgame.deviceId': 'keep' });
  let reloaded = 0;
  const wrap = mountDevReset({
    rootEl: root, hostname: 'localhost', doc, storage,
    fetchImpl: okFetch,
    reload: () => { reloaded++; },
    confirmFn: () => false,
  });
  wrap.children[0].listeners.click();
  assert.equal(storage.getItem('gridgame.deviceId'), 'keep');
  assert.equal(reloaded, 0);
});
