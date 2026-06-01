# CLAUDE.md

## Where things live

The repo is feature-sliced — each game / explorer owns its folder:

- `flagQuiz/`, `flagGrid/`, `findFlag/`, `flagsdata/`, `/` — one folder per page (HTML + sibling `page.js` + sibling `index.css`). The HTML is markup-only; `page.js` exports a `bootX()` function that the HTML calls inside a tiny `<script type="module">`.
- `flags/` — shared flag-domain code: country data (`countries.json`, `svg/`) and the game-mode engines (`quiz.js`, `grid.js`, `findFlag.js`, `group.js`). Pure logic — no DOM, no `fetch`. All covered by `flags/*.test.js`.
- `common.css` — chrome shared across pages (nav corner cluster, burger panel, body defaults).

Rule of thumb: keep new code inside its feature folder. Promote something to `flags/` (or `common.css`) **only when the second consumer actually arrives** — speculative sharing locks the wrong shape.

## Tests

- Tests live in `flags/*.test.js`, run with `npm test` (Node's built-in `node --test`).
- When changing logic in any `flags/*.js`, update or add the matching test.
- Run `npm test` before finishing a change.
- The page-level `page.js` files are mostly DOM + `fetch` glue and aren't unit-tested — keep them thin and push reusable logic down into `flags/*.js`.

## Type-checking

- JSDoc-typed JS, checked by `tsc --noEmit`. Two configs:
  - `tsconfig.json` (strict) covers `flags/**/*.js` — the engine and tests where type safety has the most ROI.
  - `tsconfig.ui.json` (relaxed `strictNullChecks` / `noImplicitAny`) covers `**/page.js` — DOM glue where strict-mode ceremony around `getElementById` returning nullable wouldn't catch real bugs.
- `npm run typecheck` runs both. CI runs it on every push and PR.
- `npm run validate` runs tests + typecheck together — same gate CI enforces. Run this before pushing.
