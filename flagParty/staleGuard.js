/**
 * Guard against a "stale client in a live room" version skew.
 *
 * A Flag Party room's questions are generated server-side (PartyKit). When we
 * ship a new question type, the server can start dealing a `questionId` that a
 * still-open browser tab's older `page.js` has no renderer for. Without a guard
 * the old client falls through to flag-pick rendering and prints the raw
 * direction token ("least") as the prompt: the exact skew a real two-player
 * game hit right after the GDP questions (Feature DJ) deployed, because the
 * PartyKit server (its own deploy) flipped to dealing GDP questions while a
 * player's tab was still on the pre-GDP build.
 *
 * The only real cure for a stale client is to reload it onto the new build (its
 * seat survives: the room code is in the URL and the pid is persisted, so a
 * reload rejoins). These pure helpers decide when that reload is safe (once)
 * versus when we've already tried and must stop to avoid a reload loop.
 *
 * **Skew is not only about question ids.** A server can deal a question this build
 * knows by id but in a shape it can't render — see {@link canRenderQuestion}.
 */

import { superlativeMetricByQuestionId, canLabelDirection } from '../flags/partyQuestions/superlativeCatalog.js';

/**
 * The question ids this build can actually render: the two fixed picture questions
 * (flag-pick, map-pick) plus every superlative metric question this build knows
 * about. A `questionId` the server sends from outside this set proves the server is
 * newer than us.
 *
 * @param {Iterable<string>} superlativeQuestionIds  the catalog's question ids —
 *   `SUPERLATIVE_METRICS.map((m) => m.questionId)` from
 *   `flags/partyQuestions/superlativeCatalog.js`
 * @returns {Set<string>}
 */
export function renderableQuestionIds(superlativeQuestionIds) {
  return new Set(['flagPick', 'mapPick', ...superlativeQuestionIds]);
}

/**
 * Can this build render the question the server actually dealt?
 *
 * Knowing the `questionId` was never the whole question, and treating it as if it
 * were left a hole this guard was meant to cover. A superlative question's prompt
 * is a DIRECTION, and the set of directions a metric is dealt in lives in the
 * same catalog on both sides of a two-deploy split (PartyKit / SWA). Flip a
 * metric's `direction` from `'most'` to `null` and the server deals 'least' on a
 * question id every open tab already knows — the id check passes, and the page
 * renders the 'most' label ("Largest coffee production") over a question whose
 * answer is the *smallest* producer. Every player picks the biggest flag and is
 * scored wrong, with nothing on screen suggesting anything is off.
 *
 * Silent mis-scoring is the worst outcome available here: worse than a crash,
 * which is at least visible, and far worse than a reload. So a direction we have
 * no copy for is treated exactly like an unknown question id — proof the server is
 * ahead of us, routed to the same one-shot reload.
 *
 * Picture questions (flag-pick, map-pick) carry a country code as their prompt, not
 * a direction, so only the id matters for them.
 *
 * `questionId` is optional on the wire type, and a question without one is treated
 * as unrenderable — matching what this call site already did (`Set.has(undefined)`
 * is false), just said out loud now rather than resting on
 * `tsconfig.ui.json` having `strictNullChecks` off.
 *
 * @param {{ questionId?: string, prompt: string } | null | undefined} question the
 *   server's question; nullish means none dealt yet, which is not a skew signal.
 * @param {Set<string>} knownQuestionIds from {@link renderableQuestionIds}
 * @returns {boolean}
 */
export function canRenderQuestion(question, knownQuestionIds) {
  if (!question) return true;
  const { questionId } = question;
  if (!questionId || !knownQuestionIds.has(questionId)) return false;
  const metric = superlativeMetricByQuestionId(questionId);
  if (!metric) return true;
  return canLabelDirection(metric, question.prompt === 'least' ? 'least' : 'most');
}

/**
 * Can this build render the hand the server dealt?
 *
 * **The second skew surface, and it does not go through questions at all.** The
 * draft's pick hand is a list of CARD ids, and the set of cards is not fixed:
 * metric families (`flags/partyDraft.js` METRIC_FAMILIES) let one card stand for
 * several metrics, so a newer server can deal a card id — `economy` was the first
 * — that an older tab has no label, icon or hue for.
 *
 * {@link canRenderQuestion} cannot catch this. A family deals its members' own
 * question ids, which an old build already knows, so every question in the round
 * renders fine; the tab only breaks one step earlier, on the pick screen, where
 * an unknown id resolves to an undefined i18n key and `t(undefined)` takes the
 * whole render down (the `undefined.split` crash `modeLabels.test.js` pins).
 *
 * Only the PICKER renders a hand, so without this guard the failure is also
 * unfair as well as ugly: one player's screen goes blank precisely when the game
 * is waiting on them.
 *
 * An empty / absent hand is not a skew signal — that is simply a room that is not
 * picking right now.
 *
 * @param {Iterable<string> | null | undefined} hand  the dealt card ids
 * @param {Set<string>} knownCardIds  every id this build can label
 * @returns {boolean}
 */
export function canRenderHand(hand, knownCardIds) {
  if (!hand) return true;
  for (const id of hand) if (!knownCardIds.has(id)) return false;
  return true;
}

/**
 * What a client should do when a question arrives.
 *
 * @param {boolean} canRender  does this build have a renderer for the `questionId`
 * @param {boolean} alreadyReloaded  have we already reloaded once this session
 *   trying to update to a build that can render what the server is dealing
 * @returns {'render' | 'reload' | 'blocked'}
 *   - `'render'`  play it normally (also the signal to clear the reload guard:
 *     rendering a server-dealt question is the proof our build is compatible).
 *   - `'reload'`  we're stale; reload once to pick up the new build.
 *   - `'blocked'` we already reloaded and still can't render it (e.g. the reload
 *     served cached HTML, or we're offline): show an update notice instead of
 *     looping.
 */
export function questionRenderAction(canRender, alreadyReloaded) {
  if (canRender) return 'render';
  return alreadyReloaded ? 'blocked' : 'reload';
}
