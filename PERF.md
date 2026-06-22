# Performance journal

A running log of performance problems observed on `yetanotherquiz.com` and what was done about each one. Read this before adding the next perf fix — many of these are interlinked, and several "obvious" fixes have already been tried, ruled out, or reversed.

For the live topology see `infra/operations.md`. For the time-ordered story of architecture decisions across all features see `FEATURE.md`. This file is the narrower perf-only thread.

## Background characteristics

The constraints that shape every fix below:

- **SWA Free SKU origin in West US 2.** Static-content fetches take ~150–200 ms TTFB from Europe even when fast. Cold-fetches against this origin have been observed as slow as **2 s for 3 KB HTML** and **21 s for individual flag SVGs**. No warm pool on Free SKU.
- **Cosmos in West Europe + SWA in West US 2.** ~300 ms cross-region hop on every API call (Free Tier locked to a single region; see operations.md). Treat the API as inherently slow — pre-cache where it matters.
- **Cloudflare in front of `www`.** HTML cached up to 2 h via Cache Rule, assets cached forever per-URL once seen. **CF caches per-POP**, so the first visitor in each region pays the cold-edge fetch independently.
- **Static assets are URL-versioned** (`?v=<sha>` from `scripts/cache-bust.mjs`) and served `Cache-Control: public, max-age=31536000, immutable` via `staticwebapp.config.json`. Once a versioned URL is fetched, the browser never re-validates.

## Journal (newest first)

### 2026-06-22 — WebP thumbnails for every flag

**Symptom.** Daily result panel stalled visibly for 2-5 s on a fast connection — many flag `<img>` requests in flight at once, page mostly blank while it loads. Reported by Jan after finishing today's puzzle.

**Diagnosis.** The result panel renders found / missed tiles + the extra-stats rail (most-guessed, most-missed) all in one shot — 15-25 flag SVGs requested in parallel. Brotli was already on (Cloudflare auto-compresses `image/svg+xml`) and cache headers were maximal (`max-age=31536000, immutable`). But a handful of flags carry dense coat-of-arms path data that doesn't compress further: rs Serbia 178 KB on disk → 52 KB brotli'd; sh-ta 289 KB → big chunk on wire; bo Bolivia 101 KB; mx Mexico 83 KB; es Spain 80 KB; sv El Salvador 76 KB. Whenever today's puzzle answers + the wrong-guess rail surfaced two or three of those, the result panel waited on them. `svgo --multipass` shaved 0-3 % — they were already minimal-path. The bloat was genuine artwork detail that can't be compressed away.

**Fix.** Added `scripts/build-webp.mjs` (sharp at 300 px wide, q80) that converts every `flags/svg/*.svg` to `flags/webp/{code}.webp`. Run via `npm run build:webp`, output committed to the repo (same pattern as the SVGs themselves). Every thumb-sized consumer swapped from SVG → WebP: daily in-game + result + extra-stats, findFlag tiles, flagsdata grid, flagQuiz choices, ticTacToe cells (3×3 + 9×9, online + offline), home-page tile previews. **Zoom dialogs kept SVG** so click-to-expand still gets vector quality at full screen. Total catalog: SVG 2221 KiB → WebP 810 KiB (36 %); worst offenders shrank ~95-98 % (rs 178 → 5.5 KB; sh-ta 289 → 7 KB; bo 101 → 2.2 KB).

**Pinned.** `flags/countries.test.js` now asserts every code in `countries.json` has both an `svg/{code}.svg` AND a `webp/{code}.webp`. Forgetting to re-run `build:webp` after adding a flag surfaces in CI rather than as a prod 404 on the result rail.

**Trade-off / open caveats.** Two asset formats per flag means slightly more friction when adding a country (must remember `npm run build:webp` — the test catches it). WebP support is universal on modern browsers (97 %+ caniuse); the < 3 % on pre-2020 Safari see broken image icons rather than a fallback — acceptable for a hobby site. The fix doesn't help the OG banner or other raster assets, but flags were the only material image-perf opportunity (audited at the time).

### 2026-06-13 — Lang-toggle flag blank on cold load until module graph resolves

**Symptom.** On a cold visit after deploy the `#lang-toggle` button paints empty for several hundred ms after CSS arrives; the flag fills in only once the deferred `i18n.js` module graph (transitively pulling `flags/group.js`, etc.) has finished cold-fetching and `bootI18n()` runs. Visible to Jan on every deploy as "the pl/eng button loads slowly."

