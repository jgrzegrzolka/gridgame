---
name: map-interaction
description: The journey log for the flagQuiz/flagsdata contour-map FEEL — pan, zoom, momentum, and the rendering model behind them (flagQuiz/mapZoom.js, and the render path in flagQuiz/flagMap.js). Read this BEFORE changing how the map moves or renders: it records what was tried, what shipped, and what was deliberately rejected or reverted (GPU-transform panning, full free-pan, elastic-pinch), each with the reason, so the next agent does not re-run a failed experiment. For the "is the ring still on the right island" verification recipe, use the sibling skill verify-flag-map-ui instead; this skill is decisions, that one is testing.
---

# Map interaction journey (pan / zoom / momentum / rendering feel)

This is a decisions-and-dead-ends log, not a how-to. The map's *feel* has been iterated a lot, and several plausible ideas were tried and pulled back. Read the "Rejected / reverted" section before proposing a change so you do not repeat one.

For **how to verify** a map change in a real browser, see the sibling skill `verify-flag-map-ui`. For the **perf journal** (what perf fixes were tried), see `PERF.md`. This skill focuses on interaction behaviour and the reasoning behind it.

## The rendering model (and why it is what it is)

- The map is **one big retained-mode SVG**, ~2228 `<path>` elements (`flagQuiz/worldMap.svg`). Panning/zooming changes the SVG `viewBox`.
- Changing the `viewBox` is **not** a GPU-compositor operation: it re-maps coordinates for every element, so the browser re-transforms and re-rasterises the whole vector scene on the **CPU**, every frame. Cost scales with path count. This is the structural ceiling on smoothness (see "Why Google Maps is smoother").
- During a gesture the SVG carries `.is-interacting`, which drops flag `<image>` fills to flat colour (see `flags/flagMap.css`). That is what keeps a move cheap (~2 to 8 ms/frame on a mid phone, measured): no bitmaps to re-raster while moving. On settle (~140 ms after the last input) the class drops and flags snap back to images in one sharp repaint.
- We render the **actual viewBox each frame** during a gesture, not a GPU `transform` layer. See the reverted experiment below for why.

## What ships today (the interaction contract)

