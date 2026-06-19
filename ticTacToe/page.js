import { suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../flags/engine.js';
import {
  generateCode,
  isValidRoomCode,
  serverUrlFor,
  initialClientState,
  reduceServerMessage,
  canGiveUpOnline,
} from './onlineClient.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { submitTttResult } from '../flags/tttResultSubmit.js';
import { fetchTttPair } from '../flags/tttPairFetch.js';
import { deriveTttOutcome } from '../flags/tttPairOutcome.js';
import { submitEngagementEvent } from '../flags/eventSubmit.js';
import { fetchProfile } from '../flags/profileFetch.js';
import { displayNickname } from '../flags/nickname.js';
import { shouldFireTicTacToeConfetti, newlyWinningCells } from '../flags/ticTacToe.js';
import { trackEvent } from '../analytics.js';
import { loadCountries } from '../flags/group.js';
import { shareUrl } from '../common.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti } from '../confetti.js';
import { trapPicker, releasePicker } from './pickerLock.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/ticTacToe.js').GameState} GameState */

const SERVER_URL = serverUrlFor(window.location.hostname);

/** @param {import('../flags/engine.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

export function bootTicTacToeOnline() {
  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((countries) => runOnline(withLocalizedAliases(countries)))
    .catch((err) => {
      const lobbyEl = document.getElementById('lobby');
      if (lobbyEl) lobbyEl.hidden = false;
      const errEl = document.getElementById('lobby-error');
      if (errEl) { errEl.hidden = false; errEl.textContent = `${t('ttt.failedToLoadCountries', 'Failed to load countries:')} ${err.message}`; }
    });
}

/** @param {Country[]} countries */
function runOnline(countries) {
  const byCode = new Map(countries.map((c) => [c.code, c]));
  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());

  /** @type {WebSocket | null} */
  let ws = null;
  let state = initialClientState();
  // Tracks the last-seen winningLine so renderGrid fires the win-shake
  // only on the transition, not on later renders. Declared early because
  // a server message can arrive (and call renderGrid) before a later
  // declaration site, which would hit a TDZ.
  /** @type {[number, number][] | null} */
  let lastSeenWinningLine = null;
  /** Tracks the rendered status-line state ('your-turn' / 'opponents-turn' /
   * 'waiting' / 'empty') so we can pulse the line on transitions between
   * meaningful states — opponent moved, you moved, opponent joined, etc.
   * Skipping the pulse on the initial render keeps the page from flashing
   * when the user just arrived. */
  /** @type {string | null} */
  let lastStatusKey = null;

  /** Current room context — needed by the auto-reconnect path. */
  /** @type {{ code: string, intent: 'create' | 'join' } | null} */
  let activeRoom = null;
  /** Sticky across reconnects (activeRoom.intent flips to 'join' on reconnect). */
  let isHost = false;
  // Touch-first devices (phones, tablets) — the platforms where copying from
  // the URL bar is fiddly and the native share sheet (WhatsApp etc.) is the
  // whole point. Desktop users have ctrl-L + ctrl-C. Declared up here because
  // a ?room=… URL triggers enterRoom() → renderShareButton() before the
  // function body has finished evaluating.
  const isTouchDevice =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  /** Reconnect bookkeeping. The server's own 'rejected' sets this so we don't loop. */
  let stopReconnecting = false;
  let reconnectAttempts = 0;
  /** @type {any} */
  let reconnectTimer = 0;

  /** @type {{ row: number, col: number } | null} */
  let activeCell = null;
  /** @type {Country[]} */
  let currentMatches = [];
  let selectedIndex = 0;

  // Soft language switch: whichever path last painted the status line
  // installs a closure here so a langchanged event can replay it. State-
  // derived paints (renderStatus) re-install themselves so a future flip
  // re-derives from the latest `state`; transient paints (setStatusKey
  // for connecting / disconnected / connection-error) install closures
  // that re-translate against the new cache while preserving any
  // template params (e.g. seconds left to retry).
  /** @type {(() => void) | null} */
  let repaintStatusForLang = null;

  const lobbyEl = document.getElementById('lobby');
  const gameEl = document.getElementById('game');
  const createBtn = document.getElementById('create-room');
  const joinForm = /** @type {HTMLFormElement} */ (document.getElementById('join-form'));
  const joinCodeEl = /** @type {HTMLInputElement} */ (document.getElementById('join-code'));
  const errorEl = document.getElementById('lobby-error');
  const roomCodeEl = document.getElementById('room-code');
  const shareBtnEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('share-link'));
  const roleBadgeEl = document.getElementById('role-badge');
  const statusEl = document.getElementById('status-line');
  const matchupOpponentEl = document.getElementById('matchup-opponent');
  const gridBodyEl = document.getElementById('grid-body');
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const playAgainEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('play-again'));
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  /** Server stamps the resigner's role on the broadcast; we keep it locally so
   * finishRound can pick "You gave up" vs "Opponent gave up" without re-deriving
   * it from the game state. */
  /** @type {boolean | null} */
  let lastGaveUpByMe = null;
  /** Once-per-game guard so a noisy welcome / multiple state messages
   * carrying the finished game can't multi-submit the same head-to-head
   * row. Reset on rematch. Refresh-after-finish still re-fires (no gameId
   * tracking by design — see FEATURE.md Feature G). */
  let resultSubmittedForGame = false;
  /** Opponent's saved nickname. `undefined` = not yet fetched, `null` =
   *  fetch resolved but the opponent never set a nickname (so the
   *  deterministic default applies via `displayNickname`), `string` =
   *  their actual saved value. One fetch per peer per room session. */
  /** @type {string | null | undefined} */
  let opponentNickname;
  let opponentFetchInFlight = false;
  /** Head-to-head record vs this opponent for the 3×3 mode. Server
   * shape: `{ wins, losses, draws }`. `null` = not yet fetched. One
   * fetch per peer per room session; bumped optimistically in
   * `reportFinishedResult` so the UI reflects the just-finished game
   * without waiting on the POST round-trip. */
  /** @type {{ wins: number, losses: number, draws: number } | null} */
  let pairRecord = null;
  let pairFetchInFlight = false;
  /** Set true by `buildGridStructure` the first time it builds the 3×3 DOM,
   * so subsequent calls (e.g. revisits across rematches) early-return. The
   * declaration sits up here with the other module-scoped state because the
   * top-level `?room=` auto-join below reaches `buildGridStructure` during
   * module init — declaring `gridBuilt` further down would TDZ on refresh. */
  let gridBuilt = false;
  const colHeaderEls = document.querySelectorAll('.col-header');
  const zoomEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('zoom'));
  const zoomImg = zoomEl ? /** @type {HTMLImageElement | null} */ (zoomEl.querySelector('img')) : null;
  const zoomName = zoomEl ? /** @type {HTMLParagraphElement | null} */ (zoomEl.querySelector('p')) : null;
  const pickerEl = document.getElementById('picker');
  const pickerBackdropEl = document.getElementById('picker-backdrop');
  const pickerCloseEl = document.getElementById('picker-close');
  const pickerCatsEl = document.getElementById('picker-cats');
  const pickerInputEl = /** @type {HTMLInputElement} */ (document.getElementById('picker-input'));
  const pickerSuggestionsEl = /** @type {HTMLUListElement} */ (document.getElementById('picker-suggestions'));

  // ---- Lobby ----
  const params = new URL(window.location.href).searchParams;
  const roomParam = params.get('room');
  if (roomParam && isValidRoomCode(roomParam.toUpperCase())) {
    // A pre-existing ?room=... URL is always a join — the only way to get a
    // create URL is by clicking the Create button, which sets intent=create
    // on the in-page state (not in the URL).
    enterRoom(roomParam.toUpperCase(), 'join');
  } else {
    showLobby();
  }

  function showLobby() {
    if (lobbyEl) lobbyEl.hidden = false;
    if (gameEl) gameEl.hidden = true;
  }

  if (createBtn) {
    createBtn.addEventListener('click', () => enterRoom(generateCode(), 'create'));
  }
  if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = joinCodeEl.value.toUpperCase().trim();
      if (!isValidRoomCode(code)) {
        showError('ttt.codeMustBe5', 'Code must be 5 characters');
        return;
      }
      enterRoom(code, 'join');
    });
  }

  // Stash the last error's i18n key + fallback so a soft language switch
  // re-translates the visible lobby error without re-running the click
  // handler. Cleared by clearError().
  /** @type {{ key: string, fallback: string, params?: Record<string, string> } | null} */
  let lastErrorKey = null;

  /**
   * @param {string} key
   * @param {string} fallback
   * @param {Record<string, string>} [params]
   */
  function showError(key, fallback, params) {
    if (!errorEl) return;
    lastErrorKey = { key, fallback, params };
    errorEl.hidden = false;
    paintError();
  }

  function paintError() {
    if (!errorEl || !lastErrorKey) return;
    let msg = t(lastErrorKey.key, lastErrorKey.fallback);
    const params = lastErrorKey.params;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(`{${k}}`, String(v));
      }
    }
    errorEl.textContent = msg;
  }

  // ---- Room join ----
  /** @param {string} code @param {'create' | 'join'} intent */
  function enterRoom(code, intent) {
    activeRoom = { code, intent };
    if (intent === 'create') isHost = true;
    stopReconnecting = false;
    reconnectAttempts = 0;
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.history.replaceState(null, '', url.toString());
    if (lobbyEl) lobbyEl.hidden = true;
    if (gameEl) gameEl.hidden = false;
    if (roomCodeEl) roomCodeEl.textContent = code;
    renderShareButton();
    setStatusKey('ttt.connecting', 'Connecting…');
    // Build the empty grid structure now so the user sees the full
    // 3×3 layout immediately, instead of just the (empty) thead row
    // while the WebSocket connects and the server responds with
    // `welcome`. Header text gets filled in by populateGridLabels()
    // once the game state arrives.
    buildGridStructure();
    connect();
  }

  function connect() {
    if (!activeRoom) return;
    const { code, intent } = activeRoom;
    const wsUrl = `${SERVER_URL}${encodeURIComponent(code)}?pid=${encodeURIComponent(deviceId)}&intent=${intent}`;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('message', (ev) => onServerMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', onSocketClose);
    ws.addEventListener('error', () => setStatusKey('ttt.connectionError', 'Connection error'));
  }

  function onSocketClose() {
    // Feature Q: net new signal — PartyKit (the WS server) runs on
    // Cloudflare, not Azure, so AI sees nothing about disconnects from
    // the server side. Tracking the client-side close gives us
    // observability into "did someone drop mid-game" from the only
    // surface we can reach.
    trackEvent('ttt-disconnect', {
      mode: '3x3',
      role: state.myRole ?? 'unknown',
      peerPresent: state.peerPresent === true,
      hadWinner: typeof state.game?.winner === 'string',
      stopReconnecting,
      reconnectAttempts,
    });
    if (stopReconnecting || !activeRoom) {
      // Either the server rejected us (rejected -> close in the reducer)
      // or we never had a room. Leave the status whatever the reducer set.
      return;
    }
    // Subsequent reconnects are always 'join' — the room was already created
    // on the first successful connect (or by the peer).
    activeRoom = { ...activeRoom, intent: 'join' };
    reconnectAttempts++;
    const delayMs = Math.min(30000, 1000 * 2 ** (reconnectAttempts - 1));
    setStatusKey('ttt.disconnectedReconnecting', 'Disconnected. Reconnecting in {seconds}s…', { seconds: Math.round(delayMs / 1000) });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delayMs);
  }

  /** @param {any} msg */
  function onServerMessage(msg) {
    const before = state;
    const { state: nextState, effects } = reduceServerMessage(state, msg);
    state = nextState;

    if (msg.type === 'welcome') populateGridLabels();
    if (state.statusOverride && state.statusOverride !== before.statusOverride) {
      setStatusKey(
        state.statusOverride.key,
        state.statusOverride.fallback,
        state.statusOverride.params,
      );
    } else {
      renderRole();
      renderGrid();
      renderStatus();
    }
    maybeFetchOpponent();
    maybeFetchPair();
    renderMatchupOpponent();
    for (const effect of effects) {
      if (effect.type === 'shake') shakeCell(effect.row, effect.col);
      else if (effect.type === 'gave-up') lastGaveUpByMe = effect.byMe;
      else if (effect.type === 'finished') { finishRound(); reportFinishedResult(); }
      else if (effect.type === 'rematch-started') { resultSubmittedForGame = false; startFreshRound(); }
      else if (effect.type === 'close') {
        // Server-side rejection — don't auto-reconnect, snap back to the
        // lobby with the reason visible so the user understands why their
        // attempt didn't land them in a real room.
        stopReconnecting = true;
        clearTimeout(reconnectTimer);
        if (ws) ws.close();
        returnToLobbyWithError(state.statusOverride);
      }
    }
  }

  /** @param {{ key: string, fallback: string, params?: Record<string, string> } | null} errorOverride */
  function returnToLobbyWithError(errorOverride) {
    if (gameEl) gameEl.hidden = true;
    if (lobbyEl) lobbyEl.hidden = false;
    if (errorOverride) showError(errorOverride.key, errorOverride.fallback, errorOverride.params);
    // Clear ?room=… so reloading doesn't re-attempt the same dead room.
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url.toString());
    activeRoom = null;
    isHost = false;
    state = initialClientState();
    gridBuilt = false;
    if (gridBodyEl) gridBodyEl.innerHTML = '';
    if (roomCodeEl) roomCodeEl.textContent = '-----';
    renderShareButton();
    lastStatusKey = null;
    // Wipe the opponent context so the next room starts with a clean
    // slate; otherwise a stale name would briefly leak into a fresh
    // join while the new fetch is in flight.
    opponentNickname = undefined;
    pairRecord = null;
    resultSubmittedForGame = false;
    if (matchupOpponentEl) matchupOpponentEl.replaceChildren();
  }

  // ---- Grid ----
  // Built in two passes: enterRoom() runs buildGridStructure() so the
  // 3×3 layout is on-screen before the WebSocket connects, then the
  // 'welcome' handler runs populateGridLabels() to fill in row/col
  // header text from the server's puzzle. Splitting these eliminates
  // the "half-grid for some seconds" gap users were seeing between
  // joining a room and the first server message arriving.
  // (`gridBuilt` is declared up with the other module-scoped state — see
  // the TDZ note there.)
  function buildGridStructure() {
    if (gridBuilt) return;
    gridBuilt = true;
    for (let r = 0; r < 3; r++) {
      const tr = document.createElement('tr');
      const rowHeader = document.createElement('th');
      tr.appendChild(rowHeader);
      for (let c = 0; c < 3; c++) {
        const td = document.createElement('td');
        td.className = 'cell';
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        td.tabIndex = 0;
        td.addEventListener('click', () => onCellActivate(r, c));
        td.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellActivate(r, c); }
        });
        tr.appendChild(td);
      }
      gridBodyEl.appendChild(tr);
    }
  }
  function populateGridLabels() {
    const { game } = state;
    if (!game) return;
    colHeaderEls.forEach((th, i) => { th.textContent = tCat(/** @type {GameState} */ (game).puzzle.cols[i]); });
    const rowHeaders = gridBodyEl.querySelectorAll('tr > th');
    rowHeaders.forEach((th, i) => { th.textContent = tCat(/** @type {GameState} */ (game).puzzle.rows[i]); });
  }

  /** @param {number} r @param {number} c */
  function onCellActivate(r, c) {
    const { game, myRole, peerPresent } = state;
    if (!game) return;
    const cellCountry = game.cells[r][c].country;
    if (cellCountry) {
      openZoom(cellCountry);
      return;
    }
    if (!myRole) return;
    if (!peerPresent) return;
    if (game.winner || game.draw) return;
    if (game.currentPlayer !== myRole) return;
    openPicker(r, c);
  }

  /** @param {Country} c */
  function openZoom(c) {
    if (!zoomEl || !zoomImg || !zoomName) return;
    zoomImg.src = `../flags/svg/${c.code}.svg`;
    const displayName = countryName(c);
    zoomImg.alt = displayName;
    zoomName.textContent = displayName;
    zoomEl.showModal();
  }

  if (zoomEl) {
    zoomEl.addEventListener('click', (e) => {
      if (e.target === zoomEl) zoomEl.close();
    });
  }

  // ---- Rules help ----
  const rulesBtnEl = document.getElementById('rules-btn');
  const rulesHelpEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('rules-help'));
  const rulesCloseEl = document.getElementById('rules-close');
  if (rulesBtnEl && rulesHelpEl) {
    rulesBtnEl.addEventListener('click', () => rulesHelpEl.showModal());
    rulesHelpEl.addEventListener('click', (e) => {
      if (e.target === rulesHelpEl) rulesHelpEl.close();
    });
  }
  if (rulesCloseEl && rulesHelpEl) {
    rulesCloseEl.addEventListener('click', () => rulesHelpEl.close());
  }

  // ---- Picker ----
  /** @param {number} r @param {number} c */
  function openPicker(r, c) {
    const { game } = state;
    if (!game) return;
    activeCell = { row: r, col: c };
    pickerCatsEl.textContent = `${tCat(game.puzzle.rows[r])} × ${tCat(game.puzzle.cols[c])}`;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    renderSuggestions();
    pickerEl.hidden = false;
    document.body.classList.add('picker-open');
    trapPicker(pickerEl);
    pickerInputEl.focus();
  }

  function closePicker() {
    if (pickerEl.hidden) return;
    activeCell = null;
    pickerInputEl.value = '';
    currentMatches = [];
    selectedIndex = 0;
    pickerSuggestionsEl.innerHTML = '';
    pickerEl.hidden = true;
    document.body.classList.remove('picker-open');
    releasePicker();
  }

  function updateSuggestions() {
    const { game } = state;
    if (!game) return;
    const query = pickerInputEl.value;
    const excludeCodes = new Set();
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = game.cells[r][c];
        if (cell.country) excludeCodes.add(cell.country.code);
      }
    }
    currentMatches = suggest(countries, query, { excludeCodes });
    selectedIndex = 0;
    renderSuggestions();
    const auto = exactSingleMatch(currentMatches, query);
    if (auto) pickCountry(auto);
  }

  function renderSuggestions() {
    pickerSuggestionsEl.innerHTML = '';
    currentMatches.forEach((country, i) => {
      const li = document.createElement('li');
      if (i === selectedIndex) li.classList.add('selected');
      const name = document.createElement('span');
      name.textContent = countryName(country);
      li.appendChild(name);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pickCountry(country); });
      li.addEventListener('mouseenter', () => { selectedIndex = i; renderSelected(); });
      pickerSuggestionsEl.appendChild(li);
    });
  }

  function renderSelected() {
    const items = pickerSuggestionsEl.querySelectorAll('li');
    items.forEach((li, i) => { li.classList.toggle('selected', i === selectedIndex); });
  }

  pickerInputEl.addEventListener('input', updateSuggestions);
  pickerInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = currentMatches[selectedIndex];
      if (picked) pickCountry(picked);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentMatches.length === 0) return;
      selectedIndex = (selectedIndex + 1) % currentMatches.length;
      renderSelected();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentMatches.length === 0) return;
      selectedIndex = (selectedIndex - 1 + currentMatches.length) % currentMatches.length;
      renderSelected();
      return;
    }
  });
  pickerBackdropEl.addEventListener('click', closePicker);
  pickerCloseEl.addEventListener('click', closePicker);

  /** @param {Country} country */
  function pickCountry(country) {
    if (!activeCell || !ws) return;
    const { row, col } = activeCell;
    ws.send(JSON.stringify({ type: 'claim', row, col, countryCode: country.code }));
    closePicker();
    // The server will broadcast the new state; render happens in onServerMessage.
  }

  // ---- Renderers ----
  function renderRole() {
    if (!roleBadgeEl) return;
    const { myRole } = state;
    if (!myRole) { roleBadgeEl.textContent = '?'; return; }
    roleBadgeEl.textContent = myRole;
    roleBadgeEl.className = 'turn-badge ' + myRole.toLowerCase();
  }

  function renderGrid() {
    const { game } = state;
    if (!game || !gridBuilt) return;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const td = /** @type {HTMLTableCellElement} */ (
          gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
        );
        const cell = game.cells[r][c];
        td.innerHTML = '';
        td.classList.toggle('owned', !!cell.owner);
        td.classList.toggle('owner-x', cell.owner === 'X');
        td.classList.toggle('owner-o', cell.owner === 'O');
        td.classList.toggle('revealed', !!cell.revealed);
        td.classList.toggle('exhausted', !!cell.exhausted);
        td.classList.remove('winning');
        if (cell.country) {
          const img = document.createElement('img');
          img.src = `../flags/svg/${cell.country.code}.svg`;
          img.alt = countryName(cell.country);
          td.appendChild(img);
        }
      }
    }
    if (game.winningLine) {
      for (const [r, c] of game.winningLine) {
        const td = gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
        if (td) td.classList.add('winning');
      }
    }
    // One-shot shake on the freshly formed line — lastSeenWinningLine
    // guards against re-shaking on later renders (rematch reset etc.).
    const fresh = newlyWinningCells(
      { winningLine: lastSeenWinningLine },
      { winningLine: game.winningLine },
    );
    for (const [r, c] of fresh) {
      const td = gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
      if (!td) continue;
      td.classList.add('shake-win');
      setTimeout(() => td.classList.remove('shake-win'), 1200);
    }
    lastSeenWinningLine = game.winningLine;
    document.body.classList.toggle('game-over', game.winner !== null || game.draw || Boolean(game.gaveUp));
    renderGiveUpButton();
  }

  function renderGiveUpButton() {
    if (!giveUpEl) return;
    giveUpEl.hidden = !canGiveUpOnline(state);
  }

  function renderStatus() {
    renderShareButton();
    renderGiveUpButton();
    if (!statusEl) return;
    const { game, myRole, peerPresent } = state;
    statusEl.className = 'status-line';
    /** @type {string} */
    let key;
    if (!game) {
      statusEl.textContent = t('ttt.connecting', 'Connecting…');
      key = 'connecting';
    } else if (game.winner || game.draw || game.gaveUp) {
      statusEl.textContent = '';
      key = 'empty';
    } else if (!peerPresent) {
      statusEl.textContent = t('ttt.waitingShareCode', 'Waiting for opponent… share the code above');
      statusEl.classList.add('peer-missing');
      key = 'waiting';
    } else if (game.currentPlayer === myRole) {
      statusEl.textContent = t('ttt.yourTurn', 'Your turn');
      statusEl.classList.add('your-turn');
      key = 'your-turn';
    } else {
      statusEl.textContent = t('ttt.opponentsTurn', "Opponent's turn");
      key = 'opponents-turn';
    }
    // Pulse on meaningful state transitions — your-turn ↔ opponents-turn is
    // the main case (replaces the bounce the old turn-badge gave us below
    // the grid). Skip the initial render (lastStatusKey === null) and any
    // transition into 'empty' so the line doesn't pulse at game-end.
    if (lastStatusKey !== null && key !== 'empty' && key !== lastStatusKey) {
      statusEl.classList.remove('pulse');
      void statusEl.offsetWidth;
      statusEl.classList.add('pulse');
    }
    lastStatusKey = key;
    // State took over the status line — point repaintStatusForLang at
    // ourselves so a future lang flip re-derives from state instead of
    // re-painting whatever transient text was last shown.
    repaintStatusForLang = renderStatus;
  }

  // ---- Share link ----
  function renderShareButton() {
    if (!shareBtnEl) return;
    shareBtnEl.hidden = !(isTouchDevice && isHost && !state.peerPresent);
  }

  async function onShareClick() {
    if (!activeRoom) return;
    const result = await shareUrl(window.location.href, {
      title: t('ttt.shareTitle', 'Tic-Tac-Toe room'),
      text: t('ttt.shareText', "Let's play! Join my room:"),
    });
    if (result === 'copied') flashCopied();
    // 'shared': system sheet handled the feedback.
    // 'dismissed': user backed out — leaving the URL unshared is the point.
    // 'failed': all three mechanisms refused; staying silent matches the
    //   pre-extraction behaviour.
    if (result === 'shared' || result === 'copied') {
      void submitEngagementEvent(deviceId, {
        kind: 'share',
        payload: { surface: 'ttt', contextHint: activeRoom.code },
      });
    }
  }

  function flashCopied() {
    if (!shareBtnEl) return;
    shareBtnEl.classList.add('copied');
    setTimeout(() => {
      if (shareBtnEl) shareBtnEl.classList.remove('copied');
    }, 1500);
  }

  if (shareBtnEl) shareBtnEl.addEventListener('click', onShareClick);

  /** @param {string} message */
  function setStatus(message) {
    if (statusEl) {
      statusEl.className = 'status-line';
      statusEl.textContent = message;
    }
  }

  /**
   * Set a transient (non-state-derived) status line via an i18n key.
   * Records a closure so a soft language switch re-translates the
   * stored key + template params instead of leaving stale text.
   *
   * @param {string} key
   * @param {string} fallback
   * @param {Record<string, string | number>} [params]
   */
  function setStatusKey(key, fallback, params) {
    let msg = t(key, fallback);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(`{${k}}`, String(v));
      }
    }
    setStatus(msg);
    repaintStatusForLang = () => setStatusKey(key, fallback, params);
  }

  /** @param {number} r @param {number} c */
  function shakeCell(r, c) {
    const td = /** @type {HTMLTableCellElement} */ (
      gridBodyEl.querySelector(`td[data-row="${r}"][data-col="${c}"]`)
    );
    if (!td) return;
    td.classList.remove('shake');
    void td.offsetWidth;
    pulseShake(td);
  }

  /**
   * Paint the final-score text from state. Idempotent + side-effect-free —
   * a langchanged event can re-call it without re-firing confetti or
   * un-disabling Play again. The reveal + confetti happen in finishRound,
   * which calls into this for the actual textContent / colour.
   */
  function paintFinalScore() {
    const { game, myRole } = state;
    if (!finalScoreEl || !game) return;
    if (game.gaveUp) {
      finalScoreEl.textContent = lastGaveUpByMe
        ? t('ttt.youGaveUp', 'You gave up')
        : t('ttt.opponentGaveUp', 'Opponent gave up');
    } else if (game.winner) {
      const youWon = game.winner === myRole;
      finalScoreEl.textContent = youWon
        ? t('ttt.youWin', 'You win!')
        : t('ttt.opponentWins', 'Opponent wins');
    } else {
      finalScoreEl.textContent = t('ttt.draw', 'Draw');
    }
    // Brand secondary on every outcome — trades the X/O winner-colour
    // encoding for a unified accent treatment. Inline (not CSS) because
    // the previous code set this inline and we can't override it from
    // the stylesheet without `!important`.
    finalScoreEl.style.color = 'var(--secondary-color)';
  }

  function finishRound() {
    const { game, myRole } = state;
    if (!resultEl || !game) return;
    paintFinalScore();
    if (!game.gaveUp && game.winner && shouldFireTicTacToeConfetti({ winner: game.winner, myRole })) {
      launchConfetti();
    }
    if (playAgainEl) playAgainEl.disabled = false;
    resultEl.hidden = false;
  }

  /**
   * POST a single head-to-head row update to /api/v1/ttt/result. Fire-and-
   * forget — failures don't block the UI, and a server-side 5xx just means
   * the pair row didn't tick this time. Outcome is derived purely from the
   * final game state (winner / draw / gaveUp + winner), so it works the
   * same whether finished was triggered live or by a refresh-restore.
   */
  function reportFinishedResult() {
    if (resultSubmittedForGame) return;
    const { game, myRole, peerId } = state;
    if (!game || !myRole || !peerId) return;
    // Outcome derivation (incl. the give-up branch the original chain
    // silently skipped) lives in flags/tttPairOutcome.js so the rule
    // is pinned by tests. See that file's header for the regression
    // history that pushed it out of inline.
    const outcome = deriveTttOutcome(game, myRole);
    if (!outcome) return;
    resultSubmittedForGame = true;
    // Only the room creator (`isHost`) POSTs. The server-side handler
    // upserts both this row AND the mirror row for the opponent in one
    // call (`api/src/functions/tttResult.js`), so the two perspectives
    // can't drift the way they did under the original "both clients
    // post" design — a dropped POST on one side left that side's row
    // permanently behind. Both sides still bump their local
    // `pairRecord` below so the joiner's UI also updates on each game.
    if (isHost) {
      void submitTttResult({ deviceId, opponentId: peerId, mode: '3x3', outcome });
    }
    // Optimistic local bump so the role line's record suffix reflects
    // the just-finished game immediately. If the POST drops a future
    // pair-fetch on a fresh room will correct any drift.
    if (pairRecord) {
      if (outcome === 'win') pairRecord = { ...pairRecord, wins: pairRecord.wins + 1 };
      else if (outcome === 'loss') pairRecord = { ...pairRecord, losses: pairRecord.losses + 1 };
      else pairRecord = { ...pairRecord, draws: pairRecord.draws + 1 };
    } else {
      pairRecord = {
        wins: outcome === 'win' ? 1 : 0,
        losses: outcome === 'loss' ? 1 : 0,
        draws: outcome === 'draw' ? 1 : 0,
      };
    }
    renderMatchupOpponent();
  }

  /**
   * Spawn a one-time fetch for the opponent's saved nickname the first
   * time we know who the opponent is. No-op on subsequent calls until
   * `returnToLobbyWithError` wipes the state.
   */
  function maybeFetchOpponent() {
    if (!state.peerId) return;
    if (opponentNickname !== undefined || opponentFetchInFlight) return;
    opponentFetchInFlight = true;
    fetchProfile({ deviceId: state.peerId }).then((r) => {
      opponentNickname = r.ok ? r.nickname : null;
      opponentFetchInFlight = false;
      renderMatchupOpponent();
    });
  }

  /**
   * Spawn a one-time fetch for the head-to-head record vs this opponent
   * (3×3 mode). Same lifecycle as `maybeFetchOpponent` — no-op on
   * subsequent calls until `returnToLobbyWithError` wipes the state.
   * Failures resolve to null and the suffix stays hidden until the
   * next fresh peer.
   */
  function maybeFetchPair() {
    if (!state.peerId) return;
    if (pairRecord !== null || pairFetchInFlight) return;
    pairFetchInFlight = true;
    fetchTttPair({ deviceId, opponentId: state.peerId }).then((r) => {
      pairRecord = r.ok ? r.row.m3x3 : null;
      pairFetchInFlight = false;
      renderMatchupOpponent();
    });
  }

  /**
   * Paint "· vs <Opponent>" inline next to the role badge. Empty when
   * no peer is known yet (lobby / pre-welcome state) — the span just
   * collapses and the role line reads as it always did.
   *
   * Built via createElement (not innerHTML) so an opponent nickname like
   * `<script>` can't escape into the page.
   */
  function renderMatchupOpponent() {
    if (!matchupOpponentEl) return;
    matchupOpponentEl.replaceChildren();
    if (!state.peerId) return;

    const vs = document.createElement('span');
    vs.className = 'muted';
    vs.textContent = t('ttt.matchupVs', 'vs');
    const name = document.createElement('span');
    // While the profile fetch is still in flight (opponentNickname is
    // `undefined`), paint a muted "loading…" label in the name slot
    // instead of letting `displayNickname` fall back to the deterministic
    // default (Brave Falcon-style). That fallback flashed the wrong
    // name for a beat before snapping to the real one once the fetch
    // resolved. `null` (fetch resolved, no nickname stored) still goes
    // through `displayNickname` and gets the deterministic default —
    // that's the intended behaviour for opponents who haven't picked
    // a nickname. */
    if (opponentNickname === undefined) {
      name.className = 'matchup-name matchup-name-loading';
      name.textContent = t('ttt.matchupOpponentLoading', 'loading…');
    } else {
      name.className = 'matchup-name';
      name.textContent = displayNickname(state.peerId, opponentNickname);
    }
    matchupOpponentEl.append(vs, name);

    // Suffix after the name. When the opponent name is still loading,
    // skip the record suffix entirely — one loading label per row reads
    // cleaner than `vs loading… (loading…)`. Once the name resolves,
    // the record may still be in flight and paints its own loading.
    //
    //   - Name loading: nothing here.
    //   - Pair fetch in flight: a muted "loading…" label so a slow API
    //     call doesn't leave the line ambiguous (rule: every long-
    //     running API surface gets a loading label).
    //   - Resolved with at least one game on record: the record
    //     `(1:0)` (wins:losses), with ", N draws" appended when draws >
    //     0, so the role line reads "You are O vs Alice (1:0)" or
    //     "You are O vs Alice (1:0, 2 draws)".
    //   - Resolved with no games yet: nothing — a brand-new pairing
    //     shouldn't paint a "(0:0)".
    if (opponentNickname === undefined) {
      // name slot already shows the unified loading state
    } else if (pairFetchInFlight) {
      const loading = document.createElement('span');
      loading.className = 'matchup-record matchup-record-loading';
      loading.textContent = t('ttt.matchupRecordLoading', 'loading…');
      matchupOpponentEl.append(loading);
    } else if (pairRecord && (pairRecord.wins | pairRecord.losses | pairRecord.draws) > 0) {
      const record = document.createElement('span');
      record.className = 'matchup-record';
      let inner = `${pairRecord.wins}:${pairRecord.losses}`;
      if (pairRecord.draws > 0) {
        const drawKey = pairRecord.draws === 1 ? 'ttt.matchupDraw' : 'ttt.matchupDraws';
        const drawLabel = t(drawKey, pairRecord.draws === 1 ? 'draw' : 'draws');
        inner += `, ${pairRecord.draws} ${drawLabel}`;
      }
      record.textContent = `(${inner})`;
      matchupOpponentEl.append(record);
    }
  }

  /**
   * Soft language switch: re-translate every text surface this game
   * owns without rebuilding game state. The grid headers (from
   * tCat-translated categories), in-cell `<img>.alt` (countryName),
   * status line (state-derived or transient — repaintStatusForLang
   * tracks which), picker category line if open, and result final
   * score all re-translate from the current cache.
   */
  function refreshI18nForGame() {
    const { game } = state;
    if (game && gridBuilt) {
      populateGridLabels();
      renderGrid();
    }
    if (repaintStatusForLang) repaintStatusForLang();
    if (!pickerEl.hidden && activeCell && game) {
      const { row, col } = activeCell;
      pickerCatsEl.textContent = `${tCat(/** @type {GameState} */ (game).puzzle.rows[row])} × ${tCat(/** @type {GameState} */ (game).puzzle.cols[col])}`;
    }
    if (resultEl && !resultEl.hidden) paintFinalScore();
    paintError();
  }

  document.addEventListener('langchanged', refreshI18nForGame);

  // The server-broadcast rematch state arrived: the grid headers need to be
  // rebuilt for the new puzzle, the finished overlay needs to go away, and
  // the body must shed the .game-over class so cells become clickable again.
  // Render at the end too — onServerMessage already called renderGrid once,
  // but against the OLD grid built from the OLD puzzle, so those writes hit
  // stale td references and we have to re-render against the fresh grid.
  function startFreshRound() {
    if (resultEl) resultEl.hidden = true;
    if (gridBodyEl) gridBodyEl.innerHTML = '';
    gridBuilt = false;
    lastStatusKey = null;
    lastGaveUpByMe = null;
    document.body.classList.remove('game-over');
    buildGridStructure();
    populateGridLabels();
    renderGrid();
    renderStatus();
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!canGiveUpOnline(state)) return;
      // Optimistically hide the button so a double-click doesn't queue a
      // second give-up. The server-broadcast state will lock the rest of
      // the UI when it arrives.
      giveUpEl.hidden = true;
      ws.send(JSON.stringify({ type: 'give-up' }));
    });
  }

  if (playAgainEl) {
    playAgainEl.addEventListener('click', () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Disable the button immediately so spam-clicks don't fire multiple
      // rematch messages — the next 'rematch-started' broadcast will reset
      // the result UI entirely.
      playAgainEl.disabled = true;
      ws.send(JSON.stringify({ type: 'rematch' }));
    });
  }
}
