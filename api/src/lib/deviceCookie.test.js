'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { deviceCookieHeader, parseDeviceCookie, COOKIE_NAME } = require('./deviceCookie');

test('COOKIE_NAME is the stable gg_did name', () => {
  assert.strictEqual(COOKIE_NAME, 'gg_did');
});

test('deviceCookieHeader carries the deviceId and the durable attributes', () => {
  const header = deviceCookieHeader('device-abc-12345');
  // Name=value first
  assert.ok(header.startsWith('gg_did=device-abc-12345'), header);
  // Survives ITP + XSS + HTTP-only-over-HTTPS
  assert.match(header, /;\s*HttpOnly/);
  assert.match(header, /;\s*Secure/);
  assert.match(header, /;\s*SameSite=Lax/);
  assert.match(header, /;\s*Path=\//);
  // 2 years, in seconds
  assert.match(header, /;\s*Max-Age=63072000/);
});

test('parseDeviceCookie reads gg_did out of a multi-cookie header', () => {
  assert.strictEqual(
    parseDeviceCookie('foo=1; gg_did=device-abc-12345; bar=baz'),
    'device-abc-12345',
  );
});

test('parseDeviceCookie finds gg_did regardless of position or spacing', () => {
  assert.strictEqual(parseDeviceCookie('gg_did=only-one-here'), 'only-one-here');
  assert.strictEqual(parseDeviceCookie('a=1;gg_did=no-spaces;b=2'), 'no-spaces');
});

test('deviceCookieHeader → parseDeviceCookie round-trips', () => {
  const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const header = deviceCookieHeader(id);
  // The Set-Cookie header's first segment is exactly what a Cookie header sends back.
  const cookieHeader = header.split(';')[0];
  assert.strictEqual(parseDeviceCookie(cookieHeader), id);
});

test('parseDeviceCookie returns null when gg_did is absent', () => {
  assert.strictEqual(parseDeviceCookie('foo=1; bar=2'), null);
});

test('parseDeviceCookie returns null for empty / missing headers', () => {
  assert.strictEqual(parseDeviceCookie(''), null);
  assert.strictEqual(parseDeviceCookie(null), null);
  assert.strictEqual(parseDeviceCookie(undefined), null);
});

test('parseDeviceCookie does not confuse a cookie whose name ends in gg_did', () => {
  // "notgg_did" must not be mistaken for "gg_did".
  assert.strictEqual(parseDeviceCookie('notgg_did=trap; other=1'), null);
});

test('parseDeviceCookie tolerates a stray empty segment', () => {
  assert.strictEqual(parseDeviceCookie('; gg_did=abc; '), 'abc');
});
