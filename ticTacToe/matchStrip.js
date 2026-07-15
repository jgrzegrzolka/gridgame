/**
 * The in-game "match strip" for both online Tic-Tac-Toe variants (3×3 and
 * 9×9): two facing player cards with a centre scoreboard. It replaces the
 * old stacked header — a "You are X" role line, an inline "· vs Opp (2:1)"
 * matchup, and a floating "Opponent's turn" status line — with one row that
 * carries identity AND whose-turn at a glance:
 *
 *   [ avatar  You  X ]   2 : 1   [ avatar  Merry Fox  O ]
 *                        1 draw
 *
 * The active player's card lifts and their mark bounces (CSS), so the turn
 * cue lives on the person instead of a separate line of text. While waiting,
 * the opponent seat is an empty dashed card with a pulsing dot.
 *
 * Same markup rendered on both pages (CLAUDE.md "same mechanism = same
 * code"): `ticTacToe/page.js` imports it as `./matchStrip.js`, the 9×9 page
 * as `../matchStrip.js`. The pure state/format helpers below are unit-tested
 * in `matchStrip.test.js`; `renderMatchStrip` is thin DOM glue on top.
 *
 * Avatars are the deterministic `avatarSvg(deviceId)` identicons the burger
 * menu and /profile/ already show, so a player reads as the same avatar
 * everywhere. `t` is passed in (not imported) to keep this module free of
 * the i18n graph and unit-testable.
 */

import { avatarSvg } from '../flags/avatar.js';
import { displayNickname } from '../flags/nickname.js';

/** @typedef {import('./onlineClient.js').ClientState} ClientState */

/**
 * Derive what each card should show from the client state. Pure — the render
 * function and the tests both consume this.
 *
 * @param {{ game?: any, myRole?: string|null, peerPresent?: boolean, peerId?: string|null }} state
 * @returns {{ hasGame: boolean, over: boolean, oppPresent: boolean, youActive: boolean, oppActive: boolean }}
 */
export function describeMatchStrip(state) {
  const game = state && state.game;
  const hasGame = !!game;
  const over = !!(game && (game.winner || game.draw || game.gaveUp));
  const peerPresent = !!(state && state.peerPresent);
  const oppPresent = peerPresent && !!(state && state.peerId);
  const myRole = (state && state.myRole) || null;
  const cur = game ? game.currentPlayer : null;
  const playing = hasGame && peerPresent && !over && !!myRole && cur != null;
  return {
    hasGame,
    over,
    oppPresent,
    youActive: playing && cur === myRole,
    oppActive: playing && cur !== myRole,
  };
}

/**
 * Format the head-to-head record for the centre scoreboard, from the local
 * player's perspective (`wins : losses`). Returns null when there's no row
 * yet or every counter is zero — a brand-new pairing shows a plain "VS", not
 * "0 : 0".
 *
 * @param {{ wins: number, losses: number, draws: number } | null | undefined} pairRecord
 * @returns {{ score: string, draws: number } | null}
 */
export function formatRecord(pairRecord) {
  if (!pairRecord) return null;
  const wins = pairRecord.wins | 0;
  const losses = pairRecord.losses | 0;
  const draws = pairRecord.draws | 0;
  if ((wins | losses | draws) === 0) return null;
  return { score: `${wins} : ${losses}`, draws };
}

/**
 * The opponent's mark, given the local player's. `null` until roles are known.
 * @param {string | null | undefined} role
 * @returns {'X' | 'O' | null}
 */
export function otherRole(role) {
  if (role === 'X') return 'O';
  if (role === 'O') return 'X';
  return null;
}

/** @param {string | null} seed */
function avatarEl(seed) {
  const a = document.createElement('span');
  a.className = 'avatar';
  // Safe innerHTML: avatarSvg emits a self-contained SVG built entirely from
  // a fixed palette + deterministic hash, never from user input.
  a.innerHTML = avatarSvg(seed || '');
  return a;
}

/**
 * @param {{ side: 'you'|'opp', active: boolean, seed: string|null, name: string, nameLoading?: boolean, role: 'X'|'O'|null }} o
 */