**Diagnosis.** The flag is CSS-driven from the `data-current` attribute, and `data-current` was previously set inside `bootI18n()` — which lives inside `<script type="module">`, auto-deferred so it only runs after every imported module fetches and parses. The synchronous paint that already existed inside `bootI18n` was already too late by the time it ran.

**Fix.** Inline non-module `<script>` immediately after the `<a id="lang-toggle">` element on every page (17 files). Runs synchronously while the parser passes by — before any module imports start — so the flag is set as soon as CSS paints the button. Removed the now-redundant synchronous block inside `bootI18n()`. Pinned the contract with a `chrome.test.js` assertion so a new page that adds `#lang-toggle` can't silently regress by forgetting the script.

**Trade-off.** ~17 lines of HTML duplicated 17 times. Sharing via a module would defeat the purpose (modules are deferred). A synchronous external `<script src>` would block parsing on its own cold fetch, paying the round-trip we're trying to skip. The duplication is intentional; the chrome guard prevents drift.

**Open follow-ups.** Lang-toggle was the visible symptom but the same waterfall (HTML → CSS → modules → bootI18n → first useful action) shapes every other first-paint element on cold load. Next-likely is `<link rel="modulepreload">` for each page's known import graph so the modules fetch in parallel with CSS instead of after `i18n.js` parses; then CF Tiered Cache for the per-POP cold tail (see below).

### 2026-06-12 — CF HTML cold on first post-deploy visit (~2 s)

**Symptom.** After every deploy, the first visit to any of the 12 entry-point HTML pages took ~2 s TTFB to serve 3 KB of HTML; the same page on hard reload was instant. Pattern visible to Jan personally on every deploy. Real users would not hard-reload.

**Diagnosis.** `deploy.yml` purges CF's HTML cache for the 12 URLs after each deploy (necessary so users don't see up to 2 h of stale HTML referencing old `?v=<sha>` assets). The next visitor cold-fetches from CF → SWA Free SKU origin (WUS2 → Europe is slow). Hard reload "fixes" it because CF's edge has been warmed by the slow first attempt. The existing smoke-check step does NOT double as warming because it deliberately uses `?_=<sha>` to bust the cache (it's verifying SWA serves *fresh*, not CF *warm*).

**Fix.** Added a "Warm Cloudflare HTML cache" step in `deploy.yml` after the smoke check that curls each of the 12 entry-point URLs *without* a query string. Populates CF's edge cache at the keys real visitors hit.

**Open caveat.** CF caches per-POP — warming from GitHub's runner POP only primes that one POP. Users in other regions still cold-fetch on first visit. If the symptom persists for Jan in Poland after this lands, the next step is enabling **CF Tiered Cache** (free feature) so lower-tier POPs pull from the warmed upper-tier POP instead of going all the way back to SWA.

### 2026-06-12 — Parallel SVG fetch storm exposed by `purge_everything` (a6884da)

**Symptom.** Post-deploy, quizzes loaded with only some flag tiles rendered. Network panel showed many SVG requests stuck pending; CF returned 524s on individual flag SVGs; one flag SVG observed at 21 s.

**Diagnosis.** Deploy was calling Cloudflare `purge_everything`, wiping the edge cache for every flag SVG along with the HTML. The next visitor fired off ~200 parallel SVG fetches against a fully-cold CF edge → all hit SWA origin simultaneously, hitting Free SKU's per-file latency spikes and CF's 524 gateway-timeout threshold.

**Fix.** Now only the 12 HTML URLs are purged. SVG/JS/CSS asset caches survive deploys because: JS/CSS/JSON references are URL-versioned (new HTML points at URLs CF has never seen → old entries orphan and evict naturally); SVG filenames are stable, and on the rare occasion one changes a targeted manual purge is acceptable.

### 2026-06-12 — Versioned assets weren't actually being long-cached (438c834)

**Symptom.** Returning visitors revalidated every JS/CSS/JSON file every 4 h despite all URLs being versioned. Network showed `CF-Cache-Status: MISS` on assets that should have been hot.

**Diagnosis.** SWA's default for these files was `max-age=14400, must-revalidate`. CF respects origin Cache-Control, so it wasn't holding them longer either. Effectively no edge cache benefit even though every URL was versioned.

