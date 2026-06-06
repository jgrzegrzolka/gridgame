import { CONTINENTS, flagsGamePool } from '../flags/group.js';
import {
  COLORS_FOR_RANDOM,
  ALL_MOTIFS,
  suggest,
  exactSingleMatch,
} from '../flags/engine.js';
import {
  findTargets,
  findPool,
  classifyGuess,
  recordFindResult,
  isFindIncludeAll,
  setFindIncludeAll,
  shouldFireFindFlagConfetti,
  parseFilterFromUrl,
  serializeFilter,
  rankedCategoryId,
  filterToCategory,
  pillLabel,
  pickRandomMix,
} from '../flags/findFlag.js';
import { emptyFilters, matchesFilters } from '../flags/flagsFilter.js';
import { formatTime, scoreColor } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti } from '../confetti.js';

export function bootFindFlag() {
  const chooserEl = document.getElementById('chooser');
  const gameEl = document.getElementById('game');
  const resultEl = document.getElementById('result');

  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = zoom.querySelector('img');
  const zoomName = zoom.querySelector('p');
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

  const includeAll = isFindIncludeAll();
  const initialFilter = parseFilterFromUrl(window.location.search);

  const scopeToggleEl = /** @type {HTMLInputElement | null} */ (document.getElementById('scope-toggle-input'));
  if (scopeToggleEl) {
    scopeToggleEl.checked = includeAll;
    scopeToggleEl.addEventListener('change', () => {
      setFindIncludeAll(localStorage, scopeToggleEl.checked);
      // Let the toggle's slide animation finish (CSS transition is 150 ms)
      // and give the user a beat to register the new position before the
      // page reloads — without this, the change event triggers an instant
      // reload and the user never sees the thumb move.
      setTimeout(() => window.location.reload(), 350);
    });
  }

  return fetch('../flags/countries.json')
    .then((r) => r.json())
    .then((raw) => {
      const all = withLocalizedAliases(flagsGamePool(raw, includeAll));
      if (!initialFilter) {
        renderChooser(all);
        chooserEl.hidden = false;
        return;
      }
      const category = filterToCategory(initialFilter, t);
      const targets = findTargets(all, category);
      if (targets.length < 1) {
        // The user landed on a URL whose intersection is empty (only
        // possible via hand-edited `?f=…` mixes — the chooser disables
        // Play when the live total is 0). Fall back to the chooser
        // instead of starting a 0/0 game that can only end in give-up.
        renderChooser(all);
        chooserEl.hidden = false;
        return;
      }
      startGame(category, initialFilter, all);
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  /**
   * @param {import('../flags/group.js').Country[]} all
   */
  function renderChooser(all) {
    const sectionsEl = document.getElementById('chooser-sections');
    sectionsEl.innerHTML = '';

    const filter = emptyFilters();

    // Each section's items are the same pills as the legacy chooser —
    // continents/colors/motifs from the engine's RANDOM constants, with
    // 0-count entries dropped so the chooser only ever offers playable
    // tags. Status / "Other continent" deliberately stay out: keeping
    // the chooser's tag inventory the same as before the refactor.
    const sections = /** @type {const} */ ([
      {
        title: t('findFlag.sections.continents', 'Continents'),
        group: /** @type {'continent'} */ ('continent'),
        items: CONTINENTS.map((value) => ({
          value: /** @type {string} */ (value),
          count: all.filter((c) => c.continent === value).length,
        })).filter((it) => it.count > 0),
      },
      {
        title: t('findFlag.sections.colors', 'Colors'),
        group: /** @type {'color'} */ ('color'),
        items: COLORS_FOR_RANDOM.map((value) => ({
          value,
          count: all.filter((c) => (c.colors ?? []).includes(value)).length,
        })).filter((it) => it.count > 0),
      },
      {
        title: t('findFlag.sections.motifs', 'Motifs'),
        group: /** @type {'motif'} */ ('motif'),
        items: ALL_MOTIFS.map((value) => ({
          value,
          count: all.filter((c) => (c.motifs ?? []).includes(value)).length,
        })).filter((it) => it.count > 0),
      },
    ]);

    /** @type {Array<{ btn: HTMLButtonElement, group: 'continent' | 'color' | 'motif', value: string }>} */
    const allPills = [];

    for (const sec of sections) {
      const secEl = document.createElement('section');
      secEl.className = 'chooser-section';
      const h = document.createElement('h2');
      h.textContent = sec.title;
      secEl.appendChild(h);
      const wrap = document.createElement('div');
      wrap.className = 'chooser-pills';
      for (const it of sec.items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'pill-label';
        labelSpan.textContent = pillLabel(sec.group, it.value, 'include', t);
        const countSpan = document.createElement('span');
        countSpan.className = 'pill-count';
        countSpan.textContent = String(it.count);
        btn.appendChild(labelSpan);
        btn.appendChild(countSpan);
        const group = sec.group;
        const value = it.value;
        btn.addEventListener('click', () => cyclePill(group, value, btn));
        wrap.appendChild(btn);
        allPills.push({ btn, group, value });
      }
      secEl.appendChild(wrap);
      sectionsEl.appendChild(secEl);
    }

    const playBar = document.getElementById('find-play-bar');
    const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-play'));
    const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-clear'));
    const countEl = document.getElementById('find-play-count');
    const randomBtn = document.getElementById('find-random');
    if (playBar) playBar.hidden = false;

    function updateBar() {
      let selCount = 0;
      for (const k of /** @type {Array<keyof typeof filter>} */ (Object.keys(filter))) {
        selCount += filter[k].include.size + filter[k].exclude.size;
      }
      if (selCount === 0) {
        countEl.textContent = '';
        playBtn.disabled = true;
        clearBtn.hidden = true;
        return;
      }
      const matchCount = all.filter((c) => matchesFilters(c, filter)).length;
      countEl.textContent = t('findFlag.flagsMatch', '{n} flags').replace('{n}', String(matchCount));
      // Min playable size is 1 — a single-flag mix is allowed (trivial
      // but the user explicitly chose it). 0 disables Play so the user
      // adjusts the selection rather than starting an unwinnable game.
      playBtn.disabled = matchCount < 1;
      clearBtn.hidden = false;
    }

    /**
     * @param {'continent' | 'color' | 'motif'} group
     * @param {string} value
     * @param {HTMLButtonElement} btn
     */
    function cyclePill(group, value, btn) {
      const g = filter[group];
      if (g.include.has(value)) {
        g.include.delete(value);
        g.exclude.add(value);
        btn.classList.remove('active');
        btn.classList.add('exclude');
      } else if (g.exclude.has(value)) {
        g.exclude.delete(value);
        btn.classList.remove('exclude');
      } else {
        g.include.add(value);
        btn.classList.add('active');
      }
      updateBar();
    }

    playBtn.addEventListener('click', () => {
      if (playBtn.disabled) return;
      const params = new URLSearchParams({ f: serializeFilter(filter) });
      window.location.search = `?${params.toString()}`;
    });

    clearBtn.addEventListener('click', () => {
      for (const k of /** @type {Array<keyof typeof filter>} */ (Object.keys(filter))) {
        filter[k].include.clear();
        filter[k].exclude.clear();
      }
      for (const { btn } of allPills) {
        btn.classList.remove('active', 'exclude');
      }
      updateBar();
    });

    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        if (allPills.length === 0) return;
        // Strip the DOM-bound `btn` field — pickRandomMix only needs the
        // (group, value) shape, and decoupling here keeps the helper
        // testable against pure data.
        const pool = allPills.map(({ group, value }) => ({ group, value }));
        const f = pickRandomMix(pool, all);
        const params = new URLSearchParams({ f: serializeFilter(f) });
        window.location.search = `?${params.toString()}`;
      });
    }

    updateBar();
  }

  /**
   * @param {import('../flags/engine.js').Category} category
   * @param {import('../flags/flagsFilter.js').Filters} filter
   * @param {import('../flags/group.js').Country[]} all
   */
  function startGame(category, filter, all) {
    const targets = findTargets(all, category);
    const pool = findPool(all);
    const targetCodes = new Set(targets.map((c) => c.code));
    const foundCodes = new Set();
    const state = { targetCodes, foundCodes };

    const catEl = document.getElementById('find-cat');
    const countEl = document.getElementById('find-count');
    const timeEl = document.getElementById('find-time');
    const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
    const sugEl = document.getElementById('find-suggestions');
    const foundEl = document.getElementById('find-found');
    const giveUpEl = document.getElementById('give-up');

    catEl.textContent = category.label;
    updateCount();

    let matches = [];
    let selected = 0;
    const startMs = Date.now();
    let timerRaf = 0;
    let finished = false;

    function updateCount() {
      countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
    }
    function tick() {
      timeEl.textContent = formatTime(Date.now() - startMs);
      if (!finished) timerRaf = requestAnimationFrame(tick);
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
      void inputEl.offsetWidth; // force a reflow so re-adding .shake restarts the animation.
      inputEl.classList.add('shake');
    }
    function flashWrong() {
      inputEl.classList.remove('wrong', 'shake');
      void inputEl.offsetWidth;
      inputEl.classList.add('wrong', 'shake');
      setTimeout(() => inputEl.classList.remove('wrong', 'shake'), 700);
    }

    function appendFound(c) {
      foundEl.insertBefore(flagTile(c), foundEl.firstChild);
    }

    function submitCountry(c) {
      const outcome = classifyGuess(state, c);
      if (outcome.kind === 'match') {
        foundCodes.add(c.code);
        appendFound(c);
        updateCount();
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
      cancelAnimationFrame(timerRaf);
      const elapsed = Date.now() - startMs;
      const found = foundCodes.size;
      const total = targetCodes.size;
      document.getElementById('final-found').textContent = String(found);
      document.getElementById('final-total').textContent = String(total);
      document.getElementById('final-time').textContent = `${t('game.time', 'Time')}: ${formatTime(elapsed)}`;
      document.getElementById('final-score-line').style.color = scoreColor(found / total);

      // Only ranked plays — exactly one positive tag, no excludes — write
      // to the best-score store. Mix plays share no leaderboard slot with
      // each other (the URL encodes infinitely many combinations) so
      // recording them would clutter the stats page with one-off entries.
      const rankedId = rankedCategoryId(filter);
      const bestEl = document.getElementById('best');
      let isNew = false;
      if (rankedId !== null) {
        const result = recordFindResult(
          localStorage,
          rankedId,
          { time: elapsed, found, total },
          includeAll,
        );
        isNew = result.isNew;
        const best = result.best;
        bestEl.textContent =
          `${t('findFlag.yourBest', 'Your best')}: ${best.found} / ${best.total} ${t('game.in', 'in')} ${formatTime(best.time)}`;
        if (isNew) {
          bestEl.appendChild(document.createTextNode(' '));
          const badge = document.createElement('span');
          badge.className = 'new-badge';
          badge.textContent = t('game.newRecord', 'new record!');
          bestEl.appendChild(badge);
        }
      } else {
        // .best:empty { display: none } in common.css hides the line.
        bestEl.textContent = '';
      }
      if (shouldFireFindFlagConfetti({ found, total, isNew })) launchConfetti();

      // Found section duplicates the in-game .find-found grid onto the
      // result screen. Without it the user never sees the flag they
      // just submitted: clicking the last target auto-finishes, the
      // game section vanishes, and the result screen would only show
      // what they missed.
      const foundFlags = targets.filter((c) => foundCodes.has(c.code));
      const foundResultEl = document.getElementById('find-result-found');
      foundResultEl.innerHTML = '';
      for (const c of foundFlags) foundResultEl.appendChild(flagTile(c));
      document.getElementById('found-title').hidden = foundFlags.length === 0;

      const missed = targets.filter((c) => !foundCodes.has(c.code));
      const missedEl = document.getElementById('find-missed');
      missedEl.innerHTML = '';
      for (const c of missed) missedEl.appendChild(flagTile(c));
      document.getElementById('missed-title').hidden = missed.length === 0;

      /** @type {HTMLAnchorElement} */ (document.getElementById('play-again')).href =
        window.location.pathname + window.location.search;

      /** @type {HTMLAnchorElement} */ (document.getElementById('play-random')).onclick = (e) => {
        e.preventDefault();
        // Same pool the chooser's Random button uses — playable
        // (group, value) pairs across continents, colors, and motifs.
        /** @type {Array<{ group: 'continent' | 'color' | 'motif', value: string }>} */
        const pool = [
          ...CONTINENTS.filter((v) => all.some((c) => c.continent === v))
            .map((v) => ({ group: /** @type {'continent'} */ ('continent'), value: /** @type {string} */ (v) })),
          ...COLORS_FOR_RANDOM.filter((v) => all.some((c) => (c.colors ?? []).includes(v)))
            .map((v) => ({ group: /** @type {'color'} */ ('color'), value: v })),
          ...ALL_MOTIFS.filter((v) => all.some((c) => (c.motifs ?? []).includes(v)))
            .map((v) => ({ group: /** @type {'motif'} */ ('motif'), value: v })),
        ];
        const f = pickRandomMix(pool, all);
        const params = new URLSearchParams({ f: serializeFilter(f) });
        window.location.search = `?${params.toString()}`;
      };

      gameEl.hidden = true;
      resultEl.hidden = false;
    }

    gameEl.hidden = false;
    tick();
    if (!('ontouchstart' in window)) inputEl.focus();
  }
}
