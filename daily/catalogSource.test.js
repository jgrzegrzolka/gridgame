import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogUrl } from './catalogSource.js';

test('catalogUrl returns the blob URL for each catalog file', () => {
  assert.equal(
    catalogUrl('live'),
    'https://styetanotherquiz.blob.core.windows.net/catalog/live.json',
  );
  assert.equal(
    catalogUrl('backlog'),
    'https://styetanotherquiz.blob.core.windows.net/catalog/backlog.json',
  );
  assert.equal(
    catalogUrl('ideas'),
    'https://styetanotherquiz.blob.core.windows.net/catalog/ideas.json',
  );
  assert.equal(
    catalogUrl('parked'),
    'https://styetanotherquiz.blob.core.windows.net/catalog/parked.json',
  );
  assert.equal(
    catalogUrl('policy'),
    'https://styetanotherquiz.blob.core.windows.net/catalog/policy.json',
  );
});
