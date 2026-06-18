/**
 * Fire-and-forget client helper for `POST /api/v1/event` — the single
 * write surface for `engagementEvents` (Feature M Part B). Every call
 * site that emits an engagement event (daily-start, findflag-play,
 * share) routes through this one function so the wire format, error
 * handling, and "never block the UI" contract have one tested home.
 *
 * Lives under `flags/` because every page that fires events imports
 * it — `same mechanism = same code` per CLAUDE.md.
 *
 * Contract:
 *   - Never throws. Returns Promise<boolean> resolving to true on a
 *     successful insert (201) OR a duplicate (409 — the dedupe path
 *     for `daily_start`; the event is *already* recorded, which is
 *     also a success for the caller's purposes). Returns false on any
 *     other status, network failure, or bad input.
 *   - Most callers ignore the result. The share/play/start UI
 *     completes regardless of whether the event landed — the engine's
 *     output is the source of truth, not the analytics counter.
 *
 * @typedef {| { kind: 'daily_start', payload: { puzzleId: number } }
 *           | { kind: 'findflag_play', payload: { filter: string, mode: 'random' | 'custom' } }
 *           | { kind: 'share', payload: { surface: 'daily' | 'findflag' | 'flagquiz' | 'ttt', contextHint?: string } }
 *           | { kind: 'quiz_play', payload: { mode: '60s' | 'all' } }
 *          } EngagementEvent
 */

const ENDPOINT = '/api/v1/event';

/**
 * @param {string} deviceId
 * @param {EngagementEvent} event
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<boolean>}
 */
export async function submitEngagementEvent(deviceId, event, opts = {}) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) return false;
  if (!event || typeof event !== 'object') return false;
  if (typeof event.kind !== 'string' || event.kind.length === 0) return false;
  if (!event.payload || typeof event.payload !== 'object') return false;

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        kind: event.kind,
        payload: event.payload,
      }),
    });
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}
