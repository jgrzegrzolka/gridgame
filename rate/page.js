import { emptyRatings, setRating, ratedCount } from './rating.js';
import { countryName } from '../i18n.js';

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('./rating.js').Ratings} Ratings */

const STORAGE_KEY = 'gridgame.rate.v2';
// 193 UN member states + 2 UN observers (Vatican, Palestine) = 195. The
// "non_un" bucket (Cook Islands, Kosovo, Niue, Taiwan, Western Sahara) is
// excluded here — those are disputed / partially recognized and belong
// with territories if we ever extend the scope past sovereign countries.
const SOVEREIGN = ['un_member', 'un_observer'];

// Provisional: every non-sovereign entry (territories, debated states,
// organizations) is exported with this score until we extend the rating
// scale and rate them properly. Reviewable; placeholder for now.
const NON_SOVEREIGN_DEFAULT = 7;

// Display order requested by the user (Europe first), with anything not in
// the list sinking to the end as "other".
const CONT_ORDER = [
  'Europe',
  'Asia',
  'North America',
  'South America',
  'Africa',
  'Oceania',
];

/** @param {Country} c */
function continentRank(c) {
  const i = CONT_ORDER.indexOf(c.continent);
  return i === -1 ? CONT_ORDER.length : i;
}

/** @returns {Ratings} */
function loadRatings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyRatings();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Only accept entries that look like { code: integer 1..5 }, in case
      // we ever land on stale data from an older shape.
      /** @type {Ratings} */
      const clean = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5) {
          clean[k] = v;
        }
      }
      return clean;
    }
    return emptyRatings();
  } catch {
    return emptyRatings();
  }
}

/** @param {Ratings} ratings */
function saveRatings(ratings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  } catch {
    /* quota or private mode — silently ignore */
  }
}

/** @param {string} filename @param {unknown} obj */
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function bootRate() {
  const res = await fetch('../flags/countries.json');
  /** @type {Country[]} */
  const all = await res.json();
  const countries = all
    .filter((c) => SOVEREIGN.includes(/** @type {string} */ (c.statehood)))
    .sort((a, b) => {
      const byContinent = continentRank(a) - continentRank(b);
      return byContinent !== 0 ? byContinent : a.name.localeCompare(b.name);
    });

  const nonSovereignCodes = all
    .filter((c) => !SOVEREIGN.includes(/** @type {string} */ (c.statehood)))
    .map((c) => c.code);

  let ratings = loadRatings();

  const gridEl = /** @type {HTMLElement} */ (document.getElementById('rate-grid'));
  const ratedCountEl = /** @type {HTMLElement} */ (document.getElementById('rate-rated-count'));
  const totalCountEl = /** @type {HTMLElement} */ (document.getElementById('rate-total-count'));
  totalCountEl.textContent = String(countries.length);

  /**
   * Mark the row's score buttons + the row itself based on the current score.
   * @param {HTMLElement} row
   * @param {number | undefined} score
   */
  function applyRowSelection(row, score) {
    for (const btn of row.querySelectorAll('.rate-row-btn')) {
      const s = Number(/** @type {HTMLElement} */ (btn).dataset.score);
      btn.classList.toggle('is-current', s === score);
    }
    row.classList.toggle('is-rated', score != null);
  }

  /** @param {Country} c */
  function buildRow(c) {
    const li = document.createElement('li');
    li.className = 'rate-row';
    li.dataset.code = c.code;

    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = '';
    img.loading = 'lazy';
    img.className = 'rate-row-flag';
    li.appendChild(img);

    const label = document.createElement('span');
    label.className = 'rate-row-label';
    const fullName = countryName(c);
    label.textContent = fullName;
    label.title = fullName;
    li.appendChild(label);

    const buttons = document.createElement('span');
    buttons.className = 'rate-row-buttons';
    for (let s = 1; s <= 5; s++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rate-row-btn';
      btn.dataset.score = String(s);
      btn.textContent = String(s);
      buttons.appendChild(btn);
    }
    li.appendChild(buttons);

    applyRowSelection(li, ratings[c.code]);
    return li;
  }

  function updateProgress() {
    ratedCountEl.textContent = String(ratedCount(ratings));
  }

  const fragment = document.createDocumentFragment();
  let lastHeader = '';
  for (const c of countries) {
    const header = CONT_ORDER.includes(c.continent) ? c.continent : 'Other';
    if (header !== lastHeader) {
      const headEl = document.createElement('li');
      headEl.className = 'rate-section-head';
      headEl.textContent = header;
      fragment.appendChild(headEl);
      lastHeader = header;
    }
    fragment.appendChild(buildRow(c));
  }
  gridEl.appendChild(fragment);
  updateProgress();

  gridEl.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('.rate-row-btn')
    );
    if (!btn) return;
    const row = /** @type {HTMLElement | null} */ (btn.closest('.rate-row'));
    if (!row || !row.dataset.code) return;
    const code = row.dataset.code;
    const score = Number(btn.dataset.score);
    ratings = setRating(ratings, code, score);
    saveRatings(ratings);
    applyRowSelection(row, ratings[code]);
    updateProgress();
  });

  document.getElementById('rate-export')?.addEventListener('click', () => {
    /** @type {Ratings} */
    const full = {};
    for (const code of nonSovereignCodes) full[code] = NON_SOVEREIGN_DEFAULT;
    Object.assign(full, ratings);
    const filename = `country-ratings-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(filename, full);
  });

  document.getElementById('rate-reset')?.addEventListener('click', () => {
    if (!window.confirm('Erase all ratings and start over?')) return;
    ratings = emptyRatings();
    saveRatings(ratings);
    for (const row of gridEl.querySelectorAll('.rate-row')) {
      applyRowSelection(/** @type {HTMLElement} */ (row), undefined);
    }
    updateProgress();
  });
}
