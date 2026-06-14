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
import { pickCelebration } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { launchConfetti, launchFireworks } from '../confetti.js';
import { bindTileCountry, refreshTileNames } from '../langRefresh.js';
import { refreshChooserI18n } from './chooserI18n.js';
import { shareUrl } from '../common.js';

/**
 * Options the Random button (and the result page's "Random next" link)
 * pass to pickRandomMix. Keeps the modifier probabilities one knob:
 *   - onlyColorsProbability: 0.25 — when colour pills end up in the
 *     mix, attach the "no other colours" modifier ~1 in 4 times. Makes
 *     "find every flag whose colours are exactly red + white" mixes
 *     reachable from Random, not just from manual chooser play.
 *   - colorCountProbability: 0.10 — independently, attach a random
 *     colorCount picker constraint (any of =/>=/<= × 2..5). Less
 *     frequent because it's a less natural puzzle shape than the
 *     "only these colours" framing.
 * Tune these here; flags/findFlag.js's pickRandomMix is a pure
 * generator and stays opt-in.
 */
const RANDOM_MIX_OPTIONS = /** @type {const} */ ({
  onlyColorsProbability: 0.25,
  colorCountProbability: 0.10,
});

/**
 * Pick a fresh random mix from the full (continent + color + motif)
 * tag inventory and navigate to it. Used by the in-game "Random" link
 * and the result page's "Random next" link — both want the same
 * "give me a new puzzle" jump, so the pool-build and navigation live
 * in one place. (The chooser's Random button uses its own narrower
 * pool — only pills that are actually visible there.)
 * @param {import('../flags/group.js').Country[]} all
 */
/**
 * Wire `el` so a click shares the current page URL (in-game or result —
 * both already have `?f=<filter>` in the address bar so we don't need
 * to re-serialize). On the 'copied' branch, toggles `.copied` for 1.5 s
 * to swap the share-icon glyph for the green checkmark (see common.css).
 * 'shared' / 'dismissed' / 'failed' all stay silent — same reasoning as
 * TTT's onShareClick. See `common.js::shareUrl` for the full state model.
 *
 * @param {HTMLElement} el
 */
function attachShareHandler(el) {
  el.addEventListener('click', async () => {
    const result = await shareUrl(window.location.href, {
      title: t('findFlag.shareTitle', 'Yet Another Quiz — flag puzzle'),
      text: t('findFlag.shareText', "I built a flag puzzle. Can you find them all?"),
    });
    if (result === 'copied') {
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 1500);
    }
  });
}

