---
name: verify-flag-map-ui
description: Recipe for verifying any change to the flagQuiz contour-map rendering (microstate rings, viewBox crops, hit-target positions, fullscreen behaviour) via Playwright MCP against the local dev server. Covers the load path, the flagsdata-fullscreen trick that magnifies microstate clusters, the read-cx/cy probes that prove ring positions without trusting pixels alone, and the four Playwright-specific gotchas that ate two PRs (HTTP cache holding stale modules, Fullscreen API needing a real user gesture, ref reshuffling between snapshots, screenshot dropping fullscreen). Use whenever a change touches `flagQuiz/flagMap.js`, `flagQuiz/mapZoom.js`, `worldMap.svg`, `europeMap.svg`, or any per-continent crop / microstate / hit-target logic — unit tests alone shipped two regressions (PR #611 / PR #612).
---

# Verify flag-map UI via Playwright MCP

Unit tests pin pure logic (offsets, viewBox math, microstate tagging). They don't catch "the rings overlap a real island in fullscreen" or "the Caribbean cluster pushed off the Lesser Antilles" — those need a real browser. This skill is the recipe for that browser pass.

## When this skill applies

Any time a change touches the rendered map and a reasonable reviewer might ask "is that still on the right island":

- `flagQuiz/flagMap.js` — hit-target positions, microstate tagging, viewBox cropping.
- `flagQuiz/mapZoom.js` — pan / zoom / fullscreen behaviour.
- `flagQuiz/worldMap.svg` or `flagQuiz/europeMap.svg` — geometry edits.
- New variants / continents added to `MAP_CONFIG` in `flagQuiz/page.js` or `flagsdata/page.js`.
- Changes to `addHitTargets` / `cropToCountries` / `tagMicrostates` / `rescaleHitTargets`.

PRs that landed broken because the author only ran `npm test`:

- PR #611 → fix in #612 → fix in this one. The "rings sit on real islands" claim survived unit tests three times because the unit tests asserted the offset/math but never that the result landed on a landmass.

Do not skip this skill when "the change is tiny" — tiny offset changes can push a Caribbean ring off into open water at world-view radius (~19 vbu) while leaving every unit test green.

## The verification flow

### 1. Boot the dev server

```
npm run dev        # full stack
npm run dev:swa    # site + API + Azurite, no PartyKit — fine for any map work
```

If port 4280 is already taken, the script aborts. Run `Invoke-WebRequest -UseBasicParsing http://localhost:4280/ -TimeoutSec 2` first — if it 200s, an existing dev server is fine to reuse, don't spawn a second one.

### 2. Pick the verification surface

Two pages render the same `mountFlagMap` output. **For microstate ring positions, prefer flagsdata** — it gives you a global highlight filter (any colour pill) that visually marks any subset of countries as filled discs without having to play through a quiz round.

| Surface | URL | Best for |
| --- | --- | --- |
| `flagsdata/` | `http://127.0.0.1:4280/flagsdata/` | Inspecting microstate rings, dense clusters, any "are these two rings distinct" question. Click a Continent pill + a Colour pill to highlight a subset. |
| `flagQuiz/` | `http://127.0.0.1:4280/flagQuiz/?v=countries&n=20` | Verifying play-mode behaviour, the play-time `markCountry` paints, `.is-finished` review state. |

**Always use `http://127.0.0.1:4280`, never `http://localhost:4280`.** The SWA dev server sends `Cache-Control: public, max-age=31536000, immutable` on every static file. After an edit, `localhost:4280` will keep serving the cached old `flagMap.js` to Playwright for a year. Switching origin to `127.0.0.1:4280` is a different cache namespace and gets you the fresh file. (`browser_close` does NOT clear this — the disk cache survives the close.)

### 3. The flagsdata + fullscreen recipe (microstate clusters)

This is the workflow Jan uses by hand to see Caribbean / Lesser-Antilles / Pacific microstate clusters at zoom:

1. Navigate to `http://127.0.0.1:4280/flagsdata/`.
2. Click a Continent pill (`North America`, `Oceania`, `Asia`, …) to filter the tile grid and to crop the map's viewBox to that continent.
3. Click a Colour pill (`violet`, `orange`, …) to mark a sparse subset of countries as filled discs on the map. Helpful for landmarking — e.g. Dominica's violet flag makes it the only solid disc in the Antilles chain.
4. Click the `⛶` "Toggle fullscreen" button at the top-right of the map to expand it to the viewport. Pinch-zoom or wheel-zoom into the cluster you care about.

When automating this in Playwright MCP, steps 2-3 work via `getByRole('button', { name: '…' })` clicks, **but step 4 will silently fail**: the browser's Fullscreen API requires a real user gesture, and Playwright `evaluate`-driven `.click()` doesn't satisfy that constraint. See the workaround in §5.

### 4. Read the ground truth, not just the picture

Pixel screenshots are necessary but not sufficient. Always pair them with a `browser_evaluate` that reads the SVG attributes directly — the cx/cy/r values are the source of truth for "is this ring where I think it is".

```js
// Find the world map (not the logo SVG which also lives on the page).
const map = Array.from(document.querySelectorAll('svg')).find(s => s.querySelector('#mf'));
const codes = ['mf', 'sx', 'ai', 'bl']; // whatever country IDs you're checking
const hits = map.querySelectorAll(codes.map(c => `[data-hit-for="${c}"]`).join(','));
const out = { viewBox: map.getAttribute('viewBox') };
for (const h of hits) {
  out[h.getAttribute('data-hit-for')] = {
    cx: h.getAttribute('cx'),
    cy: h.getAttribute('cy'),
    r: h.getAttribute('r'),         // scaled by rescaleHitTargets for current crop
    baseR: h.getAttribute('data-base-r'), // natural-viewBox radius
  };
}
return out;
```

What to compare:

- **Distinct centers.** Two rings with identical `cx`/`cy` are stacked — only the topmost is clickable. Any pair < 1 vbu apart is effectively stacked at world view (`baseR ≈ 19`).
- **Centers on land.** A `cx`/`cy` 10+ vbu off the underlying `#code` path's bbox means the ring sits in open water — bad. The acceptable offset budget is roughly `baseR` (~19 vbu at world view); past that the ring stops looking like it belongs to the country.
- **`r` shrinks with crop.** If `r === baseR` after a continent crop, `rescaleHitTargets` didn't fire — the rings will appear huge and overwhelm neighbouring countries.

For the mf/sx case: before the fix, `mf` cy was 542.137 and `sx` cy was 542.447 — 0.31 vbu apart, perfectly stacked at world view. After, mf cy is 537.137 (N) and sx cy is 547.447 (S) — 10.3 vbu apart, distinct at every zoom level.

### 5. The screenshot trick (faking fullscreen)

Playwright can't drive the browser's Fullscreen API. To screenshot the map at fullscreen-equivalent magnification, apply the same end-state directly: pin the section to fill the viewport and force the `slice` preserveAspectRatio that the real fullscreen path uses (see `addFullscreenButton` in `flagQuiz/flagMap.js`).

```js
const section = document.getElementById('flag-map-section');
Object.assign(section.style, {
  position: 'fixed', inset: '0', zIndex: '9999',
  width: '100vw', height: '100vh', background: '#fafafa',
});
const svg = section.querySelector('svg');
svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
```

Then for a tight crop on a microstate cluster, narrow the SVG's `viewBox` further before the screenshot — this is the equivalent of pinching into the cluster:

```js
const map = Array.from(document.querySelectorAll('svg')).find(s => s.querySelector('#mf'));
map.setAttribute('viewBox', '815 525 30 30'); // Saint Martin neighbourhood
```

Screenshot via `mcp__playwright__browser_take_screenshot { type: png, filename: '…' }`. Output lands in `.playwright-mcp/` (gitignored).

### 6. The Playwright-MCP gotchas

These are the foot-guns you'll hit, in order of how often they bite:

1. **HTTP cache holds the old module.** Symptom: you edited `flagMap.js`, ran `npm test`, navigated, the rendered cx/cy is still the pre-edit value. Cause: SWA dev's 1-year immutable cache header (see `staticwebapp.config.json`). Fix: navigate via `127.0.0.1:4280` instead of `localhost:4280` (different cache namespace). Verify-without-doubt: `await fetch('/flagQuiz/flagMap.js', { cache: 'no-store' })` from inside `browser_evaluate` will always return the truth from the server — if that says NEW but the page sees OLD, it's the module cache. Note that ONCE you've visited a given origin, even that origin's cache is locked from that point — switching back to `localhost` after `127.0.0.1` is useless. Always pick the fresh origin first.

2. **Fullscreen API needs a real gesture.** Clicking the `⛶` button via Playwright `getByRole(...).click()` doesn't enter fullscreen. The button registers as clicked, but `document.fullscreenElement` stays null. Use the fake-fullscreen recipe in §5 instead.

3. **Snapshot refs reshuffle between calls.** A `browser_snapshot` gives you `[ref=e27]` for "North America". After the next click (which mutates the DOM), `e27` may now be a different button — `browser_click({ target: 'e27' })` will land on the wrong control. Either snapshot again before each click, or skip refs entirely and click by visible text:
   ```js
   const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'North America');
   b?.click();
   ```

4. **Screenshot can drop fullscreen.** Even when fullscreen is real, the screenshot driver sometimes triggers a context switch that exits it. The fake-fullscreen recipe in §5 sidesteps this entirely.

5. **DOM-presence is not the same as render-presence.** A `browser_evaluate` that finds your new element with the right attributes is NOT proof it renders. A pixel screenshot is. Specifically: `flags/flagMap.css` carries `#flag-map-section svg line:not(.map-hit-leader) { display: none }` to hide the world-map's bundled coastline labels. ANY new `<line>` you introduce inside `#flag-map-section svg` will inherit `display: none` unless its class is in the `:not(...)` exclusion list. If you add a new line type, extend the `:not(...)` selector — or move the line to a different element type (`<polyline>`, `<path>`) that the rule doesn't catch. Same trap exists for `<text>`. (PR #613 lesson — I shipped the `<line>` injection, the DOM showed correct coords, `getComputedStyle` showed pink stroke, `getBBox` was `0,0,0,0` — that's the smoking gun for `display: none` on the element, since hidden elements have no rendered geometry.)

### 7. What "verified" means

Two screenshots, both saved with descriptive names under `.playwright-mcp/` (gitignored — the names matter for the conversation, not the repo):

- **Close-up.** A tight crop on whatever the fix targeted (a single ring, a pair, a cluster). Proves the fix did what it claimed.
- **Wider context.** The whole continent or sub-region. Proves nothing else moved — neighbouring rings still sit on their islands, no cascade.

Pair each with the corresponding `browser_evaluate` cx/cy dump in your reply. "Looks right" + raw numbers > either alone.

## Where the relevant code lives

- `flagQuiz/flagMap.js` — `addHitTargets`, `tagMicrostates`, `cropToCountries`, `offsetHitTargetCenter` (the hand-coded co-located-pair table for mf/sx), `MICROSTATE_CODES`, `HIT_TARGET_FRACTION`.
- `flagQuiz/mapZoom.js` — `attachZoomPan`, `rescaleHitTargets` (rings get smaller as you zoom in, so the offset:radius ratio increases — a static offset that looks tight at world view spreads out at any continent crop).
- `flagQuiz/page.js` — `MAP_CONFIG` with per-variant `crop` / `cropExcludes` / `cropPad`.
- `flagsdata/page.js` — same imports, different rendering surface.
