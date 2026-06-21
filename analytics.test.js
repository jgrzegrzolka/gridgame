import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrichTelemetryItem } from './analytics.js';

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
