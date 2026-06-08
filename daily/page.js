import { flagsGamePool, loadCountries } from '../flags/group.js';
import { suggest, exactSingleMatch } from '../flags/engine.js';
import {
  findPool,
  classifyGuess,
  filterToCategory,
} from '../flags/findFlag.js';
import { scoreColor, pickFinalScoreLine, pickCelebration } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti, launchFireworks } from '../confetti.js';
import { todayN, dailyNFromUrl, isReplayFromUrl, resolveDailyPuzzle, findPuzzle, resolvePuzzleEntry } from '../flags/daily.js';
import { loadScores, saveScore, isCompleteRecord } from './scores.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/daily.js').DailyPuzzle} DailyPuzzle */

export function bootDaily() {
  const stateEl = /** @type {HTMLElement} */ (document.getElementById('daily-state'));
  const gameEl = /** @type {HTMLElement} */ (document.getElementById('game'));
  const resultEl = /** @type {HTMLElement} */ (document.getElementById('result'));
  const numEl = /** @type {HTMLElement} */ (document.getElementById('daily-n'));
  const descEl = /** @type {HTMLElement} */ (document.getElementById('daily-desc'));

  /**
   * Paint the puzzle's helper sentence for the current page language.
   * i18n has already run by the time bootDaily fires (the page-level
   * script chains via .then(bootI18n)), so documentElement.lang is the
   * resolved code. Falls back to English if the requested language is
   * missing from the entry — better to show *some* sentence than to
   * leak the absence of a translation. Empty/missing description hides
   * the element so the sovereign note still reads naturally.
   *
   * @param {Record<string, string> | undefined} description
   */
  function paintDescription(description) {
    const lang = document.documentElement.lang || 'en';
    const text = description?.[lang] ?? description?.en ?? '';
    descEl.textContent = text;
    descEl.hidden = text === '';
  }

  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = /** @type {HTMLImageElement} */ (zoom.querySelector('img'));
  const zoomName = /** @type {HTMLParagraphElement} */ (zoom.querySelector('p'));
  /** @param {Country} c */
  function openZoom(c) {
    zoomImg.src = `../flags/svg/${c.code}.svg`;
    const displayName = countryName(c);
    zoomImg.alt = displayName;
    zoomName.textContent = displayName;
    zoom.showModal();
  }
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });

  /** @param {Country} c */
  function flagTile(c) {
    const displayName = countryName(c);
    const li = document.createElement('li');
    li.className = 'find-tile';
    li.dataset.name = displayName;
    li.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = displayName;
    img.loading = 'lazy';
    li.appendChild(img);
    return li;
  }

  const backlogParam = new URLSearchParams(window.location.search).get('backlog');
  const backlogN = backlogParam !== null ? parseInt(backlogParam, 10) : NaN;
  const isBacklog = Number.isFinite(backlogN);
  // Replay mode: live daily lets the player retry a finished puzzle
  // without overwriting the archive's recorded score. ?replay=1 both
  // bypasses the "complete record → jump straight to result" shortcut
  // and skips saveScore in finish(). The first real play stays the
  // canonical result; replays are practice runs.
  const isReplay = isReplayFromUrl(window.location.search);
  // Backlog mode swaps the live catalog for the staged backlog so the
  // author can play-test the next puzzles without exposing them to
  // players. URL-only entry point — there's no nav link to backlog.html
  // and `?backlog=N` isn't surfaced anywhere in the UI.
  const catalogUrl = isBacklog ? './daily_backlog.json' : './daily_puzzles.json';

  return Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    fetch(catalogUrl).then((r) => r.json()),
  ])
    .then(([raw, catalog]) => {
      const all = withLocalizedAliases(flagsGamePool(raw, false));

      if (isBacklog) {
        numEl.textContent = `${backlogN} · backlog`;
        // Tab title carries the puzzle number so multiple ?backlog=N tabs
        // are tellable apart at a glance during catalog review. Set after
        // bootI18n's data-i18n pass so this override is final.
        document.title = `Yet Another Quiz #${backlogN}`;
        // Rewrite the existing result-links in place:
        //   - #play-again → ./?backlog=N (no replay flag needed; backlog
        //     plays already skip saveScore unconditionally)
        //   - both "Previous puzzles" links → backlog.html so giving up
        //     or finishing lands on the staged list, not the live archive
        // data-i18n is removed so a lang-toggle reload re-runs bootDaily
        // and reapplies these mutations from scratch.
        const playAgainLink = document.getElementById('play-again');
        if (playAgainLink) {
          playAgainLink.setAttribute('href', `./?backlog=${backlogN}`);
          playAgainLink.textContent = 'Play again';
          playAgainLink.removeAttribute('data-i18n');
        }
        for (const id of ['prev-puzzles-link', 'result-prev-puzzles-link']) {
          const link = document.getElementById(id);
          if (link) {
            link.setAttribute('href', 'backlog.html');
            link.textContent = 'Back to backlog';
            link.removeAttribute('data-i18n');
          }
        }
        const entry = findPuzzle(catalog, backlogN);
        if (!entry) {
          showState(reasonMessage('not-found'));
          return;
        }
        const backlogResult = resolvePuzzleEntry(entry, all);
        if (backlogResult.ok === false) {
          showState(reasonMessage(backlogResult.reason));
          return;
        }
        paintDescription(backlogResult.entry.description);
        const category = filterToCategory(backlogResult.filter, t);
        startGame(backlogN, category, backlogResult.targets, all, { backlog: true });
        return;
      }

      const today = todayN(catalog);
      const n = dailyNFromUrl(window.location.search, today);
      numEl.textContent = `${n}`;
      // Same rationale as the backlog branch — tab title carries #N so
      // archived puzzles open in separate tabs read distinctly. Override
      // runs after bootI18n's data-i18n pass.
      document.title = `Yet Another Quiz #${n}`;

      // Point the static "Play again" link at this same puzzle with the
      // replay flag set, so clicking it re-runs the game without
      // touching the archive score. Pinning N in the href (rather than
      // relying on "today") keeps the link stable if the catalog rolls
      // over while the result page is open.
      const playAgainLink = document.getElementById('play-again');
      if (playAgainLink) playAgainLink.setAttribute('href', `./?n=${n}&replay=1`);

      const result = resolveDailyPuzzle(catalog, all, n);
      if (result.ok === false) {
        showState(reasonMessage(result.reason));
        return;
      }

      paintDescription(result.entry.description);

      // Revisit: if this puzzle has a full saved record, jump
      // straight to the result page without confetti (the player
      // saw confetti the first time around; replaying it on every
      // revisit would be obnoxious). Replay mode skips this shortcut
      // — the whole point of ?replay=1 is to actually replay.
      const stored = loadScores(window.localStorage)[n];
      if (!isReplay && isCompleteRecord(stored)) {
        const foundCodes = new Set(stored.c);
        renderResult(result.targets, foundCodes);
        return;
      }

      const category = filterToCategory(result.filter, t);
      startGame(n, category, result.targets, all, { replay: isReplay });
    })
    .catch((err) => {
      showState(`${t('game.failedToLoad', 'Failed to load:')} ${err.message}`);
    });

  /** @param {string} msg */
  function showState(msg) {
    stateEl.textContent = msg;
    stateEl.hidden = false;
    gameEl.hidden = true;
    resultEl.hidden = true;
  }

  /**
   * Map a resolveDailyPuzzle failure reason to a localised message. Kept
   * inline (rather than promoted to the i18n module) so the message
   * shape stays a per-page concern — daily's pre-launch copy doesn't
   * leak into other features.
   *
   * @param {'not-found' | 'invalid-filter' | 'no-targets'} reason
   */
  function reasonMessage(reason) {
    switch (reason) {
      case 'not-found':
        return t('daily.notFound', 'Puzzle not found.');
      case 'invalid-filter':
        return `${t('game.failedToLoad', 'Failed to load:')} invalid puzzle filter`;
      case 'no-targets':
        return `${t('game.failedToLoad', 'Failed to load:')} no targets resolved`;
    }
  }

  /**
   * Paint the result section (final score, time, found grid, missed
   * grid) from a finished game's state, then swap from #game to
   * #result. Called from both `finish()` (just-completed play) and
   * the revisit boot path (restored from localStorage). Confetti is
   * the caller's responsibility — revisits don't want it.
   *
   * @param {Country[]} targets
   * @param {Set<string>} foundCodes
   */
  function renderResult(targets, foundCodes) {
    const found = foundCodes.size;
    const total = targets.length;
    const { prefixKey, showFraction } = pickFinalScoreLine(found, total);
    const prefixEl = /** @type {HTMLElement} */ (document.getElementById('final-score-prefix'));
    prefixEl.setAttribute('data-i18n', prefixKey);
    prefixEl.textContent = t(prefixKey, prefixKey === 'findFlag.youFoundAll' ? 'You found all' : 'You found');
    /** @type {HTMLElement} */ (document.getElementById('final-score-fraction')).hidden = !showFraction;
    /** @type {HTMLElement} */ (document.getElementById('final-found')).textContent = String(found);
    /** @type {HTMLElement} */ (document.getElementById('final-total')).textContent = String(total);
    /** @type {HTMLElement} */ (document.getElementById('final-score-line')).style.color = scoreColor(found / total);

    const foundFlags = targets.filter((c) => foundCodes.has(c.code));
    const foundResultEl = /** @type {HTMLElement} */ (document.getElementById('find-result-found'));
    foundResultEl.innerHTML = '';
    for (const c of foundFlags) foundResultEl.appendChild(flagTile(c));
    /** @type {HTMLElement} */ (document.getElementById('found-title')).hidden = foundFlags.length === 0;

    const missed = targets.filter((c) => !foundCodes.has(c.code));
    const missedEl = /** @type {HTMLElement} */ (document.getElementById('find-missed'));
    missedEl.innerHTML = '';
    for (const c of missed) missedEl.appendChild(flagTile(c));
    /** @type {HTMLElement} */ (document.getElementById('missed-title')).hidden = missed.length === 0;

    gameEl.hidden = true;
    resultEl.hidden = false;
  }

  /**
   * Run the find-all game against a fixed target list. This is the
   * non-stats variant of findFlag's startGame — same input mechanics,
   * same shake/wrong-flash, no best-time recording (daily is a
   * "everyone-the-same" puzzle; per-user best times don't add up to
   * something meaningful until we add a shareable score string in
   * a later phase). The final found/total IS persisted (per puzzle
   * number) so the archive can show the player their score.
   *
   * Backlog mode (`opts.backlog`): play the puzzle exactly the same way
   * but skip `saveScore` — backlog plays must not pollute the player's
   * archive, since they're test runs of unreleased puzzles.
   *
   * Replay mode (`opts.replay`): same skip-save behaviour, but in the
   * live catalog. The player has finished this puzzle before and just
   * wants another go without overwriting their archive score.
   *
   * @param {number} n
   * @param {import('../flags/engine.js').Category} category
   * @param {Country[]} targets
   * @param {Country[]} all
   * @param {{ backlog?: boolean, replay?: boolean }} [opts]
   */
  function startGame(n, category, targets, all, opts = {}) {
    const skipSave = opts.backlog === true || opts.replay === true;
    const pool = findPool(all);
    const targetCodes = new Set(targets.map((c) => c.code));
    const foundCodes = new Set();
    const state = { targetCodes, foundCodes };

    const catEl = /** @type {HTMLElement} */ (document.getElementById('find-cat'));
    const countEl = /** @type {HTMLElement} */ (document.getElementById('find-count'));
    const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
    const sugEl = /** @type {HTMLElement} */ (document.getElementById('find-suggestions'));
    const foundEl = /** @type {HTMLElement} */ (document.getElementById('find-found'));
    const giveUpEl = /** @type {HTMLElement} */ (document.getElementById('give-up'));

    catEl.textContent = category.label;
    updateCount();

    /** @type {Country[]} */
    let matches = [];
    let selected = 0;
    let finished = false;

    function updateCount() {
      countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
    }
    /* Brief flash on each correct guess. Remove → force reflow → add
     * is the standard pattern for re-triggering a CSS animation on the
     * same element. Called from the match branch only — initial
     * updateCount() at startup shouldn't pulse. */
    function pulseCount() {
      countEl.classList.remove('find-count--pulse');
      void countEl.offsetWidth;
      countEl.classList.add('find-count--pulse');
    }

    function renderSuggestions() {
      sugEl.innerHTML = '';
      matches.forEach((c, i) => {
        const li = document.createElement('li');
        if (i === selected) li.classList.add('selected');
        const span = document.createElement('span');
        span.textContent = countryName(c);
        li.appendChild(span);
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          submitCountry(c);
        });
        li.addEventListener('mouseenter', () => {
          selected = i;
          renderSelected();
        });
        sugEl.appendChild(li);
      });
      sugEl.hidden = matches.length === 0;
    }
    function renderSelected() {
      for (const [i, li] of sugEl.querySelectorAll('li').entries()) {
        li.classList.toggle('selected', i === selected);
      }
    }
    function updateSuggestions() {
      matches = suggest(pool, inputEl.value, { excludeCodes: foundCodes });
      selected = 0;
      renderSuggestions();
      const auto = exactSingleMatch(matches, inputEl.value);
      if (auto) submitCountry(auto);
    }

    function shakeInput() {
      inputEl.classList.remove('shake');
      void inputEl.offsetWidth;
      inputEl.classList.add('shake');
    }
    function flashWrong() {
      inputEl.classList.remove('wrong', 'shake');
      void inputEl.offsetWidth;
      inputEl.classList.add('wrong', 'shake');
      setTimeout(() => inputEl.classList.remove('wrong', 'shake'), 700);
    }

    /** @param {Country} c */
    function appendFound(c) {
      foundEl.insertBefore(flagTile(c), foundEl.firstChild);
    }

    /** @param {Country} c */
    function submitCountry(c) {
      const outcome = classifyGuess(state, c);
      if (outcome.kind === 'match') {
        foundCodes.add(c.code);
        appendFound(c);
        updateCount();
        pulseCount();
        inputEl.value = '';
        matches = [];
        renderSuggestions();
        if (foundCodes.size === targetCodes.size) finish();
        return;
      }
      if (outcome.kind === 'duplicate') {
        shakeInput();
        return;
      }
      if (outcome.kind === 'wrong-category') {
        flashWrong();
        inputEl.value = '';
        matches = [];
        renderSuggestions();
        return;
      }
      shakeInput();
    }

    inputEl.addEventListener('input', updateSuggestions);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = matches[selected];
        if (picked) submitCountry(picked);
        else shakeInput();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (matches.length === 0) return;
        selected = (selected + 1) % matches.length;
        renderSelected();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (matches.length === 0) return;
        selected = (selected - 1 + matches.length) % matches.length;
        renderSelected();
        return;
      }
      if (e.key === 'Escape') {
        inputEl.value = '';
        matches = [];
        renderSuggestions();
      }
    });

    giveUpEl.addEventListener('click', () => finish());

    function finish() {
      if (finished) return;
      finished = true;
      const found = foundCodes.size;
      const total = targetCodes.size;
      if (!skipSave) {
        saveScore(window.localStorage, n, found, total, Array.from(foundCodes));
      }
      const tier = pickCelebration({ found, total });
      if (tier === 'fireworks') launchFireworks();
      else if (tier === 'confetti') launchConfetti();
      renderResult(targets, foundCodes);
    }

    gameEl.hidden = false;
    if (!('ontouchstart' in window)) inputEl.focus();
  }
}
