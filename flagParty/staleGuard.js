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
 *
 * **Skew is not only about round ids.** A server can deal a round this build
 * knows by id but in a shape it can't render — see {@link canRenderQuestion}.
 */

import { superlativeMetricByRoundId, canLabelDirection } from '../flags/partyRounds/superlativeCatalog.js';

/**
 * The round ids this build can actually render: the two fixed picture rounds
 * (flag-pick, map-pick) plus every superlative metric round this build knows
 * about. A `roundId` the server sends from outside this set proves the server is
 * newer than us.
 *
 * @param {Iterable<string>} superlativeRoundIds  the catalog's round ids —
 *   `SUPERLATIVE_METRICS.map((m) => m.roundId)` from
 *   `flags/partyRounds/superlativeCatalog.js`
 * @returns {Set<string>}
 */
export function renderableRoundIds(superlativeRoundIds) {
  return new Set(['flagPick', 'mapPick', ...superlativeRoundIds]);
}

/**
 * Can this build render the question the server actually dealt?
 *
 * Knowing the `roundId` was never the whole question, and treating it as if it
 * were left a hole this guard was meant to cover. A superlative round's prompt
 * is a DIRECTION, and the set of directions a metric is dealt in lives in the
 * same catalog on both sides of a two-deploy split (PartyKit / SWA). Flip a
 * metric's `direction` from `'most'` to `null` and the server deals 'least' on a
 * round id every open tab already knows — the id check passes, and the page
 * renders the 'most' label ("Largest coffee production") over a question whose
 * answer is the *smallest* producer. Every player picks the biggest flag and is
 * scored wrong, with nothing on screen suggesting anything is off.
 *
 * Silent mis-scoring is the worst outcome available here: worse than a crash,
 * which is at least visible, and far worse than a reload. So a direction we have
 * no copy for is treated exactly like an unknown round id — proof the server is
 * ahead of us, routed to the same one-shot reload.
 *
 * Picture rounds (flag-pick, map-pick) carry a country code as their prompt, not
 * a direction, so only the id matters for them.
 *
 * `roundId` is optional on the wire type, and a question without one is treated
 * as unrenderable — matching what this call site already did (`Set.has(undefined)`
 * is false), just said out loud now rather than resting on
 * `tsconfig.ui.json` having `strictNullChecks` off.
 *
 * @param {{ roundId?: string, prompt: string } | null | undefined} question the
 *   server's question; nullish means none dealt yet, which is not a skew signal.
 * @param {Set<string>} knownRoundIds from {@link renderableRoundIds}
 * @returns {boolean}
 */
export function canRenderQuestion(question, knownRoundIds) {
  if (!question) return true;
  const { roundId } = question;
  if (!roundId || !knownRoundIds.has(roundId)) return false;
  const metric = superlativeMetricByRoundId(roundId);
  if (!metric) return true;
  return canLabelDirection(metric, question.prompt === 'least' ? 'least' : 'most');
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
