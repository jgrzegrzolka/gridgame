/**
 * Tiny in-memory TTL cache. `now` is injected so tests don't have to
 * mock time. The owning module holds the cache instance at module
 * scope, so its entries survive across Function invocations on the
 * same warm instance (and reset on cold start — same tradeoff as the
 * rate limiter).
 *
 * createTtlCache({ ttlMs }).get(key, now) → value | undefined
 * createTtlCache({ ttlMs }).set(key, value, now) → void
 *
 * Expired entries are removed lazily on access — no background timer.
 */

function createTtlCache({ ttlMs }) {
  const store = new Map();

  return {
    get(key, now) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (now >= entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, now) {
      store.set(key, { value, expiresAt: now + ttlMs });
    },
  };
}

module.exports = { createTtlCache };
