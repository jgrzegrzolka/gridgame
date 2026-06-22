/**
 * One-time migration of pre-Phase-3 engagement data into the
 * client-side carrier (Feature S Phase 3). Runs once per device. The
 * sentinel `localStorage.gridgame.engagementMigrated === 'v1'` latches
 * after a successful run so subsequent boots short-circuit immediately.
 *
 * Pull-first ordering — fixes the multi-device data-loss bug spelled
 * out in FEATURE.md "Migration design":
 *
 *   1. Sentinel set? → done, nothing to do.
 *   2. `pullSyncBlob(deviceId)`. If the blob already has an
 *      `engagement` section, a different device on this deviceId has
 *      already migrated and pushed its post-migration state. Inflate
 *      localStorage from THAT (not from the stale historical Cosmos
 *      rows we'd otherwise read) and latch the sentinel.
 *   3. No blob / no engagement section → call `dailyMe` once to read
 *      the last server-side snapshot of share counts + coffee-click
 *      signal. Build initial state from it. Save locally. Push back
 *      to the blob so other devices skip the dailyMe read.
 *   4. Latch sentinel in all success paths.
 *
 * Why we don't extend `dailyMe` to return the raw `quiz60s` day log
 * for migration: pre-Phase-3 the server doesn't expose the day log,
 * only the derived streak snapshot. Reconstructing the log would
 * require a new server query (one extra container scan per migrating
 * device). Trade-off: a pre-Phase-3 streak doesn't roll over into
 * the new system — the user starts fresh on the day-log axis. The
 * snapshot streak stays visible via `dailyMe` during the Phase 3 →
 * Phase 4 window (per the "frozen snapshot" choice — FEATURE.md
 * Phase 3 description). After Phase 4, achievements compute from the
 * day log going forward. Acceptable per "lets not worry about lost
 * writes between phases" (Jan, 2026-06-23).
 *
 * Coffee-click count: pre-Phase-3 the server only stored "at least one
 * click" (boolean `coffeeClicked` from engagementCompute). Migration
 * sets `coffeeClickCount = 1` if the boolean was true, else 0. The
 * "Angel Investor" achievement is gated on `>= 1` so users keep it;
 * any "Big Investor" tier that wants higher counts would need a
 * pre-Phase-3 day-log-style migration which we don't have data for.
 *
 * Never throws. All failures (network, JSON, invalid sentinel state)
 * leave the sentinel unset so the next boot retries.
 */

import { pullSyncBlob, pushSyncBlob } from './syncBlob.js';
import { emptyState, inflateFromBlob, getSyncBlobSection, saveState } from './engagementCounters.js';

export const SENTINEL_KEY = 'gridgame.engagementMigrated';
export const SENTINEL_VALUE = 'v1';
const DAILY_ME_ENDPOINT = '/api/v1/daily/me';

/**
 * @typedef {{
 *   getItem(key: string): string | null,
 *   setItem(key: string, value: string): void,
 * }} Store
 */

/**
 * Run the one-time migration. Idempotent — safe to call from every
 * page boot; the sentinel makes subsequent calls a single localStorage
 * read.
 *
 * @param {{
 *   deviceId: string,
 *   store: Store,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<{ migrated: boolean, source: 'sentinel' | 'blob' | 'dailyMe' | 'failed', reason?: string }>}
 */
export async function migrateEngagement({ deviceId, store, fetchImpl = globalThis.fetch }) {
  // Sentinel short-circuit. The latched value is the entire signal —
  // we don't re-validate the localStorage state, because a corrupted
  // state should be repaired by the counter module's defensive
  // `loadState`, not re-fetched from the server.
  try {
    if (store.getItem(SENTINEL_KEY) === SENTINEL_VALUE) {
      return { migrated: false, source: 'sentinel' };
    }
  } catch {
    // Quota / private-mode read failure: fall through and try anyway.
    // Worst case we run migration extra times — idempotent server-side
    // (pull-first finds the same blob) so safe.
  }

  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    return { migrated: false, source: 'failed', reason: 'invalid_deviceId' };
  }

  // Pull first. Another device on this deviceId may have already
  // migrated and pushed its state — if so, we inflate from the blob
  // rather than from the stale historical Cosmos rows. This is the
  // critical correctness step that avoids the data-loss race.
  const pull = await pullSyncBlob(deviceId, { fetchImpl });
  if (pull.ok && pull.blob) {
    const engagement = /** @type {{ engagement?: unknown }} */ (pull.blob).engagement;
    if (engagement && typeof engagement === 'object') {
      inflateFromBlob(store, engagement);
      latchSentinel(store);
      return { migrated: true, source: 'blob' };
    }
  }

  // Blob is empty / has no engagement section / pull failed (treat as
  // empty and migrate from scratch — a hard server failure here just
  // means the user gets a fresh state, which is the same as a brand-new
  // device. The sentinel doesn't latch on hard failure so a future
  // boot retries).
  let payload;
  try {
    const res = await fetchImpl(`${DAILY_ME_ENDPOINT}?deviceId=${encodeURIComponent(deviceId)}`);
    if (!res || res.status !== 200) {
      return { migrated: false, source: 'failed', reason: `http_${res ? res.status : 'unknown'}` };
    }
    payload = await res.json();
  } catch {
    return { migrated: false, source: 'failed', reason: 'network_error' };
  }
  if (!payload || typeof payload !== 'object') {
    return { migrated: false, source: 'failed', reason: 'invalid_shape' };
  }

  const state = emptyState();
  if (Number.isInteger(payload.dailySharesCount) && payload.dailySharesCount >= 0) {
    state.shares.daily = payload.dailySharesCount;
  }
  if (Number.isInteger(payload.quizSharesCount) && payload.quizSharesCount >= 0) {
    state.shares.flagquiz = payload.quizSharesCount;
  }
  if (Number.isInteger(payload.findflagSharesCount) && payload.findflagSharesCount >= 0) {
    state.shares.findflag = payload.findflagSharesCount;
  }
  // TTT share count is fresh — pre-Phase-3 it wasn't aggregated by
  // computeEngagement (no achievement consumed it). Starts at zero.
  if (payload.coffeeClicked === true) {
    // The server only knew "at least one" — see comment block at top
    // for the trade-off. Setting to 1 keeps the "Angel Investor"
    // achievement gated correctly.
    state.coffeeClickCount = 1;
  }
  // quiz60sDayLog starts empty (server didn't expose the raw log).
  // Streak achievements use the dailyMe snapshot during the Phase 3 →
  // Phase 4 window; Phase 4 compute switches to the day log and starts
  // fresh from Phase 3 deploy.

  saveState(store, state);

  // Push back to the blob so other devices on this deviceId skip the
  // dailyMe migration read on their next boot. Fire-and-forget — even
  // if the push fails, the local state is valid and the next bump on
  // any counter will trigger another push. Sentinel still latches.
  void pushSyncBlob(deviceId, { v: 1, engagement: getSyncBlobSection(store) }, { fetchImpl });

  latchSentinel(store);
  return { migrated: true, source: 'dailyMe' };
}

/**
 * Defensive setItem wrapper. Sentinel write failure shouldn't crash
 * the boot path; worst case migration runs again next time, which is
 * idempotent.
 *
 * @param {Store} store
 */
function latchSentinel(store) {
  try {
    store.setItem(SENTINEL_KEY, SENTINEL_VALUE);
  } catch {
    /* best-effort */
  }
}
