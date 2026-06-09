import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndRenderStats } from './statsView.js';

function makeDoc() {
  /** @type {any} */
  const doc = {};
  function makeEl(tag) {
    /** @type {any[]} */
    const children = [];
    /** @type {any} */
    const el = {
      tag, className: '', textContent: '',
      ownerDocument: doc, children,
      get innerHTML() { return ''; },
      set innerHTML(_v) { children.length = 0; },
      /** @param {any} c */
      appendChild(c) { children.push(c); return c; },
    };
    return el;
  }
  doc.createElement = makeEl;
  return doc;
}

function makeContainer(doc) {
  /** @type {any} */
  const c = {
    children: [], ownerDocument: doc, hidden: true,
    get innerHTML() { return ''; },
    set innerHTML(_v) { c.children.length = 0; },
    /** @param {any} child */
    appendChild(child) { c.children.push(child); return child; },
  };
  return c;
}

const targets = [{ code: 'ch', name: 'Switzerland' }];
const displayName = (c) => c.name;
const labels = {
  sectionTitle: 'Stats',
  loading: 'Loading…',
  noSubmissions: 'Be first',
};

const fakeRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('successful fetch passes parsed stats to render', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  /** @type {any} */
  let renderArgs;
  await loadAndRenderStats({
    n: 7, container, targets, displayName, labels,
    fetchImpl: async () => fakeRes(200, {
      totalAttempts: 10, perCodeFinds: { ch: 5 }, median: 0, topPct: 0,
    }),
    render: (c, a) => { renderArgs = a; },
  });
  assert.deepEqual(renderArgs.stats, {
    totalAttempts: 10, perCodeFinds: { ch: 5 }, median: 0, topPct: 0,
  });
  assert.equal(renderArgs.targets, targets);
  assert.equal(renderArgs.displayName, displayName);
  assert.equal(renderArgs.labels.sectionTitle, 'Stats');
  assert.equal(renderArgs.labels.noSubmissions, 'Be first');
  assert.equal(container.hidden, false);
});

test('non-2xx response hides the container silently — render not called', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  let renderCalls = 0;
  await loadAndRenderStats({
    n: 7, container, targets, displayName, labels,
    fetchImpl: async () => fakeRes(500, { error: 'server_error' }),
    render: () => { renderCalls++; },
  });
  assert.equal(renderCalls, 0);
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
});

test('fetch throwing (network error) hides the container silently', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  let renderCalls = 0;
  await loadAndRenderStats({
    n: 7, container, targets, displayName, labels,
    fetchImpl: async () => { throw new Error('offline'); },
    render: () => { renderCalls++; },
  });
  assert.equal(renderCalls, 0);
  assert.equal(container.hidden, true);
});

test('malformed JSON response hides the container silently', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  let renderCalls = 0;
  await loadAndRenderStats({
    n: 7, container, targets, displayName, labels,
    fetchImpl: async () => ({
      ok: true, status: 200, json: async () => { throw new Error('bad'); },
    }),
    render: () => { renderCalls++; },
  });
  assert.equal(renderCalls, 0);
  assert.equal(container.hidden, true);
});

test('hits the correct endpoint with the puzzle number in the path', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  let calledUrl = '';
  await loadAndRenderStats({
    n: 42, container, targets, displayName, labels,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, { totalAttempts: 0, perCodeFinds: {}, median: 0, topPct: 0 }); },
    render: () => {},
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42');
});

test('bypassCache=true appends ?fresh=1 to the URL', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  let calledUrl = '';
  await loadAndRenderStats({
    n: 42, container, targets, displayName, labels, bypassCache: true,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, { totalAttempts: 0, perCodeFinds: {}, median: 0, topPct: 0 }); },
    render: () => {},
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42?fresh=1');
});

test('bypassCache=false (default) sends the bare URL', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  let calledUrl = '';
  await loadAndRenderStats({
    n: 42, container, targets, displayName, labels, bypassCache: false,
    fetchImpl: async (url) => { calledUrl = url; return fakeRes(200, { totalAttempts: 0, perCodeFinds: {}, median: 0, topPct: 0 }); },
    render: () => {},
  });
  assert.equal(calledUrl, '/api/v1/daily/stats/42');
});

test('shows loading text in the container before the fetch resolves', async () => {
  const doc = makeDoc();
  const container = makeContainer(doc);
  // Capture container state at fetch time by stalling the resolution.
  let resolveFetch;
  const fetchImpl = () => new Promise((resolve) => { resolveFetch = resolve; });
  const renderPromise = loadAndRenderStats({
    n: 7, container, targets, displayName, labels,
    fetchImpl, render: () => {},
  });
  // At this point the fetch hasn't resolved — container should show loading.
  assert.equal(container.hidden, false);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].textContent, 'Loading…');
  assert.equal(container.children[0].className, 'find-stats-loading');
  // Now resolve and let the function finish.
  resolveFetch(fakeRes(200, { totalAttempts: 0, perCodeFinds: {}, median: 0, topPct: 0 }));
  await renderPromise;
});
