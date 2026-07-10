import { t } from '../../i18n.js';
import { renderArchiveSquare, refreshSquareCriteria } from '../squares.js';
import { fetchCatalog } from '../catalogSource.js';
import { loadReviewState, saveReviewState, ideaKey } from './reviewState.js';

/**
 * @typedef {Object} Idea
 * @property {string} [filter]
 * @property {string} [kind]  'superlative' for metric-ranked ideas; absent = filter idea.
 * @property {Record<string, string>} [title]  hand-written label for superlative ideas.
 * @property {string} [notes]
 * @property {number} [parkUntilN]
 * @property {number} [difficulty]
 */

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */
/** @typedef {import('./reviewState.js').Verdict} Verdict */

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
 * (default). State is per-browser localStorage keyed by filter string;
 * the same key powers the play-page verdict bar.
 */
export function bootIdeas() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('ideas-list'));

  const state = loadReviewState();

  fetchCatalog('ideas')
    .then((/** @type {Idea[]} */ ideas) => {
      if (ideas.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'archive-empty';
        empty.textContent = 'No ideas yet.';
        listEl.appendChild(empty);
        return;
      }

      ideas.forEach((idea, i) => {
        const k = i + 1;
        const key = ideaKey(idea);
        // Carry kind + title so a superlative idea renders via its title (the
        // squares title path), not a parse of its absent criterion filter.
        const synthetic = /** @type {DailyPuzzle} */ ({
          n: k,
          kind: idea.kind,
          filter: idea.filter,
          title: idea.title,
          answers: [],
        });
        const tile = renderArchiveSquare(synthetic, {
          href: `./play.html?k=${k}`,
          ariaPrefix: 'Idea',
          difficulty: idea.difficulty,
        });
        if (idea.notes) {
          const link = tile.querySelector('a');
          if (link) link.title = idea.notes;
        }

        const paintVerdictClass = () => {
          const v = state.get(key);
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
            const current = state.get(key);
            if (current === target) state.delete(key); // toggle off
            else state.set(key, target);               // set or switch
            saveReviewState(state);
            paintVerdictClass();
          });
          return btn;
        };

        tile.appendChild(makeBtn('approved', '✓', 'Approve (mark as fine to promote)'));
        tile.appendChild(makeBtn('rejected', '✗', 'Reject (mark as not interested)'));

        listEl.appendChild(tile);
      });
      document.addEventListener('langchanged', () => refreshSquareCriteria());
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
