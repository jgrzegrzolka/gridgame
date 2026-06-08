import { t } from '../../i18n.js';
import { renderArchiveSquare } from '../squares.js';

/**
 * @typedef {Object} Idea
 * @property {string} filter
 * @property {string} [notes]
 * @property {number} [parkUntilN]
 */

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */

// Review state is per-browser, persisted in localStorage. Keyed by the
// idea's filter string (NOT the file position) so re-running the
// generator preserves the review state for unchanged ideas — author
// flow is "review fresh ideas only, leave already-OK'd ones alone."
//
// Storage shape: JSON array of filter strings. Empty array on first run.
// Orphan entries (filters that no longer exist in daily_ideas.json) are
// harmless — they just sit there. We don't prune; the cost is bytes and
// the benefit is bug-free idempotency.
const REVIEW_KEY = 'gridgame.ideas.reviewed';

function loadReviewed() {
  try {
    const raw = window.localStorage.getItem(REVIEW_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} set */
function saveReviewed(set) {
  window.localStorage.setItem(REVIEW_KEY, JSON.stringify([...set]));
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
 * Per-tile review button (✓) lets the author mark an idea as "fine to
 * promote." State is per-browser localStorage keyed by filter string;
 * "Hide reviewed" toggle filters the list down to the unreviewed pool.
 * The counter at the top tracks progress.
 */
export function bootIdeas() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('ideas-list'));
  const counterEl = /** @type {HTMLElement} */ (document.getElementById('review-counter'));
  const hideToggleEl = /** @type {HTMLInputElement} */ (document.getElementById('hide-reviewed'));

  const reviewed = loadReviewed();

  hideToggleEl.addEventListener('change', () => {
    document.body.classList.toggle('hide-reviewed', hideToggleEl.checked);
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
        let n = 0;
        for (const idea of ideas) if (reviewed.has(idea.filter)) n++;
        counterEl.textContent = `Reviewed: ${n} / ${ideas.length}`;
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
        if (reviewed.has(idea.filter)) {
          tile.classList.add('archive-square--reviewed');
        }

        // Review button — sibling of the play link, NOT inside it, so
        // clicks on the button stay on the button. preventDefault is
        // still belt-and-braces against any future containing <a>.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'review-button';
        btn.title = 'Toggle reviewed (click ✓ to mark as fine)';
        btn.setAttribute('aria-label', 'Toggle reviewed');
        btn.textContent = '✓';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (reviewed.has(idea.filter)) {
            reviewed.delete(idea.filter);
            tile.classList.remove('archive-square--reviewed');
          } else {
            reviewed.add(idea.filter);
            tile.classList.add('archive-square--reviewed');
          }
          saveReviewed(reviewed);
          updateCounter();
        });
        tile.appendChild(btn);

        listEl.appendChild(tile);
      });
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
