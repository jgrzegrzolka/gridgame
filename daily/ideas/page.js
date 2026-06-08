import { t } from '../../i18n.js';
import { renderArchiveSquare } from '../squares.js';

/**
 * @typedef {Object} Idea
 * @property {string} filter
 * @property {string} [notes]
 * @property {number} [parkUntilN]
 */

/** @typedef {import('../../flags/daily.js').DailyPuzzle} DailyPuzzle */

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
 */
export function bootIdeas() {
  const listEl = /** @type {HTMLElement} */ (document.getElementById('ideas-list'));

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
        listEl.appendChild(tile);
      });
    })
    .catch((err) => {
      listEl.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });
}
