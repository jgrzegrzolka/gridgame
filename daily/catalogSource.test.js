import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHost, catalogUrl } from './catalogSource.js';

test('isLocalHost recognises localhost + 127.0.0.1', () => {
  assert.equal(isLocalHost('localhost'), true);
  assert.equal(isLocalHost('127.0.0.1'), true);
});

test('isLocalHost rejects prod hosts', () => {
  assert.equal(isLocalHost('www.yetanotherquiz.com'), false);
  assert.equal(isLocalHost('yetanotherquiz.com'), false);
  assert.equal(isLocalHost(''), false);
});

test('catalogUrl returns devPath on localhost', () => {
  assert.equal(
    catalogUrl('live', { hostname: 'localhost', devPath: './daily_puzzles.json' }),
    './daily_puzzles.json',
  );
  assert.equal(
    catalogUrl('backlog', { hostname: '127.0.0.1', devPath: '../daily_backlog.json' }),
    '../daily_backlog.json',
  );
});

test('catalogUrl returns blob URL on prod', () => {
  assert.equal(
    catalogUrl('live', { hostname: 'www.yetanotherquiz.com', devPath: './daily_puzzles.json' }),
    'https://styetanotherquiz.blob.core.windows.net/catalog/live.json',
  );
  assert.equal(
    catalogUrl('backlog', { hostname: 'www.yetanotherquiz.com', devPath: './foo.json' }),
    'https://styetanotherquiz.blob.core.windows.net/catalog/backlog.json',
  );
  assert.equal(
    catalogUrl('policy', { hostname: 'www.yetanotherquiz.com', devPath: './foo.json' }),
    'https://styetanotherquiz.blob.core.windows.net/catalog/policy.json',
  );
});