function playerCard(o) {
  // One row: [avatar] [mark] [name]. Nothing sits beside the X/O, so a single
  // line keeps the card short (better on phones) instead of stacking the name
  // over the mark.
  const card = document.createElement('div');
  card.className = `player-card ${o.side}` + (o.active ? ' active' : '');
  card.appendChild(avatarEl(o.seed));
  if (o.role === 'X' || o.role === 'O') {
    const mark = document.createElement('span');
    mark.className = 'pc-mark ' + o.role.toLowerCase();
    mark.textContent = o.role;
    card.appendChild(mark);
  }
  const nm = document.createElement('span');
  nm.className = 'pc-name' + (o.nameLoading ? ' pc-name-loading' : '');
  nm.textContent = o.name;
  card.appendChild(nm);
  return card;
}

/** @param {(key: string, fallback: string) => string} t */
function waitingCard(t) {
  const card = document.createElement('div');
  card.className = 'player-card waiting';
  const dot = document.createElement('span');
  dot.className = 'pc-wait-dot';
  const txt = document.createElement('span');
  txt.className = 'pc-wait-text';
  txt.textContent = t('ttt.waitingForPlayer', 'Waiting for player…');
  card.append(dot, txt);
  return card;
}

/**
 * @param {{ score: string, draws: number } | null} record
 * @param {(key: string, fallback: string) => string} t
 */
function centerCell(record, t) {
  const center = document.createElement('div');
  center.className = 'match-center';
  if (!record) {
    const vs = document.createElement('span');
    vs.className = 'mc-vs';
    vs.textContent = t('ttt.matchupVs', 'vs');
    center.appendChild(vs);
    return center;
  }
  const score = document.createElement('span');
  score.className = 'mc-score';
  score.textContent = record.score;
  center.appendChild(score);
  if (record.draws > 0) {
    const dr = document.createElement('span');
    dr.className = 'mc-draws';
    const key = record.draws === 1 ? 'ttt.matchupDraw' : 'ttt.matchupDraws';
    dr.textContent = `${record.draws} ${t(key, record.draws === 1 ? 'draw' : 'draws')}`;
    center.appendChild(dr);
  }
  return center;
}

/**
 * (Re)paint the match strip into `root`. Idempotent — rebuilds the whole
 * strip each call, so callers just re-invoke it whenever state, the fetched
 * opponent nickname, or the pair record changes.
 *
 * @param {{
 *   root: HTMLElement | null,
 *   state: { game?: any, myRole?: string|null, peerPresent?: boolean, peerId?: string|null },
 *   deviceId: string,
 *   opponentNickname: string | null | undefined,
 *   pairRecord: { wins: number, losses: number, draws: number } | null,
 *   t: (key: string, fallback: string) => string,
 * }} ctx
 */
export function renderMatchStrip(ctx) {
  const { root, state, deviceId, opponentNickname, pairRecord, t } = ctx;
  if (!root) return;
  const info = describeMatchStrip(state);
  const myRole = (state && state.myRole) || null;
  root.replaceChildren();

  root.appendChild(playerCard({
    side: 'you',
    active: info.youActive,
    seed: deviceId,
    name: t('ttt.you', 'You'),
    role: myRole === 'X' || myRole === 'O' ? myRole : null,
  }));

  root.appendChild(centerCell(formatRecord(pairRecord), t));

  if (!info.oppPresent) {
    root.appendChild(waitingCard(t));
    return;
  }

  // Opponent seat. While the profile fetch is in flight (opponentNickname
  // === undefined) show a muted "loading…" label rather than let
  // displayNickname flash the deterministic default for a beat before the
  // real name resolves. `null` (fetch done, no saved nickname) goes through
  // displayNickname and gets the deterministic default — the intended path.
  const loading = opponentNickname === undefined;
  root.appendChild(playerCard({
    side: 'opp',
    active: info.oppActive,
    seed: state.peerId || '',
    name: loading
      ? t('ttt.matchupOpponentLoading', 'loading…')
      : displayNickname(state.peerId || '', opponentNickname),
    nameLoading: loading,
    role: otherRole(myRole),
  }));
}
