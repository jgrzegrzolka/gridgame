import { CONTINENTS, loadCountries } from '../flags/group.js';
import { ALL_FLAG_COLORS, ALL_MOTIFS, foldDiacritics } from '../flags/engine.js';
import { emptyFilters, matchesFilters, createColorCountLock } from '../flags/flagsFilter.js';
import { createColorCountPicker } from '../colorCountPicker.js';
import { t, countryName } from '../i18n.js';

/** @param {string} v */
function statusLabel(v) {
  return t(`status.${v}`, STATUS_LABELS[/** @type {keyof typeof STATUS_LABELS} */ (v)]);
}

/** @param {string} name */
function continentLabel(name) {
  if (name === 'Other') return t('continent.other', 'Other');
  const key = name.toLowerCase().replace(/ /g, '-');
  return t(`variant.${key}`, name);
}

/** @param {string} v */
function colorLabel(v) {
  return t(`color.${v}`, v);
}

/** @param {string} v */
function motifLabel(v) {
  return t(`motif.${v}`, v);
}

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/group.js').Sovereignty} Sovereignty */

/** @type {Sovereignty[]} */
const STATUS_VALUES = ['sovereign', 'non_un', 'territory', 'other'];
/** @type {Record<Sovereignty, string>} */
const STATUS_LABELS = {
  sovereign: 'Sovereign',
  non_un: 'Non-UN',
  territory: 'Territory',
  other: 'Other',
};

