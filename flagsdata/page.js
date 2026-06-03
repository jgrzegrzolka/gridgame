import { CONTINENTS, sovereigntyOf } from '../flags/group.js';
import { COLORS_FOR_RANDOM, MOTIFS_FOR_RANDOM } from '../flags/grid.js';
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

  /** @typedef {{ include: Set<string>, exclude: Set<string> }} FilterSet */
  /** @type {Record<'status' | 'continent' | 'color' | 'motif', FilterSet>} */
  const filters = {
    status: { include: new Set(), exclude: new Set() },
    continent: { include: new Set(), exclude: new Set() },
    color: { include: new Set(), exclude: new Set() },
    motif: { include: new Set(), exclude: new Set() },
  };

  /** @param {Country} c */
  function matches(c) {
    const sov = sovereigntyOf(c);
    if (filters.status.include.size && !filters.status.include.has(sov)) return false;
    if (filters.status.exclude.has(sov)) return false;

    const cont = c.continent ?? 'Other';
    if (filters.continent.include.size && !filters.continent.include.has(cont)) return false;
    if (filters.continent.exclude.has(cont)) return false;

    const colors = c.colors ?? [];
    if (filters.color.include.size && !colors.some((col) => filters.color.include.has(col))) return false;
    if (filters.color.exclude.size && colors.some((col) => filters.color.exclude.has(col))) return false;

    const motifs = c.motifs ?? [];
    if (filters.motif.include.size && !motifs.some((m) => filters.motif.include.has(m))) return false;
    if (filters.motif.exclude.size && motifs.some((m) => filters.motif.exclude.has(m))) return false;

    return true;
  }

  /** @type {{ items: Country[], tiles: HTMLElement[], count: HTMLElement } | null} */
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
    for (const c of items) {
      const tile = flagTile(c);
      tiles.push(tile);
      grid.appendChild(tile);
    }
    parent.appendChild(grid);
    state = { items, tiles, count: countSpan };
  }

  function applyFilter() {
    if (!state) return;
    let visible = 0;
    for (let i = 0; i < state.items.length; i++) {
      const show = matches(state.items[i]);
      state.tiles[i].hidden = !show;
      if (show) visible++;
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
