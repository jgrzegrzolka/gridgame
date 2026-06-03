# CLAUDE.md

## Where things live

The repo is feature-sliced — each game / explorer owns its folder:

- `flagQuiz/`, `flagGrid/`, `findFlag/`, `flagsdata/`, `/` — one folder per page (HTML + sibling `page.js` + sibling `index.css`). The HTML is markup-only; `page.js` exports a `bootX()` function that the HTML calls inside a tiny `<script type="module">`.
- `flags/` — shared flag-domain code: country data (`countries.json`, `svg/`) and the game-mode engines (`quiz.js`, `grid.js`, `findFlag.js`, `group.js`). Pure logic — no DOM, no `fetch`. All covered by `flags/*.test.js`.
- `common.css` — chrome shared across pages (nav corner cluster, burger panel, body defaults).

Rule of thumb: keep new code inside its feature folder. Promote something to `flags/` (or `common.css`) **only when the second consumer actually arrives** — speculative sharing locks the wrong shape.

## Tests

- **Anything that can be tested should be tested.** Pure logic — game engines, reducers, validators, puzzle generators — must have unit tests. If you find yourself writing logic that isn't covered, either add a test or move the logic somewhere it can be tested.
- Tests live next to the module they cover as `*.test.js` (e.g. `flags/quiz.test.js`, `ticTacToe/onlineClient.test.js`), run with `npm test` (Node's built-in `node --test`).
- When changing logic in any tested module, update or add the matching test in the same change.
- Run `npm test` before finishing a change.
- The page-level `page.js` files are mostly DOM + `fetch` glue and aren't unit-tested — keep them thin and push reusable logic down into a sibling module (or `flags/*.js` if shared) where tests apply. "I can't test this" is a smell: it usually means the logic is in the wrong file.

## UI consistency between pages

- Pages that share a class name or a feature pattern must look and behave the same. Inconsistency is a bug.
- **Same mechanism = same code.** If two games both implement "give-up reveal", "wrong-answer shake", "winning highlight", or any other named UI behavior, the CSS (and JS where possible) must live in one shared place — `common.css`, `flags/*.js`, etc. — and both consumers reference it. Copy-pasting a rule into a second feature stylesheet is the bug; even if the copies are byte-identical today they will drift, and partial copies (only the outline, not the bounce) are how user-visible inconsistencies are born.
- Before adding or changing a UI element on one page, grep the other pages for the same class / element and match the existing pattern.
- If you find yourself about to copy a CSS rule from one feature stylesheet into another, **stop** — promote the rule to `common.css` (or a shared module) and delete the source copy too. The exception is feature-specific tweaks (e.g. `.cell.exhausted` for 9×9 only) where the *behavior itself* doesn't exist elsewhere.
- Prefer the shared rule in `common.css`. If a per-feature stylesheet overrides a shared rule, that override is suspect — confirm it's intentional or remove it.
- When fixing inconsistency, prefer **deleting the override** over adding more overrides on the other pages.

## Type-checking

- JSDoc-typed JS, checked by `tsc --noEmit`. Two configs:
  - `tsconfig.json` (strict) covers `flags/**/*.js` — the engine and tests where type safety has the most ROI.
  - `tsconfig.ui.json` (relaxed `strictNullChecks` / `noImplicitAny`) covers `**/page.js` — DOM glue where strict-mode ceremony around `getElementById` returning nullable wouldn't catch real bugs.
- `npm run typecheck` runs both. CI runs it on every push and PR.
- `npm run validate` runs tests + typecheck together — same gate CI enforces. Run this before pushing.