export function bootFlagsData() {
  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = zoom.querySelector('img');
  const zoomName = zoom.querySelector('p');
  const zoomData = zoom.querySelector('.country-data');
  /** @param {Country} c */
  function openZoom(c) {
    const displayName = countryName(c);
    zoomImg.src = `../flags/svg/${c.code}.svg`;
    zoomImg.alt = displayName;
    zoomName.textContent = displayName;
    zoomData.textContent = JSON.stringify(c, null, 2);
    zoom.showModal();
  }
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });

  /** @param {Country} c */
  function flagTile(c) {
    const displayName = countryName(c);
    const wrap = document.createElement('div');
    wrap.className = 'flag';
    wrap.dataset.name = displayName;
    wrap.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = displayName;
    img.loading = 'lazy';
    wrap.appendChild(img);
    return wrap;
  }

  const filters = emptyFilters();
  /** Diacritic-folded substring of the name search input. Empty means the
   * filter is off. Stored as the folded form so we don't refold per-tile
   * on every input event — the per-country fold is the same idea, computed
   * once in renderAll. */
  let nameQuery = '';

  // "No other colours" toggle pill — state lives in the shared
  // createColorCountLock so findFlag and flagsdata can't drift on what
  // "only these colours" means. Page owns the DOM (button below) and
  // calls into the lock from three places: the toggle click, every
  // color pill click (sync), and Clear (reset).
  const colorCountLock = createColorCountLock(filters);
  /** @type {HTMLButtonElement | null} */
  let onlyColorsBtn = null;

  // "Colour count" widget — segmented op + N picker shared with the
  // findFlag chooser. Both surfaces write to `filters.colorCount`, so
  // engaging the picker resets the lock and vice versa.
  const colorCountPicker = createColorCountPicker(filters, t, {
    onChange: () => applyFilter(),
    onPicked: () => {
      // Picker just took over `filters.colorCount`. Disengage the lock
      // *cosmetically* — DON'T call lock.reset() here, because that
      // would clobber the value the picker just wrote.
      colorCountLock.disengage();
      if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
    },
  });

  /** @type {{ items: Country[], foldedNames: string[], tiles: HTMLElement[], count: HTMLElement } | null} */
  let state = null;

  function renderAll(parent, items) {
    const h2 = document.createElement('h2');
    h2.textContent = t('domain.flags', 'Flags');
    const countSpan = document.createElement('span');
    countSpan.className = 'section-count';
    countSpan.textContent = String(items.length);
    h2.appendChild(countSpan);
    parent.appendChild(h2);
    const grid = document.createElement('div');
    grid.className = 'grid';
    /** @type {HTMLElement[]} */
    const tiles = [];
    /** @type {string[]} */
    const foldedNames = [];
    for (const c of items) {
      const tile = flagTile(c);
      tiles.push(tile);
      foldedNames.push(foldDiacritics(countryName(c)));
      grid.appendChild(tile);
    }
    parent.appendChild(grid);
    state = { items, foldedNames, tiles, count: countSpan };
  }

  function applyFilter() {
    if (!state) return;
    let visible = 0;
    for (let i = 0; i < state.items.length; i++) {
      const catMatch = matchesFilters(state.items[i], filters);
      const nameMatch = nameQuery === '' || state.foldedNames[i].includes(nameQuery);
      const show = catMatch && nameMatch;
      state.tiles[i].hidden = !show;
      if (show) visible++;
    }
    state.count.textContent =
      visible === state.items.length ? String(visible) : `${visible} / ${state.items.length}`;
    let pillTotal = 0;
    for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status'>} */ (['continent','color','motif','status'])) {
      pillTotal += filters[k].include.size + filters[k].exclude.size;
    }
    if (filters.colorCount !== null) pillTotal++;
    const anyActive = pillTotal > 0 || nameQuery !== '';
    clearBtn.hidden = !anyActive;
    // Include name search in the toggle badge count — once the search
    // is hidden behind the mobile Filters toggle, the badge is the
    // user's only cue that something is filtering. Counting it as one
    // "active filter" (alongside each pill) matches that mental model.
    updateFilterToggle(pillTotal + (nameQuery !== '' ? 1 : 0));
  }

  /** @param {number} count */
  function updateFilterToggle(count) {
    const badge = document.getElementById('filter-toggle-count');
    if (!badge) return;
    badge.textContent = count > 0 ? String(count) : '';
    badge.hidden = count === 0;
  }

  /**
   * @param {string} label
   * @param {'continent' | 'color' | 'motif' | 'status'} group
   * @param {Array<{ value: string, label: string }>} entries
   */
  function buildFilterGroup(label, group, entries) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-group';
    const labelEl = document.createElement('span');
    labelEl.className = 'filter-label';
    labelEl.textContent = label;
    wrap.appendChild(labelEl);
    for (const { value, label: pillLabel } of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.dataset.group = group;
      btn.dataset.value = value;
      btn.textContent = pillLabel;
      btn.addEventListener('click', () => {
        const { include, exclude } = filters[group];
        if (include.has(value)) {
          include.delete(value);
          exclude.add(value);
          btn.classList.remove('active');
          btn.classList.add('exclude');
        } else if (exclude.has(value)) {
          exclude.delete(value);
          btn.classList.remove('exclude');
        } else {
          include.add(value);
          btn.classList.add('active');
        }
        if (group === 'color') colorCountLock.sync();
        applyFilter();
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  const filterBar = document.getElementById('filter-bar');

  // Name search — substring match, diacritic-folded against the
  // localized country name, ANDed with the category pills. On desktop
  // it sits in its own row at the top of the filter bar; on mobile
  // it's appended into .filter-groups so the existing collapse toggle
  // hides it behind "Filters" along with the pills (rationale: once
  // it's part of the filter set, it should follow the same show/hide
  // contract — otherwise the user sees a search box but no pills,
  // which makes the toggle feel inconsistent).
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'name-search';
  searchInput.className = 'name-search';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('autocapitalize', 'off');
  searchInput.setAttribute('autocorrect', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchInput.placeholder = t('flagsdata.searchName', 'Search by name…');
  searchInput.addEventListener('input', () => {
    nameQuery = foldDiacritics(searchInput.value.trim());
    applyFilter();
  });
  // The wrapper does the row-claim on desktop (flex-basis: 100% on a
  // plain div wraps reliably where the same on an <input> doesn't).
  // The wrapper gets inserted into groupsWrap further down, so the
  // mobile collapse toggle covers it too.
  const searchWrap = document.createElement('div');
  searchWrap.className = 'name-search-wrap';
  searchWrap.appendChild(searchInput);

  // Search sits OUTSIDE the collapsible groups so it's always reachable —
  // search and filter are different mental models: search is "I know what
  // I want, take me there", filter is "narrow the population to a
  // category". Hiding search behind the toggle would put a click in front
  // of the faster path.
  filterBar.appendChild(searchWrap);

  // Collapse toggle on every viewport. Default initial state differs:
  //   - mobile (≤600 px): closed — the filter bar would otherwise eat
  //     half the viewport on a phone
  //   - desktop: open — preserves what desktop users used to get
  //     unconditionally, so today's landing experience is unchanged.
  // The badge shows how many include/exclude pills are currently active
  // so the user knows whether filtering is happening while the panel is
  // closed.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.id = 'filter-toggle';
  toggleBtn.className = 'filter-toggle';
  toggleBtn.setAttribute('aria-controls', 'filter-groups');
  toggleBtn.innerHTML = `<span>${t('flagsdata.filters', 'Filters')}</span><span id="filter-toggle-count" class="filter-toggle-count" hidden></span><span class="filter-toggle-chevron" aria-hidden="true">▾</span>`;
  const startOpen = window.matchMedia('(min-width: 601px)').matches;
  filterBar.classList.toggle('is-open', startOpen);
  toggleBtn.setAttribute('aria-expanded', String(startOpen));
  toggleBtn.addEventListener('click', () => {
    const open = filterBar.classList.toggle('is-open');
    toggleBtn.setAttribute('aria-expanded', String(open));
  });
  // Wrap the toggle in a full-width row so it sits alone above the pill
  // groups. Without this it would share row 2 with the first pill group
  // (toggle is a natural-width inline-flex; the pills would just flow in
  // beside it).
  const toggleRow = document.createElement('div');
  toggleRow.className = 'filter-toggle-row';
  toggleRow.appendChild(toggleBtn);
  filterBar.appendChild(toggleRow);

  const groupsWrap = document.createElement('div');
  groupsWrap.id = 'filter-groups';
  groupsWrap.className = 'filter-groups';
  filterBar.appendChild(groupsWrap);

  groupsWrap.appendChild(
    buildFilterGroup(t('flagsdata.filterStatus', 'Status'), 'status', STATUS_VALUES.map((v) => ({ value: v, label: statusLabel(v) }))),
  );
  groupsWrap.appendChild(
    buildFilterGroup(t('flagsdata.filterContinent', 'Continent'), 'continent', [...CONTINENTS, 'Other'].map((v) => ({ value: v, label: continentLabel(v) }))),
  );
  const colorGroup = buildFilterGroup(t('flagsdata.filterColors', 'Colors'), 'color', ALL_FLAG_COLORS.map((v) => ({ value: v, label: colorLabel(v) })));
  // Append the "no other colours" modifier pill at the end of the Colors
  // row — same placement as findFlag's chooser, same toggle semantics.
  const onlyBtn = document.createElement('button');
  onlyBtn.type = 'button';
  onlyBtn.className = 'pill pill-modifier';
  onlyBtn.textContent = t('findFlag.noOtherColors', 'no other colours');
  onlyBtn.addEventListener('click', () => {
    const on = colorCountLock.toggle();
    onlyBtn.classList.toggle('active', on);
    // Lock just took over the colour-count primitive — tell the
    // picker pill to disengage cosmetically (drops its op/n to
    // defaults, paints inactive). Doesn't touch `filters.colorCount`.
    colorCountPicker.disengage();
    applyFilter();
  });
  colorGroup.appendChild(onlyBtn);
  onlyColorsBtn = onlyBtn;
  // Colour-count compound pill — sits next to "no other colours" since
  // both drive the same `filters.colorCount` primitive. Single pill
  // with three click zones (op cycles =/≥/≤, N cycles 2/3/4/5, × clears).
  colorGroup.appendChild(colorCountPicker.el);
  groupsWrap.appendChild(colorGroup);

  groupsWrap.appendChild(
    buildFilterGroup(t('flagsdata.filterMotifs', 'Motifs'), 'motif', ALL_MOTIFS.map((v) => ({ value: v, label: motifLabel(v) }))),
  );

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.id = 'filter-clear';
  clearBtn.textContent = t('flagsdata.clear', 'Clear');
  clearBtn.hidden = true;
  clearBtn.addEventListener('click', () => {
    for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status'>} */ (['continent','color','motif','status'])) {
      filters[k].include.clear();
      filters[k].exclude.clear();
    }
    colorCountLock.reset();
    if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
    colorCountPicker.reset();
    for (const el of filterBar.querySelectorAll('.pill.active, .pill.exclude')) {
      el.classList.remove('active');
      el.classList.remove('exclude');
    }
    searchInput.value = '';
    nameQuery = '';
    applyFilter();
  });
  // Clear sits on the same row as the toggle (right-aligned), not inside
  // the collapsible groups. It only renders when at least one filter is
  // active, so the user can reset without expanding the bar — particularly
  // useful when filters are collapsed but the count badge says "3".
  toggleRow.appendChild(clearBtn);

  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((all) => {
      const sections = document.getElementById('sections');
      renderAll(sections, all);
    })
    .catch((err) => {
      document.getElementById('sections').textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
