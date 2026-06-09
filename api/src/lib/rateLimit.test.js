const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter, clientIp } = require('./rateLimit');

test('first request from a new key is allowed', () => {
  const l = createRateLimiter({ limit: 5, windowMs: 60_000 });
  assert.deepEqual(l.check('1.2.3.4', 1000), { allowed: true });
});

test('requests up to the limit in the same window are allowed', () => {
  const l = createRateLimiter({ limit: 3, windowMs: 60_000 });
  assert.equal(l.check('a', 0).allowed, true);
  assert.equal(l.check('a', 100).allowed, true);
  assert.equal(l.check('a', 200).allowed, true);
});

test('request past the limit is denied with retryAfterMs', () => {
  const l = createRateLimiter({ limit: 2, windowMs: 60_000 });
  l.check('a', 0);
  l.check('a', 0);
  const r = l.check('a', 30_000);
  assert.equal(r.allowed, false);
  assert.equal(r.retryAfterMs, 30_000);
});

test('window resets exactly at windowMs', () => {
  const l = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(l.check('a', 0).allowed, true);
  assert.equal(l.check('a', 59_999).allowed, false);
  assert.equal(l.check('a', 60_000).allowed, true);
});

test('separate keys are tracked independently', () => {
  const l = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(l.check('a', 0).allowed, true);
  assert.equal(l.check('b', 0).allowed, true);
  assert.equal(l.check('a', 0).allowed, false);
});

test('clientIp reads first entry of x-forwarded-for from Headers', () => {
  const req = { headers: new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' }) };
  assert.equal(clientIp(req), '203.0.113.1');
});

test('clientIp reads x-forwarded-for from a plain object', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4' } };
  assert.equal(clientIp(req), '1.2.3.4');
});

test('clientIp returns "unknown" when header is missing', () => {
  const req = { headers: new Headers() };
  assert.equal(clientIp(req), 'unknown');
});

test('clientIp trims whitespace around the first IP', () => {
  const req = { headers: new Headers({ 'x-forwarded-for': '  9.9.9.9 , 10.0.0.1' }) };
  assert.equal(clientIp(req), '9.9.9.9');
});