- **Pan**: drag follows the finger. At an edge it **rubber-bands** (stretches past with growing resistance, capped at `MAX_OVERSCROLL = 0.35` of the view) and **springs back** on release with a slight overshoot bounce (`easeOutBack`, `SPRING_MS = 560`, `SPRING_OVERSHOOT`). Applies at *every* pan edge: the zoomed-in map edge (#741) and the zoomed-out floating-map keep-sliver edge (#742). (Tuned rubberier + springier 2026-07-09, Feature T: overscroll 0.12 -> 0.2 -> 0.35, easeOutCubic -> easeOutBack spring-back, SPRING_MS 260 -> 300 -> 560 for a slower, smoother return.)
- **Flick inertia** (#743): a pan released with velocity glides on and decelerates to a stop. `flickVelocity` measures px/ms over the last `FLICK_WINDOW_MS`; above `INERTIA_MIN_SPEED` it projects a target (distance = velocity x `INERTIA_TAU_MS`) and eases with `easeOutCubic` over `3x TAU` (that pairing opens the glide at the flick speed). Reuses `animateTo`, which clamps the target, so a glide into an edge eases to a stop there.
- **Release priority**: overscrolled -> spring back; else fast flick -> glide; else commit in place.
- **Zoom** (wheel / pinch): pivot stays under the cursor/fingers. Hard-clamped at `MAX_ZOOM_IN = 24` (no rubber — see rejected item). The zoom-OUT floor depends on the caller's bounds mode: the live maps (flagQuiz + flagsdata) pass `containZoomOut: true`, which stops zoom-out at the smallest view that still shows the whole map (the **contain floor**, `containZoomOutLimit` × a 6% margin — meet mode ≈ 1.06, slice/fullscreen-portrait grows by the viewport/asset aspect mismatch so the whole wide world is still reachable). Callers that don't opt in keep the loose `MAX_ZOOM_OUT = 3`.
- **Bounds mode** (`containZoomOut: true` + `freePan: false`, shipped 2026-07-09, Feature T Phase 1): the Google-Maps feel Jan asked for — the map can't shrink into a void and can't be dragged off into empty page. Antarctica pins near the bottom, a thin ocean strip up top. Applies to *every* variant including Europe (which lost its old 3x pull-back). The rubber-band still gives on all four edges.
- **`boundsExpand`** (world map only, 0.15): the clamp region (`original`) is the mounted view grown 15% per side via `expandBounds`, while the DEFAULT/reset view stays the tight mounted framing (`mounted`, kept separate from `original` inside `attachZoomPan`). So the world map rests tight but the player can drag / zoom ~15% past its edges into open ocean and rest there (lets you pull the antimeridian Pacific islands off the frame edge). Aspect-preserving so a first gesture never reshapes the view. Continents omit it — panning past their crop would reveal neighbouring land, not ocean. NOTE: an earlier take padded the *mounted* viewBox (`edgePad`), which moved the default framing — reverted 2026-07-09 because Jan wanted the tight default back, with the margin only reachable by dragging.
- **Double-tap** (touch only): reset to the mounted viewBox. There is **no** mouse double-click reset.
- All of the above honour `prefers-reduced-motion` (spring/inertia/fly snap instead of animating).

Pure, unit-tested helpers in `mapZoom.js`: `zoomViewBox`, `panViewBox`, `clampViewBox`, `clampZoomScale`, `regionalFrame`, `rubberBandOffset`, `flickVelocity`, `easeInOutCubic`, `easeOutCubic`. The DOM glue (`attachZoomPan`) is verified in a browser (see `verify-flag-map-ui`).

## Rejected / reverted — do not re-run these without new information

- **GPU `transform` panning during the drag** (moved the SVG with `style.transform`, reconciled viewBox on settle). *Reverted 2026-07-08, PR #732.* A transform only moves already-painted pixels, so panning into un-rendered area left a **blank strip** that only filled on settle. The image-raster cost that once justified it is already gone during a move (the `.is-interacting` wash). It is only viable **with an over-render margin** so there is always painted content to move into (that is what tiles buy Google). See `PERF.md`.
- **Full free-pan when zoomed in** (drag the map anywhere, keep only a sliver on screen). *Rejected in favour of rubber-band, 2026-07-08.* When zoomed in, dragging the map off-centre exposes blank page beside it, which reads as broken. Standard map apps clamp to the edge when zoomed in for exactly this reason. Rubber-band gives the "not a hard wall" feel without the void.
- **Elastic-pinch at the zoom limits** (rubber + spring when you pinch past `MAX_ZOOM_OUT` / `MAX_ZOOM_IN`). *Deliberately NOT done, parked 2026-07-08.* It would reopen the zoom path's pivot handling that `clampZoomScale` was added to stabilise (an off-centre-pivot drift bug at the zoom-out limit): meaningful regression risk for a wall users hit rarely, and pinch is the one gesture that cannot be verified headlessly. A hard stop at max zoom is normal (Google Maps does it). Revisit only if there is a clean way to allow width overshoot without disturbing the pivot math.
- **Measuring the free-pan keep against the map width** (instead of the visible window). *Changed 2026-07-06.* It made 1x feel guarded while zoomed-out cleared freely. `FREE_PAN_KEEP` is now a fraction of the *screen* at every zoom. See the comment on `FREE_PAN_KEEP`.

## Why Google Maps is smoother (and the levers we have)

Not a bug on our side, an architecture gap. Google is GPU-composited raster/vector **tiles** (now WebGL): a pan is a camera-matrix change the GPU redraws, with **over-render** beyond the viewport and **level-of-detail** by zoom, plus **inertia**. We are a single CPU-rasterised SVG that fully repaints per frame. Even at ~60fps ours feels different because of: no inertia (now addressed, #743), the flag "simplify" flip on drag start/end, and repaint spikes on weaker devices.

Levers, cheapest first:
1. **Inertia** — done (#743). Biggest perceived win for the effort.
2. **Bitmap-pan hybrid** — rasterise the contours to a bitmap at the current zoom, GPU-translate it during the drag, redraw sharp SVG on settle, *with an over-render margin* so no blank strips (the fix the #732 revert was missing). Medium effort, likely the next real gain.
3. **Level-of-detail** — simplify the SVG geometry at world zoom (fewer paths to repaint). Medium/high.
4. **Canvas2D / WebGL renderer** — the big rewrite. Highest ceiling, but loses SVG's easy hit-testing, per-country DOM, and CSS styling. Only if 1-3 are not enough.

## Verification gotcha specific to this work

The SWA dev server sends `Cache-Control: immutable` (1 year) on every static file, so the browser **locks the module it first fetched** per origin. Symptom: you edit `mapZoom.js`, the served text (via `fetch(..., {cache:'no-store'})`) shows your change, but the page and even `import('/flagQuiz/mapZoom.js')` run the **old** module (a missing new export is the tell). `Network.setCacheDisabled` + reload was not enough. What worked: CDP `Network.clearBrowserCache` **then** `setCacheDisabled` **then** navigate. Both `127.0.0.1` and `localhost` get poisoned independently (each is its own cache namespace, and each can hold a *different* stale version). See `verify-flag-map-ui` for the rest of the Playwright-MCP recipe.

Also: `page.mouse.move` round-trips are too slow (>80 ms apart) to register as a flick, so inertia will not trigger from Playwright-driven moves. To exercise inertia, dispatch the `mousemove`s **inside** the page (`page.evaluate` with `await sleep(14)` between them) so the samples have realistic ~16 ms spacing.
