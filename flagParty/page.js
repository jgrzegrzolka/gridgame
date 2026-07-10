import { t, countryName } from '../i18n.js';
import { generateCode, isValidRoomCode, serverUrlFor } from '../flags/roomNet.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { displayNickname } from '../flags/nickname.js';
import { loadCountries } from '../flags/group.js';
import { initialPartyClientState, reducePartyMessage, withLocalBuzz, pickPartyCelebration, isCleanReveal } from '../flags/partyClient.js';
import { runCelebration } from '../confetti.js';
import { CORRECT_POINTS, SPEED_BONUS } from '../flags/partyScore.js';
import { QUESTION_SECONDS, revealSecondsFor, secondsLeft, remainingFraction } from '../flags/partyTiming.js';
import { PARTY_MODES, DEFAULT_PLAN, countsForPlan, planFromModeCounts, MAX_ROUNDS_PER_MODE } from '../flags/partyPlan.js';
import { formatValue } from '../flags/metricLens.js';
import { buildAvatar, renderPlayingAs, shareUrl } from '../common.js';

/** @typedef {import('../flags/partyClient.js').PartyClientState} PartyClientState */

const NICKNAME_KEY = 'gridgame.nickname';
const PLAN_KEY = 'gridgame.party.plan';

/** Lobby copy for each catalog mode (`flags/partyPlan.js` PARTY_MODES). The
 *  catalog stays pure (ids only); labels live here, translated via i18n with the
 *  English text as the fallback. `full` shows in the dial row, `short` in the
 *  collapsed summary mix. */
