# Performance journal

A running log of performance problems observed on `yetanotherquiz.com` and what was done about each one. Read this before adding the next perf fix — many of these are interlinked, and several "obvious" fixes have already been tried, ruled out, or reversed.

For the live topology see `infra/operations.md`. For the time-ordered story of architecture decisions across all features see `FEATURE.md`. This file is the narrower perf-only thread.

## Background characteristics

The constraints that shape every fix below:

- **SWA Free SKU origin in West US 2.** Static-content fetches take ~150–200 ms TTFB from Europe even when fast. Cold-fetches against this origin have been observed as slow as **2 s for 3 KB HTML** and **21 s for individual flag SVGs**. No warm pool on Free SKU.
- **Cosmos in West Europe + SWA in West US 2.** ~300 ms cross-region hop on every API call (Free Tier locked to a single region; see operations.md). Treat the API as inherently slow — pre-cache where it matters.
- **Cloudflare in front of `www`.** HTML cached up to 2 h via Cache Rule, assets cached forever per-URL once seen. **CF caches per-POP**, so the first visitor in each region pays the cold-edge fetch independently.
- **Static assets are URL-versioned** (`?v=<sha>` from `scripts/cache-bust.mjs`). Browsers cache them for a year (`max-age=31536000`); **SVGs** are additionally `immutable`, while **JS/CSS/JSON** carry `s-maxage=600` so Cloudflare's edge revalidates them every 10 min (see 2026-07-01 entry — `immutable` on the code assets caused a deploy-time edge-poisoning bug). Served via `staticwebapp.config.json`.

## Journal (newest first)

### 2026-07-08 — Pan revealed a blank strip → dropped the GPU-transform gesture layer

**Symptom.** Panning the map (quiz result, flagsdata) to reveal a region that was off-screen showed the newly-exposed strip as blank / un-rendered for the duration of the drag; it only filled in on release. Jan: "the part that was not previously visible is rendering and feels weird." Not a throughput problem — a *reveal* artifact.

