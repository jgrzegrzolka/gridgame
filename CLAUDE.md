# CLAUDE.md

## Where things live

The repo is feature-sliced — each game / explorer owns its folder:

- `flagQuiz/`, `findFlag/`, `flagsdata/`, `/` — one folder per page (HTML + sibling `page.js` + sibling `index.css`). The HTML is markup-only; `page.js` exports a `bootX()` function that the HTML calls inside a tiny `<script type="module">`.
- `flags/` — shared flag-domain code: country data (`countries.json`, `svg/`) and the game-mode engines (`quiz.js`, `engine.js`, `findFlag.js`, `group.js`). `engine.js` carries the shared primitives — category factories (`continent` / `hasColor` / `hasMotif` / `statehood`), the `validateCell` / `tryPick` cell mechanics that tic-tac-toe builds on, the 3×3 and 9×9 random-puzzle generators, and the country-search helpers (`suggest`, `exactSingleMatch`, `foldDiacritics`). Pure logic — no DOM, no `fetch`. All covered by `flags/*.test.js`.
- `common.css` — chrome shared across pages (nav corner cluster, burger panel, body defaults).

Rule of thumb: keep new code inside its feature folder. Promote something to `flags/` (or `common.css`) **only when the second consumer actually arrives** — speculative sharing locks the wrong shape.

## Hosting

- Production URL: **`https://www.yetanotherquiz.com`**. Apex `yetanotherquiz.com` 301-redirects to www via a Cloudflare Redirect Rule.
- Hosted on **Azure Static Web Apps** (Free SKU). Deployed by `.github/workflows/deploy.yml` on push to `main`; SWA-hosted hostname is `black-dune-0ebd24603.7.azurestaticapps.net` (don't link externally — use the custom domain).
- DNS sits on **Cloudflare**. The `www` CNAME (DNS only / grey cloud) points at SWA; apex A records are proxied (orange) so the apex→www Redirect Rule can fire.
- PartyKit's tic-tac-toe WebSocket server (`gridgame-ttt.jgrzegrzolka.partykit.dev`) is unrelated to SWA — its own deploy workflow (`deploy-partykit.yml`) sends it to Cloudflare. Don't conflate.
- **Naming convention:** code, pages, repo name, and `gridgame.*` `localStorage` keys all stay `gridgame` (historical). Azure resources (subscription, resource group, SWA name, Cosmos account, etc.) use `yetanotherquiz` because that's the public product framing. When wiring Azure-side things, pick `yetanotherquiz-...`; when editing code, leave `gridgame` alone.
- See `FEATURE.md` for in-progress hosting / Azure work and the full Azure resource inventory.

## API / Azure Functions

The site's HTTP API lives in `api/` and ships as part of the SWA deploy (no separate Function App resource).

- **Programming model:** Azure Functions **v4** programmatic. Each endpoint is a single file under `api/src/functions/<name>.js` that calls `app.http('name', { route, methods, authLevel, handler })`. No `function.json`, no central registry — files are auto-discovered via the glob in `api/package.json`'s `main`.
- **File layout:** `api/src/functions/` for endpoint files (thin handlers), `api/src/lib/` for pure logic + tests. Same rule as the rest of the repo: anything testable lives in a pure module with a `*.test.js` sibling. The handler is a shell that parses input, calls into `lib/`, and translates results to HTTP responses. Everything sits under `src/` because Oryx's v4 packaging walks the `main` graph and drops anything outside the resolved set — files at `api/lib/` would never reach the deployed runtime.
- **Module system:** `api/` is CommonJS (`require` / `module.exports`) — `api/package.json` **explicitly sets `"type": "commonjs"`**. This is not optional: Azure's runtime walks up looking for a `package.json` and (apparently) inherits the root's `"type": "module"` if api/'s doesn't pin its own — locally Node finds api/ first so this only ever bites in production. Symptom is `require()` returning `{ __esModule, default }` instead of your named exports.
- **Secrets:** SWA **app settings** (env vars at runtime — `process.env.NAME`). Set via `az staticwebapp appsettings set -n swa-yetanotherquiz -g rg-yetanotherquiz --setting-names NAME=value`. Never commit; local dev would use `api/local.settings.json` (gitignored).
- **Cosmos client:** we talk to Cosmos over plain HTTPS (`api/src/lib/cosmos.js`), not via `@azure/cosmos`. The SDK consistently triggered SWA's "Failure during content distribution" at deploy time, even after the type/minify/lib-path landmines from B2b were all closed — the working theory is that one of its transitive deps tickles a server-side packaging quirk we couldn't pin down. The REST surface we actually need is tiny (one POST per insert), the auth is HMAC-SHA256 with Node's built-in `node:crypto`, and we get clean HTTP status codes for 201/409/other. See `api/src/functions/dailyResult.js` for the pattern.
- **Azure quirk:** the underlying Function App is **managed by SWA** — it does not appear as a discrete resource in `rg-yetanotherquiz`. To view it: portal → `swa-yetanotherquiz` → **APIs** → click `(managed)`. Free SKU has no Premium plan / no warm instances; first request after ~20 min idle = ~1-2 s cold start. For a flag game this is fine.
- **Adding a new endpoint:** drop a new file in `api/src/functions/`, call `app.http(...)`. Push, deploy, done. No changes elsewhere.

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
- **Chrome buttons** (`.back`, `.coffee`, `.flags-link`, `.lang-toggle`, `.burger`) all use `box-sizing: border-box` so the 44 × 44 px slot stays the same regardless of border width. When adding a new chrome button, set `box-sizing: border-box` and space it 52 px from the next one (44 px slot + 8 px gap). Mixing `content-box` and `border-box` here causes the 2 px discrepancy that's hard to spot until you have several buttons in a row.

## Type-checking

- JSDoc-typed JS, checked by `tsc --noEmit`. Two configs:
  - `tsconfig.json` (strict) covers `flags/**/*.js` — the engine and tests where type safety has the most ROI.
  - `tsconfig.ui.json` (relaxed `strictNullChecks` / `noImplicitAny`) covers `**/page.js` — DOM glue where strict-mode ceremony around `getElementById` returning nullable wouldn't catch real bugs.
- `npm run typecheck` runs both. CI runs it on every push and PR.
- `npm run validate` runs tests + typecheck together — same gate CI enforces. Run this before pushing.