const MODE_LABELS = {
  'flags-all': { key: 'party.mode.flagsAll', full: 'Flags: all countries', shortKey: 'party.modeShort.flagsAll', short: 'Flags' },
  'flags-territories': { key: 'party.mode.flagsTerritories', full: 'Flags: territories', shortKey: 'party.modeShort.flagsTerritories', short: 'Territories' },
  'map-outlines': { key: 'party.mode.mapOutlines', full: 'Map: outlines', shortKey: 'party.modeShort.mapOutlines', short: 'Maps' },
  'superlative-pop': { key: 'party.mode.superlativePop', full: 'Population: most & least', shortKey: 'party.modeShort.superlativePop', short: 'Population' },
};

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
  /** Fire the finish celebration (confetti / fireworks) exactly once per final
   *  screen. render() re-runs on every message and on a language switch, so a
   *  guard keeps the burst from re-triggering; reset when we leave the final
   *  phase (a "Play again" round → final fires a fresh show). */
  let finalCelebrated = false;

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
  const promptLead = $('prompt-lead');
  const promptTarget = $('prompt-target');
  const gridEl = $('flags-grid');
  const footEl = $('round-foot');
  const finalSub = $('final-sub');
  const finalBoard = $('final-board');
  const playAgainBtn = /** @type {HTMLButtonElement} */ ($('play-again'));
  const playingAsEl = $('playing-as');
  const joinError = $('join-error');
  const shareBtn = /** @type {HTMLButtonElement} */ ($('share-btn'));
  const gameSetupEl = $('game-setup');
  const gsModesEl = $('gs-modes');
  const gsMixEl = $('gs-mix');
  const gsRoundsEl = $('gs-rounds');

  /** @type {Map<string, { code: string, name: string }>} */
  const byCode = new Map();

  // Population values for the superlative round's reveal, fetched once at load
  // (the round itself is judged server-side; the client only needs the numbers
  // to show the ranking after the answer is out). Null until loaded / on failure
  // — the reveal just omits the strip if the data isn't there.
  /** @type {Record<string, number> | null} */
  let popValues = null;
  let popFormat = 'compact';

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
   * idiom as daily-stats / sync "loading…". Used for the connecting /
   * reconnecting wait so it reads as a wait, not an error box.
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
  // connecting / disconnected states. The last key is stashed so a
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

  // ---- game setup (host-only lobby plan) ----
  // The host picks which modes play and how many rounds each. The choice is
  // local (persisted per device) until Start, when the plan rides along on the
  // 'start' message and the server validates it — this is just the picker.
  /** @type {Record<string, { on: boolean, n: number }>} */
  const modeState = loadModeState();

  function defaultModeState() {
    const counts = countsForPlan(DEFAULT_PLAN);
    /** @type {Record<string, { on: boolean, n: number }>} */
    const s = {};
    for (const m of PARTY_MODES) s[m.id] = { on: counts[m.id] > 0, n: counts[m.id] || 1 };
    return s;
  }
  function loadModeState() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(PLAN_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        const def = defaultModeState();
        /** @type {Record<string, { on: boolean, n: number }>} */
        const s = {};
        for (const m of PARTY_MODES) {
          const e = raw[m.id];
          s[m.id] = e && typeof e.n === 'number' && e.n >= 1
            ? { on: !!e.on, n: Math.min(MAX_ROUNDS_PER_MODE, Math.max(1, Math.floor(e.n))) }
            : def[m.id];
        }
        // A game needs rounds — never restore an all-off plan.
        if (!PARTY_MODES.some((m) => s[m.id].on)) return def;
        return s;
      }
    } catch { /* private mode / malformed */ }
    return defaultModeState();
  }
  function saveModeState() {
    try { window.localStorage.setItem(PLAN_KEY, JSON.stringify(modeState)); } catch { /* private mode */ }
  }
  /** The plan to send on Start: enabled modes only, in catalog order. */
  function currentPlan() {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const m of PARTY_MODES) counts[m.id] = modeState[m.id].on ? modeState[m.id].n : 0;
    return planFromModeCounts(counts);
  }

  const modeLabel = (/** @type {string} */ id) => t(MODE_LABELS[id].key, MODE_LABELS[id].full);
  const modeShort = (/** @type {string} */ id) => t(MODE_LABELS[id].shortKey, MODE_LABELS[id].short);

  /** Build the dial rows once; their values are painted by updateSetup(). */
  function buildSetup() {
    gsModesEl.innerHTML = '';
    for (const m of PARTY_MODES) {
      const row = el('div', 'gs-mode');
      row.dataset.mode = m.id;
      row.appendChild(el('span', 'gs-name', modeLabel(m.id)));

      const stepper = el('span', 'gs-stepper');
      const minus = el('button', 'gs-step', '−');
      /** @type {HTMLButtonElement} */ (minus).type = 'button';
      minus.setAttribute('aria-label', t('party.fewer', 'Fewer rounds'));
      minus.addEventListener('click', () => stepMode(m.id, -1));
      const count = el('span', 'gs-count', String(modeState[m.id].n));
      const plus = el('button', 'gs-step', '+');
      /** @type {HTMLButtonElement} */ (plus).type = 'button';
      plus.setAttribute('aria-label', t('party.more', 'More rounds'));
      plus.addEventListener('click', () => stepMode(m.id, 1));
      stepper.append(minus, count, plus);
      row.appendChild(stepper);

      const sw = document.createElement('label');
      sw.className = 'scope-toggle-switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = modeState[m.id].on;
      input.setAttribute('aria-label', modeLabel(m.id));
      input.addEventListener('change', () => toggleMode(m.id, input.checked));
      const track = el('span', 'scope-toggle-track');
      track.appendChild(el('span', 'scope-toggle-thumb'));
      sw.append(input, track);
      row.appendChild(sw);

      gsModesEl.appendChild(row);
    }
    updateSetup();
  }

  function stepMode(/** @type {string} */ id, /** @type {number} */ d) {
    const st = modeState[id];
    st.n = Math.min(MAX_ROUNDS_PER_MODE, Math.max(1, st.n + d));
    saveModeState();
    updateSetup();
  }
  function toggleMode(/** @type {string} */ id, /** @type {boolean} */ on) {
    // Keep at least one mode enabled — a game needs rounds. Turning off the last
    // one is a no-op (updateSetup snaps its checkbox back on).
    if (!on && PARTY_MODES.filter((m) => modeState[m.id].on).length <= 1) { updateSetup(); return; }
    modeState[id].on = on;
    saveModeState();
    updateSetup();
  }

  /** Repaint counts, toggles, the round total, and the collapsed mix. */
  function updateSetup() {
    let total = 0;
    gsMixEl.innerHTML = '';
    for (const m of PARTY_MODES) {
      const st = modeState[m.id];
      const row = /** @type {HTMLElement | null} */ (gsModesEl.querySelector(`[data-mode="${m.id}"]`));
      if (row) {
        row.classList.toggle('off', !st.on);
        const c = row.querySelector('.gs-count'); if (c) c.textContent = String(st.n);
        const inp = /** @type {HTMLInputElement | null} */ (row.querySelector('input')); if (inp) inp.checked = st.on;
      }
      if (st.on) {
        total += st.n;
        const part = el('span');
        part.append(document.createTextNode(`${modeShort(m.id)} `), el('span', 'n', String(st.n)));
        gsMixEl.appendChild(part);
      }
    }
    gsRoundsEl.textContent = String(total);
  }
  /** On a language switch, repaint the JS-set labels (row names + mix). */
  function repaintSetupLabels() {
    for (const m of PARTY_MODES) {
      const row = gsModesEl.querySelector(`[data-mode="${m.id}"]`);
      const nm = row && row.querySelector('.gs-name');
      if (nm) nm.textContent = modeLabel(m.id);
    }
    updateSetup();
  }

  // ---- connection ----
  function wsUrl(/** @type {string} */ code, /** @type {'create'|'join'} */ intent) {
    return `${SERVER_URL}${encodeURIComponent(code)}?pid=${encodeURIComponent(deviceId)}` +
      `&nick=${encodeURIComponent(myName)}&intent=${intent}`;
  }

  function connect() {
    if (!activeRoom) return;
    // Connecting / reconnecting are waiting states, so they use the same
    // loading-dots idiom as daily-stats loading (not the bordered error box).
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
      // No override to show, so drop any transient status (connecting /
      // reconnecting) now that a real message has arrived.
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
    // The reveal length depends on the round, not the room: a clean sweep (every
    // present player got it right) snaps on; a miss holds so the correct flag
    // can be read. Question time is fixed. (flagQuiz's correct-fast/wrong-slow.)
    const clean = mode === 'reveal' && isCleanReveal(state.roster, state.reveal);
    clockTotalMs = (mode === 'reveal' ? revealSecondsFor(clean) : QUESTION_SECONDS) * 1000;
    clockDeadline = Date.now() + clockTotalMs;
    // Only the question phase shows the shrinking bar. The reveal has no timer of
    // its own — a sub-second bar read as a flicker — so it runs its clock unseen
    // and just advances after the beat (short when clean, longer on a miss).
    timerEl.hidden = mode === 'reveal';
    timerEl.setAttribute('data-mode', mode);
    if (!clockInterval) clockInterval = window.setInterval(tickClock, 200);
    tickClock();
  }

  function tickClock() {
    const mode = state.phase === 'reveal' ? 'reveal' : 'question';
    const now = Date.now();
    const left = secondsLeft(clockDeadline, now);
    // Only the question phase paints a bar; the reveal is bar-less (the clock
    // still runs below to advance the room, it just isn't drawn).
    if (mode === 'question') {
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
    // Leaving (or not yet in) the final screen re-arms the one-shot celebration.
    if (state.phase !== 'final') finalCelebrated = false;
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
    // The host can start as soon as they're seated — a room of one is allowed
    // (play alone), and more players can join before the tap. The guard only
    // greys out the impossible empty-roster case.
    startBtn.disabled = state.roster.filter((r) => r.present).length < 1;
    waitEl.hidden = !(!state.isHost && inLobby);
    // Game setup is the host's to configure, and only in the lobby.
    gameSetupEl.hidden = !(state.isHost && inLobby);
  }

  function renderRound() {
    const q = state.question;
    if (!q) return;
    roundPill.textContent = fmt(t('party.round', 'Round {n} of {total}'), {
      n: state.roundIndex + 1, total: state.totalRounds,
    });
    const isReveal = state.phase === 'reveal' && state.reveal;
    const isMap = q.roundId === 'mapPick';
    const isSuperlative = q.roundId === 'superlative';
    // A quiet mode hint above the country name, so players know whether the tiles
    // are flags or contours; the name itself stays bare (no "The flag of", no
    // trailing "?") — the tiles and their reveal pulse carry the rest.
    if (isSuperlative) {
      // Superlative has no target country: the prompt is a direction ('most' /
      // 'least'), and the whole question lives in the hint line ("Which is the
      // most populous?"). The big name header stays empty in *both* phases — on
      // reveal the answer is read straight off the tiles (each shows its country
      // + population and the correct one pulses), so a winner name here would be
      // redundant, and filling it only on reveal shifted the grid down.
      const least = q.prompt === 'least';
      promptLead.textContent = least
        ? t('party.hintLeast', 'Which is the least populous?')
        : t('party.hintMost', 'Which is the most populous?');
      promptTarget.textContent = '';
    } else {
      const targetCode = isReveal && state.reveal ? state.reveal.answer : q.prompt;
      const country = byCode.get(targetCode);
      const name = country ? countryName(country) : targetCode;
      promptLead.textContent = isMap ? t('party.hintMap', 'Which outline?') : t('party.hintFlag', 'Which flag?');
      promptTarget.textContent = name;
    }

    // On a superlative reveal, each tile shows its country + population so the
    // whole ranking is readable at a glance — the round's learning payoff. Only
    // on reveal (the numbers are hidden during the question), and only when the
    // population data actually loaded.
    const popStrip = (/** @type {string} */ code) => {
      if (!(isSuperlative && isReveal) || !popValues) return null;
      const v = popValues[code];
      if (v == null) return null;
      const c = byCode.get(code);
      return { name: c ? countryName(c) : code, value: formatValue(v, popFormat) };
    };

    gridEl.innerHTML = '';
    for (const code of q.options) {
      if (isReveal && state.reveal) {
        const correct = code === state.reveal.answer;
        // Your own wrong pick pulses pink (flagQuiz's "bad" marker); it isn't
        // dimmed like the tiles nobody chose. The correct tile pulses green.
        const myWrong = !correct && state.reveal.picks[state.you] === code;
        /** @type {string[]} */
        const pickers = [];
        for (const [pid, choice] of Object.entries(state.reveal.picks)) {
          if (choice === code) pickers.push(pid);
        }
        gridEl.appendChild(flagOpt(code, { isMap, selectable: false, selected: false, correct, wrong: myWrong, dim: !correct && !myWrong, pickers, pop: popStrip(code) }));
      } else {
        const selected = state.myChoice === code;
        const dim = state.myChoice != null && !selected;
        gridEl.appendChild(flagOpt(code, { isMap, selectable: state.myChoice == null, selected, correct: false, wrong: false, dim, pickers: [], pop: null }));
      }
    }

    footEl.innerHTML = '';
    if (isReveal) renderRevealFoot();
  }

  /**
   * @param {string} code
   * @param {{ isMap: boolean, selectable: boolean, selected: boolean, correct: boolean, wrong: boolean, dim: boolean, pickers: string[], pop?: { name: string, value: string } | null }} opts
   */
  function flagOpt(code, opts) {
    const node = document.createElement(opts.selectable ? 'button' : 'div');
    node.className = 'opt' + (opts.selected ? ' sel' : '') + (opts.correct ? ' correct' : '') + (opts.wrong ? ' wrong' : '') + (opts.dim ? ' dim' : '') + (opts.pop ? ' pop' : '');
    // On reveal, name the flag/outline you got wrong — the shared bottom strip
    // (common.css `.opt.wrong[data-name]`, same as flagQuiz) tells you what you
    // actually picked; the correct answer's name is already in the prompt header.
    // Suppressed when a superlative pop-strip is present (`opts.pop`): that strip
    // already carries every tile's name + value, so the ::after would double up.
    if (opts.wrong && !opts.pop) {
      const c = byCode.get(code);
      node.dataset.name = c ? countryName(c) : code;
    }
    if (opts.selectable) {
      /** @type {HTMLButtonElement} */ (node).type = 'button';
      node.addEventListener('click', () => onPick(code));
    }
    const img = document.createElement('img');
    img.className = opts.isMap ? 'contour' : 'flag';
    // The map round is the literal mirror of flag-pick: same tile, just swap the
    // asset folder (contours instead of flags/svg).
    img.src = opts.isMap ? `../flags/contours/${code}.svg` : `../flags/svg/${code}.svg`;
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
    // Superlative reveal only: a bottom strip naming the country and its
    // population, so all four values read as a ranking (the correct tile's green
    // pulse already flags the extreme).
    if (opts.pop) {
      const strip = el('div', 'opt-pop');
      strip.appendChild(el('span', 'nm', opts.pop.name));
      strip.appendChild(el('span', 'val', opts.pop.value));
      node.appendChild(strip);
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
    const top = board[0];
    const tie = board.length > 1 && !!top && board[1].score === top.score;
    // A clear winner needs no "{name} takes it" caption — the pink highlight
    // and the breathing effect on the top row already say it. The subtitle
    // only earns its place on a tie, where there's no single winner row to
    // carry the message.
    finalSub.textContent = tie ? t('party.tie', "It's a tie!") : '';
    finalSub.hidden = !tie;

    // The full finish "moment" — cascade, count-up, subtitle pop, and the
    // confetti / fireworks burst — plays once, on the first render of the
    // final screen. Later re-renders (a language switch, a repeated state
    // message) paint the board statically so nothing re-animates.
    const firstShow = !finalCelebrated;
    const animate = firstShow && !prefersReducedMotion();

    finalBoard.innerHTML = '';
    board.forEach((entry, i) => {
      const isWinner = i === 0 && !tie && entry.score > 0;
      // `.champion` (a sole winner) carries the sustained breathe + glow; a
      // tie's top row still gets `.win` styling but no champion effect.
      const row = el('div', 'scoreline' + (i === 0 ? ' win' : ' other') + (isWinner ? ' champion' : ''));
      row.appendChild(el('span', 'rank', String(i + 1)));
      row.appendChild(buildAvatar(entry.playerId));
      row.appendChild(el('span', 'nm', entry.nickname));
      const sc = el('span', 'sc', String(entry.score));
      row.appendChild(sc);
      if (animate) {
        // Cascade in bottom-to-top so the winner's row lands last, then tick
        // that row's score up once it has settled.
        const delay = (board.length - 1 - i) * 90;
        row.classList.add('enter');
        row.style.setProperty('--enter-delay', `${delay}ms`);
        countUp(sc, entry.score, 600, delay + 200);
      }
      finalBoard.appendChild(row);
    });

    if (firstShow) {
      // Pop only applies to the tie caption (the sole surviving subtitle).
      if (animate && tie) { finalSub.classList.remove('pop'); void finalSub.offsetWidth; finalSub.classList.add('pop'); }
      runCelebration(pickPartyCelebration({ scoreboard: board, you: state.you }));
      finalCelebrated = true;
    }

    // Only the host can restart, so both "Play again" and the "·" separator
    // that divides it from "Home" show for the host alone; everyone else sees
    // just "Home".
    playAgainBtn.hidden = !state.isHost;
    const sep = document.getElementById('result-sep');
    if (sep) sep.hidden = !state.isHost;
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Tick a score element from 0 up to its final value with an ease-out, so the
   * winner's total feels earned rather than just appearing. Starts after
   * `delayMs` (used to line up with the row's cascade landing).
   * @param {HTMLElement} node @param {number} to @param {number} durationMs @param {number} delayMs
   */
  function countUp(node, to, durationMs, delayMs) {
    if (to <= 0) { node.textContent = '0'; return; }
    node.textContent = '0';
    window.setTimeout(() => {
      const start = performance.now();
      const step = (/** @type {number} */ now) => {
        const p = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(eased * to));
        if (p < 1) requestAnimationFrame(step);
        else node.textContent = String(to);
      };
      requestAnimationFrame(step);
    }, delayMs);
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
      showJoinError('ttt.codeMustBe5', 'Code must be 5 characters');
      return;
    }
    clearJoinError();
    enterRoom(code, 'join');
  });

  startBtn.addEventListener('click', () => send({ type: 'start', plan: currentPlan() }));
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
  buildSetup();

  // Re-render dynamic text (country names, labels) on a soft language switch.
  document.addEventListener('langchanged', () => { paintPlayingAs(); paintJoinError(); repaintSetupLabels(); render(); });

  // ---- load data + route ----
  // Countries (for names + flags) and the population metric (for the superlative
  // reveal) load together. Population is best-effort — a failed fetch just means
  // the reveal shows no numbers — so it can't block the game; countries failing
  // still falls through to a bare render().
  Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    fetch('../flags/metrics/population.json').then((r) => r.json()).catch(() => null),
  ])
    .then(([countries, population]) => {
      for (const c of countries) byCode.set(c.code, c);
      if (population && population.values) {
        popValues = population.values;
        popFormat = population.format || 'compact';
      }
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
