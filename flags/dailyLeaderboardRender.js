/**
 * Pure renderer for the daily-leaderboard panel shown on the flagQuiz
 * result screen. Takes the response shape returned by
 * `fetchLeaderboard` plus a small bag of UI helpers, and returns the DOM
 * subtree the caller can drop into the result-screen container.
 *
 * Why pure (no document lookups, no global state):
 *   - Lets us test with a stub `doc` instead of jsdom — matches the
 *     statsOverlay/avatar testing pattern already in this repo.
 *   - Keeps the page.js file thin: it just resolves the container,
 *     mounts the returned subtree, and re-renders on `langchanged`.
 *
 * XSS posture: all nickname text reaches the DOM via `.textContent` /
 * createTextNode, never `innerHTML`. A malicious nickname like `<script>`
 * lands as literal text, not a script tag. Same rule the TTT room follows
 * (Feature H3) for the same reason.
 */

import { displayNickname } from './nickname.js';

const TOP_N = 10;

/**
 * @typedef {object} LeaderboardEntry
 * @property {string} deviceId
 * @property {string | null} nickname
 * @property {number} score
 * @property {number} durationMs
 */

/**
 * Build the leaderboard panel subtree.
 *
 * Render rules:
 *   - State 'loading'   → "Loading leaderboard…"
 *   - State 'failed'    → "Couldn't load the leaderboard."
 *   - State 'ready', top empty → "Be the first!"
 *   - State 'ready', top non-empty → ordered list of up to TOP_N rows.
 *     A row whose `deviceId` matches `ownDeviceId` gets the `is-self`
 *     marker class so CSS can highlight it. Each row shows
 *     `<rank>. <name> — <score> (<formattedTime>)`.
 *   - If `you.rank > TOP_N` AND ownDeviceId is supplied, append a
 *     separator + a self-row at the bottom: "… 87. You — 12 (32.4s)".
 *
 * @param {{
 *   state: 'loading' | 'failed' | 'ready',
 *   data?: { top: LeaderboardEntry[], you: { rank: number, score: number, durationMs: number } | null },
 *   ownDeviceId?: string | null,
 *   t: (key: string, fallback: string, vars?: Record<string, string|number>) => string,
 *   doc?: Document,
 * }} args
 * @returns {HTMLElement}
 */
export function renderLeaderboard({ state, data, ownDeviceId = null, t, doc = globalThis.document }) {
  // No className on the root: it's appended into a host with id="leaderboard-body"
  // already, so adding a class with the same intent would just nest two
  // equivalent wrappers.
  const root = doc.createElement('div');

  if (state === 'loading') {
    const p = doc.createElement('p');
    p.className = 'leaderboard-status';
    p.textContent = t('quiz.leaderboard.loading', 'Loading leaderboard…');
    root.appendChild(p);
    return root;
  }

  if (state === 'failed') {
    const p = doc.createElement('p');
    p.className = 'leaderboard-status leaderboard-status-failed';
    p.textContent = t('quiz.leaderboard.failed', "Couldn't load the leaderboard.");
    root.appendChild(p);
    return root;
  }

  const top = (data && Array.isArray(data.top)) ? data.top.slice(0, TOP_N) : [];
  const you = data ? data.you : null;

  if (top.length === 0) {
    const p = doc.createElement('p');
    p.className = 'leaderboard-status leaderboard-status-empty';
    p.textContent = t('quiz.leaderboard.empty', 'Be the first!');
    root.appendChild(p);
    return root;
  }

  const list = doc.createElement('ol');
  list.className = 'leaderboard-list';
  top.forEach((entry, idx) => {
    list.appendChild(buildRow(doc, { rank: idx + 1, entry, ownDeviceId }));
  });
  root.appendChild(list);

  // Append a self-row at the bottom only if the caller is outside the
  // visible top — when they're already on the list, the highlight in
  // place is enough; another row would just duplicate.
  const callerInTop = ownDeviceId !== null && top.some((r) => r.deviceId === ownDeviceId);
  if (you && ownDeviceId && you.rank > TOP_N && !callerInTop) {
    const sep = doc.createElement('p');
    sep.className = 'leaderboard-sep';
    sep.textContent = '…';
    root.appendChild(sep);

    const youList = doc.createElement('ol');
    youList.className = 'leaderboard-list leaderboard-list-you';
    youList.start = you.rank; // <ol start="…"> renders the right number without faking the row count
    youList.appendChild(buildRow(doc, {
      rank: you.rank,
      entry: {
        deviceId: ownDeviceId,
        nickname: null,                     // forced to the literal "You" label via the self check below
        score: you.score,
        durationMs: you.durationMs,
      },
      ownDeviceId,
      selfLabelOverride: t('quiz.leaderboard.you', 'You'),
    }));
    root.appendChild(youList);
  }

  return root;
}

/**
 * Build one <li> row. Self rows get the `is-self` class so CSS can
 * highlight; the name column shows the "You" label when the caller is
 * the row's device, otherwise the saved/default nickname.
 *
 * @param {Document} doc
 * @param {{
 *   rank: number,
 *   entry: LeaderboardEntry,
 *   ownDeviceId: string | null,
 *   selfLabelOverride?: string,
 * }} args
 */
function buildRow(doc, { rank, entry, ownDeviceId, selfLabelOverride }) {
  const li = doc.createElement('li');
  const isSelf = ownDeviceId !== null && entry.deviceId === ownDeviceId;
  li.className = isSelf ? 'leaderboard-row is-self' : 'leaderboard-row';

  const rankEl = doc.createElement('span');
  rankEl.className = 'leaderboard-rank';
  rankEl.textContent = `${rank}.`;

  const nameEl = doc.createElement('span');
  nameEl.className = 'leaderboard-name';
  nameEl.textContent = isSelf && selfLabelOverride
    ? selfLabelOverride
    : displayNickname(entry.deviceId, entry.nickname);

  const scoreEl = doc.createElement('span');
  scoreEl.className = 'leaderboard-score';
  scoreEl.textContent = String(entry.score);

  li.appendChild(rankEl);
  li.appendChild(nameEl);
  li.appendChild(scoreEl);
  return li;
}
