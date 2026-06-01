import { suggest, pulseShake } from '../../flags/grid.js';

/** @typedef {import('../../flags/group.js').Country} Country */
/** @typedef {import('../../flags/ticTacToe.js').GameState} GameState */
/** @typedef {import('../../flags/ticTacToe.js').Player} Player */

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_LEN = 5;

// Localhost talks to the partykit dev server on :1999; everywhere else
// talks to the deployed Cloudflare server.
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const SERVER_URL = IS_LOCAL
  ? `ws://${window.location.hostname}:1999/parties/main/`
  : 'wss://gridgame-ttt.jgrzegrzolka.partykit.dev/parties/main/';

export function bootTicTacToeOnline() {
  fetch('../../flags/countries.json')
    .then((r) => r.json())
    .then((countries) => runOnline(countries))
    .catch((err) => {
      const lobbyEl = document.getElementById('lobby');
      if (lobbyEl) lobbyEl.hidden = false;
      const errEl = document.getElementById('lobby-error');
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Failed to load countries: ' + err.message; }
    });
}

/** @param {Country[]} countries */
function runOnline(countries) {
  const byCode = new Map(countries.map((c) => [c.code, c]));

  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {GameState | null} */
  let game = null;
  /** @type {Player | null} */
  let myRole = null;
  let peerPresent = false;
  let lastRenderedTurn = /** @type {Player | null} */ (null);

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
  const roleBadgeEl = document.getElementById('role-badge');
  const statusEl = document.getElementById('status-line');
  const turnLineEl = document.getElementById('turn-line');
  const turnBadgeEl = document.getElementById('turn-badge');
  const turnTextEl = document.getElementById('turn-text');
  const gridBodyEl = document.getElementById('grid-body');
  const resultEl = document.getElementById('result');
  const finalScoreEl = document.getElementById('final-score');
  const colHeaderEls = document.querySelectorAll('.col-header');
  const pickerEl = document.getElementById('picker');
  const pickerBackdropEl = document.getElementById('picker-backdrop');
  const pickerCloseEl = document.getElementById('picker-close');
  const pickerCatsEl = document.getElementById('picker-cats');
  const pickerInputEl = /** @type {HTMLInputElement} */ (document.getElementById('picker-input'));
  const pickerSuggestionsEl = /** @type {HTMLUListElement} */ (document.getElementById('picker-suggestions'));

  // ---- Lobby ----
  const params = new URL(window.location.href).searchParams;
  const roomParam = params.get('room');
  if (roomParam && /^[A-Z0-9]{5}$/.test(roomParam.toUpperCase())) {
    joinRoom(roomParam.toUpperCase());
  } else {
    showLobby();
  }

  function showLobby() {
    if (lobbyEl) lobbyEl.hidden = false;
    if (gameEl) gameEl.hidden = true;
  }

  if (createBtn) {
    createBtn.addEventListener('click', () => joinRoom(generateCode()));
  }
  if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = joinCodeEl.value.toUpperCase().trim();
      if (!/^[A-Z0-9]{5}$/.test(code)) {
        showError('Code must be 5 characters');
        return;
      }
      joinRoom(code);
    });
  }

  function generateCode() {
    let code = '';
    for (let i = 0; i < ROOM_LEN; i++) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    return code;
  }

  /** @param {string} message */
  function showError(message) {
    if (!errorEl) return;
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  // ---- Room join ----
  /** @param {string} code */
  function joinRoom(code) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.history.replaceState(null, '', url.toString());
    if (lobbyEl) lobbyEl.hidden = true;
    if (gameEl) gameEl.hidden = false;
    if (roomCodeEl) roomCodeEl.textContent = code;
    setStatus('Connecting…');
    connect(code);
  }

  /** @param {string} code */
  function connect(code) {
    ws = new WebSocket(SERVER_URL + encodeURIComponent(code));
    ws.addEventListener('message', (ev) => onServerMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', () => setStatus('Disconnected. Reload to retry.'));
    ws.addEventListener('error', () => setStatus('Connection error'));
  }

  /** @param {any} msg */
  function onServerMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        myRole = msg.you;
        game = msg.game;
        peerPresent = msg.peerPresent;
        buildGridIfNeeded();
        renderRole();
        renderGrid();
        renderTurn();
        renderStatus();
        break;
      case 'state':
        game = msg.game;
        renderGrid();
        renderTurn();
        renderStatus();
        if (msg.kind === 'miss-invalid' || msg.kind === 'miss-duplicate') {
          shakeCell(msg.row, msg.col);
        }
        if (game && (game.winner || game.draw)) {
          finishRound();
        }
        break;
      case 'peer-joined':
        peerPresent = true;
        renderStatus();
        renderTurn();
        break;
      case 'peer-left':
        peerPresent = false;
        renderStatus();
        renderTurn();
        break;
      case 'rejected':
        setStatus(msg.reason === 'room-full' ? 'Room is full' : 'Rejected: ' + msg.reason);
        if (ws) ws.close();
        break;
    }
  }

  // ---- Grid (built once, on welcome) ----
  let gridBuilt = false;
  function buildGridIfNeeded() {
    if (gridBuilt || !game) return;
    gridBuilt = true;
    colHeaderEls.forEach((th, i) => { th.textContent = /** @type {GameState} */ (game).puzzle.cols[i].label; });
    for (let r = 0; r < 3; r++) {
      const tr = document.createElement('tr');
      const rowHeader = document.createElement('th');
      rowHeader.textContent = /** @type {GameState} */ (game).puzzle.rows[r].label;
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
    if (!game || !myRole) return;
    if (!peerPresent) return;
    if (game.winner || game.draw) return;
    if (game.cells[r][c].owner) return;
    if (game.currentPlayer !== myRole) return;
    openPicker(r, c);
  }

  // ---- Picker ----
  /** @param {number} r @param {number} c */
  function openPicker(r, c) {
    if (!game) return;
    activeCell = { row: r, col: c };
    pickerCatsEl.textContent = `${game.puzzle.rows[r].label} × ${game.puzzle.cols[c].label}`;
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
  }

  function renderSuggestions() {
    pickerSuggestionsEl.innerHTML = '';
    currentMatches.forEach((country, i) => {
      const li = document.createElement('li');
      if (i === selectedIndex) li.classList.add('selected');
      const img = document.createElement('img');
      img.src = `../../flags/svg/${country.code}.svg`;
      img.alt = '';
      li.appendChild(img);
      const name = document.createElement('span');
      name.textContent = country.name;
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
    if (!myRole) { roleBadgeEl.textContent = '?'; return; }
    roleBadgeEl.textContent = myRole;
    roleBadgeEl.className = 'turn-badge ' + myRole.toLowerCase();
  }

  function renderGrid() {
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
        td.classList.remove('winning');
        if (cell.country && cell.owner) {
          const img = document.createElement('img');
          img.src = `../../flags/svg/${cell.country.code}.svg`;
          img.alt = cell.country.name;
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
    document.body.classList.toggle('game-over', game.winner !== null || game.draw);
  }

  function renderTurn() {
    if (!turnLineEl || !turnBadgeEl || !turnTextEl) return;
    if (!game || !peerPresent || game.winner || game.draw) {
      turnLineEl.hidden = true;
      lastRenderedTurn = null;
      return;
    }
    turnLineEl.hidden = false;
    turnBadgeEl.textContent = game.currentPlayer;
    const changed = lastRenderedTurn !== game.currentPlayer;
    turnBadgeEl.className = 'turn-badge ' + game.currentPlayer.toLowerCase();
    turnTextEl.textContent = 'to move';
    if (changed) {
      void turnBadgeEl.offsetWidth; // restart the bounce animation on every turn change
      turnBadgeEl.classList.add('bounce');
      lastRenderedTurn = game.currentPlayer;
    }
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.className = 'status-line';
    if (!game) { statusEl.textContent = 'Connecting…'; return; }
    if (game.winner || game.draw) { statusEl.textContent = ''; return; }
    if (!peerPresent) {
      statusEl.textContent = 'Waiting for opponent… share the code above';
      statusEl.classList.add('peer-missing');
      return;
    }
    if (game.currentPlayer === myRole) {
      statusEl.textContent = 'Your turn';
      statusEl.classList.add('your-turn');
    } else {
      statusEl.textContent = "Opponent's turn";
    }
  }

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
    if (!resultEl || !finalScoreEl || !game) return;
    if (game.winner) {
      const youWon = game.winner === myRole;
      finalScoreEl.textContent = youWon ? 'You win!' : 'Opponent wins';
      finalScoreEl.style.color = game.winner === 'X' ? 'var(--x-color)' : 'var(--o-color)';
    } else {
      finalScoreEl.textContent = 'Draw';
      finalScoreEl.style.color = '#1c1c1c';
    }
    resultEl.hidden = false;
  }
}
