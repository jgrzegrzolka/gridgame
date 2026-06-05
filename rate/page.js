import {
  emptyState,
  rate,
  skip,
  undo,
  currentCountry,
  isDone,
  progress,
  jumpToFirstUnrated,
} from './rating.js';
import { countryName } from '../i18n.js';

/** @typedef {import('../flags/group.js').Country} Country */

const STORAGE_KEY = 'gridgame.rate.v1';
const SOVEREIGN = ['un_member', 'un_observer', 'non_un'];

/** @returns {import('./rating.js').RatingState} */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.index !== 'number' ||
      parsed?.ratings == null ||
      typeof parsed.ratings !== 'object'
    ) {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode — silently ignore */
  }
}

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
    .sort((a, b) => a.name.localeCompare(b.name));

  let state = loadState();

  const cardEl = document.getElementById('rate-card');
  const doneEl = document.getElementById('rate-done');
  const flagEl = /** @type {HTMLImageElement} */ (document.getElementById('rate-flag'));
  const nameEl = document.getElementById('rate-name');
  const enEl = document.getElementById('rate-en');
  const continentEl = document.getElementById('rate-continent');
  const codeEl = document.getElementById('rate-code');
  const helpEl = document.getElementById('rate-help');
  const progressFill = document.getElementById('rate-progress-fill');
  const progressText = document.getElementById('rate-progress-text');
  const doneCountEl = document.getElementById('rate-done-count');

  function render() {
    if (isDone(state, countries)) {
      cardEl.hidden = true;
      doneEl.hidden = false;
      doneCountEl.textContent = `${Object.keys(state.ratings).length} of ${countries.length} rated.`;
      saveState(state);
      return;
    }
    cardEl.hidden = false;
    doneEl.hidden = true;

    const c = currentCountry(state, countries);
    if (!c) return;
    flagEl.src = `../flags/svg/${c.code}.svg`;
    flagEl.alt = c.name;

    const localized = countryName(c);
    nameEl.textContent = localized;
    enEl.textContent = localized === c.name ? '' : c.name;
    continentEl.textContent = c.continent;
    codeEl.textContent = c.code.toUpperCase();

    const existing = state.ratings[c.code];
    helpEl.textContent = existing
      ? `Already rated ${existing}/5 — press a number to change, or skip.`
      : '1 = everyone knows · 5 = almost nobody knows';

    for (const btn of document.querySelectorAll('.rate-score')) {
      const score = Number(/** @type {HTMLElement} */ (btn).dataset.score);
      btn.classList.toggle('is-current', existing === score);
    }

    const p = progress(state, countries);
    progressFill.style.width = `${(p.position / p.total) * 100}%`;
    progressText.textContent = `${p.position} / ${p.total} · ${p.rated} rated`;

    saveState(state);
  }

  function applyRate(score) {
    state = rate(state, countries, score);
    render();
  }
  function applySkip() {
    state = skip(state, countries);
    render();
  }
  function applyUndo() {
    state = undo(state);
    render();
  }
  function applyJump() {
    state = jumpToFirstUnrated(state, countries);
    render();
  }

  for (const btn of document.querySelectorAll('.rate-score')) {
    btn.addEventListener('click', () =>
      applyRate(Number(/** @type {HTMLElement} */ (btn).dataset.score)),
    );
  }
  document.getElementById('rate-skip').addEventListener('click', applySkip);
  document.getElementById('rate-undo').addEventListener('click', applyUndo);
  document.getElementById('rate-jump').addEventListener('click', applyJump);

  function exportRatings() {
    const filename = `country-ratings-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(filename, state.ratings);
  }
  document.getElementById('rate-export').addEventListener('click', exportRatings);
  document.getElementById('rate-export-done').addEventListener('click', exportRatings);

  function reset() {
    if (!window.confirm('Erase all ratings and start over?')) return;
    state = emptyState();
    saveState(state);
    render();
  }
  document.getElementById('rate-reset').addEventListener('click', reset);
  document.getElementById('rate-reset-done').addEventListener('click', reset);

  document.addEventListener('keydown', (e) => {
    const tag = /** @type {HTMLElement} */ (e.target).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key >= '1' && e.key <= '5') {
      applyRate(Number(e.key));
    } else if (e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      applySkip();
    } else if (e.key === 'Backspace' || e.key === 'ArrowLeft') {
      e.preventDefault();
      applyUndo();
    }
  });

  render();
}