function goRandom(all) {
  /** @type {Array<{ group: 'continent' | 'color' | 'motif', value: string }>} */
  const pool = [
    ...CONTINENTS.filter((v) => all.some((c) => c.continent === v))
      .map((v) => ({ group: /** @type {'continent'} */ ('continent'), value: /** @type {string} */ (v) })),
    ...ALL_FLAG_COLORS.filter((v) => all.some((c) => c.colors.includes(v)))
      .map((v) => ({ group: /** @type {'color'} */ ('color'), value: v })),
    ...ALL_MOTIFS.filter((v) => all.some((c) => (c.motifs ?? []).includes(v)))
      .map((v) => ({ group: /** @type {'motif'} */ ('motif'), value: v })),
  ];
  const f = pickRandomMix(pool, all, RANDOM_MIX_OPTIONS);
  const params = new URLSearchParams({ f: serializeFilter(f) });
  window.location.search = `?${params.toString()}`;
}

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
    bindTileCountry(li, c);
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
      /** @type {{ refreshI18n: (newAll: import('../flags/group.js').Country[]) => void } | null} */
      let activeHandle = null;
      if (!initialFilter) {
        activeHandle = renderChooser(all);
        chooserEl.hidden = false;
      } else {
        const category = filterToCategory(initialFilter, t);
        const targets = findTargets(all, category);
        if (targets.length < 1) {
          // The user landed on a URL whose intersection is empty (only
          // possible via hand-edited `?f=…` mixes — the chooser disables
          // Play when the live total is 0). Fall back to the chooser
          // instead of starting a 0/0 game that can only end in give-up.
          activeHandle = renderChooser(all);
          chooserEl.hidden = false;
        } else {
          activeHandle = startGame(category, initialFilter, all);
        }
      }

      // Soft language switch: re-run withLocalizedAliases so any new
      // suggestion matching honours the new language's aliases, then
      // hand the fresh pool to whichever surface is active (chooser or
      // game). Tile names re-paint via refreshTileNames — that covers
      // both in-game and result tiles in one walk. data-i18n surfaces
      // (button labels, section titles with attributes, the result
      // prefix span) re-translate upstream in applyStringsToDocument.
      document.addEventListener('langchanged', () => {
        const newAll = withLocalizedAliases(flagsGamePool(raw, includeAll));
        refreshTileNames();
        if (activeHandle) activeHandle.refreshI18n(newAll);
      });
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  /**
   * @param {import('../flags/group.js').Country[]} all
   * @returns {{ refreshI18n: (newAll: import('../flags/group.js').Country[]) => void }}
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
    // titleKey + fallback (not the resolved string) so refreshI18n can
    // re-translate on a soft language switch.
    const sections = /** @type {const} */ ([
      {
        titleKey: 'findFlag.sections.continents',
        titleFallback: 'Continents',
        group: /** @type {'continent'} */ ('continent'),
        items: CONTINENTS.map((value) => ({
          value: /** @type {string} */ (value),
          count: all.filter((c) => c.continent === value).length,
        })).filter((it) => it.count > 0),
      },
      {
        titleKey: 'findFlag.sections.colors',
        titleFallback: 'Colors',
        group: /** @type {'color'} */ ('color'),
        items: ALL_FLAG_COLORS.map((value) => ({
          value,
          count: all.filter((c) => c.colors.includes(value)).length,
        })).filter((it) => it.count > 0),
      },
      {
        titleKey: 'findFlag.sections.motifs',
        titleFallback: 'Motifs',
        group: /** @type {'motif'} */ ('motif'),
        items: ALL_MOTIFS.map((value) => ({
          value,
          count: all.filter((c) => (c.motifs ?? []).includes(value)).length,
        })).filter((it) => it.count > 0),
      },
    ]);

    /** @type {Array<{ btn: HTMLButtonElement, group: 'continent' | 'color' | 'motif', value: string, labelSpan: HTMLSpanElement }>} */
    const allPills = [];
    /** @type {Array<{ h: HTMLHeadingElement, key: string, fallback: string }>} */
    const sectionHeaders = [];
    /** @type {HTMLSpanElement | null} */
    let onlyColorsLabelSpan = null;

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
      h.textContent = t(sec.titleKey, sec.titleFallback);
      sectionHeaders.push({ h, key: sec.titleKey, fallback: sec.titleFallback });
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
        allPills.push({ btn, group, value, labelSpan });
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
        onlyColorsLabelSpan = labelSpan;
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

    const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-play'));
    const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-clear'));
    const randomBtn = document.getElementById('find-random');

    const playLabel = () => t('findFlag.play', 'Play');

    function updateBar() {
      let selCount = 0;
      for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status'>} */ (['continent','color','motif','status'])) {
        selCount += filter[k].include.size + filter[k].exclude.size;
      }
      if (filter.colorCount !== null) selCount++;
      if (selCount === 0) {
        // Nothing selected — bare "Play" (no zero-count to read as a sad
        // empty result; the user hasn't picked anything yet).
        playBtn.textContent = playLabel();
        playBtn.disabled = true;
        clearBtn.hidden = true;
        return;
      }
      const matchCount = all.filter((c) => matchesFilters(c, filter)).length;
      // Once anything is selected, show the live match count IN the
      // button — "Play (83)" or "Play (0)". The 0 case stays informative:
      // "your filter matches nothing, adjust it." Min playable size is 1.
      playBtn.textContent = `${playLabel()} (${matchCount})`;
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
        const f = pickRandomMix(pool, all, RANDOM_MIX_OPTIONS);
        const params = new URLSearchParams({ f: serializeFilter(f) });
        window.location.search = `?${params.toString()}`;
      });
    }

    updateBar();

    return {
      /**
       * Re-translate every chooser surface that was painted with `t()`
       * at render time. Delegates to the pure helper in `chooserI18n.js`
       * so the repaint contract is unit-tested without a fake document.
       * `data-i18n`-marked elements (Clear button, static Random label,
       * etc.) are handled upstream by `applyStringsToDocument` before
       * this fires. `newAll` is unused today (pill counts don't shift
       * on a re-alias) but kept in the signature so a future "live
       * count refresh" can plug in without a contract change.
       *
       * @param {import('../flags/group.js').Country[]} _newAll
       */
      refreshI18n(_newAll) {
        refreshChooserI18n({ sectionHeaders, allPills, onlyColorsLabelSpan, updateBar });
      },
    };
  }

  /**
   * @param {import('../flags/engine.js').Category} category
   * @param {import('../flags/flagsFilter.js').Filters} filter
   * @param {import('../flags/group.js').Country[]} all
   * @returns {{ refreshI18n: (newAll: import('../flags/group.js').Country[]) => void }}
   */
  function startGame(category, filter, all) {
    let targets = findTargets(all, category);
    // pool is rebuilt on a soft language switch — the suggestion matcher
    // reads each Country's `aliases`, which are baked at
    // withLocalizedAliases time. targetCodes is mutated in place so the
    // `state` object captured below keeps pointing at the same Set.
    let pool = findPool(all);
    const targetCodes = new Set(targets.map((c) => c.code));
    const foundCodes = new Set();
    const state = { targetCodes, foundCodes };

    const catEl = document.getElementById('find-cat');
    const countEl = document.getElementById('find-count');
    const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
    const sugEl = document.getElementById('find-suggestions');
    const foundEl = document.getElementById('find-found');
    const giveUpEl = document.getElementById('give-up');
    const gameRandomEl = /** @type {HTMLAnchorElement} */ (document.getElementById('game-random'));
    const gameShareEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('game-share'));

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

    gameRandomEl.addEventListener('click', (e) => {
      e.preventDefault();
      goRandom(all);
    });

    // Touch-only reveal — matches TTT's `matchMedia('(pointer: coarse)')`
    // pattern (ticTacToe/page.js, line 76). Desktop users have the URL
    // already in the address bar; reserving the share-icon for phones
    // where it actually triggers the native share sheet keeps the
    // chrome-button cluster lighter on the surface where it adds
    // less value. The click handler is still wired in both modes so
    // a future "reveal on desktop too" toggle wouldn't need rewiring.
    const isTouchDevice = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    if (gameShareEl) {
      attachShareHandler(gameShareEl);
      if (isTouchDevice) gameShareEl.hidden = false;
    }
    const resultShareEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('result-share'));
    if (resultShareEl) {
      attachShareHandler(resultShareEl);
      if (isTouchDevice) resultShareEl.hidden = false;
    }

    function finish() {
      if (finished) return;
      finished = true;
      const found = foundCodes.size;
      const total = targetCodes.size;

      // findFlag is play-and-walk-away now — no per-category best score,
      // no "Your best" line, no record-tracking. No "You found X / Y"
      // headline either: the Found / Missed grids below already make the
      // score self-evident. Celebration tier comes from the shared
      // pickCelebration helper so daily / findFlag / quiz all read the
      // same way: confetti for partial, fireworks (alone, not stacked)
      // for a clean sweep.
      const { tier, intensity } = pickCelebration({ found, total });
      if (tier === 'fireworks') launchFireworks();
      else if (tier === 'confetti') launchConfetti({ intensity });

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
        goRandom(all);
      };

      gameEl.hidden = true;
      resultEl.hidden = false;
    }

    gameEl.hidden = false;
    if (!('ontouchstart' in window)) inputEl.focus();

    return {
      /**
       * Soft language switch: swap in the re-aliased country list (so
       * the suggestion matcher accepts the new language's names),
       * re-derive targets in the new pool by code, re-translate the
       * category label, and re-paint the tiles + suggestion list. The
       * result section's `data-i18n` strings (prefix, found-title,
       * missed-title) re-translate upstream via
       * `applyStringsToDocument`; only the tile names (read from
       * `countryName`) need page-local work, and `refreshTileNames`
       * already covers both the in-game and result lists.
       *
       * @param {import('../flags/group.js').Country[]} newAll
       */
      refreshI18n(newAll) {
        all = newAll;
        pool = findPool(all);
        // Re-translate the category label by re-deriving it from the
        // stored filter — `category.label` was baked at first render
        // and would otherwise read in the boot-time language.
        const fresh = filterToCategory(filter, t);
        targets = findTargets(all, fresh);
        targetCodes.clear();
        for (const c of targets) targetCodes.add(c.code);
        catEl.textContent = fresh.label;
        refreshTileNames();
        renderSuggestions();
      },
    };
  }
}
