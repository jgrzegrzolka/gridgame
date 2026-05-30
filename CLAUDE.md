# CLAUDE.md

## Tests

- Tests live in `flags/*.test.js`, run with `npm test` (Node's built-in `node --test`).
- When changing logic in `flags/group.js` or `flags/quiz.js`, update or add the matching test.
- Run `npm test` before finishing a change.
- HTML/CSS and `<script type="module">` blocks inside HTML files aren't reachable by `node:test`. If you're adding branching logic to a page's inline script, prefer extracting the pure part into `flags/quiz.js` (or a sibling module) so it gets the same test treatment.
