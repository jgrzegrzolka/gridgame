import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrichTelemetryItem, CORRELATION_EXCLUDED_DOMAINS } from './index.js';
import { httpServerUrlFor, serverUrlFor } from '../flags/roomNet.js';

test('enrichTelemetryItem stamps role, user.id tag, and customDimension on an empty envelope', () => {
  const item = {};
  enrichTelemetryItem(item, 'device-abc');
  assert.deepEqual(item.tags, { 'ai.cloud.role': 'web', 'ai.user.id': 'device-abc' });
  assert.deepEqual(item.data, { deviceId: 'device-abc' });
});

test('enrichTelemetryItem preserves existing tags and data', () => {
  const item = {
    tags: { 'ai.operation.name': '/daily' },
    data: { someExisting: 1 },
  };
  enrichTelemetryItem(item, 'device-abc');
  // existing kept
  assert.equal(item.tags['ai.operation.name'], '/daily');
  assert.equal(item.data.someExisting, 1);
  // ours added
  assert.equal(item.tags['ai.cloud.role'], 'web');
  assert.equal(item.tags['ai.user.id'], 'device-abc');
  assert.equal(item.data.deviceId, 'device-abc');
});

test('enrichTelemetryItem overrides any earlier ai.user.id (SDK auto-set anonymous id)', () => {
  // The SDK defaults to a random anonymous id stored in a cookie. We
  // want our stable deviceId to take precedence so a single browser
  // always shows as one user_Id across sessions.
  const item = { tags: { 'ai.user.id': 'sdk-random-uuid' } };
  enrichTelemetryItem(item, 'device-abc');
  assert.equal(item.tags['ai.user.id'], 'device-abc');
});

test('enrichTelemetryItem is idempotent — calling twice with same deviceId leaves the same shape', () => {
  const item = {};
  enrichTelemetryItem(item, 'device-abc');
  const snapshot = JSON.parse(JSON.stringify(item));
  enrichTelemetryItem(item, 'device-abc');
  assert.deepEqual(item, snapshot);
});

// ---- correlation-header exclusions ----

// `enableCorsCorrelation` attaches a `Request-Id` header to cross-origin calls.
// Against PartyKit that header is not merely useless (PartyKit is not ours to
// instrument) — it turns a simple GET into a preflighted one, and PartyKit
// answers no OPTIONS, so the browser blocks the request outright. That silently
// killed the room-liveness probe behind Flag Party's "Rejoin" line in
// production, while local dev looked fine because App Insights does not load on
// localhost at all. These pin the exclusion so it cannot drift back.

test('the PartyKit host is excluded from correlation headers', () => {
  const host = new URL(httpServerUrlFor('www.yetanotherquiz.com', 'party')).hostname;
  assert.ok(
    CORRELATION_EXCLUDED_DOMAINS.includes(host),
    `${host} must be in CORRELATION_EXCLUDED_DOMAINS — the Request-Id header preflights the ` +
      'liveness probe and PartyKit serves no OPTIONS, so the request is blocked',
  );
});

test('the excluded host matches the one the WebSocket uses — one host, one exclusion', () => {
  // If the party host is ever renamed in roomNet.js, this fails rather than
  // leaving the exclusion pointing at a domain nobody calls any more.
  const wsHost = new URL(serverUrlFor('www.yetanotherquiz.com', 'party').replace(/^wss:/, 'https:')).hostname;
  const httpHost = new URL(httpServerUrlFor('www.yetanotherquiz.com', 'party')).hostname;
  assert.equal(wsHost, httpHost);
  assert.ok(CORRELATION_EXCLUDED_DOMAINS.includes(wsHost));
});

test('every excluded entry is a bare hostname — the SDK matches on host, not URL', () => {
  for (const d of CORRELATION_EXCLUDED_DOMAINS) {
    assert.ok(!d.includes('/'), `"${d}" looks like a URL; the SDK expects a hostname`);
    assert.ok(!d.includes(':'), `"${d}" carries a scheme or port; the SDK expects a bare hostname`);
  }
});
