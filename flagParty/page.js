import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz } from '../flags/partyClient.js';
import { CORRECT_POINTS, SPEED_BONUS } from '../flags/partyScore.js';

/** @typedef {import('../flags/partyClient.js').PartyClientState} PartyClientState */

const NICKNAME_KEY = 'gridgame.nickname';

/**
 * Boot the Flag Party page: resolve identity, wire the lobby controls, open
 * the WebSocket, and re-render on every server message. Kept thin — all game
 * rules live in the pure modules (`flags/partyRoom.js`, `partyScore.js`,
 * `partyClient.js`); this is DOM + socket glue.
 */
export function bootFlagParty() {
  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
  let cachedNick = null;
  try { cachedNick = window.localStorage.getItem(NICKNAME_KEY); } catch { /* private mode */ }
  const myName = displayNickname(deviceId, cachedNick);

  const SERVER_URL = serverUrlFor(window.location.hostname, 'party');

  /** @type {PartyClientState} */
  let state = initialPartyClientState();
  /** @type {{ code: string, intent: 'create' | 'join' } | null} */
  let activeRoom = null;
  /** playerId of the room's host, learned from welcome (self) / roster (hostId). */
  let roomHostId = /** @type {string | null} */ (null);
  /** @type {WebSocket | null} */
  let ws = null;
  let rejected = false;
  let reconnectAttempts = 0;
  let reconnectTimer = 0;

  // ---- element refs ----
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const statusEl = $('party-status');
  const sections = {
    start: $('pt-start'), lobby: $('pt-lobby'), round: $('pt-round'), final: $('pt-final'),
  };
  const roomCodeEl = $('room-code');
  const playersEl = $('players');
  const startBtn = /** @type {HTMLButtonElement} */ ($('start-game'));
  const waitEl = $('lobby-wait');
  const roundPill = $('round-pill');
  const promptQ = $('prompt-q');
  const promptTarget = $('prompt-target');
  const gridEl = $('flags-grid');
  const footEl = $('round-foot');
  const finalSub = $('final-sub');
  const finalBoard = $('final-board');
  const playAgainBtn = /** @type {HTMLButtonElement} */ ($('play-again'));
  const playingAsEl = $('playing-as');
  const joinError = $('join-error');
  const shareLabel = $('share-label');

  /** @type {Map<string, { code: string, name: string }>} */
  const byCode = new Map();

  // ---- helpers ----
  const fmt = (/** @type {string} */ str, /** @type {Record<string, string|number>} */ params) =>
    str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));

  /** @param {string} tag @param {string} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** @param {string} name */
  function initials(name) {
    const caps = name.match(/[A-ZŁŚŻŹĆŃÓĄĘ]/g) || [];
    if (caps.length >= 2) return (caps[0] + caps[1]).toUpperCase();
    return (name.replace(/\s+/g, '').slice(0, 2) || '??').toUpperCase();
  }

  /** @param {string} name @param {boolean} you */
  function avatar(name, you) {
    const a = el('span', 'avatar' + (you ? '' : ' o'), initials(name));
    return a;
  }

  /**
   * @param {string} key
   * @param {string} fallback
   * @param {Record<string, string|number>} [params]
   */
  function setStatus(key, fallback, params) {
    statusEl.textContent = params ? fmt(t(key, fallback), params) : t(key, fallback);
    statusEl.hidden = false;
  }
  function clearStatus() { statusEl.hidden = true; statusEl.textContent = ''; }

  function showSection(/** @type {'start'|'lobby'|'round'|'final'} */ which) {
    for (const [k, node] of Object.entries(sections)) node.hidden = k !== which;
  }

  function send(/** @type {object} */ msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---- connection ----
  function wsUrl(/** @type {string} */ code, /** @type {'create'|'join'} */ intent) {
    return `${SERVER_URL}${encodeURIComponent(code)}?pid=${encodeURIComponent(deviceId)}` +
      `&nick=${encodeURIComponent(myName)}&intent=${intent}`;
  }

  function connect() {
    if (!activeRoom) return;
    setStatus('party.connecting', 'Connecting…');
    ws = new WebSocket(wsUrl(activeRoom.code, activeRoom.intent));
    ws.addEventListener('open', () => { reconnectAttempts = 0; });
    ws.addEventListener('message', (e) => handleMessage(String(e.data)));
    ws.addEventListener('close', () => { if (!rejected) scheduleReconnect(); });
  }

  function scheduleReconnect() {
    if (!activeRoom) return;
    // After the first connect, every reconnect is a join (the room exists).
    activeRoom = { ...activeRoom, intent: 'join' };
    reconnectAttempts += 1;
    const delayMs = Math.min(30000, 1000 * 2 ** (reconnectAttempts - 1));
    setStatus('party.disconnected', 'Disconnected. Reconnecting…');
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, delayMs);
  }

  function handleMessage(/** @type {string} */ raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { state: next, effects } = reducePartyMessage(state, msg);
    state = next;
    if (msg.type === 'roster' && typeof msg.hostId === 'string') roomHostId = msg.hostId;
    if (msg.type === 'welcome' && msg.isHost) roomHostId = state.you;
    for (const eff of effects) {
      if (eff.type === 'close') {
        rejected = true;
        try { if (ws) ws.close(); } catch { /* already closed */ }
        activeRoom = null;
        history.replaceState(null, '', location.pathname);
      }
    }
    if (state.statusOverride) {
      const so = state.statusOverride;
      setStatus(so.key, so.fallback, so.params || {});
    } else if (msg.type === 'welcome') {
      clearStatus();
    }
    render();
  }

  function enterRoom(/** @type {string} */ code, /** @type {'create'|'join'} */ intent) {
    rejected = false;
    reconnectAttempts = 0;
    state = initialPartyClientState();
    activeRoom = { code, intent };
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url.toString());
    render();
    connect();
  }

  // ---- render ----
  function render() {
    if (!activeRoom) { showSection('start'); return; }
    if (state.phase === 'question' || state.phase === 'reveal') { showSection('round'); renderRound(); }
    else if (state.phase === 'final') { showSection('final'); renderFinal(); }
    else { showSection('lobby'); renderLobby(); }
  }

  function renderLobby() {
    roomCodeEl.textContent = activeRoom ? activeRoom.code : '-----';
    playersEl.innerHTML = '';
    const label = el('p', 'plabel', `${t('party.players', 'Players')} · ${state.roster.length}`);
    playersEl.appendChild(label);
    for (const r of state.roster) {
      const chip = el('div', 'chip' + (r.present ? '' : ' away'));
      chip.appendChild(avatar(r.nickname, r.playerId === state.you));
      chip.appendChild(el('span', 'chip-name', r.nickname));
      if (r.playerId === roomHostId) chip.appendChild(el('span', 'chip-host', t('party.host', 'host')));
      playersEl.appendChild(chip);
    }
    const inLobby = state.phase === 'lobby';
    startBtn.hidden = !(state.isHost && inLobby);
    waitEl.hidden = !(!state.isHost && inLobby);
  }

  function nameLookup() {
    /** @type {Map<string, string>} */
    const m = new Map();
    for (const e of state.scoreboard || []) m.set(e.playerId, e.nickname);
    for (const r of state.roster) if (!m.has(r.playerId)) m.set(r.playerId, r.nickname);
    return m;
  }

  function renderRound() {
    const q = state.question;
    if (!q) return;
    roundPill.textContent = fmt(t('party.round', 'Round {n} of {total}'), {
      n: state.roundIndex + 1, total: state.totalRounds,
    });
    const isReveal = state.phase === 'reveal' && state.reveal;
    const targetCode = isReveal && state.reveal ? state.reveal.answer : q.prompt;
    const country = byCode.get(targetCode);
    const name = country ? countryName(country) : targetCode;
    promptQ.textContent = isReveal ? t('party.theFlagOf', 'The flag of') : t('party.whichFlag', 'Which flag is');
    promptTarget.textContent = isReveal ? name : `${name}?`;

    const names = nameLookup();
    gridEl.innerHTML = '';
    for (const code of q.options) {
      if (isReveal && state.reveal) {
        const correct = code === state.reveal.answer;
        /** @type {Array<{name:string, you:boolean}>} */
        const pickers = [];
        for (const [pid, choice] of Object.entries(state.reveal.picks)) {
          if (choice === code) pickers.push({ name: names.get(pid) || '?', you: pid === state.you });
        }
        gridEl.appendChild(flagOpt(code, { selectable: false, selected: false, correct, dim: !correct, pickers }));
      } else {
        const selected = state.myChoice === code;
        const dim = state.myChoice != null && !selected;
        gridEl.appendChild(flagOpt(code, { selectable: state.myChoice == null, selected, correct: false, dim, pickers: [] }));
      }
    }

    footEl.innerHTML = '';
    if (isReveal) renderRevealFoot();
    else renderQuestionFoot();
  }

  /**
   * @param {string} code
   * @param {{ selectable: boolean, selected: boolean, correct: boolean, dim: boolean, pickers: Array<{name:string,you:boolean}> }} opts
   */
  function flagOpt(code, opts) {
    const node = document.createElement(opts.selectable ? 'button' : 'div');
    node.className = 'opt' + (opts.selected ? ' sel' : '') + (opts.correct ? ' correct' : '') + (opts.dim ? ' dim' : '');
    if (opts.selectable) {
      /** @type {HTMLButtonElement} */ (node).type = 'button';
      node.addEventListener('click', () => onPick(code));
    }
    const img = document.createElement('img');
    img.className = 'flag';
    img.src = `../flags/svg/${code}.svg`;
    img.alt = '';
    node.appendChild(img);
    if (opts.selected || opts.correct) node.appendChild(el('span', 'mark', '✓'));
    if (opts.pickers.length) {
      const p = el('div', 'picks');
      for (const pk of opts.pickers) p.appendChild(avatar(pk.name, pk.you));
      node.appendChild(p);
    }
    return node;
  }

  function renderQuestionFoot() {
    if (state.myChoice) footEl.appendChild(el('div', 'banner', t('party.lockedWaiting', 'Locked in, waiting for the others…')));
    const answered = fmt(t('party.answered', '{n} of {total} answered'), { n: state.buzzedCount, total: state.seatCount });
    const line = state.myChoice ? answered : `${t('party.tapFlag', 'Tap the flag')} · ${answered}`;
    footEl.appendChild(el('div', 'status-line', line));
  }

  function renderRevealFoot() {
    const list = el('div', 'toast-list');
    const fastest = CORRECT_POINTS + (SPEED_BONUS[0] || 0);
    const points = (state.reveal && state.reveal.points) || {};
    for (const entry of state.scoreboard || []) {
      const pts = points[entry.playerId] || 0;
      const toast = el('div', 'toast');
      toast.appendChild(avatar(entry.nickname, entry.playerId === state.you));
      toast.appendChild(el('span', 'toast-name', entry.nickname));
      if (pts === fastest) toast.appendChild(el('span', 'fast', `⚡ ${t('party.fastest', 'Fastest')}`));
      toast.appendChild(el('span', 'pts' + (pts === 0 ? ' zero' : ''), `+${pts}`));
      list.appendChild(toast);
    }
    footEl.appendChild(list);
    if (state.isHost) {
      const btn = /** @type {HTMLButtonElement} */ (el('button', 'party-btn', t('party.nextRound', 'Next round')));
      btn.type = 'button';
      btn.addEventListener('click', () => send({ type: 'next' }));
      footEl.appendChild(btn);
    }
  }

  function renderFinal() {
    const board = state.scoreboard || [];
    if (board.length) {
      const top = board[0];
      const tie = board.length > 1 && board[1].score === top.score;
      finalSub.textContent = tie ? t('party.tie', "It's a tie!") : fmt(t('party.winnerTakesIt', '{name} takes it'), { name: top.nickname });
    } else {
      finalSub.textContent = '';
    }
    finalBoard.innerHTML = '';
    board.forEach((entry, i) => {
      const row = el('div', 'scoreline' + (i === 0 ? ' win' : ' other'));
      row.appendChild(el('span', 'rank', String(i + 1)));
      row.appendChild(avatar(entry.nickname, entry.playerId === state.you));
      row.appendChild(el('span', 'nm', entry.nickname));
      row.appendChild(el('span', 'sc', String(entry.score)));
      finalBoard.appendChild(row);
    });
    playAgainBtn.hidden = !state.isHost;
  }

  function onPick(/** @type {string} */ code) {
    if (state.phase !== 'question' || state.myChoice) return;
    const next = withLocalBuzz(state, code);
    if (next.myChoice === code) {
      state = next;
      send({ type: 'buzz', choice: code });
      render();
    }
  }

  // ---- wire controls ----
  $('create-room').addEventListener('click', () => enterRoom(generateCode(), 'create'));

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (document.getElementById('join-code'));
    const code = input.value.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      joinError.textContent = fmt(t('ttt.codeMustBe5', 'Code must be {n} characters'), { n: 5 });
      joinError.hidden = false;
      return;
    }
    joinError.hidden = true;
    enterRoom(code, 'join');
  });

  startBtn.addEventListener('click', () => send({ type: 'start' }));
  playAgainBtn.addEventListener('click', () => send({ type: 'playAgain' }));

  $('share-btn').addEventListener('click', async () => {
    if (!activeRoom) return;
    const url = new URL(location.href);
    url.searchParams.set('room', activeRoom.code);
    const shareUrl = url.toString();
    const shareText = `${t('party.shareText', 'Join my Flag Party room:')} ${shareUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: t('party.shareTitle', 'Flag Party'), text: shareText, url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        flashShareCopied();
      }
    } catch { /* user cancelled share, or clipboard blocked — no-op */ }
  });

  function flashShareCopied() {
    const original = t('party.share', 'Invite link');
    shareLabel.textContent = t('party.shareCopied', 'Link copied');
    window.setTimeout(() => { shareLabel.textContent = original; }, 1500);
  }

  // ---- "playing as" line ----
  function paintPlayingAs() {
    playingAsEl.innerHTML = '';
    playingAsEl.appendChild(avatar(myName, true));
    const label = el('span', 'playing-as-label', `${t('party.playingAs', 'Playing as')} `);
    const strong = el('strong', undefined, myName);
    label.appendChild(strong);
    playingAsEl.appendChild(label);
  }
  paintPlayingAs();

  // Re-render dynamic text (country names, labels) on a soft language switch.
  document.addEventListener('langchanged', () => { paintPlayingAs(); render(); });

  // ---- load data + route ----
  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((countries) => {
      for (const c of countries) byCode.set(c.code, c);
      const roomParam = new URLSearchParams(location.search).get('room');
      if (roomParam && isValidRoomCode(roomParam.toUpperCase())) {
        enterRoom(roomParam.toUpperCase(), 'join');
      } else {
        render();
      }
    })
    .catch(() => { render(); });

  // Show the start screen immediately while countries load.
  render();
}
