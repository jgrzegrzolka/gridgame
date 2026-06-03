import { CONTINENTS } from '../flags/group.js';
import { COLORS_FOR_RANDOM, MOTIFS_FOR_RANDOM } from '../flags/grid.js';
import { emptyFilters, matchesFilters } from '../flags/flagsFilter.js';
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

  /**
   * @type {{
   *   items: Country[],
   *   tiles: HTMLElement[],
   *   count: HTMLElement,
   *   sections: Array<{ el: HTMLElement, start: number, end: number }>,
   * } | null}
   */
  let state = null;

  function renderAll(parent, items) {
    const h2 = document.createElement('h2');
    h2.textContent = t('domain.flags', 'Flags');
    const countSpan = document.createElement('span');
    countSpan.className = 'section-count';
    countSpan.textContent = String(items.length);
    h2.appendChild(countSpan);
    parent.appendChild(h2);

    // Sort by localized name so the first-letter grouping reflects what
    // the user actually sees. Use the document lang so Polish sorts as
    // Polish (Ł after L, Ż last) instead of system default.
    const lang = document.documentElement.lang || 'en';
    const sorted = [...items].sort((a, b) =>
      countryName(a).localeCompare(countryName(b), lang),
    );

    /** @type {HTMLElement[]} */
    const tiles = [];
    /** @type {Array<{ el: HTMLElement, start: number, end: number }>} */
    const sections = [];
    let currentLetter = '';
    /** @type {HTMLElement | null} */
    let currentGrid = null;
    for (const c of sorted) {
      const letter = countryName(c).charAt(0).toLocaleUpperCase(lang);
      if (letter !== currentLetter) {
        if (sections.length) sections[sections.length - 1].end = tiles.length;
        currentLetter = letter;
        const section = document.createElement('section');
        section.className = 'letter-section';
        const h3 = document.createElement('h3');
        h3.textContent = letter;
        section.appendChild(h3);
        currentGrid = document.createElement('div');
        currentGrid.className = 'grid';
        section.appendChild(currentGrid);
        parent.appendChild(section);
        sections.push({ el: section, start: tiles.length, end: tiles.length });
      }
      const tile = flagTile(c);
      tiles.push(tile);
      /** @type {HTMLElement} */ (currentGrid).appendChild(tile);
    }
    if (sections.length) sections[sections.length - 1].end = tiles.length;

    state = { items: sorted, tiles, count: countSpan, sections };
  }

  function applyFilter() {
    if (!state) return;
    let visible = 0;
    for (let i = 0; i < state.items.length; i++) {
      const show = matchesFilters(state.items[i], filters);
      state.tiles[i].hidden = !show;
      if (show) visible++;
    }
    for (const sec of state.sections) {
      let anyVisible = false;
      for (let i = sec.start; i < sec.end; i++) {
        if (!state.tiles[i].hidden) { anyVisible = true; break; }
      }
      sec.el.hidden = !anyVisible;
    }
    state.count.textContent =
      visible === state.items.length ? String(visible) : `${visible} / ${state.items.length}`;
    let any = false;
    for (const k of /** @type {Array<keyof typeof filters>} */ (Object.keys(filters))) {
      if (filters[k].include.size || filters[k].exclude.size) { any = true; break; }
    }
    clearBtn.hidden = !any;
  }

  /**
   * @param {string} label
   * @param {keyof typeof filters} group
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
        applyFilter();
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  const filterBar = document.getElementById('filter-bar');
  filterBar.appendChild(
    buildFilterGroup(t('flagsdata.filterStatus', 'Status'), 'status', STATUS_VALUES.map((v) => ({ value: v, label: statusLabel(v) }))),
  );
  filterBar.appendChild(
    buildFilterGroup(t('flagsdata.filterContinent', 'Continent'), 'continent', [...CONTINENTS, 'Other'].map((v) => ({ value: v, label: continentLabel(v) }))),
  );
  filterBar.appendChild(
    buildFilterGroup(t('flagsdata.filterColors', 'Colors'), 'color', COLORS_FOR_RANDOM.map((v) => ({ value: v, label: colorLabel(v) }))),
  );
  filterBar.appendChild(
    buildFilterGroup(t('flagsdata.filterMotifs', 'Motifs'), 'motif', MOTIFS_FOR_RANDOM.map((v) => ({ value: v, label: motifLabel(v) }))),
  );

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.id = 'filter-clear';
  clearBtn.textContent = t('flagsdata.clear', 'Clear');
  clearBtn.hidden = true;
  clearBtn.addEventListener('click', () => {
    for (const k of /** @type {Array<keyof typeof filters>} */ (Object.keys(filters))) {
      filters[k].include.clear();
      filters[k].exclude.clear();
    }
    for (const el of filterBar.querySelectorAll('.pill.active, .pill.exclude')) {
      el.classList.remove('active');
      el.classList.remove('exclude');
    }
    applyFilter();
  });
  filterBar.appendChild(clearBtn);

  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then((all) => {
      const sections = document.getElementById('sections');
      renderAll(sections, all);
    })
    .catch((err) => {
      document.getElementById('sections').textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
