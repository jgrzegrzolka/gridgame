import { suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../../flags/engine.js';
import {
  generateCode,
  isValidRoomCode,
  serverUrlFor,
  initialUltimateClientState,
  reduceUltimateServerMessage,
  canGiveUpUltimateOnline,
} from './onlineClient.js';
import { getOrCreateDeviceId } from '../../flags/identity.js';
import { newlyWonSmallBoards, isMetaWinNewlyFormed } from '../../flags/ultimateTicTacToe.js';
import { shouldFireTicTacToeConfetti } from '../../flags/ticTacToe.js';
import { loadCountries } from '../../flags/group.js';
import { shareUrl, renderPlayingAs } from '../../common.js';
import { trackEvent } from '../../analytics/index.js';
import { t, countryName, withLocalizedAliases } from '../../i18n.js';
import { launchConfetti } from '../../confetti.js';
import { trapPicker, releasePicker } from '../pickerLock.js';
import { submitTttResult } from '../../flags/tttResultSubmit.js';
import { fetchTttPair } from '../../flags/tttPairFetch.js';
import { deriveTttOutcome } from '../../flags/tttPairOutcome.js';
import { decideIsHost, forgetHostRoom, rememberHostRoom } from '../../flags/tttHostMemory.js';
import { bumpShare, pushEngagementBlob } from '../../flags/engagementCounters.js';
import { ensureProfile } from '../../flags/autoProfile.js';
import { fetchProfile } from '../../flags/profileFetch.js';
import { displayNickname } from '../../flags/nickname.js';

/** @typedef {import('../../flags/group.js').Country} Country */
/** @typedef {import('../../flags/ultimateTicTacToe.js').UltimateGameState} UltimateGameState */

const SERVER_URL = serverUrlFor(window.location.hostname, 'ultimate');

/** @param {import('../../flags/engine.js').Category} c */
function tCat(c) {
  return translateCategoryLabel(c, t);
}

export function bootUltimateTicTacToeOnline() {
  fetch('../../flags/countries.json')
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
  const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());

  // "Playing as <you>" identity line on the lobby — same shared chip as the
  // 3×3 board and Flag Party. Re-painted on a soft language switch.
  const playingAsEl = document.getElementById('playing-as');
  function paintPlayingAs() {
    if (!playingAsEl) return;
    let cachedNick = null;
    try { cachedNick = window.localStorage.getItem('gridgame.nickname'); } catch { /* private mode */ }
    renderPlayingAs(playingAsEl, deviceId, displayNickname(deviceId, cachedNick), t('ttt.playingAs', 'Playing as'));
  }
  paintPlayingAs();
  document.addEventListener('langchanged', paintPlayingAs);

  /** @type {WebSocket | null} */
  let ws = null;
  let state = initialUltimateClientState();
  /** Snapshot of the previous ultimate state — drives the one-shot
   * shake animation on freshly-won small boards / meta line so later
   * re-renders don't replay it. */
  /** @type {UltimateGameState | null} */
  let prevGame = null;
  /** Tracks the rendered status-line state ('your-turn' / 'opponents-turn' /
   * 'waiting' / 'empty') so we can pulse the line on transitions between
   * meaningful states — opponent moved, you moved, opponent joined, etc.
   * Skipping the pulse on the initial render keeps the page from flashing
   * when the user just arrived. */
  /** @type {string | null} */
  let lastStatusKey = null;

  /** @type {{ code: string, intent: 'create' | 'join' } | null} */
  let activeRoom = null;
  /** Sticky across reconnects and across full page reloads via
   * `sessionStorage` — see `flags/tttHostMemory.js`. Without that,
   * refreshing mid-game silently dropped the result POST because the
   * URL auto-join branch flipped `isHost` to false. */
  let isHost = false;
  const isTouchDevice =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  let stopReconnecting = false;
  let reconnectAttempts = 0;
  /** @type {any} */
  let reconnectTimer = 0;

  /** @type {{ bigRow: number, bigCol: number, smallRow: number, smallCol: number } | null} */
  let activeCell = null;
  /** @type {Country[]} */
  let currentMatches = [];
  /** @type {(() => void) | null} */
  let repaintStatusForLang = null;
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
  const matchupOpponentEl = document.getElementById('matchup-opponent');
  const gridBodyEl = document.getElementById('grid-body');
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const playAgainEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('play-again'));
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  /** Resigner role stamped on the server give-up broadcast; lets finishRound
   * pick "You gave up" vs "Opponent gave up". */
  /** @type {boolean | null} */
  let lastGaveUpByMe = null;
  /** Once-per-game guard so a noisy welcome / multiple state messages
   * carrying the finished game can't multi-submit the same head-to-head
   * row. Reset on rematch. See ../page.js for the same pattern. */
  let resultSubmittedForGame = false;
  /** Opponent's saved nickname; `undefined` = not yet fetched, `null` =
   *  no nickname stored (falls back to deterministic default). Mirrors
   *  the 3×3 page's state. */
  /** @type {string | null | undefined} */
  let opponentNickname;
  let opponentFetchInFlight = false;
  /** Head-to-head record vs this opponent for the 9×9 mode — same
   * shape and lifecycle as the 3×3 page. */
  /** @type {{ wins: number, losses: number, draws: number } | null} */
  let pairRecord = null;
  let pairFetchInFlight = false;
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
    if (intent === 'create') rememberHostRoom(window.sessionStorage, code);
    isHost = decideIsHost({ storage: window.sessionStorage, roomCode: code, urlIntent: intent });
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
    // Build the empty 9×9 grid structure now so the full layout is
    // on-screen before the WebSocket connects — header text is filled
    // in by populateGridLabels() once the server responds with welcome.
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
    // Feature Q — see ticTacToe/page.js for the rationale (PartyKit's
    // WS server is on Cloudflare; client side is the only AI-reachable
    // surface for disconnect signal).
    trackEvent('ttt-disconnect', {
      mode: '9x9',
      role: state.myRole ?? 'unknown',
      peerPresent: state.peerPresent === true,
      hadWinner: typeof state.game?.winner === 'string',
      stopReconnecting,
      reconnectAttempts,
    });
    if (stopReconnecting || !activeRoom) return;
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
    const { state: nextState, effects } = reduceUltimateServerMessage(state, msg);
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
      if (effect.type === 'shake') shakeCell(effect.bigRow, effect.bigCol, effect.smallRow, effect.smallCol);
      else if (effect.type === 'gave-up') lastGaveUpByMe = effect.byMe;
      else if (effect.type === 'finished') { finishRound(); reportFinishedResult(); }
      else if (effect.type === 'rematch-started') { resultSubmittedForGame = false; startFreshRound(); }
      else if (effect.type === 'close') {
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
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url.toString());
    activeRoom = null;
    isHost = false;
    forgetHostRoom(window.sessionStorage);
    state = initialUltimateClientState();
    gridBuilt = false;
    if (gridBodyEl) gridBodyEl.innerHTML = '';
    if (roomCodeEl) roomCodeEl.textContent = '-----';
    renderShareButton();
    lastStatusKey = null;
    prevGame = null;
    opponentNickname = undefined;
    pairRecord = null;
    resultSubmittedForGame = false;
    if (matchupOpponentEl) matchupOpponentEl.replaceChildren();
  }

  // ---- Grid ----
  // Built in two passes: enterRoom() runs buildGridStructure() so the
  // 9×9 layout is on-screen before the WebSocket connects, then the
  // 'welcome' handler runs populateGridLabels() to fill in row/col
  // header text from the server's puzzle. Splitting these eliminates
  // the gap users were seeing between joining a room and the first
  // server message arriving.
  let gridBuilt = false;
  function buildGridStructure() {
    if (gridBuilt) return;
    gridBuilt = true;
    for (let r = 0; r < 9; r++) {
      const tr = document.createElement('tr');
      if (r % 3 === 0) {
        const rowHeader = document.createElement('th');
        rowHeader.rowSpan = 3;
        tr.appendChild(rowHeader);
      }
      for (let c = 0; c < 9; c++) {
        const td = document.createElement('td');
        td.className = 'cell';
        const bigRow = Math.floor(r / 3);
        const bigCol = Math.floor(c / 3);
        const smallRow = r % 3;
        const smallCol = c % 3;
        td.dataset.bigrow = String(bigRow);
        td.dataset.bigcol = String(bigCol);
        td.dataset.row = String(smallRow);
        td.dataset.col = String(smallCol);
        td.tabIndex = 0;
        td.addEventListener('click', () => onCellActivate(bigRow, bigCol, smallRow, smallCol));
        td.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onCellActivate(bigRow, bigCol, smallRow, smallCol);
          }
        });
        tr.appendChild(td);
      }
      gridBodyEl.appendChild(tr);
    }
  }
  function populateGridLabels() {
    const { game } = state;
    if (!game) return;
    colHeaderEls.forEach((th, i) => { th.textContent = tCat(/** @type {UltimateGameState} */ (game).puzzle.cols[i]); });
    // Row headers live on every 3rd <tr> (rowspan=3 cells) inside tbody —
    // querySelectorAll('tr > th') finds all three in row order.
    const rowHeaders = gridBodyEl.querySelectorAll('tr > th');
    rowHeaders.forEach((th, i) => { th.textContent = tCat(/** @type {UltimateGameState} */ (game).puzzle.rows[i]); });
  }

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function onCellActivate(bigRow, bigCol, smallRow, smallCol) {
    const { game, myRole, peerPresent } = state;
    if (!game) return;
    const cellCountry = game.boards[bigRow][bigCol].cells[smallRow][smallCol].country;
    if (cellCountry) {
      openZoom(cellCountry);
      return;
    }
    if (!myRole) return;
    if (!peerPresent) return;
    if (game.winner || game.draw || game.gaveUp) return;
    if (game.currentPlayer !== myRole) return;
    const board = game.boards[bigRow][bigCol];
    if (board.winner || board.dead) return;
    openPicker(bigRow, bigCol, smallRow, smallCol);
  }

  /** @param {Country} c */
  function openZoom(c) {
    if (!zoomEl || !zoomImg || !zoomName) return;
    zoomImg.src = `../../flags/svg/${c.code}.svg`;
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
  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function openPicker(bigRow, bigCol, smallRow, smallCol) {
    const { game } = state;
    if (!game) return;
    activeCell = { bigRow, bigCol, smallRow, smallCol };
    pickerCatsEl.textContent = `${tCat(game.puzzle.rows[bigRow])} × ${tCat(game.puzzle.cols[bigCol])}`;
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

  /** Close the picker AND return focus to the cell it was opened from.
   *  Matches the 9×9 offline page so keyboard users don't lose their
   *  position in the grid when they back out of the picker. The pick-success
   *  path stays plain closePicker — focus is irrelevant because the cell
   *  is now occupied and the next move belongs to the opponent. */
  function closePickerAndRestoreFocus() {
    const cell = activeCell;
    closePicker();
    if (cell) focusCell(cell.bigRow, cell.bigCol, cell.smallRow, cell.smallCol);
  }

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function focusCell(bigRow, bigCol, smallRow, smallCol) {
    const td = findCell(bigRow, bigCol, smallRow, smallCol);
    if (td) td.focus({ preventScroll: true });
  }

  function updateSuggestions() {
    const { game } = state;
    if (!game) return;
    const query = pickerInputEl.value;
    /** @type {Set<string>} */
    const excludeCodes = new Set();
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const cells = game.boards[br][bc].cells;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            if (cells[r][c].country) excludeCodes.add(cells[r][c].country.code);
          }
        }
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
    if (e.key === 'Escape') { e.preventDefault(); closePickerAndRestoreFocus(); return; }
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
  pickerBackdropEl.addEventListener('click', closePickerAndRestoreFocus);
  pickerCloseEl.addEventListener('click', closePickerAndRestoreFocus);

  /** @param {Country} country */
  function pickCountry(country) {
    if (!activeCell || !ws) return;
    const { bigRow, bigCol, smallRow, smallCol } = activeCell;
    ws.send(JSON.stringify({ type: 'claim', bigRow, bigCol, smallRow, smallCol, countryCode: country.code }));
    closePicker();
  }

  // ---- Renderers ----
  function renderRole() {
    if (!roleBadgeEl) return;
    const { myRole } = state;
    if (!myRole) { roleBadgeEl.textContent = '?'; return; }
    roleBadgeEl.textContent = myRole;
    roleBadgeEl.className = 'turn-badge ' + myRole.toLowerCase();
  }

  /**
   * @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol
   * @returns {HTMLTableCellElement | null}
   */
  function findCell(bigRow, bigCol, smallRow, smallCol) {
    return /** @type {HTMLTableCellElement | null} */ (
      gridBodyEl.querySelector(
        `td[data-bigrow="${bigRow}"][data-bigcol="${bigCol}"][data-row="${smallRow}"][data-col="${smallCol}"]`,
      )
    );
  }

  function renderGrid() {
    const { game } = state;
    if (!game || !gridBuilt) return;
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const board = game.boards[br][bc];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const td = findCell(br, bc, r, c);
            if (!td) continue;
            const cell = board.cells[r][c];
            td.innerHTML = '';
            td.classList.toggle('owned', !!cell.owner);
            td.classList.toggle('owner-x', cell.owner === 'X');
            td.classList.toggle('owner-o', cell.owner === 'O');
            td.classList.toggle('revealed', !!cell.revealed);
            td.classList.toggle('exhausted', !!cell.exhausted);
            td.classList.toggle('in-claimed-x', board.winner === 'X');
            td.classList.toggle('in-claimed-o', board.winner === 'O');
            td.classList.toggle('in-dead', board.dead);
            td.classList.remove('winning');
            td.classList.remove('meta-winning');
            if (cell.country) {
              const img = document.createElement('img');
              img.src = `../../flags/svg/${cell.country.code}.svg`;
              img.alt = countryName(cell.country);
              td.appendChild(img);
            }
          }
        }
        if (board.winningLine) {
          for (const [r, c] of board.winningLine) {
            const td = findCell(br, bc, r, c);
            if (td) td.classList.add('winning');
          }
        }
      }
    }
    if (game.winningLine) {
      for (const [br, bc] of game.winningLine) {
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const td = findCell(br, bc, r, c);
            if (td) td.classList.add('meta-winning');
          }
        }
      }
    }
    // One-shot shake on freshly-won small boards and on the meta win.
    // prevGame is the last *render-time* snapshot so server-pushed states
    // animate exactly once even if a later render fires from the same game.
    if (prevGame) {
      for (const [br, bc] of newlyWonSmallBoards(prevGame, game)) {
        const board = game.boards[br][bc];
        if (!board.winningLine) continue;
        for (const [r, c] of board.winningLine) {
          const td = findCell(br, bc, r, c);
          if (!td) continue;
          td.classList.add('shake-win');
          setTimeout(() => td.classList.remove('shake-win'), 1200);
        }
      }
      if (isMetaWinNewlyFormed(prevGame, game) && game.winningLine) {
        for (const [br, bc] of game.winningLine) {
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
              const td = findCell(br, bc, r, c);
              if (!td) continue;
              td.classList.add('shake-win');
              setTimeout(() => td.classList.remove('shake-win'), 1200);
            }
          }
        }
      }
    }
    prevGame = game;
    document.body.classList.toggle('game-over', game.winner !== null || game.draw || Boolean(game.gaveUp));
    renderGiveUpButton();
  }

  function renderGiveUpButton() {
    if (!giveUpEl) return;
    giveUpEl.hidden = !canGiveUpUltimateOnline(state);
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
    // 'shared' / 'dismissed' / 'failed' — see ticTacToe/page.js for why
    // each of those stays silent here.
    if (result === 'shared' || result === 'copied') {
      void ensureProfile(deviceId);
      // Feature S Phase 3: same shape as ticTacToe/page.js share.
      bumpShare(window.localStorage, 'ttt');
      void pushEngagementBlob(deviceId, window.localStorage);
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

  /** @param {number} bigRow @param {number} bigCol @param {number} smallRow @param {number} smallCol */
  function shakeCell(bigRow, bigCol, smallRow, smallCol) {
    const td = findCell(bigRow, bigCol, smallRow, smallCol);
    if (!td) return;
    td.classList.remove('shake');
    void td.offsetWidth;
    pulseShake(td);
  }

  /**
   * Paint the final-score text from state. Idempotent + side-effect-free —
   * a langchanged event can re-call it without re-firing confetti or
   * un-disabling Play again.
   */
  function paintFinalScore() {
    const { game, myRole } = state;
    if (!finalScoreEl || !game) return;
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
    } else {
      finalScoreEl.textContent = t('ttt.draw', 'Draw');
      finalScoreEl.style.color = '#1c1c1c';
    }
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
   * forget — failures don't block the UI. Outcome is derived purely from
   * the final game state so refresh-restore and live-finish go through the
   * same branch. See ../page.js for the mirror function on the 3×3 page.
   */
  function reportFinishedResult() {
    if (resultSubmittedForGame) return;
    const { game, myRole, peerId } = state;
    if (!game || !myRole || !peerId) return;
    // 9×9 `UltimateGameState` doesn't carry `gaveUpBy`, so the helper
    // falls back to the locally-tracked `lastGaveUpByMe` when the
    // server-stamped value is absent. See flags/tttPairOutcome.js.
    const outcome = deriveTttOutcome(game, myRole, lastGaveUpByMe);
    if (!outcome) return;
    resultSubmittedForGame = true;
    // Only the room creator POSTs — the server upserts both rows from
    // that single call. See ../page.js for the full rationale.
    void ensureProfile(deviceId);
    if (isHost) {
      void submitTttResult({ deviceId, opponentId: peerId, mode: '9x9', outcome });
    }
    // Optimistic local bump so the role line's record suffix reflects
    // the just-finished game without a round-trip. See ../page.js for
    // the mirror on the 3×3 page.
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

  /** Mirror of the 3×3 page — see ../page.js. */
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

  /** Mirror of the 3×3 page — see ../page.js. Reads `m9x9` not `m3x3`. */
  function maybeFetchPair() {
    if (!state.peerId) return;
    if (pairRecord !== null || pairFetchInFlight) return;
    pairFetchInFlight = true;
    fetchTttPair({ deviceId, opponentId: state.peerId }).then((r) => {
      pairRecord = r.ok ? r.row.m9x9 : null;
      pairFetchInFlight = false;
      renderMatchupOpponent();
    });
  }

  function renderMatchupOpponent() {
    if (!matchupOpponentEl) return;
    matchupOpponentEl.replaceChildren();
    if (!state.peerId) return;

    const vs = document.createElement('span');
    vs.className = 'muted';
    vs.textContent = t('ttt.matchupVs', 'vs');
    const name = document.createElement('span');
    // Name slot shows a loading label while the profile fetch is in
    // flight (opponentNickname === undefined) — see ../page.js for the
    // mirror with the full rationale.
    if (opponentNickname === undefined) {
      name.className = 'matchup-name matchup-name-loading';
      name.textContent = t('ttt.matchupOpponentLoading', 'loading…');
    } else {
      name.className = 'matchup-name';
      name.textContent = displayNickname(state.peerId, opponentNickname);
    }
    matchupOpponentEl.append(vs, name);

    // Suffix after the name (loading label OR record OR nothing) —
    // see ../page.js for the mirror with the full rationale.
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
   * owns. The 9×9 grid headers + every cell `<img>.alt` + status line +
   * picker categories (if open) + final score (if showing) all re-derive
   * from the current cache.
   */
  function refreshI18nForGame() {
    const { game } = state;
    if (game && gridBuilt) {
      populateGridLabels();
      renderGrid();
    }
    if (repaintStatusForLang) repaintStatusForLang();
    if (!pickerEl.hidden && activeCell && game) {
      const { bigRow, bigCol } = activeCell;
      pickerCatsEl.textContent = `${tCat(/** @type {UltimateGameState} */ (game).puzzle.rows[bigRow])} × ${tCat(/** @type {UltimateGameState} */ (game).puzzle.cols[bigCol])}`;
    }
    if (resultEl && !resultEl.hidden) paintFinalScore();
    paintError();
  }

  document.addEventListener('langchanged', refreshI18nForGame);

  function startFreshRound() {
    if (resultEl) resultEl.hidden = true;
    if (gridBodyEl) gridBodyEl.innerHTML = '';
    gridBuilt = false;
    lastStatusKey = null;
    lastGaveUpByMe = null;
    prevGame = null;
    document.body.classList.remove('game-over');
    buildGridStructure();
    populateGridLabels();
    renderGrid();
    renderStatus();
  }

  if (giveUpEl) {
    giveUpEl.addEventListener('click', () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!canGiveUpUltimateOnline(state)) return;
      giveUpEl.hidden = true;
      ws.send(JSON.stringify({ type: 'give-up' }));
    });
  }

  if (playAgainEl) {
    playAgainEl.addEventListener('click', () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      playAgainEl.disabled = true;
      ws.send(JSON.stringify({ type: 'rematch' }));
    });
  }
}
