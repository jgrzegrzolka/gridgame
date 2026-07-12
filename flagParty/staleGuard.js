/**
 * Guard against a "stale client in a live room" version skew.
 *
 * A Flag Party room's questions are generated server-side (PartyKit). When we
 * ship a new round type, the server can start dealing a `roundId` that a
 * still-open browser tab's older `page.js` has no renderer for. Without a guard
 * the old client falls through to flag-pick rendering and prints the raw
 * direction token ("least") as the prompt: the exact skew a real two-player
 * game hit right after the GDP rounds (Feature DJ) deployed, because the
 * PartyKit server (its own deploy) flipped to dealing GDP rounds while a
 * player's tab was still on the pre-GDP build.
 *
 * The only real cure for a stale client is to reload it onto the new build (its
 * seat survives: the room code is in the URL and the pid is persisted, so a
 * reload rejoins). These pure helpers decide when that reload is safe (once)
 * versus when we've already tried and must stop to avoid a reload loop.
 */

/**
 * The round ids this build can actually render: the two fixed picture rounds
 * (flag-pick, map-pick) plus every superlative metric round wired into the
 * page's `SUPERLATIVE_MODES`. A `roundId` the server sends from outside this set
 * proves the server is newer than us.
 *
 * @param {Iterable<string>} superlativeRoundIds  `Object.keys(SUPERLATIVE_MODES)`
 * @returns {Set<string>}
 */
export function renderableRoundIds(superlativeRoundIds) {
  return new Set(['flagPick', 'mapPick', ...superlativeRoundIds]);
}

/**
 * What a client should do when a round arrives.
 *
 * @param {boolean} canRender  does this build have a renderer for the `roundId`
 * @param {boolean} alreadyReloaded  have we already reloaded once this session
 *   trying to update to a build that can render what the server is dealing
 * @returns {'render' | 'reload' | 'blocked'}
 *   - `'render'`  play it normally (also the signal to clear the reload guard:
 *     rendering a server-dealt round is the proof our build is compatible).
 *   - `'reload'`  we're stale; reload once to pick up the new build.
 *   - `'blocked'` we already reloaded and still can't render it (e.g. the reload
 *     served cached HTML, or we're offline): show an update notice instead of
 *     looping.
 */
export function roundRenderAction(canRender, alreadyReloaded) {
  if (canRender) return 'render';
  return alreadyReloaded ? 'blocked' : 'reload';
}
