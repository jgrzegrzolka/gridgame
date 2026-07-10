import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz } from '../flags/partyClient.js';
import { CORRECT_POINTS, SPEED_BONUS } from '../flags/partyScore.js';
import { QUESTION_SECONDS, REVEAL_SECONDS, secondsLeft, remainingFraction } from '../flags/partyTiming.js';
import { buildAvatar, renderPlayingAs, shareUrl } from '../common.js';

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
  /** Solo path: created a private room and want to skip the lobby, auto-starting
   *  the game the moment we're seated as host. Cleared once the first question
   *  arrives. Keeps the create-a-room (multiplayer) lobby untouched. */
  let soloPending = false;

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
  const timerEl = $('round-timer');
  const timerFill = $('round-timer-fill');
  const timerLabel = $('round-timer-label');
  const promptTarget = $('prompt-target');
  const gridEl = $('flags-grid');
  const footEl = $('round-foot');
  const finalSub = $('final-sub');
  const finalBoard = $('final-board');
  const playAgainBtn = /** @type {HTMLButtonElement} */ ($('play-again'));
  const playingAsEl = $('playing-as');
  const joinError = $('join-error');
  const shareBtn = /** @type {HTMLButtonElement} */ ($('share-btn'));

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

  /**
   * Loading variant of the status line: a muted label trailed by the shared
   * pulsing `.loading-dots` (common.css) — the same "something's happening"
   * idiom as daily-stats / sync "loading…". Used for the solo "Starting…"
   * spin-up so it reads as a wait, not an error box.
   * @param {string} key @param {string} fallback
   */
  function setLoadingStatus(key, fallback) {
    statusEl.className = 'party-status loading';
    statusEl.textContent = t(key, fallback);
    const dots = el('span', 'loading-dots');
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    statusEl.appendChild(dots);
    statusEl.hidden = false;
  }
  function clearStatus() { statusEl.hidden = true; statusEl.textContent = ''; statusEl.className = 'party-status'; }

  // Join-form validation / reject error (pink `.join-error`, shown under the
  // join box). Both the client-side "code must be 5 chars" check and the
  // server's reject reasons (room not found, code taken, in progress) surface
  // here — same placement + styling as Tic-Tac-Toe's `.lobby-error`, instead
  // of the top `.party-status` box which is now reserved for transient
  // connecting / disconnected / starting states. The last key is stashed so a
  // soft language switch re-translates the visible message.
  /** @type {{ key: string, fallback: string, params?: Record<string, string|number> } | null} */
  let lastJoinError = null;
  /**
   * @param {string} key @param {string} fallback
   * @param {Record<string, string|number>} [params]
   */
  function showJoinError(key, fallback, params) {
    lastJoinError = { key, fallback, params };
    paintJoinError();
    joinError.hidden = false;
  }
  function paintJoinError() {
    if (!lastJoinError) return;
    const { key, fallback, params } = lastJoinError;
    joinError.textContent = params ? fmt(t(key, fallback), params) : t(key, fallback);
  }
  function clearJoinError() { lastJoinError = null; joinError.hidden = true; joinError.textContent = ''; }

  function showSection(/** @type {'start'|'lobby'|'round'|'final'|null} */ which) {
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
    // Connecting / reconnecting are waiting states, so they use the same
    // loading-dots idiom as the solo "Starting" spin-up (not the bordered box).
    setLoadingStatus('party.connecting', 'Connecting');
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
    setLoadingStatus('party.disconnected', 'Disconnected. Reconnecting');
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
    // Solo auto-start: as soon as we're welcomed back as the host of our fresh
    // private room, kick the game off without waiting for a lobby tap.
    if (msg.type === 'welcome' && msg.isHost && soloPending) send({ type: 'start' });
    if (msg.type === 'question') soloPending = false;
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
      // A reject bounces us back to the start screen; show it as the pink
      // validation line under the join form (like TTT), not the top status box.
      clearStatus();
      showJoinError(so.key, so.fallback, so.params);
    } else {
      // No override to show, so drop any transient status (connecting, or the
      // solo "Starting…" banner). render() re-sets "Starting…" itself while a
      // solo game is still spinning up, so clearing here can't strand it — but
      // it does clear once the first question arrives (soloPending is false by
      // then), which is the bug this fixes: the banner used to sit over round 1.
      clearStatus();
    }
    render();
  }

  function enterRoom(/** @type {string} */ code, /** @type {'create'|'join'} */ intent) {
    rejected = false;
    reconnectAttempts = 0;
    clearJoinError();
    state = initialPartyClientState();
    activeRoom = { code, intent };
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url.toString());
    render();
    connect();
  }

  // ---- round clock ----
  // Everyone renders the countdown; only the host's timer fires the transition
  // (send 'reveal' when a question runs out, 'next' when a reveal has lingered),
  // so the room advances on its own with no host button to press. Timing lives
  // here on the page by design — the room reducer stays time-free. Caveat: the
  // pace depends on the host's tab staying awake; if the host drops mid-round
  // the room can stall at a reveal (documented in PARTY.md, server-alarm is the
  // future fix). All-present-buzzed still auto-reveals server-side regardless.
  /** @type {string | null} phase:roundIndex the clock is currently counting */
  let clockToken = null;
  let clockDeadline = 0;
  let clockTotalMs = 0;
  let clockFired = false;
  let clockInterval = 0;

  function stopClock() {
    if (clockInterval) { window.clearInterval(clockInterval); clockInterval = 0; }
    clockToken = null;
    timerEl.hidden = true;
  }

  /** (Re)start the countdown when the phase or round changes; otherwise leave it. */
  function syncClock() {
    const mode = state.phase === 'reveal' ? 'reveal' : 'question';
    const token = `${mode}:${state.roundIndex}`;
    if (token === clockToken) return;
    clockToken = token;
    clockFired = false;
    clockTotalMs = (mode === 'reveal' ? REVEAL_SECONDS : QUESTION_SECONDS) * 1000;
    clockDeadline = Date.now() + clockTotalMs;
    timerEl.hidden = false;
    timerEl.setAttribute('data-mode', mode);
    if (!clockInterval) clockInterval = window.setInterval(tickClock, 200);
    tickClock();
  }

  function tickClock() {
    const mode = state.phase === 'reveal' ? 'reveal' : 'question';
    const now = Date.now();
    const left = secondsLeft(clockDeadline, now);
    if (mode === 'reveal') {
      // Reveal: the progress bar freezes full and stopped (CSS drops its
      // transition in this mode) with a quiet "next round in N" label beside
      // it, in the same slot the question countdown number used. Clear `.low`
      // so the label never inherits the question timer's last-5s pulse — that
      // was the "sometimes it blinks" inconsistency.
      timerFill.style.width = '100%';
      timerEl.classList.remove('low');
      timerLabel.textContent = fmt(t('party.nextIn', 'Next round in {n}s'), { n: left });
    } else {
      timerFill.style.width = `${remainingFraction(clockDeadline, now, clockTotalMs) * 100}%`;
      timerEl.classList.toggle('low', left <= 5);
      timerLabel.textContent = String(left);
    }
    if (left <= 0 && !clockFired) {
      clockFired = true;
      // Host only: end the phase. A stale 'reveal'/'next' for a phase that
      // already advanced is ignored by the room reducer, so this is safe even
      // if the all-buzzed auto-reveal beat us to it.
      if (state.isHost) send({ type: mode === 'reveal' ? 'next' : 'reveal' });
    }
  }

  // ---- render ----
  function render() {
    if (!activeRoom) { stopClock(); showSection('start'); return; }
    // Solo: suppress the lobby entirely while we connect and auto-start, so the
    // player drops from "Play solo" straight into round 1 with only a status.
    if (soloPending && state.phase !== 'question' && state.phase !== 'reveal' && state.phase !== 'final') {
      stopClock();
      showSection(null);
      setLoadingStatus('party.starting', 'Starting');
      return;
    }
    if (state.phase === 'question' || state.phase === 'reveal') { showSection('round'); renderRound(); syncClock(); }
    else if (state.phase === 'final') { stopClock(); showSection('final'); renderFinal(); }
    else { stopClock(); showSection('lobby'); renderLobby(); }
  }

  function renderLobby() {
    roomCodeEl.textContent = activeRoom ? activeRoom.code : '-----';
    playersEl.innerHTML = '';
    const label = el('p', 'plabel', `${t('party.players', 'Players')} · ${state.roster.length}`);
    playersEl.appendChild(label);
    for (const r of state.roster) {
      const chip = el('div', 'chip' + (r.present ? '' : ' away'));
      chip.appendChild(buildAvatar(r.playerId));
      chip.appendChild(el('span', 'chip-name', r.nickname));
      if (r.playerId === roomHostId) chip.appendChild(el('span', 'chip-host', t('party.host', 'host')));
      playersEl.appendChild(chip);
    }
    const inLobby = state.phase === 'lobby';
    startBtn.hidden = !(state.isHost && inLobby);
    // A party needs at least two present players before the host can start —
    // the button stays visible but greys out (shared `.actions-row
    // button:disabled` style) until a second player joins.
    startBtn.disabled = state.roster.filter((r) => r.present).length < 2;
    waitEl.hidden = !(!state.isHost && inLobby);
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
    // Just the country name — no "Which flag is" / "The flag of" lead-in and no
    // trailing "?". The flag tiles (and their reveal pulse) carry the question.
    promptTarget.textContent = name;

    gridEl.innerHTML = '';
    for (const code of q.options) {
      if (isReveal && state.reveal) {
        const correct = code === state.reveal.answer;
        // Your own wrong pick pulses pink (flagQuiz's "bad" marker); it isn't
        // dimmed like the flags nobody chose. The correct flag pulses green.
        const myWrong = !correct && state.reveal.picks[state.you] === code;
        /** @type {string[]} */
        const pickers = [];
        for (const [pid, choice] of Object.entries(state.reveal.picks)) {
          if (choice === code) pickers.push(pid);
        }
        gridEl.appendChild(flagOpt(code, { selectable: false, selected: false, correct, wrong: myWrong, dim: !correct && !myWrong, pickers }));
      } else {
        const selected = state.myChoice === code;
        const dim = state.myChoice != null && !selected;
        gridEl.appendChild(flagOpt(code, { selectable: state.myChoice == null, selected, correct: false, wrong: false, dim, pickers: [] }));
      }
    }

    footEl.innerHTML = '';
    if (isReveal) renderRevealFoot();
  }

  /**
   * @param {string} code
   * @param {{ selectable: boolean, selected: boolean, correct: boolean, wrong: boolean, dim: boolean, pickers: string[] }} opts
   */
  function flagOpt(code, opts) {
    const node = document.createElement(opts.selectable ? 'button' : 'div');
    node.className = 'opt' + (opts.selected ? ' sel' : '') + (opts.correct ? ' correct' : '') + (opts.wrong ? ' wrong' : '') + (opts.dim ? ' dim' : '');
    if (opts.selectable) {
      /** @type {HTMLButtonElement} */ (node).type = 'button';
      node.addEventListener('click', () => onPick(code));
    }
    const img = document.createElement('img');
    img.className = 'flag';
    img.src = `../flags/svg/${code}.svg`;
    img.alt = '';
    node.appendChild(img);
    // The locked-in pick is shown by the pink ring + surface tint on the tile
    // itself (`.opt.sel`) — no ✓ badge. On reveal the correct flag is marked by
    // the green pulse alone (matching flagQuiz).
    if (opts.pickers.length) {
      const p = el('div', 'picks');
      for (const pid of opts.pickers) p.appendChild(buildAvatar(pid));
      node.appendChild(p);
    }
    return node;
  }

  function renderRevealFoot() {
    const list = el('div', 'toast-list');
    const fastest = CORRECT_POINTS + (SPEED_BONUS[0] || 0);
    const points = (state.reveal && state.reveal.points) || {};
    for (const entry of state.scoreboard || []) {
      const pts = points[entry.playerId] || 0;
      const toast = el('div', 'toast');
      toast.appendChild(buildAvatar(entry.playerId));
      toast.appendChild(el('span', 'toast-name', entry.nickname));
      if (pts === fastest) toast.appendChild(el('span', 'fast', `⚡ ${t('party.fastest', 'Fastest')}`));
      toast.appendChild(el('span', 'pts' + (pts === 0 ? ' zero' : ''), `+${pts}`));
      list.appendChild(toast);
    }
    footEl.appendChild(list);
    // No "Next round" button and no countdown: the round advances on its own
    // after a short beat (the host's clock sends 'next'), so the reveal just
    // shows who scored and moves on.
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
      row.appendChild(buildAvatar(entry.playerId));
      row.appendChild(el('span', 'nm', entry.nickname));
      row.appendChild(el('span', 'sc', String(entry.score)));
      finalBoard.appendChild(row);
    });
    // Only the host can restart, so both "Play again" and the "·" separator
    // that divides it from "Home" show for the host alone; everyone else sees
    // just "Home".
    playAgainBtn.hidden = !state.isHost;
    const sep = document.getElementById('result-sep');
    if (sep) sep.hidden = !state.isHost;
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
  $('create-room').addEventListener('click', () => { soloPending = false; enterRoom(generateCode(), 'create'); });

  $('play-solo').addEventListener('click', () => { soloPending = true; enterRoom(generateCode(), 'create'); });

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (document.getElementById('join-code'));
    const code = input.value.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      showJoinError('ttt.codeMustBe5', 'Code must be 5 characters');
      return;
    }
    clearJoinError();
    soloPending = false;
    enterRoom(code, 'join');
  });

  startBtn.addEventListener('click', () => send({ type: 'start' }));
  playAgainBtn.addEventListener('click', () => send({ type: 'playAgain' }));

  // Same share mechanism as Tic-Tac-Toe (common.js `shareUrl` → native sheet,
  // clipboard fallback), so the invite icon behaves identically across the two
  // online games. On a plain clipboard copy the icon morphs to a checkmark for
  // 1.5s via the shared `.copied` class; the native sheet and dismiss/fail
  // paths stay silent (matching TTT).
  shareBtn.addEventListener('click', async () => {
    if (!activeRoom) return;
    const result = await shareUrl(window.location.href, {
      title: t('party.shareTitle', 'Flag Party'),
      text: t('party.shareText', 'Join my Flag Party room:'),
    });
    if (result === 'copied') flashCopied();
  });

  function flashCopied() {
    shareBtn.classList.add('copied');
    window.setTimeout(() => shareBtn.classList.remove('copied'), 1500);
  }

  // ---- "playing as" line ----
  function paintPlayingAs() {
    renderPlayingAs(playingAsEl, deviceId, myName, t('party.playingAs', 'Playing as'));
  }
  paintPlayingAs();

  // Re-render dynamic text (country names, labels) on a soft language switch.
  document.addEventListener('langchanged', () => { paintPlayingAs(); paintJoinError(); render(); });

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