**Fix.** Added `staticwebapp.config.json` route applying `Cache-Control: public, max-age=31536000, immutable` to `*.{js,css,json,svg}`. URLs are versioned by `scripts/cache-bust.mjs` so they're inherently immutable; SVG filenames are stable.

**Side fix in the same commit.** Removed the home-page block (`8d72fb0`, *Home page: preload all flag SVGs while the user reads the menu*) that fetched `countries.json` and fired `new Image()` for every flag in the pool — ~2.2 MB of speculative SVG fetches on landing for zero first-paint benefit. The home page shows zero flags; the four game tiles are CSS icons. This was a previously-shipped "perf win" that turned out to be cost without benefit once each game preloaded its own pool on entry.

### 2026-06-12 — Quiz: dropped preload-everything for just-in-time prefetch (583a6e8)

**Trajectory.** `f69491c` (*Flag Quiz: preload SVGs on start so questions render instantly*) shipped a "preload the whole pool up front" approach. Reversed here: prefetch only the *next* round's flags as the current round resolves, so bandwidth tracks engagement instead of being paid up front.

### 2026-06-12 — TTT: half-grid render gap on room entry (7e4c431, 00bf422)

**Symptom.** Entering a TTT room (online or offline) flashed a half-built grid for a frame before fully rendering.

**Fix.** Build the empty grid skeleton immediately on `enterRoom`, populate cells as data arrives. Done for both online and offline modes.

### Earlier (history, terse)

Pull commit messages for full context with `git show <sha>`.

- `6b16914` — *ops: purge Cloudflare cache after each deploy*. Initial purge step. Refined later to HTML-only (a6884da, above) once parallel-fetch storm was understood.
- `13b550e` — *fix: B4 — bypass server cache on the post-finish GET (`?fresh=1`)*. Daily-stats GET needs fresh data immediately after submit; default cache hides the user's own submission from themselves.
- `8bf2fd1` — *feat: B3 — GET /api/v1/daily/stats/{puzzleId} with 60s cache*. 60 s server-side cache on the stats endpoint to keep RU/s low on hot puzzles.
- `8cf6bb5` — *feat: daily stats — loading indicator + Turnstile preload*. Visual loader for the inherently-slow cross-region API hop; preloading Turnstile so the widget isn't a finish-time bottleneck.
- `494fb48` — *deploy: cache-bust shared JS modules and JSON fetches too*. Extended `__BUILD__` HTML rewrite with a JS-walk pass to version sub-imports and runtime `fetch()` paths — without this, a fresh `page.js?v=<sha>` would static-import the OLD cached `quiz.js`.
- `db3eaca` — *Cache-bust HTML imports with `__BUILD__` → commit SHA at deploy time*. The original cache-bust mechanism.
- `19b8b97` — *Perf quick wins: drop no-cache, preload countries, dns-prefetch, deploy-minify*. Foundational batch.

## Open / next-likely fixes

- **CF Tiered Cache** (free feature). Would let the post-deploy warming step prime an upper-tier POP that other POPs pull from on miss, instead of every cold POP going all the way to SWA. Try this if "~2 s on first visit from my region" persists for Jan after the 2026-06-12 warming step lands.
- **Short HTML TTL + no purge** as an alternative shape. Set HTML to `Cache-Control: s-maxage=300, max-age=0` and stop purging CF on deploy. Trades ~5 min of post-deploy staleness for never paying the cold-fetch penalty on entry-point HTML. Daily puzzle release runs on a Logic App at 00:05 Warsaw, not on demand, so a 5-minute staleness window is acceptable.
- **SWA Standard SKU** ($9/mo). Last resort. The Free SKU's lack of warm instances is the origin floor; a paid tier would remove the 2-s cold-fetch penalty at the source. Not justified until traffic does.
- **`findFlag` fetch storm at game start.** Even with `loading="lazy"` on `<img>` tiles, once the user scrolls (or many tiles are in the initial viewport on desktop) the page fires off hundreds of SVG fetches in parallel. Not currently broken given the warm CF asset cache, but architecturally fragile — if CF cold for any reason, this is the failure mode that bites first. Possible mitigations if it ever resurfaces: sprite-sheet the flags, batch the preloads, or render placeholder shapes until the user actually focuses a tile.
