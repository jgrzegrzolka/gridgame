import { suggest, exactSingleMatch, pulseShake, translateCategoryLabel } from '../../flags/engine.js';
import {
  generateCode,
  isValidRoomCode,
  serverUrlFor,
  initialUltimateClientState,
  reduceUltimateServerMessage,
  getOrCreatePlayerId,
  canGiveUpUltimateOnline,
} from './onlineClient.js';
import { newlyWonSmallBoards, isMetaWinNewlyFormed } from '../../flags/ultimateTicTacToe.js';
import { shouldFireTicTacToeConfetti } from '../../flags/ticTacToe.js';
import { loadCountries } from '../../flags/group.js';
import { t, countryName, withLocalizedAliases } from '../../i18n.js';
import { launchConfetti } from '../../confetti.js';
import { trapPicker, releasePicker } from '../pickerLock.js';

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
  const playerId = getOrCreatePlayerId(window.localStorage);

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
  const gridBodyEl = document.getElementById('grid-body');
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const playAgainEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('play-again'));
  const giveUpEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('give-up'));
  /** Resigner role stamped on the server give-up broadcast; lets finishRound
   * pick "You gave up" vs "Opponent gave up". */
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
    setStatusKey('ttt.connecting', 'Connecting…');
    connect();
  }

  function connect() {
    if (!activeRoom) return;
    const { code, intent } = activeRoom;
    const wsUrl = `${SERVER_URL}${encodeURIComponent(code)}?pid=${encodeURIComponent(playerId)}&intent=${intent}`;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('message', (ev) => onServerMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', onSocketClose);
    ws.addEventListener('error', () => setStatusKey('ttt.connectionError', 'Connection error'));
  }

  function onSocketClose() {
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

    if (msg.type === 'welcome') buildGridIfNeeded();
    if (state.statusOverride && state.statusOverride !== before.statusOverride) {
      setStatus(state.statusOverride);
    } else {
      renderRole();
      renderGrid();
      renderStatus();
    }
    for (const effect of effects) {
      if (effect.type === 'shake') shakeCell(effect.bigRow, effect.bigCol, effect.smallRow, effect.smallCol);
      else if (effect.type === 'gave-up') lastGaveUpByMe = effect.byMe;
      else if (effect.type === 'finished') finishRound();
      else if (effect.type === 'rematch-started') startFreshRound();
      else if (effect.type === 'close') {
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
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url.toString());
    activeRoom = null;
    isHost = false;
    state = initialUltimateClientState();
    gridBuilt = false;
    if (gridBodyEl) gridBodyEl.innerHTML = '';
    if (roomCodeEl) roomCodeEl.textContent = '-----';
    renderShareButton();
    lastStatusKey = null;
    prevGame = null;
  }

  // ---- Grid (built once, on welcome) ----
  let gridBuilt = false;
  function buildGridIfNeeded() {
    const { game } = state;
    if (gridBuilt || !game) return;
    gridBuilt = true;
    colHeaderEls.forEach((th, i) => { th.textContent = tCat(/** @type {UltimateGameState} */ (game).puzzle.cols[i]); });
    for (let r = 0; r < 9; r++) {
      const tr = document.createElement('tr');
      if (r % 3 === 0) {
        const rowHeader = document.createElement('th');
        rowHeader.rowSpan = 3;
        rowHeader.textContent = tCat(/** @type {UltimateGameState} */ (game).puzzle.rows[r / 3]);
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
    const url = window.location.href;
    const title = t('ttt.shareTitle', 'Tic-Tac-Toe room');
    const text = t('ttt.shareText', "Let's play! Join my room:");
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err && /** @type {{ name?: string }} */ (err).name === 'AbortError') return;
      }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        flashCopied();
        return;
      } catch {
        // try legacy fallback
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
   * Soft language switch: re-translate every text surface this game
   * owns. The 9×9 grid headers + every cell `<img>.alt` + status line +
   * picker categories (if open) + final score (if showing) all re-derive
   * from the current cache.
   */
  function refreshI18nForGame() {
    const { game } = state;
    if (game && gridBuilt) {
      colHeaderEls.forEach((th, i) => {
        th.textContent = tCat(/** @type {UltimateGameState} */ (game).puzzle.cols[i]);
      });
      // Row headers live on every 3rd <tr> (rowspan=3 cells) inside
      // tbody — querySelectorAll('tr > th') is enough to find all three
      // in order without coupling to a class name.
      const rowHeaders = gridBodyEl.querySelectorAll('tr > th');
      rowHeaders.forEach((th, i) => {
        th.textContent = tCat(/** @type {UltimateGameState} */ (game).puzzle.rows[i]);
      });
      renderGrid();
    }
    if (repaintStatusForLang) repaintStatusForLang();
    if (!pickerEl.hidden && activeCell && game) {
      const { bigRow, bigCol } = activeCell;
      pickerCatsEl.textContent = `${tCat(/** @type {UltimateGameState} */ (game).puzzle.rows[bigRow])} × ${tCat(/** @type {UltimateGameState} */ (game).puzzle.cols[bigCol])}`;
    }
    if (resultEl && !resultEl.hidden) paintFinalScore();
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
    buildGridIfNeeded();
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
