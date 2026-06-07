import { CONTINENTS, flagsGamePool, loadCountries } from '../flags/group.js';
import {
  ALL_FLAG_COLORS,
  ALL_MOTIFS,
  suggest,
  exactSingleMatch,
} from '../flags/engine.js';
import {
  findTargets,
  findPool,
  classifyGuess,
  isFindIncludeAll,
  setFindIncludeAll,
  parseFilterFromUrl,
  serializeFilter,
  filterToCategory,
  pillLabel,
  pickRandomMix,
} from '../flags/findFlag.js';
import { emptyFilters, matchesFilters, createColorCountLock } from '../flags/flagsFilter.js';
import { createColorCountPicker } from '../colorCountPicker.js';
import { scoreColor } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti, launchFireworks } from '../confetti.js';
import { pickCelebration } from '../flags/quiz.js';

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
    .then(loadCountries)
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
        items: ALL_FLAG_COLORS.map((value) => ({
          value,
          count: all.filter((c) => c.colors.includes(value)).length,
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

    // "No other colours" toggle pill — state lives in the shared
    // createColorCountLock so flagsdata and findFlag can't drift on what
    // "only these colours" means. Page owns the DOM (button below) and
    // calls into the lock from three places: the toggle click, every
    // color-include pill click (sync), and Clear (reset).
    const colorCountLock = createColorCountLock(filter);
    /** @type {HTMLButtonElement | null} */
    let onlyColorsBtn = null;

    // "Colour count" widget — segmented op + N picker shared with the
    // flagsdata filter bar. Both surfaces write to `filter.colorCount`,
    // so engaging the picker resets the lock and vice versa.
    const colorCountPicker = createColorCountPicker(filter, t, {
      onChange: () => updateBar(),
      onPicked: () => {
        // Picker just took over `filter.colorCount`. Disengage the lock
        // *cosmetically* — DON'T call lock.reset() here, because that
        // would clobber the value the picker just wrote.
        colorCountLock.disengage();
        if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
      },
    });

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
      // After the Colors section render the "no other colours" modifier
      // pill. Single toggle; when active, filter.colorCount is bound to the
      // number of include colours. Adding/removing colour pills auto-updates
      // the count via the lock's sync() call in cyclePill.
      if (sec.group === 'color') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill pill-modifier';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'pill-label';
        labelSpan.textContent = t('findFlag.noOtherColors', 'no other colours');
        btn.appendChild(labelSpan);
        btn.addEventListener('click', () => {
          const on = colorCountLock.toggle();
          btn.classList.toggle('active', on);
          // Lock just took over the colour-count primitive — tell the
          // picker pill to disengage cosmetically (drops its op/n to
          // defaults, paints inactive). Doesn't touch `filter.colorCount`.
          colorCountPicker.disengage();
          updateBar();
        });
        wrap.appendChild(btn);
        onlyColorsBtn = btn;
        // Colour-count compound pill — sits next to "no other colours"
        // since both drive the same `filter.colorCount` primitive.
        wrap.appendChild(colorCountPicker.el);
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
      for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status'>} */ (['continent','color','motif','status'])) {
        selCount += filter[k].include.size + filter[k].exclude.size;
      }
      if (filter.colorCount !== null) selCount++;
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
      // Colour-include count may have changed — if "no other colours" is on,
      // colorCount tracks it. (No-op if the lock is off.)
      if (group === 'color') colorCountLock.sync();
      updateBar();
    }

    playBtn.addEventListener('click', () => {
      if (playBtn.disabled) return;
      const params = new URLSearchParams({ f: serializeFilter(filter) });
      window.location.search = `?${params.toString()}`;
    });

    clearBtn.addEventListener('click', () => {
      for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status'>} */ (['continent','color','motif','status'])) {
        filter[k].include.clear();
        filter[k].exclude.clear();
      }
      colorCountLock.reset();
      if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
      colorCountPicker.reset();
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
    const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
    const sugEl = document.getElementById('find-suggestions');
    const foundEl = document.getElementById('find-found');
    const giveUpEl = document.getElementById('give-up');

    catEl.textContent = category.label;
    updateCount();

    let matches = [];
    let selected = 0;
    let finished = false;

    function updateCount() {
      countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
    }
    /* Brief flash on each correct guess. Remove → force reflow → add
     * re-triggers the CSS animation on consecutive matches. Called
     * from the match branch only, not from the initial updateCount(). */
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
      document.getElementById('final-found').textContent = String(found);
      document.getElementById('final-total').textContent = String(total);
      document.getElementById('final-score-line').style.color = scoreColor(found / total);

      // findFlag is play-and-walk-away now — no per-category best score,
      // no "Your best" line, no record-tracking. Celebration tier comes
      // from the shared pickCelebration helper so daily / findFlag /
      // quiz all read the same way: confetti for partial, fireworks
      // (alone, not stacked) for a clean sweep.
      const tier = pickCelebration({ found, total });
      if (tier === 'fireworks') launchFireworks();
      else if (tier === 'confetti') launchConfetti();

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
          ...ALL_FLAG_COLORS.filter((v) => all.some((c) => c.colors.includes(v)))
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
    if (!('ontouchstart' in window)) inputEl.focus();
  }
}
