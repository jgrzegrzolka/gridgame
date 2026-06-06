import { suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../flags/engine.js';
import {
  generateCode,
  isValidRoomCode,
  serverUrlFor,
  initialClientState,
  reduceServerMessage,
  getOrCreatePlayerId,
  canGiveUpOnline,
} from './onlineClient.js';
import { shouldFireTicTacToeConfetti, newlyWinningCells } from '../flags/ticTacToe.js';
import { loadCountries } from '../flags/group.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti } from '../confetti.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../flags/ticTacToe.js').Player} Player */

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
  const playerId = getOrCreatePlayerId(window.localStorage);

  /** @type {WebSocket | null} */
  let ws = null;
  let state = initialClientState();
  // Tracks the last-seen winningLine so renderGrid fires the win-shake
  // only on the transition, not on later renders. Declared early because
  // a server message can arrive (and call renderGrid) before a later
  // declaration site, which would hit a TDZ.
  /** @type {[number, number][] | null} */
  let lastSeenWinningLine = null;
  let lastRenderedTurn = /** @type {Player | null} */ (null);

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
  const turnLineEl = document.getElementById('turn-line');
  const turnBadgeEl = document.getElementById('turn-badge');
  const turnTextEl = document.getElementById('turn-text');
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
        showError(t('ttt.codeMustBe5', 'Code must be 5 characters'));
        return;
      }
      enterRoom(code, 'join');
    });
  }

  /** @param {string} message */
  function showError(message) {
    if (!errorEl) return;
    errorEl.hidden = false;
    errorEl.textContent = message;
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
    setStatus(t('ttt.connecting', 'Connecting…'));
    connect();
  }

  function connect() {
    if (!activeRoom) return;
    const { code, intent } = activeRoom;
    const wsUrl = `${SERVER_URL}${encodeURIComponent(code)}?pid=${encodeURIComponent(playerId)}&intent=${intent}`;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('message', (ev) => onServerMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', onSocketClose);
    ws.addEventListener('error', () => setStatus(t('ttt.connectionError', 'Connection error')));
  }

  function onSocketClose() {
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
    setStatus(t('ttt.disconnectedReconnecting', 'Disconnected. Reconnecting in {seconds}s…').replace('{seconds}', String(Math.round(delayMs / 1000))));
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delayMs);
  }

  /** @param {any} msg */
  function onServerMessage(msg) {
    const before = state;
    const { state: nextState, effects } = reduceServerMessage(state, msg);
    state = nextState;

    if (msg.type === 'welcome') buildGridIfNeeded();
    if (state.statusOverride && state.statusOverride !== before.statusOverride) {
      setStatus(state.statusOverride);
    } else {
      renderRole();
      renderGrid();
      renderTurn();
      renderStatus();
    }
    for (const effect of effects) {
      if (effect.type === 'shake') shakeCell(effect.row, effect.col);
      else if (effect.type === 'gave-up') lastGaveUpByMe = effect.byMe;
      else if (effect.type === 'finished') finishRound();
      else if (effect.type === 'rematch-started') startFreshRound();
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

  /** @param {string | null} errorMessage */
  function returnToLobbyWithError(errorMessage) {
    if (gameEl) gameEl.hidden = true;
    if (lobbyEl) lobbyEl.hidden = false;
    if (errorMessage) showError(errorMessage);
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
    lastRenderedTurn = null;
  }

  // ---- Grid (built once, on welcome) ----
  let gridBuilt = false;
  function buildGridIfNeeded() {
    const { game } = state;
    if (gridBuilt || !game) return;
    gridBuilt = true;
    colHeaderEls.forEach((th, i) => { th.textContent = tCat(/** @type {GameState} */ (game).puzzle.cols[i]); });
    for (let r = 0; r < 3; r++) {
      const tr = document.createElement('tr');
      const rowHeader = document.createElement('th');
      rowHeader.textContent = tCat(/** @type {GameState} */ (game).puzzle.rows[r]);
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

  function renderTurn() {
    if (!turnLineEl || !turnBadgeEl || !turnTextEl) return;
    const { game, peerPresent } = state;
    if (!game || !peerPresent || game.winner || game.draw || game.gaveUp) {
      turnLineEl.hidden = true;
      lastRenderedTurn = null;
      return;
    }
    turnLineEl.hidden = false;
    turnBadgeEl.textContent = game.currentPlayer;
    const changed = lastRenderedTurn !== game.currentPlayer;
    turnBadgeEl.className = 'turn-badge ' + game.currentPlayer.toLowerCase();
    turnTextEl.textContent = t('ttt.toMove', 'to move');
    if (changed) {
      void turnBadgeEl.offsetWidth; // restart the bounce animation on every turn change
      turnBadgeEl.classList.add('bounce');
      lastRenderedTurn = game.currentPlayer;
    }
  }

  function renderStatus() {
    renderShareButton();
    renderGiveUpButton();
    if (!statusEl) return;
    const { game, myRole, peerPresent } = state;
    statusEl.className = 'status-line';
    if (!game) { statusEl.textContent = t('ttt.connecting', 'Connecting…'); return; }
    if (game.winner || game.draw || game.gaveUp) { statusEl.textContent = ''; return; }
    if (!peerPresent) {
      statusEl.textContent = t('ttt.waitingShareCode', 'Waiting for opponent… share the code above');
      statusEl.classList.add('peer-missing');
      return;
    }
    if (game.currentPlayer === myRole) {
      statusEl.textContent = t('ttt.yourTurn', 'Your turn');
      statusEl.classList.add('your-turn');
    } else {
      statusEl.textContent = t('ttt.opponentsTurn', "Opponent's turn");
    }
  }

  // ---- Share link ----
  function renderShareButton() {
    if (!shareBtnEl) return;
    shareBtnEl.hidden = !(isTouchDevice && isHost && !state.peerPresent);
  }

  async function onShareClick() {
    if (!activeRoom) return;
    const url = window.location.href;
    const title = t('ttt.shareTitle', 'Tic-Tac-Toe room');
    const text = t('ttt.shareText', "Let's play! Join my room:");
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // User dismissed the share sheet — leave the link unshared, don't fall
        // through to clipboard (we'd silently overwrite their clipboard).
        if (err && /** @type {{ name?: string }} */ (err).name === 'AbortError') return;
        // Anything else (share unsupported for this payload, permissions, etc.):
        // fall through to clipboard as a best-effort recovery.
      }
    }
    // Async Clipboard API needs a secure context (HTTPS or localhost). On a
    // bare LAN-IP URL — common when testing from a phone against the dev
    // server — it's undefined, so we keep the legacy execCommand path as a
    // last resort.
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        flashCopied();
        return;
      } catch {
        // Permission denied or focus lost mid-call — try the legacy path.
      }
    }
    if (legacyCopyToClipboard(url)) flashCopied();
  }

  /** @param {string} text @returns {boolean} */
  function legacyCopyToClipboard(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
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

  function finishRound() {
    const { game, myRole } = state;
    if (!resultEl || !finalScoreEl || !game) return;
    if (game.gaveUp) {
      finalScoreEl.textContent = lastGaveUpByMe
        ? t('ttt.youGaveUp', 'You gave up')
        : t('ttt.opponentGaveUp', 'Opponent gave up');
      finalScoreEl.style.color = '#1c1c1c';
    } else if (game.winner) {
      const youWon = game.winner === myRole;
      finalScoreEl.textContent = youWon
        ? t('ttt.youWin', 'You win!')
        : t('ttt.opponentWins', 'Opponent wins');
      finalScoreEl.style.color = game.winner === 'X' ? 'var(--x-color)' : 'var(--o-color)';
      if (shouldFireTicTacToeConfetti({ winner: game.winner, myRole })) launchConfetti();
    } else {
      finalScoreEl.textContent = t('ttt.draw', 'Draw');
      finalScoreEl.style.color = '#1c1c1c';
    }
    if (playAgainEl) playAgainEl.disabled = false;
    resultEl.hidden = false;
  }

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
    lastRenderedTurn = null;
    lastGaveUpByMe = null;
    document.body.classList.remove('game-over');
    buildGridIfNeeded();
    renderGrid();
    renderTurn();
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
