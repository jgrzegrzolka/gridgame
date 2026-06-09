/**
 * In-memory fixed-window rate limiter. Pure logic — the caller injects
 * `now` so tests don't have to mock time, and the calling Function holds
 * the limiter at module scope so its state survives across invocations
 * on the same warm instance (resets on cold start per FEATURE.md).
 *
 * createRateLimiter({ limit, windowMs }).check(key, now) →
 *   { allowed: true }
 *   { allowed: false, retryAfterMs }
 */

function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();

  return {
    check(key, now) {
      const entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        hits.set(key, { count: 1, windowStart: now });
        return { allowed: true };
      }
      if (entry.count < limit) {
        entry.count++;
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: windowMs - (now - entry.windowStart) };
    },
  };
}

function clientIp(req) {
  const headers = req.headers;
  const xff = typeof headers.get === 'function'
    ? headers.get('x-forwarded-for')
    : headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}

module.exports = { createRateLimiter, clientIp };