**Diagnosis.** The `.is-interacting` gesture layer (PR #701, refined 2026-07-06) held the viewBox frozen at the gesture's start view and slid the whole SVG as one GPU-composited layer via `style.transform`. A transform can only move pixels that were *already painted* — so panning past the start-of-gesture viewBox exposed the container behind the layer (blank), and the real region only appeared when settle baked the transform into a real viewBox and repainted. Confirmed by freezing a mid-drag transform: a clean blank band on the leading edge over map that plainly exists.

**Why the transform was safe to drop.** Its whole reason for existing was to avoid re-rasterising the ~255 flag `<image>` patterns every frame. But `.is-interacting` *already* drops every flag to a flat solid fill (the green/red correctness wash / flagsdata yellow) for the duration of a move — so during a gesture there are **no flag images to raster**. Measured the actual per-frame cost of re-rendering the real viewBox with only contours + solid fills (CDP trace, `visible` page): native Paint **max 2.1 ms desktop, 8.2 ms @4× CPU throttle, 23.9 ms worst-frame @6×** (p50 ~1 ms) — comfortably inside frame budget on any normal device. (An early `drawImage`+`getImageData` proxy screamed 60–200 ms; that's a 2D-canvas software-raster + readback artifact, not how the browser paints the live SVG. Trace, not proxy.)

**Fix.** In-page pan/zoom now re-renders the real `viewBox` once per frame (coalesced to one flush per rAF), exactly like fullscreen already did — the transform path is gone. A pan always paints the region it moves into; no blank strip, and no zoom-blur either (the transform magnified a stale bitmap until settle). Removed `viewBoxTransform`, `paintTransform`, `useTransformPath`, the cached gesture-box math in `gesturePivot` / `gestureUnitsPerPixel` (now plain `screenToSvg` / `svgUnitsPerPixel` on the clean CTM), `committedVB`, and the orphaned `isFullscreen`. Net −131 lines. Verified with a real drag: mid-gesture `style.transform` is empty, the viewBox pans, and all flagged countries render as the solid wash (0 images, 0 blank).

**Trade-off.** On a genuinely low-end phone (6× throttle) the *worst* pan frame is ~24 ms — an occasional dropped frame during a fast fling, vs the transform's zero-cost-but-blank motion. Correct rendering beats a blank strip, and fullscreen has ridden this exact per-frame path without complaint. **Do not re-introduce the transform to shave that worst frame** — it brings the blank-reveal back, and the base-contour cache that would keep the transform *and* fix the blank (pre-render the grey map with a margin) was measured as not worth the complexity for a 2–8 ms cost. If low-end fling smoothness ever genuinely bites, the base-contour bitmap cache is the lever, not the transform.

### 2026-07-06 — Map pan/zoom stutter → dominant-colour tint while moving

**Symptom.** Panning/zooming the flag map (`/flagsdata/` and the quiz end-of-game view) stuttered. The `.is-interacting` GPU-transform layer (PR #701) already holds the viewBox and moves the whole SVG as one composited layer, so the *movement* is free — but the map still didn't feel fluid.

**Diagnosis.** The cost is **rasterizing the flag images**, and it's proportional to *how many flags are on the map*, not how complex each one is. Every answered / filtered country is filled with an `<image href="…svg">` pattern; building the composited layer at gesture start has to decode and raster all of them (~255 on a full flagsdata view). The heavy coats of arms (Serbia 177 KB, Mexico 356 paths) dominate, but even the simple bicolours add up. The old fix greyed *every* flagged country while moving (`fill:#f9f9f9`) precisely because a flat fill means **zero flag images to raster** — that's why grey was smooth. A prototype that showed emblem-less "plain" flag variants during motion was abandoned: a plain tricolour is still an `<image>` pattern, so it doesn't lower the image count that is the actual cost.

**Fix.** Replace the flat grey with a per-country **dominant-colour tint** (`--flag-tint`, set in `flagMap.js` from `flags/flagTints.js`; CSS fills `.is-interacting .is-flagged` with it). A solid colour costs the browser exactly what grey did — no image decode — so motion stays as smooth as the grey baseline, but the map reads as a colourful world instead of a grey one. Full flags snap back on settle (one repaint, while stopped).

**Regenerating the tints.** `flags/flagTints.js` is generated, not hand-authored. To rebuild it (e.g. when the flag set changes): serve the repo, and in a browser rasterize each `flags/svg/<code>.svg` to a small canvas, bucket the pixels, and pick the colour with the highest `area × saturation × brightness` — the brightness/saturation weighting stops a black or white band (which reads as saturation 1.0 for a near-black like `#000001`) from winning over the real colour. Near-white-only flags (e.g. Afghanistan's white field) fall back to a visible light grey so the country isn't invisible on the page. The one-shot sampler script lives in the PR #703 discussion; keep the output sorted and formatted `~6 per line`.

**Trade-off.** One dominant colour per flag loses the *layout* — a multi-colour flag shows a single block (Germany gold, Mexico red, Ukraine yellow), picked by area×saturation×brightness. Acceptable for a transient moving state; a per-country override in `flagTints.js` is a one-line edit if a specific pick reads wrong. If a single colour ever feels too flat, the next cheap step up (still no images) is a hard-stop gradient for the purely-striped flags.

### 2026-07-01 — `immutable` on versioned assets → a poisoned edge entry stuck for a year

**Symptom.** After the Poland flag-story fix deployed (PR #637), the `/flagsdata/` story popup kept rendering the *old* 3-step timeline (the broken cockade) for every visitor — even in incognito, even hours after the deploy succeeded. The intro text updated (it comes from i18n JSON) but the timeline (from `flagFacts.js`) did not.

**Diagnosis.** The origin file was correct, but Cloudflare's edge had cached the **versioned** URL `flags/flagFacts.js?v=705ccb9` with the *pre-fix* bytes. Proof: fetching the unversioned origin path returned the new 2-step, while `import()`ing the exact `?v=705ccb9` URL the page uses returned the old 3-step (cockade + the removed `space` fact). Mechanism: every deploy stamps assets `?v=<sha>` and served them `immutable` — but the `?v=<sha>` query does **not** change which bytes SWA serves for `/flags/flagFacts.js` (SWA ignores the query; it serves whatever the file currently is). Azure SWA's custom-domain edge lags the HTML flip by minutes (see the deploy smoke-check note about 15-min propagation). In that window CF fetched `?v=705ccb9` while SWA was still serving the old file, and `immutable` told CF to hold those stale bytes for a **year** with no revalidation. The `?v=<sha>`-orphans-old-entries assumption (2026-06-12 entry) only holds if the *new* versioned URL always returns *new* bytes — the edge-lag window breaks that.

**Fix.** Split the `staticwebapp.config.json` cache rule. SVGs keep `immutable` (stable filenames, content never changes, and revalidating each flag would reintroduce the 2026-06-12 cold-fetch storm). JS/CSS/JSON now use `public, max-age=31536000, s-maxage=600`: browsers still cache a year (they use `max-age`, and the URL changes every deploy), but CF honours `s-maxage` and revalidates the edge copy every 10 min via a conditional GET (SWA sends an ETag → cheap `304`). So a stale-during-lag entry now self-heals in minutes instead of a year — **no manual purge on deploy**. Merging this config change is itself a shipped-file deploy, which re-mints the versioned URLs and orphans the poisoned `?v=705ccb9`.

**Trade-off.** Each active CF POP now does one background-ish conditional GET per code asset per 10 min. On the Free SKU origin that revalidation can occasionally be slow, but it's a `304` (no body) and vastly cheaper than a year of stale correctness bugs. If the periodic revalidation ever shows up as a cold-asset stall, the next step is a deploy-time targeted purge of the changed `?v=<sha>` URLs *after* the smoke-check confirms the edge has settled — keeps `immutable` perf, closes the race explicitly, but adds workflow complexity (needs the changed-file list captured before `.git` is stripped from the artifact).

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
