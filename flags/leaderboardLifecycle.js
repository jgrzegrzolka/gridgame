/**
 * Two-phase leaderboard lifecycle, lifted out of flagQuiz/page.js so the
 * resolve/reject paths can be unit-tested without a DOM. Phase 1 reveals
 * the panel in a loading state immediately; phase 2 fires the fetch after
 * the submit settles so today's just-written row is durable by then.
 *
 * Defensive against the contract drifting under us: `submitImpl` is
 * documented as never-rejecting, but if a future refactor flips that, the
 * fetch still fires and the panel doesn't get stuck in loading. Same
 * belt-and-braces on `fetchImpl` — a thrown error paints `failed` instead
 * of leaving the panel mid-animation.
 *
 * @param {{
 *   submitImpl: () => Promise<unknown>,
 *   fetchImpl: () => Promise<{ ok: true, top: any[], you: any } | { ok: false, reason: string }>,
 *   paint: (state: { state: 'loading' } | { state: 'ready', data: { top: any[], you: any } } | { state: 'failed' }) => void,
 * }} args
 * @returns {Promise<void>}
 */
export async function runLeaderboardCycle({ submitImpl, fetchImpl, paint }) {
  paint({ state: 'loading' });

  try {
    await submitImpl();
  } catch {
    // submit contract: always resolves with {outcome}. Defence in depth.
  }

  let res;
  try {
    res = await fetchImpl();
  } catch {
    paint({ state: 'failed' });
    return;
  }

  paint(
    res.ok
      ? { state: 'ready', data: { top: res.top, you: res.you } }
      : { state: 'failed' },
  );
}
