import { t } from '../../i18n.js';
import { renderArchiveSquare } from '../squares.js';

/**
 * @typedef {Object} Idea
 * @property {string} filter
 * @property {string} [notes]
 * @property {number} [parkUntilN]
 *
 * @typedef {'approved' | 'rejected'} Verdict
 */

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */

// Review state is per-browser, persisted in localStorage. Keyed by the
// idea's filter string (NOT the file position) so re-running the
// generator preserves the review state for unchanged ideas — author
// flow is "review fresh ideas only, leave already-judged ones alone."
//
// Storage shape: JSON object `{ "<filterString>": "approved" | "rejected" }`.
// Backward-compat with the v1 array-of-approved-filters from the first
// version of this UI: arrays are migrated to objects on read.
//
// Orphan entries (filters that no longer exist in daily_ideas.json) are
// harmless — they just sit there. We don't prune; cost is bytes, benefit
// is bug-free idempotency when the generator re-runs.
const REVIEW_KEY = 'gridgame.ideas.reviewed';

/** @returns {Map<string, Verdict>} */
function loadReviewState() {
  try {
    const raw = window.localStorage.getItem(REVIEW_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    // v1 stored an array of "approved" filter strings.
    if (Array.isArray(parsed)) {
      return new Map(parsed.map((f) => [String(f), /** @type {Verdict} */ ('approved')]));
    }
    if (parsed && typeof parsed === 'object') {
      const m = new Map();
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'approved' || v === 'rejected') m.set(k, v);
      }
      return m;
    }
    return new Map();
  } catch {
    return new Map();
  }
}

/** @param {Map<string, Verdict>} map */
function saveReviewState(map) {
  window.localStorage.setItem(REVIEW_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * Render the brainstorm ideas pool as a grid of preview cards. Hidden
 * page — only reachable by typing /daily/ideas/ directly. Each card
 * links to the sibling `play.html` so the author can play-test a raw
 * filter before promoting it to the backlog.
 *
 * Ideas have no `n` and no `answers`. The synthetic `n: i+1` is just a
 * stable position number for the tile badge and the `?k=K` URL — adding
 * or reordering ideas shifts the index, so URLs are session-scoped, not
 * bookmarkable. That's fine: the page exists for the author, not for
 * sharing.
 *
 * Notes go on the tile as a `title` attribute (native browser tooltip
 * on hover) instead of into the `.archive-square-criteria` overlay —
 * keeping notes here avoids touching the shared `squares.js` /
 * `archive.css` rendering that the live archive page also depends on.
 *
 * Per-tile review buttons: ✓ (approve) top-right and ✗ (reject)
 * top-left. Three states per idea: approved, rejected, or unmarked
 * (default). State is per-browser localStorage keyed by filter string.
 * "Hide reviewed" toggle hides everything with a verdict so the
 * remaining pool is "what I haven't looked at yet." Counter shows
 * `✓ X · ✗ Y · Z pending` so progress is glanceable.
 */
export function bootIdeas() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('ideas-list'));
  const counterEl = /** @type {HTMLElement} */ (document.getElementById('review-counter'));
  const hideToggleEl = /** @type {HTMLInputElement} */ (document.getElementById('hide-reviewed'));
  const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('export-approved'));

  const state = loadReviewState();

  hideToggleEl.addEventListener('change', () => {
    document.body.classList.toggle('hide-reviewed', hideToggleEl.checked);
  });

  // Export approved filter list to clipboard so the author can paste it
  // into chat (or a script) to promote ideas. JSON array form — easiest
  // to pipe into the next workflow step. Brief visual confirmation by
  // flipping the button's colour for ~1.2s; resets on its own.
  exportBtn.addEventListener('click', async () => {
    const approved = [];
    for (const [filter, verdict] of state) {
      if (verdict === 'approved') approved.push(filter);
    }
    const payload = JSON.stringify(approved, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      const originalText = exportBtn.textContent;
      exportBtn.textContent = `Copied ${approved.length} ✓`;
      exportBtn.classList.add('export-button--copied');
      setTimeout(() => {
        exportBtn.textContent = originalText;
        exportBtn.classList.remove('export-button--copied');
      }, 1200);
    } catch {
      // Clipboard write can fail in some browsers/contexts (e.g. non-HTTPS,
      // permissions denied). Fall back to logging so the author can grab
      // the list from the DevTools console.
      // eslint-disable-next-line no-console
      console.log('Approved filters (clipboard write failed; copy from here):\n' + payload);
      exportBtn.textContent = 'See console';
    }
  });

  fetch('../daily_ideas.json')
    .then((r) => r.json())
    .then((/** @type {Idea[]} */ ideas) => {
      if (ideas.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        empty.textContent = 'No ideas yet.';
        listEl.appendChild(empty);
        return;
      }

      const updateCounter = () => {
        let approved = 0;
        let rejected = 0;
        for (const idea of ideas) {
          const v = state.get(idea.filter);
          if (v === 'approved') approved++;
          else if (v === 'rejected') rejected++;
        }
        const pending = ideas.length - approved - rejected;
        counterEl.textContent = `✓ ${approved} · ✗ ${rejected} · ${pending} pending`;
      };
      updateCounter();

      ideas.forEach((idea, i) => {
        const k = i + 1;
        const synthetic = /** @type {DailyPuzzle} */ ({
          n: k,
          filter: idea.filter,
          answers: [],
        });
        const tile = renderArchiveSquare(synthetic, {
          href: `./play.html?k=${k}`,
          ariaPrefix: 'Idea',
        });
        if (idea.notes) {
          const link = tile.querySelector('a');
          if (link) link.title = idea.notes;
        }

        const paintVerdictClass = () => {
          const v = state.get(idea.filter);
          tile.classList.toggle('archive-square--approved', v === 'approved');
          tile.classList.toggle('archive-square--rejected', v === 'rejected');
        };
        paintVerdictClass();

        // Verdict button factory — handles the shared click logic for
        // both ✓ and ✗: toggling the verdict to/from this button's
        // target state. Pressing the opposite button when one verdict
        // is active flips to the other (no need to clear first).
        /** @param {'approved' | 'rejected'} target @param {string} symbol @param {string} label */
        const makeBtn = (target, symbol, label) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `review-button review-button--${target === 'approved' ? 'approve' : 'reject'}`;
          btn.title = label;
          btn.setAttribute('aria-label', label);
          btn.textContent = symbol;
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const current = state.get(idea.filter);
            if (current === target) state.delete(idea.filter); // toggle off
            else state.set(idea.filter, target);               // set or switch
            saveReviewState(state);
            paintVerdictClass();
            updateCounter();
          });
          return btn;
        };

        tile.appendChild(makeBtn('approved', '✓', 'Approve (mark as fine to promote)'));
        tile.appendChild(makeBtn('rejected', '✗', 'Reject (mark as not interested)'));

        listEl.appendChild(tile);
      });
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
