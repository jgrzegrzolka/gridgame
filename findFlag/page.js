import { CONTINENTS, flagsGamePool } from '../flags/group.js';
import {
  COLORS_FOR_RANDOM,
  MOTIFS_FOR_RANDOM,
  suggest,
} from '../flags/grid.js';
import {
  categoryFromId,
  findTargets,
  findPool,
  classifyGuess,
  recordFindResult,
  isFindIncludeAll,
  setFindIncludeAll,
  exactSingleMatch,
} from '../flags/findFlag.js';
import { formatTime, scoreColor } from '../flags/quiz.js';

export function bootFindFlag() {
  const chooserEl = document.getElementById('chooser');
  const gameEl = document.getElementById('game');
  const resultEl = document.getElementById('result');

  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = zoom.querySelector('img');
  const zoomName = zoom.querySelector('p');
  function openZoom(c) {
    zoomImg.src = `../flags/svg/${c.code}.svg`;
    zoomImg.alt = c.name;
    zoomName.textContent = c.name;
    zoom.showModal();
  }
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });

  function flagTile(c) {
    const li = document.createElement('li');
    li.className = 'find-tile';
    li.dataset.name = c.name;
    li.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = c.name;
    img.loading = 'lazy';
    li.appendChild(img);
    return li;
  }

  const params = new URLSearchParams(window.location.search);
  const catId = params.get('cat');

  const includeAll = isFindIncludeAll();

  const scopeToggleEl = /** @type {HTMLInputElement | null} */ (document.getElementById('scope-toggle-input'));
  if (scopeToggleEl) {
    scopeToggleEl.checked = includeAll;
    scopeToggleEl.addEventListener('change', () => {
      setFindIncludeAll(localStorage, scopeToggleEl.checked);
      window.location.reload();
    });
  }

  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then((raw) => {
      const all = flagsGamePool(raw, includeAll);
      if (!catId) {
        renderChooser(all);
        chooserEl.hidden = false;
        return;
      }
      const cat = categoryFromId(catId);
      if (!cat) {
        chooserEl.hidden = false;
        renderChooser(all);
        return;
      }
      startGame(cat, all);
    })
    .catch((err) => {
      document.body.textContent = 'Failed to load: ' + err.message;
    });

  function renderChooser(all) {
    const sectionsEl = document.getElementById('chooser-sections');
    const allCats = [
      ...CONTINENTS.map((n) => ({ id: `continent:${n}`, label: n })),
      ...COLORS_FOR_RANDOM.map((c) => ({ id: `hasColor:${c}`, label: `Has ${c}` })),
      ...MOTIFS_FOR_RANDOM.map((m) => ({ id: `hasMotif:${m}`, label: `Has ${m}` })),
    ];
    const sections = [
      { title: 'Continents', items: allCats.slice(0, CONTINENTS.length) },
      { title: 'Colors', items: allCats.slice(CONTINENTS.length, CONTINENTS.length + COLORS_FOR_RANDOM.length) },
      { title: 'Motifs', items: allCats.slice(CONTINENTS.length + COLORS_FOR_RANDOM.length) },
    ];
    for (const s of sections) {
      const sec = document.createElement('section');
      sec.className = 'chooser-section';
      const h = document.createElement('h2');
      h.textContent = s.title;
      sec.appendChild(h);
      const wrap = document.createElement('div');
      wrap.className = 'chooser-pills';
      for (const item of s.items) {
        const cat = categoryFromId(item.id);
        const count = findTargets(all, cat).length;
        if (count === 0) continue;
        const a = document.createElement('a');
        a.className = 'find-pill';
        a.href = `?cat=${encodeURIComponent(item.id)}`;
        a.innerHTML = `<span>${item.label}</span><span class="find-pill-count">${count}</span>`;
        wrap.appendChild(a);
      }
      sec.appendChild(wrap);
      sectionsEl.appendChild(sec);
    }
    document.getElementById('find-random').addEventListener('click', () => {
      const i = Math.floor(Math.random() * allCats.length);
      window.location.search = `?cat=${encodeURIComponent(allCats[i].id)}`;
    });
  }

  function startGame(category, all) {
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
        const img = document.createElement('img');
        img.src = `../flags/svg/${c.code}.svg`;
        img.alt = '';
        li.appendChild(img);
        const span = document.createElement('span');
        span.textContent = c.name;
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
        if (foundCodes.size === targetCodes.size) finish(false);
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

    giveUpEl.addEventListener('click', () => finish(true));

    function finish(gaveUp) {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(timerRaf);
      const elapsed = Date.now() - startMs;
      const found = foundCodes.size;
      const total = targetCodes.size;
      document.getElementById('final-found').textContent = String(found);
      document.getElementById('final-total').textContent = String(total);
      document.getElementById('final-time').textContent = `Time: ${formatTime(elapsed)}`;
      document.getElementById('final-score-line').style.color = scoreColor(found / total);

      const { best, isNew } = recordFindResult(
        localStorage,
        category.id,
        { time: elapsed, found, total },
        includeAll,
      );
      const bestEl = document.getElementById('best');
      bestEl.textContent =
        `Your best: ${best.found} / ${best.total} in ${formatTime(best.time)}`;
      if (isNew) {
        bestEl.appendChild(document.createTextNode(' '));
        const badge = document.createElement('span');
        badge.className = 'new-badge';
        badge.textContent = 'new record!';
        bestEl.appendChild(badge);
      }

      const missed = targets.filter((c) => !foundCodes.has(c.code));
      const missedEl = document.getElementById('find-missed');
      missedEl.innerHTML = '';
      for (const c of missed) missedEl.appendChild(flagTile(c));
      document.getElementById('missed-title').hidden = missed.length === 0;

      /** @type {HTMLAnchorElement} */ (document.getElementById('play-again')).href =
        window.location.pathname + window.location.search;

      gameEl.hidden = true;
      resultEl.hidden = false;
    }

    gameEl.hidden = false;
    tick();
    if (!('ontouchstart' in window)) inputEl.focus();
  }
}
