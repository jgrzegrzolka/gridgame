/**
 * Per-variant flag-quiz contour map.
 *
 * One asset ships today:
 *
 *   - `worldMap.svg` (CC BY-SA 4.0) — world map, ID'd by ISO 3166-1
 *     alpha-2. Every variant mounts it; continent variants (Europe,
 *     Asia, …) apply a runtime viewBox crop to their country codes.
 *
 * This module is the surface the page wiring talks to. It doesn't know
 * about quiz state, just "paint country X correct" / "paint country X
 * wrong" / "mount this URL into that host" / "crop the viewBox to these
 * countries."
 *
 * Pure DOM, no fetch unless explicitly via `mountFlagMap`. The page
 * mounts the SVG once (inlined into a host element so CSS can reach
 * into it), then calls `paintCountryFlag` on each answer.
 *
 * Codes not present in the SVG (e.g. `ax`, `sj`, the EU/CEFTA regional
 * codes the quiz pool also surfaces) silently no-op — they just don't
 * paint, the rest of the round continues unchanged.
 *
 * Answer state on a painted country (`paintCountryFlag`): its contour is
 * filled with the flag image and tagged `.is-flag-correct` (green) or
 * `.is-flag-wrong` (red). The most-recent answer shows the live flag; earlier
 * answers settle to a quiet green / red correctness wash (`.is-tinted`), which
 * is also what stands in for every flag while the map is panned / zoomed — see
 * the fill rules in `flags/flagMap.css`.
 */

/**
 * Answer-status colours for the flag-fill tint overlay — the same green /
 * red answer-state exceptions used across the site. Set inline on the
 * overlay clone so it wins over the asset's own `g.map-country path` fill
 * without a specificity war; the strong-then-soft fade is a CSS animation.
 */
const FLAG_FLASH_COLORS = { correct: '#2a8a3a', wrong: '#c0392b' };

/**
 * Radius of the visible pink-ring marker, expressed as a fraction of
 * the displayed viewBox's larger dimension. Tuned by eye: small
 * enough that microstate markers don't overwhelm their neighbouring
 * countries on the rendered map, big enough to remain a comfortable
 * click target.
 */
const HIT_TARGET_FRACTION = 0.007;
// "Hug" ring sizing (flagsdata): the ring tracks the island's own footprint
// (`countryR`) plus a small margin, instead of the flat locator radius above,
// so a speck like Montserrat gets a speck-sized circle rather than one that
// swamps its neighbours. Floored so the very tiniest still show a dot.
const HUG_RADIUS_MARGIN = 1;
const HUG_MIN_RADIUS = 1.5;
// Multi-island microstate markers (hug mode). A country's islands are "tight"
// (one enclosing circle) unless the union of all islands is more than this many
// times the largest single island's span, in which case they're "spread"
// (small circle on the main island + a leader out to each of the others, rather
// than one big mostly-empty disc). Real getBBox ratios on this asset:
// Guadeloupe 2.03 and Saint Kitts & Nevis 1.74 (tight) vs US Virgin Islands
// 2.82, Turks & Caicos 4.15, British Virgin Islands 7.01 (spread) — so 2.4
// splits them cleanly.
const MARKER_SPREAD_FACTOR = 2.4;
// Pointers only make sense for a HANDFUL of scattered islands (Turks & Caicos
// 3, US/British Virgin Islands 2). A many-island archipelago (Cape Verde 8,
// Falklands 8, Faroe 6) would sprout a starburst of leaders, so past this count
// we always draw one enclosing circle even when the islands are spread — the
// circle reads as the country and the many islands fill it rather than leaving
// it empty.
const MARKER_MAX_POINTER_ISLANDS = 3;
// An island whose bbox is narrower than this (viewBox units) is sub-pixel at
// map scale, so we draw an artificial land dot on it (British Virgin Islands
// 0.8, Bermuda 0.8, Montserrat 0.71, and Turks & Caicos' islands 0.72-1.51) —
// otherwise its ring / leader ends in empty water. Set just above Turks &
// Caicos' main island (1.51) so a spread country's own ring isn't empty, and
// below US Virgin Islands' St Croix (2.37), which is visible on its own.
const ISLAND_DOT_MAX_DIM = 1.55;
// Radius of that artificial land dot, kept constant on screen via data-base-r
// (same mechanism as the rings), so it stays visible under the hug ring.
const ISLAND_DOT_RADIUS = 0.9;
// ...but floored in viewBox units (data-country-r) so it doesn't shrink to a
// sub-pixel nothing when the map zooms out — e.g. when a filter frames a single
// antimeridian microstate (Kiribati) at a wide view, the dot must still read.
// Smaller than any ring's own floor so the dot stays visibly inside its ring.
const ISLAND_DOT_MIN_RADIUS = 0.5;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Codes the map pipeline (paint / fly / mark / bbox) will act on. Plain ISO2
// (`fr`, `xk`) plus compound subdivision codes (`gb-sct`, `es-ct`) whose own
// flag is quizzed and which we've given an injected `<g>` + locator. Before,
// this was ISO2-only, so subdivisions were rejected everywhere and their flag
// never filled / the camera never flew. Trailing-hyphen path ids (`gb-sct-`)
// deliberately don't match, so only the country `<g>` is treated as a country.
const MAP_CODE_PATTERN = /^[a-z]{2}(-[a-z]{2,3})?$/;

/**
 * Per-country ring-center shifts in natural viewBox units, applied
 * after the default bbox-center computation. Targeted at the one known
 * co-located pair: Saint Martin (`mf`, French northern half) and Sint
 * Maarten (`sx`, Dutch southern half) share a single ~9 km Caribbean
 * island, and their inner-path bboxes sit ~0.3 vbu apart — the default
 * rule produced two rings stacked exactly on top of each other, so only
 * the top one was clickable. mf shifts north, sx shifts south, matching
 * the actual French / Dutch halves of the island. A leader line (drawn
 * by addHitTargets when an entry exists here) connects each shifted
 * ring back to the real landmass.
 *
 * A hand-coded table for the one known pair stays surgical. A generic
 * "push apart any pair within N×radius" loop was tried in PR #612 and
 * rejected: at world-level radius (~19 vbu) it cascades across the
 * densely-clustered Caribbean and pushes Bahamas / Lesser Antilles off
 * their islands into open ocean.
 *
 * Offset magnitudes (8 vbu) and DIRECTIONS are picked so that at the
 * North America continent crop — where `rescaleHitTargets` shrinks
 * ring radius to ~2.4 vbu — each shifted ring clears every neighbour
 * ring with positive edge-to-edge gap, not just the obvious pair:
 *
 *   - **mf** shifts pure north (`dy: -8`). Anguilla (`ai`) sits ~1 vbu
 *     north of the shared island; an 8-vbu push puts mf 2 vbu clear
 *     of ai's ring edge. Nothing else lives close enough north to
 *     matter (the Turks & Caicos and Bahamas chains start far further
 *     north on the map).
 *   - **sx** shifts south-southwest (`dx: -4, dy: +8`). A pure-south
 *     push would collide with Saint Kitts & Nevis (`kn`) at ~(828,
 *     549) — sx at pure (826.5, 550.5) would land only 2 vbu from
 *     kn's center, overlapping by ~3 vbu of ring edge. Skewing 4 vbu
 *     west takes sx around kn into the open water south-west of the
 *     shared island, clearing both kn and Saint Barthélemy. Virgin
 *     Islands (vi, vg) sit far enough west not to be affected.
 *
 * Smaller offsets (we tried 5) left the rings grazing each other and
 * the visual read as a confused pile-up; bigger offsets push the rings
 * so far into open water that the leader becomes the only "this
 * belongs to that" cue — 8 vbu lands in the sweet spot where the
 * leader is a clear short stick and the ring still reads as "near the
 * island, not at it." World-view crop (no continent zoom) renders
 * every Caribbean ring heavily overlapping regardless of this offset —
 * that's data density, not something a per-country shift can fix; the
 * 50% stroke/fill opacity on `.map-hit-target` (set in flagMap.css)
 * keeps even the unavoidable overlaps readable as soft layers.
 *
 * A generic "push apart any pair within N×radius" loop was tried in
 * PR #612 and rejected: it cascades across the dense Caribbean and
 * pushes Bahamas / Lesser Antilles off their islands into open ocean.
 *
 * Add a new entry only when a second co-located ISO pair appears.
 * Re-tune both magnitude AND direction per-pair against the actual
 * neighbour positions — pure N/S that worked for mf does NOT work for
 * sx, as the lesson here shows.
 *
 * `dx` is east-positive, `dy` is south-positive (SVG y grows downward).
 *
 * @type {Record<string, { dx: number, dy: number }>}
 */
const HIT_TARGET_CENTER_OFFSETS = {
  mf: { dx: 0, dy: -8 },
  sx: { dx: -4, dy: 8 },
};

/**
 * Apply the per-country center shift from `HIT_TARGET_CENTER_OFFSETS`,
 * returning the (possibly unchanged) `{ cx, cy }`. Pure so a sibling
 * test can pin the table without the addHitTargets DOM ceremony.
 *
 * @param {string} id  ISO2 code
 * @param {number} cx
 * @param {number} cy
 * @returns {{ cx: number, cy: number }}
 */
export function offsetHitTargetCenter(id, cx, cy) {
  const o = HIT_TARGET_CENTER_OFFSETS[id];
  if (!o) return { cx, cy };
  return { cx: cx + o.dx, cy: cy + o.dy };
}

/**
 * Curated set of ISO 3166-1 alpha-2 codes whose countries are tiny
 * enough on the rendered map to need the pink-ring marker treatment.
 * Hardcoded rather than auto-detected via getBBox because the world-
 * map asset wraps each country in a `<g>` containing a tiny `<path>`
 * AND a hidden `<circle r=6>` locator — getBBox on the `<g>` returns
 * the inflated union, which misses true microstates (the locator
 * dominates the bbox so Singapore looks 12 units wide and dodges the
 * threshold).
 *
 * Adding a country here makes it get a pink-ring overlay AND become
 * a comfortable click target. List covers both Europe + Asia variants
 * today; extend when adding new continent maps.
 */
const MICROSTATE_CODES = new Set([
  // Europe — Vatican, Monaco, San Marino, Andorra, Liechtenstein, Malta.
  // Luxembourg is intentionally NOT here: at ~2600 km² it's visible-
  // sized as a country path at the Europe crop and doesn't need a ring.
  'va', 'mc', 'sm', 'ad', 'li', 'mt',
  // British isles + Crown Dependencies
  'gg', 'je', 'im', 'fo',
  // Åland: a Nordic autonomous archipelago (part of Finland) that the base
  // world map omits. We inject an `ax` <g> + locator into worldMap.svg so its
  // pink ring lands in the Baltic between Sweden and Finland.
  'ax',
  // Clipperton: a French atoll in the eastern Pacific the base map also omits.
  // Injected as a `cp` <g> + locator (open ocean SW of Mexico) so it shows a
  // ring instead of nothing on the quiz / browse map.
  'cp',
  // Constituent countries / autonomous regions whose OWN flag is quizzed but
  // which the world map only draws as part of a parent landmass (UK, Spain).
  // We inject a `<g>` + locator at each one's real location so its flag has
  // something to ring instead of highlighting nothing. gb-eng/sct/wls/nir sit
  // on Great Britain + the north of Ireland; es-ct/pv/ga on the Iberian rim;
  // ic (Canary Islands) off NW Africa. On the quiz only one shows at a time.
  'gb-eng', 'gb-sct', 'gb-wls', 'gb-nir', 'es-ct', 'es-pv', 'es-ga', 'ic',
  // Svalbard and Jan Mayen: a high-Arctic Norwegian territory the base map
  // omits. Injected `sj` <g> + locator far north, above mainland Norway.
  'sj',
  // Gibraltar (gi): carries its own geometry, but it's a ~0.8-unit speck, so
  // without a ring the answer reveal is too tiny to spot. Ring it. Kosovo (xk)
  // is intentionally NOT here — its landmass is big enough that its flag fills
  // the real outline once MAP_CODE_PATTERN lets the paint through; a ring on
  // top would be redundant.
  'gi',
  // Asia microstates — only countries whose paths are tinier than
  // the pink ring itself (smaller-than-ring marker would be pointless,
  // e.g. Bhutan / Lebanon / Cyprus are already visible-sized as
  // country paths and don't need a ring on top).
  'sg', 'bh', 'mv', 'bn', 'qa', 'kw', 'hk', 'mo', 'ps',
  // Africa microstates / island nations — same "tinier than the ring"
  // criterion. Cabo Verde, Comoros, Mauritius, Seychelles, São Tomé.
  'cv', 'km', 'mu', 'sc', 'st',
  // Americas — almost all Caribbean island nations + territories, plus
  // Bermuda and the Falklands. Big mainland Caribbean / Central American
  // countries (Cuba, Dominican Republic, Haiti, Jamaica, Trinidad) are
  // visible-sized and don't need rings.
  'ag', 'ai', 'aw', 'bb', 'bl', 'bm', 'bq', 'dm', 'gd', 'gp',
  'kn', 'ky', 'lc', 'mf', 'mq', 'ms', 'sx', 'tc', 'vc', 'vg', 'vi',
  'fk',
  // Oceania — Pacific island nations and territories that are tinier
  // than the pink ring would be. Australia / NZ / PNG / New Caledonia /
  // Fiji / Vanuatu / Solomon Islands / French Polynesia are big enough
  // as drawn paths and don't need rings.
  'as', 'cc', 'ck', 'cx', 'fm', 'gu', 'ki', 'mh', 'mp', 'nf',
  'nr', 'nu', 'pn', 'pw', 'tk', 'to', 'tv', 'wf', 'ws',
]);

/**
 * Fill an answered country's contour with its actual flag image (at 60%
 * opacity), then tint it green (correct) or red (wrong). An SVG `fill` is
 * clipped to the painted geometry automatically, so pointing a country's
 * fill at a `<pattern>` whose single `<image>` is the flag stamps the flag
 * into the country's silhouette; a colour-overlay clone on top supplies
 * the answer status.
 *
 * Used by flagQuiz for every map variant + mode: each answer stamps the
 * asked-about country with its flag and a green (correct) / red (wrong)
 * status.
 *
 * Mechanics:
 *   - Lazily create a `<defs>` and append one `<pattern id="flagfill-xx">`
 *     per country (deduped by id). `patternContentUnits="objectBoundingBox"`
 *     + width/height = 1 maps the image onto the filled element's own
 *     bounding box, so the flag scales to whatever the country's bbox is.
 *   - `preserveAspectRatio="xMidYMid slice"` keeps the flag's proportions
 *     and crops the overflow rather than stretching it to the (usually
 *     non-3:2) country bbox.
 *   - Fill targets: the `#id` element (its child `<path>`s for `<g>`-
 *     wrapped countries, skipping inner paths that are themselves separate
 *     countries), plus the microstate ring overlay. Flag fill at 60%
 *     opacity is set inline so it wins over the stylesheet without
 *     `!important`.
 *   - Status: a green / red clone of each filled shape is dropped on top
 *     (`flash`). The CSS `flag-flash` animation holds it solid briefly
 *     then settles it to a 40% wash, so the answer flashes its colour and
 *     leaves a soft tint over the flag. The answered shape also gets a
 *     thin, semi-transparent green / red outline (inline stroke, set
 *     below) that persists once the wash fades — a crisp "right / wrong"
 *     frame around the flag.
 *   - Every flag-filled element gets `.is-flagged` so the fills can be
 *     found (e.g. to settle them to their correctness wash on the next answer).
 *
 * @param {any} svg     mounted `<svg>` root
 * @param {string} code ISO 3166-1 alpha-2
 * @param {string} svgBase  flag-svg directory, e.g. `'../flags/svg/'`
 * @param {'correct' | 'wrong'} status
 */
export function paintCountryFlag(svg, code, svgBase, status) {
  if (!svg || typeof code !== 'string') return;
  const id = code.toLowerCase();
  if (!MAP_CODE_PATTERN.test(id)) return;
  /** @type {any} */
  const doc = svg.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElementNS !== 'function') return;
  const statusClass = status === 'wrong' ? 'is-flag-wrong' : 'is-flag-correct';
  const patternId = `flagfill-${id}`;
  if (!svg.querySelector(`#${patternId}`)) {
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = doc.createElementNS(SVG_NS, 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    const pattern = doc.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', patternId);
    pattern.setAttribute('patternContentUnits', 'objectBoundingBox');
    pattern.setAttribute('width', '1');
    pattern.setAttribute('height', '1');
    const image = doc.createElementNS(SVG_NS, 'image');
    const flagUrl = `${svgBase}${id}.svg`;
    image.setAttribute('href', flagUrl);
    // xlink:href fallback for renderers that predate the unprefixed attr.
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', flagUrl);
    image.setAttribute('width', '1');
    image.setAttribute('height', '1');
    image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    pattern.appendChild(image);
    defs.appendChild(pattern);
  }
  const fill = `url(#${patternId})`;
  const flashColor = FLAG_FLASH_COLORS[status];
  // Overlay a green / red clone of the answered shape on top of the flag.
  // The CSS `flag-flash` animation holds it solid briefly (a green / red
  // "got it / missed it" stamp) then settles it to a soft 40% wash that
  // tints the flag underneath — so the colour reads strongly on answer
  // and lingers as the resting status without hiding the flag. A clone
  // (rather than animating the element's own fill) is needed because CSS
  // can't transition a solid colour into a `url(#pattern)` fill. Inserted
  // as the element's next sibling so it inherits the same ancestor
  // transforms and stacks directly on top. No-op in the test fakes
  // (no `cloneNode`).
  /** @param {any} el */
  const flash = (el) => {
    if (!flashColor || !el || typeof el.cloneNode !== 'function') return;
    const parent = el.parentNode;
    if (!parent || typeof parent.insertBefore !== 'function') return;
    const clone = el.cloneNode(false);
    clone.setAttribute('class', 'flag-flash');
    clone.removeAttribute('id');
    if (clone.style) {
      clone.style.fill = flashColor;
      clone.style.fillOpacity = '';
      clone.style.stroke = 'none';
      clone.style.pointerEvents = 'none';
    }
    parent.insertBefore(clone, el.nextSibling);
  };
  /** @param {any} el */
  const applyFill = (el) => {
    if (!el) return;
    if (el.style) {
      el.style.fill = fill;
      // 90% — the flag reads vividly so it stands out from the grey
      // neighbours. The old soft 0.6 paired with a resting colour wash;
      // that wash now fades to nothing (see `flag-flash-out`), so the
      // flag carries the "which country" signal on its own and the
      // border below carries "right / wrong".
      el.style.fillOpacity = '0.9';
      // Thin, semi-transparent green / red outline framing the answered
      // country — a crisp "right / wrong" edge that persists after the
      // flash wash fades. `non-scaling-stroke` keeps it a constant hairline
      // weight at every map zoom level (the same trick the microstate
      // rings use); set inline so it wins over the asset's default grey
      // coastline without a specificity fight.
      if (flashColor) {
        el.style.stroke = flashColor;
        el.style.strokeWidth = '1.5';
        el.style.strokeOpacity = '0.6';
        el.style.vectorEffect = 'non-scaling-stroke';
      }
    } else if (typeof el.setAttribute === 'function') {
      el.setAttribute('fill', fill);
    }
    if (el.classList) {
      el.classList.add('is-flagged');
      // Persist the answer status so once this country is no longer the most
      // recent (gains `.is-tinted`), it settles to a quiet green / red
      // correctness wash instead of its flag colour — see flagMap.css. The
      // same green / red also stands in for the flag while the map moves.
      el.classList.add(statusClass);
    }
    flash(el);
  };
  for (const el of flagFillTargets(svg, id)) applyFill(el);
}

/**
 * Demote an already-painted country to its flat green / red correctness wash —
 * add `.is-tinted` to the same targets {@link paintCountryFlag} filled. The quiz
 * calls this on the previously-answered country as each new answer lands, so
 * only the most-recent country renders as a live flag `<image>` and the
 * per-fly-in settle repaint stays O(1) (see the `.is-tinted` rules in
 * flagMap.css). No-op for an unpainted / invalid code — an unflagged element
 * gaining the class is inert until it's also `.is-flagged`.
 *
 * @param {any} svg  mounted `<svg>` root
 * @param {string} code ISO 3166-1 alpha-2
 */
export function settleFlagToTint(svg, code) {
  if (!svg || typeof code !== 'string') return;
  const id = code.toLowerCase();
  if (!MAP_CODE_PATTERN.test(id)) return;
  for (const el of flagFillTargets(svg, id)) {
    if (el && el.classList) el.classList.add('is-tinted');
  }
}

/**
 * Reveal one already-painted country as its full flag `<image>` — the inverse
 * of {@link settleFlagToTint}, dropping `.is-tinted` from its targets so the
 * inline flag fill shows again instead of the settled correctness wash. The
 * quiz calls this in throttled batches when the round ends (or the finished
 * map is re-zoomed) so the whole board doesn't rasterise in a single frame and
 * freeze the tab. No-op for an invalid code.
 *
 * @param {any} svg  mounted `<svg>` root
 * @param {string} code ISO 3166-1 alpha-2
 */
export function revealFlagImage(svg, code) {
  if (!svg || typeof code !== 'string') return;
  const id = code.toLowerCase();
  if (!MAP_CODE_PATTERN.test(id)) return;
  for (const el of flagFillTargets(svg, id)) {
    if (el && el.classList) el.classList.remove('is-tinted');
  }
}

/**
 * The set of elements `paintCountryFlag` fills for one country — its
 * `#id` element's paintable child `<path>`s (the `<g>`-wrapped case the
 * world map uses, skipping inner paths that are themselves separate
 * countries), or the element itself when it has no such child paths (a
 * defensive single-path fallback), plus every microstate ring overlay
 * tagged for the country. Used by `paintCountryFlag` (apply the fill) and by
 * the tint / reveal helpers that toggle the settle-wash class on the same set.
 *
 * @param {any} svg  mounted `<svg>` root
 * @param {string} id  lowercase ISO 3166-1 alpha-2
 * @returns {any[]}
 */
function flagFillTargets(svg, id) {
  /** @type {any[]} */
  const targets = [];
  const rootEl = svg.querySelector(`#${id}`);
  if (rootEl) {
    const childPaths = typeof rootEl.querySelectorAll === 'function'
      ? rootEl.querySelectorAll('path') : [];
    const rootIsCountry = !!(rootEl.classList && rootEl.classList.contains('map-country'));
    let added = 0;
    for (let i = 0; i < childPaths.length; i++) {
      const p = childPaths[i];
      // Skip inner paths that belong to a DIFFERENT country nested inside this
      // one, so (un)highlighting the outer country never clobbers the inner:
      //   - a direct sub-country path: <g id="fr"><path id="gf"> French Guiana
      //   - a nested country GROUP: the asset draws Kosovo inside Serbia
      //     (<g id="rs"><g id="xk"><path id="xk-">), so a plain recursive path
      //     query pulls xk- into Serbia's set — un-highlighting Serbia on a
      //     flagsdata search then stripped Kosovo's own highlight, and answering
      //     Serbia on the quiz would have painted Kosovo. A path is "ours" only
      //     if its nearest map-country ancestor is rootEl.
      if (p && p.classList && p.classList.contains('map-country')) continue;
      if (rootIsCountry && p && typeof p.closest === 'function'
        && p.closest('.map-country') !== rootEl) continue;
      targets.push(p);
      added++;
    }
    // Defensive: an element with no paintable inner paths — fill it
    // directly. (The world map wraps every country in a `<g>`, so this
    // only fires for a hypothetical single-path country.)
    if (added === 0) targets.push(rootEl);
  }
  const hits = svg.querySelectorAll(`.map-hit-target[data-hit-for="${id}"]`);
  for (let i = 0; i < hits.length; i++) targets.push(hits[i]);
  // Include the microstate's leader line (only mf / sx have one) so it
  // gains / loses the same is-marked / is-flagged state class as its ring
  // — the CSS hides both by default and reveals them together. Setting a
  // flag-pattern fill on a <line> is a no-op (lines paint via stroke), so
  // routing it through here is harmless beyond the class toggle.
  const leaders = svg.querySelectorAll(`.map-hit-leader[data-hit-for="${id}"]`);
  for (let i = 0; i < leaders.length; i++) targets.push(leaders[i]);
  // Caribbean-inset island (flagsdata only): a redrawn coastline for a
  // microstate too small to show in place. It carries the country's
  // `data-hit-for`, so routing it through here gives it the same
  // is-marked / is-flagged highlighting as the in-place element for free.
  const inset = svg.querySelectorAll(`.carib-island[data-hit-for="${id}"]`);
  for (let i = 0; i < inset.length; i++) targets.push(inset[i]);
  // Artificial land dots (sub-pixel islands: BVI, Bermuda, Turks & Caicos
  // specks) carry the country's data-hit-for too — mark them so they go
  // yellow with the rest of the country when a filter matches.
  const dots = svg.querySelectorAll(`.map-island-dot[data-hit-for="${id}"]`);
  for (let i = 0; i < dots.length; i++) targets.push(dots[i]);
  return targets;
}

/**
 * Highlight / un-highlight one country with a flat fill (`.is-marked`, yellow
 * — see flagMap.css). This is the cheap alternative to `paintCountryFlag` for
 * surfaces that only need to say "this country is in the current set" rather
 * than show its flag: no `<image>` / `<pattern>` and so no raster decode, which
 * is what makes flagsdata's whole-world highlight fast (and lets it skip the
 * tint / throttled-reveal machinery flagQuiz needs). Toggles the same target
 * set `paintCountryFlag` fills (child paths + microstate hit rings). Distinct
 * from `paintCountryFlag`, which stamps the flag image + green / red status.
 *
 * @param {any} svg  mounted `<svg>` root
 * @param {string} code ISO 3166-1 alpha-2
 */
export function highlightCountry(svg, code) {
  if (!svg || typeof code !== 'string') return;
  const id = code.toLowerCase();
  if (!MAP_CODE_PATTERN.test(id)) return;
  for (const el of flagFillTargets(svg, id)) {
    if (el && el.classList) el.classList.add('is-marked');
  }
}

/**
 * Inverse of `highlightCountry` — drop the `.is-marked` fill from one country.
 *
 * @param {any} svg  mounted `<svg>` root
 * @param {string} code ISO 3166-1 alpha-2
 */
export function unhighlightCountry(svg, code) {
  if (!svg || typeof code !== 'string') return;
  const id = code.toLowerCase();
  if (!MAP_CODE_PATTERN.test(id)) return;
  for (const el of flagFillTargets(svg, id)) {
    if (el && el.classList) el.classList.remove('is-marked');
  }
}

/**
 * Fetch the SVG, inline it into `container`, and patch the root `<svg>`
 * element so it scales responsively. Returns the inlined `<svg>` root.
 *
 * `cropCodes` (optional) focuses the viewBox to the bounding-box union
 * of those country paths — used by Asia (which mounts the world map and
 * crops to Asia). Europe keeps the asset's natural viewBox.
 *
 * `cropPad` (optional, SVG units) extends the cropped viewBox after
 * the bbox union. Used when one variant's natural bbox excludes a
 * specific region we still want visible (e.g. NA's crop excludes US
 * to avoid the antimeridian wrap, then pads west to include Alaska).
 *
 * `scopeCodes` (optional) limits which countries get the microstate
 * treatment (pink-ring overlay). Defaults to all `.map-country`
 * elements — fine for Europe, which only carries European countries in
 * its asset. For the world map used by Asia we want to suppress overlays
 * on Caribbean / Pacific / African microstates that aren't in the
 * Asian quiz pool. Caller passes the active variant's codes.
 *
 * `fullscreenLabel` is the already-translated string used as the
 * fullscreen button's `aria-label`. Caller passes
 * `t('menu.fullscreen', 'Toggle fullscreen')`.
 *
 * `onToggle` (optional) opts the map into a top-left hide/show toggle chip
 * that mirrors the fullscreen chip in the opposite corner. Its click calls
 * `onToggle()` — flagQuiz collapses the mounted map (keeping the chip in
 * place, flipped to a "show" eye) or re-mounts it, persisting the choice.
 * Omitted by flagsdata, which has no hide affordance, so no chip renders
 * there. `toggleLabel` is the already-translated `aria-label` for the
 * current (mounted → "hide map") state.
 *
 * @param {{
 *   container: HTMLElement,
 *   url: string,
 *   cropCodes?: string[] | null,
 *   cropPad?: { left?: number, right?: number, top?: number, bottom?: number },
 *   scopeCodes?: string[] | null,
 *   fullscreenLabel?: string,
 *   onToggle?: (() => void) | null,
 *   toggleLabel?: string,
 *   resizable?: boolean,
 *   hugIslands?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} args
 * @returns {Promise<SVGElement | null>}
 */
export async function mountFlagMap({
  container, url, cropCodes = null, cropPad, scopeCodes = null,
  fullscreenLabel = 'Toggle fullscreen',
  onToggle = null,
  toggleLabel = 'Hide map',
  resizable = true,
  hugIslands = false,
  fetchImpl = globalThis.fetch,
}) {
  if (!container || !url) return null;
  let res;
  try {
    res = await fetchImpl(url);
  } catch {
    return null;
  }
  if (!res || !res.ok) return null;
  let text;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  container.innerHTML = text;
  const svg = container.querySelector('svg');
  if (!svg) return null;
  if (!svg.getAttribute('viewBox')) {
    const w = svg.getAttribute('width') || '680';
    const h = svg.getAttribute('height') || '520';
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  tagCountryPaths(svg);
  if (Array.isArray(cropCodes) && cropCodes.length > 0) {
    cropToCountries(/** @type {any} */ (svg), cropCodes, cropPad);
  }
  const scope = Array.isArray(scopeCodes)
    ? new Set(scopeCodes.map((c) => (typeof c === 'string' ? c.toLowerCase() : '')))
    : null;
  tagMicrostates(svg, scope);
  addHitTargets(svg, hitTargetRadius(/** @type {any} */ (svg)), hugIslands);
  addFullscreenButton(container, fullscreenLabel);
  if (typeof onToggle === 'function') addHideButton(container, toggleLabel, onToggle);
  if (resizable) makeMapResizable(container, /** @type {any} */ (svg));
  wireCountryHover(/** @type {any} */ (svg));
  return /** @type {SVGElement} */ (svg);
}

/**
 * Filter microstate ring snapshots to those a HOVER may resolve to. A ring is
 * eligible only once it's REVEALED — filter-matched on flagsdata (`isMarked`)
 * or answered on the quiz (`isFlagged`) — and never an inset-suppressed speck
 * (`insetted`, whose real marker moved into the Caribbean inset box). This is
 * the guard that stops the quiz from leaking an UNANSWERED microstate's
 * location: without it, sweeping the pointer across blank ocean where a still-
 * hidden ring sits would wash it and give the country away. Pure over the
 * snapshot objects so it can be pinned without a DOM; the geometry pick that
 * consumes the result is {@link pickNearestHitTarget}.
 *
 * @template {{ isMarked?: boolean, isFlagged?: boolean, insetted?: boolean }} R
 * @param {R[]} rings
 * @returns {R[]}
 */
export function hoverableRings(rings) {
  if (!Array.isArray(rings)) return [];
  return rings.filter((r) => r && (r.isMarked || r.isFlagged) && !r.insetted);
}

/**
 * Desktop hover feedback: darken the country under the pointer a shade (grey
 * land → deeper grey, a filter-matched yellow → deeper gold) and, for a
 * microstate, fill its ring with a soft wash. Toggles `.is-hovered` on the
 * country's `flagFillTargets` — the same scoped set the fills use — so it
 * excludes a nested sub-country (Kosovo inside Serbia never lights up with
 * Serbia) and reaches the ring / island dot / inset island that live in the
 * flat overlay layer outside the country `<g>`. A CSS `:hover` can do neither,
 * which is why this is wired in JS. See the `.is-hovered` rules in flagMap.css.
 *
 * Which country the pointer is over is resolved exactly the way a CLICK is (see
 * flagsdata's handler): first the ring geometry — a point inside a visible
 * microstate ring resolves to that ring via `pickNearestHitTarget`, so hovering
 * ANYWHERE in the circle washes it (you don't have to land on the speck-sized
 * island) — then a fall back to the DOM target for full-size countries. Rings
 * stay `pointer-events: none` (the click still falls through to the real island,
 * so overlapping Caribbean rings don't misresolve), which is why the ring hover
 * has to be a geometry test rather than a native `:hover` on the circle.
 *
 * The pointermove hit-test is coalesced to one geometry pass per frame (rAF) so
 * a fast sweep across the map doesn't rebuild the ring snapshot dozens of times.
 * Touch devices are skipped (`hover: hover`) so a tap never leaves a country
 * stuck dark. No-op where there's no `matchMedia` (tests / SSR).
 *
 * @param {any} svg mounted `<svg>` root
 */
function wireCountryHover(svg) {
  if (!svg || typeof svg.addEventListener !== 'function') return;
  const mm = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia : null;
  if (mm && !mm('(hover: hover)').matches) return;

  /** id of the country currently under the pointer, or null. */
  let current = null;
  const setHover = (id, on) => {
    for (const el of flagFillTargets(svg, id)) {
      if (el && el.classList) el.classList.toggle('is-hovered', on);
    }
  };
  // Which country a DOM target belongs to (the full-size-country fallback): an
  // overlay element (island dot / inset island) names its country via
  // `data-hit-for`; a land path resolves to its NEAREST `.map-country` ancestor,
  // so Kosovo's path resolves to `xk`, not the `rs` group it's drawn inside.
  const countryOf = (el) => {
    if (!el) return null;
    const hitFor = el.dataset && el.dataset.hitFor;
    if (hitFor) return hitFor;
    const c = typeof el.closest === 'function' ? el.closest('.map-country') : null;
    return c && c.id ? c.id : null;
  };
  // Pointer → svg user coords via the live screen CTM, so ring hit-testing holds
  // at any zoom / pan. Null off the real DOM (tests), where geometry is skipped.
  const svgPoint = (e) => {
    if (typeof svg.getScreenCTM !== 'function' || typeof svg.createSVGPoint !== 'function') return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const local = p.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };
  // Snapshot the rings a hover may resolve to. `hoverableRings` keeps only the
  // revealed ones (filter-matched on flagsdata, answered on the quiz, never an
  // inset-suppressed speck) so passing over blank ocean near an unrevealed
  // microstate can't leak its location. Live `r` (mapZoom rescales it per zoom)
  // is read here so the geometry holds at any zoom.
  const visibleRings = () => {
    const out = [];
    const nodes = svg.querySelectorAll('.map-hit-target');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el.classList) continue;
      out.push({
        cx: parseFloat(el.getAttribute('cx')),
        cy: parseFloat(el.getAttribute('cy')),
        r: parseFloat(el.getAttribute('r')),
        code: el.getAttribute('data-hit-for'),
        hidden: false,
        isMarked: el.classList.contains('is-marked'),
        isFlagged: el.classList.contains('is-flagged'),
        insetted: el.classList.contains('carib-insetted'),
      });
    }
    return hoverableRings(out);
  };

  let queued = false;
  let lastEvent = null;
  const process = () => {
    queued = false;
    const e = lastEvent;
    if (!e) return;
    let id = null;
    const pt = svgPoint(e);
    if (pt) id = pickNearestHitTarget(pt, visibleRings()); // inside a ring?
    if (!id) id = countryOf(e.target);                     // else full-size country
    if (id === current) return;
    if (current) setHover(current, false);
    current = id;
    if (current) setHover(current, true);
  };
  svg.addEventListener('pointermove', (e) => {
    lastEvent = e;
    if (queued) return;
    queued = true;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') raf(process); else process();
  });
  // Clear when the pointer leaves the map entirely.
  svg.addEventListener('pointerleave', () => {
    lastEvent = null;
    if (current) { setHover(current, false); current = null; }
  });
}

/**
 * Make the map section width-resizable (desktop only) via a bottom-right corner
 * handle. The map opens at its CSS default (~480px) and the handle drags it
 * either way — down to a small floor or out to the full window width — with the
 * SVG (width:100%, height:auto) scaling to keep the map's shape. Notes:
 *  - width clamps to [MIN_WIDTH, window width]; the window is the ceiling
 *    because the section is centred on the viewport and a wider map would force
 *    a horizontal scrollbar;
 *  - resizing is session-only — nothing is persisted, so a refresh returns to
 *    the default; stale width / size keys from earlier builds are cleared;
 *  - phones (≤600px) get no handle (hidden in CSS); reset to default if the
 *    viewport crosses into mobile mid-session;
 *  - clear the explicit width while fullscreen (the browser owns the size).
 *
 * @param {HTMLElement} container
 * @param {any} _svg
 */
function makeMapResizable(container, _svg) {
  if (!container || !container.style || !container.parentElement) return;
  const doc = container.ownerDocument || globalThis.document;

  // Session-only now — drop any width persisted by earlier builds so a refresh
  // always returns to the CSS default.
  for (const k of ['gridgame.mapSize', 'gridgame.mapHeight', 'gridgame.mapWidth']) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }

  const MIN_WIDTH = 240;
  // The map grows out to the window width — it's centred on the viewport in CSS,
  // so past its panel it spills symmetrically into the page's side margins.
  // `clientWidth` excludes the scrollbar, so full width never forces a
  // horizontal scrollbar. (Only flagQuiz mounts the map resizable, and its body
  // is full-width; flagsdata pins the map to its column and opts out.)
  const maxWidth = () => {
    const el = doc && doc.documentElement;
    return (el && el.clientWidth) || (globalThis.innerWidth || 0);
  };
  const reset = () => { container.style.width = ''; };

  // The handle is hidden in CSS ≤600px; if the viewport crosses into mobile
  // with an in-session resize applied, drop it back to the default width.
  const mq = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia('(max-width: 600px)') : null;
  if (mq && typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', () => { if (mq.matches) reset(); });
  }

  if (doc && typeof doc.createElement === 'function') {
    const handle = doc.createElement('div');
    handle.className = 'map-resize-handle';
    handle.setAttribute('aria-hidden', 'true');
    // Box-with-corner-arrow "expand" glyph, pointing to the bottom-right —
    // reads as "drag the corner out to enlarge". Built from the standard
    // top-right box-arrow, vertically flipped (matrix 1 0 0 -1 0 24) so the
    // arrow points down-right toward the drag corner.
    handle.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
      + '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" '
      + 'stroke-linejoin="round" transform="matrix(1 0 0 -1 0 24)">'
      + '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
      + '<path d="M15 3h6v6"/>'
      + '<path d="M10 14 21 3"/>'
      + '</g></svg>';
    container.appendChild(handle);
    /** @type {{x:number,w:number,max:number}|null} */
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
      start = { x: e.clientX, w: container.getBoundingClientRect().width, max: maxWidth() };
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      // The map is centred, so a corner drag of dx changes each side — resize by
      // 2·dx to keep the handle under the cursor. Drag out to grow, in to shrink.
      const w = Math.max(MIN_WIDTH, Math.min(start.max, start.w + (e.clientX - start.x) * 2));
      container.style.width = `${Math.round(w)}px`;
    });
    const end = (/** @type {PointerEvent} */ e) => {
      if (!start) return;
      start = null;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // Fullscreen: the browser forces the section to the viewport, so our inline
  // width would fight it. Clear it (entering) and settle back to the default
  // (exiting) — there's no persisted width to restore.
  if (doc && doc.addEventListener) {
    doc.addEventListener('fullscreenchange', reset);
    doc.addEventListener('webkitfullscreenchange', reset);
  }
}

/**
 * Append a small "enter fullscreen" button to the section, anchored
 * top-right. Click toggles the browser Fullscreen API on the section
 * itself, so the SVG fills the viewport (browser chrome hidden).
 * Escape exits, same as any other fullscreen surface. Webkit-prefixed
 * fallbacks for older Safari.
 *
 * `label` is the already-translated aria-label string — caller passes
 * `t('menu.fullscreen', 'Toggle fullscreen')`.
 *
 * @param {HTMLElement} container
 * @param {string} label
 */
function addFullscreenButton(container, label) {
  if (!container || typeof container.appendChild !== 'function') return;
  const doc = container.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'map-fullscreen-btn';
  btn.setAttribute('aria-label', label || 'Toggle fullscreen');
  // Expand-to-corners glyph as inline SVG (line style, currentColor) so it
  // matches the resize handle's icon weight, instead of the system ⛶ font
  // glyph which renders inconsistently (thin corner brackets on some OSes).
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
    + '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 9V4a1 1 0 0 1 1-1h5"/>'
    + '<path d="M15 3h5a1 1 0 0 1 1 1v5"/>'
    + '<path d="M21 15v5a1 1 0 0 1-1 1h-5"/>'
    + '<path d="M9 21H4a1 1 0 0 1-1-1v-5"/>'
    + '</g></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen(container);
  });
  container.appendChild(btn);
  // Fullscreen exit ✕. The corner ⤢ button above can be clipped by a phone's
  // rounded corner or camera notch, and mobile has no Esc — so in fullscreen a
  // ✕ at the TOP-CENTRE (clear of both a rounded corner and a landscape
  // side-notch) appears on a deliberate SWIPE DOWN, auto-hiding a few seconds
  // later (see revealMapExit). Rebuilt each mount because mountFlagMap's
  // innerHTML replacement wipes it; the corner button stays put.
  const exitBtn = doc.createElement('button');
  exitBtn.type = 'button';
  exitBtn.className = 'map-fs-exit';
  exitBtn.setAttribute('aria-label', label || 'Toggle fullscreen');
  exitBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
    + '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M6 6 18 18"/><path d="M18 6 6 18"/></g></svg>';
  exitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen(container); // already fullscreen → exits
  });
  container.appendChild(exitBtn);

  // Document + container listeners are wired ONCE per section: mountFlagMap
  // re-runs addFullscreenButton on every re-show (the hide/show chip), which
  // would otherwise stack a fresh sync + pointer listener each mount.
  if (container.dataset && container.dataset.fsWired) return;
  if (container.dataset) container.dataset.fsWired = '1';

  // While in fullscreen, force preserveAspectRatio=slice so the SVG content
  // fills both viewport dimensions (cropping the longer axis) instead of
  // letterboxing; on a touch device also rotate to landscape
  // (lockLandscapeOnTouch) and flash the exit ✕ so it's discoverable on entry.
  // On exit, undo all three.
  const sync = () => {
    /** @type {any} */
    const d = globalThis.document;
    const current = d.fullscreenElement || d.webkitFullscreenElement || null;
    const svg = container.querySelector('svg');
    if (current === container) {
      if (svg) svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      lockLandscapeOnTouch();
    } else {
      if (svg) svg.removeAttribute('preserveAspectRatio');
      unlockOrientation();
      hideMapExit(container);
    }
  };
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('fullscreenchange', sync);
    doc.addEventListener('webkitfullscreenchange', sync);
  }
  if (typeof container.addEventListener === 'function') {
    // Reveal the ✕ on a deliberate swipe DOWN only — a plain tap, a country
    // click, or a horizontal / upward pan leaves it hidden, so the exit surfaces
    // when the player reaches for it rather than on every touch. One pointer
    // tracked at a time; fires once per gesture past the vertical threshold.
    let startX = 0, startY = 0, tracking = false, fired = false;
    container.addEventListener('pointerdown', (e) => {
      tracking = isMapFullscreen(container);
      fired = false;
      startX = e.clientX;
      startY = e.clientY;
    });
    container.addEventListener('pointermove', (e) => {
      if (!tracking || fired) return;
      const dy = e.clientY - startY;
      // Predominantly-downward travel past the threshold: not a tap, not a
      // sideways/upward pan.
      if (dy > SWIPE_REVEAL_PX && dy > Math.abs(e.clientX - startX)) {
        fired = true;
        revealMapExit(container);
      }
    });
    const endSwipe = () => { tracking = false; };
    container.addEventListener('pointerup', endSwipe);
    container.addEventListener('pointercancel', endSwipe);
  }
}

/** Auto-hide delay for the fullscreen exit ✕ after it's revealed. */
const FS_EXIT_HIDE_MS = 3200;
/** Downward travel (px) that counts as a "swipe down" to reveal the exit ✕. */
const SWIPE_REVEAL_PX = 48;
/** @type {WeakMap<Element, number>} Live auto-hide timer per map section. */
const fsExitTimers = new WeakMap();

/**
 * True when `container` is the element currently in browser fullscreen.
 * @param {any} container
 */
function isMapFullscreen(container) {
  /** @type {any} */
  const d = globalThis.document;
  if (!d) return false;
  const cur = d.fullscreenElement || d.webkitFullscreenElement || null;
  return cur === container;
}

/** Coarse (touch) primary pointer — the only place the exit ✕ is needed. */
function isCoarsePointer() {
  const mm = globalThis.matchMedia;
  if (typeof mm !== 'function') return false;
  try { return mm('(pointer: coarse)').matches; } catch { return false; }
}

/**
 * Reveal the fullscreen exit ✕ and (re)arm its auto-hide timer. Touch only —
 * desktop keeps the corner button + Esc, so the centred ✕ never shows there.
 * @param {any} container
 */
function revealMapExit(container) {
  if (!container || !container.classList || !isCoarsePointer()) return;
  container.classList.add('fs-exit-visible');
  const prev = fsExitTimers.get(container);
  if (prev) globalThis.clearTimeout(prev);
  const set = globalThis.setTimeout;
  if (typeof set !== 'function') return;
  const id = set(() => {
    container.classList.remove('fs-exit-visible');
    fsExitTimers.delete(container);
  }, FS_EXIT_HIDE_MS);
  fsExitTimers.set(container, /** @type {any} */ (id));
}

/**
 * Hide the exit ✕ and clear any pending auto-hide timer.
 * @param {any} container
 */
function hideMapExit(container) {
  if (!container || !container.classList) return;
  container.classList.remove('fs-exit-visible');
  const prev = fsExitTimers.get(container);
  if (prev) { globalThis.clearTimeout(prev); fsExitTimers.delete(container); }
}

/**
 * Append the map's hide/show toggle chip, anchored top-left — the mirror
 * of the fullscreen chip in the opposite corner, sharing the exact same
 * button recipe (surface fill, hover, pink :active afterglow — all in
 * `common.css`) and icon weight so the two read as one set of map
 * controls. Click calls `onToggle`; flagQuiz collapses / re-mounts the map
 * and persists the choice. Built only when the caller passes an `onToggle`
 * (flagsdata omits it, so no chip there).
 *
 * The chip carries BOTH glyphs — an eye (show) and an eye-with-slash
 * (hide) — and CSS reveals the right one from the section's `.is-collapsed`
 * state, so the SAME button stays in the SAME spot and only its icon flips
 * when the map collapses. `label` is the already-translated aria-label for
 * the current state (hide when mounted, show when collapsed).
 *
 * @param {HTMLElement} container
 * @param {string} label
 * @param {() => void} onToggle
 */
export function addHideButton(container, label, onToggle) {
  if (!container || typeof container.appendChild !== 'function') return;
  const doc = container.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'map-hide-btn';
  btn.setAttribute('aria-label', label || 'Hide map');
  // A folded-map glyph so the control clearly reads as "the map" (not a
  // generic eye): a plain map (show) + a map with a diagonal slash (hide),
  // mirroring the eye / eye-off on-off convention. Line style at the same
  // 1.3 stroke weight the fullscreen / resize glyphs use. Both ship;
  // `.is-collapsed` on the section picks which shows (see flagMap.css).
  // The two fold lines are `<path>`, not `<line>`: flagMap.css hides every
  // bare `<line>` inside `#flag-map-section svg` (it kills the world map's
  // bundled coastline labels), which would blank the map's folds. Paths dodge
  // that rule, so the folds actually render.
  const map = '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>'
    + '<path d="M8 2 8 18"/><path d="M16 6 16 22"/>';
  const g = (inner) => '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
    + '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">'
    + inner + '</g></svg>';
  btn.innerHTML = `<span class="map-hide-ico map-hide-ico--hide">${g(map + '<path d="M3 3 21 21"/>')}</span>`
    + `<span class="map-hide-ico map-hide-ico--show">${g(map)}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle();
  });
  container.appendChild(btn);
}

/**
 * Cross-browser Fullscreen API toggle. Handles webkit-prefixed
 * variants for older Safari. No-op when the browser doesn't support
 * fullscreen (very old browsers).
 *
 * @param {HTMLElement} el
 */
function toggleFullscreen(el) {
  /** @type {any} */
  const doc = globalThis.document;
  const current = doc.fullscreenElement || doc.webkitFullscreenElement || null;
  if (current) {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) exit.call(doc);
    return;
  }
  /** @type {any} */
  const elAny = el;
  const enter = elAny.requestFullscreen || elAny.webkitRequestFullscreen;
  if (enter) enter.call(elAny);
}

/**
 * On a touch device, rotate the fullscreen map to landscape — the way a
 * fullscreen video does. The world map is ~2:1, so sliced into a tall portrait
 * viewport it crops to a sliver and forces awkward panning; landscape lets the
 * wide map fill a wide viewport and the pan/zoom behave normally.
 *
 * Only fires in fullscreen (where the Screen Orientation lock is permitted) and
 * only on a coarse-pointer device, so desktop keeps its native orientation.
 * Rejects silently where the lock API is unsupported — notably iOS Safari,
 * which also can't fullscreen a non-video element in the first place — leaving
 * the existing portrait slice-pan as the graceful fallback.
 */
function lockLandscapeOnTouch() {
  const mq = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia('(pointer: coarse)') : null;
  if (!mq || !mq.matches) return;
  /** @type {any} */
  const orientation = globalThis.screen && globalThis.screen.orientation;
  if (!orientation || typeof orientation.lock !== 'function') return;
  try {
    const p = orientation.lock('landscape');
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* unsupported / not allowed — portrait slice-pan stays the fallback */ }
}

/**
 * Release any orientation lock taken on fullscreen enter. Exiting fullscreen
 * already drops the lock per spec, so this is belt-and-suspenders — and a
 * no-op where the API is unsupported.
 */
function unlockOrientation() {
  /** @type {any} */
  const orientation = globalThis.screen && globalThis.screen.orientation;
  if (!orientation || typeof orientation.unlock !== 'function') return;
  try { orientation.unlock(); } catch { /* ignore */ }
}


/**
 * Hit-target radius in viewBox units, scaled to whatever viewBox is
 * currently set. Read AFTER cropToCountries so the size matches the
 * displayed crop, not the asset's natural viewBox.
 *
 * @param {{ getAttribute(name: string): string | null }} svg
 * @returns {number}
 */
function hitTargetRadius(svg) {
  const vb = typeof svg.getAttribute === 'function' ? svg.getAttribute('viewBox') : null;
  if (!vb) return 6;
  const parts = vb.split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return 6;
  return Math.max(2, Math.max(parts[2], parts[3]) * HIT_TARGET_FRACTION);
}

/**
 * Tag every element whose `id` is a 2-letter ISO 3166-1 alpha-2 code
 * with `.map-country`. Works on both Europe (`<path id="es">`) and the
 * world map (`<g id="cn">`) so the CSS targets one class regardless of
 * how the asset structures its countries. Composite ids like
 * `dk_kingdom` or Adobe-generated `st0` aren't tagged — the regex
 * rejects anything that isn't exactly two lowercase letters.
 *
 * @param {Element | SVGElement} svg
 */
export function tagCountryPaths(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  try {
    const all = svg.querySelectorAll('[id]');
    for (let i = 0; i < all.length; i++) {
      /** @type {any} */
      const el = all[i];
      if (typeof el.id === 'string' && MAP_CODE_PATTERN.test(el.id) && el.classList) {
        el.classList.add('map-country');
      }
    }
  } catch { /* ignore */ }
}

/**
 * Compute the bounding-box union of the named country paths, plus 5%
 * padding on each side and any `extra` (left/right/top/bottom)
 * directional padding. Returns the viewBox as `{ x, y, width, height }`
 * or `null` when no codes resolved (test env, no matches, etc.).
 *
 * Pure read-only — doesn't touch the SVG attribute. `cropToCountries`
 * is the side-effect wrapper that calls this + setAttribute.
 *
 * @param {{ querySelector(sel: string): any }} svg
 * @param {string[]} codes
 * @param {{ left?: number, right?: number, top?: number, bottom?: number }} [extra]
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function computeCountriesBbox(svg, codes, extra) {
  if (!svg || typeof svg.querySelector !== 'function') return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const code of codes) {
    if (typeof code !== 'string' || !MAP_CODE_PATTERN.test(code)) continue;
    const el = svg.querySelector(`#${code}`);
    if (!el || typeof el.getBBox !== 'function') continue;
    try {
      const bb = el.getBBox();
      if (!bb || (bb.width === 0 && bb.height === 0)) continue;
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
      if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
    } catch { /* skip */ }
  }
  if (!Number.isFinite(minX)) return null;
  return padBbox(minX, minY, maxX, maxY, extra);
}

/** Apply the shared 5% margin (plus optional per-side extra) to a raw bbox. */
function padBbox(minX, minY, maxX, maxY, extra) {
  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.05;
  const padY = h * 0.05;
  const extraLeft = (extra && extra.left) || 0;
  const extraRight = (extra && extra.right) || 0;
  const extraTop = (extra && extra.top) || 0;
  const extraBottom = (extra && extra.bottom) || 0;
  return {
    x: minX - padX - extraLeft,
    y: minY - padY - extraTop,
    width: w + 2 * padX + extraLeft + extraRight,
    height: h + 2 * padY + extraTop + extraBottom,
  };
}

/**
 * Gap between two axis-aligned bboxes: 0 if they touch/overlap, else the
 * straight-line distance between their nearest edges.
 */
function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

/**
 * Paths within this many viewBox units of each other count as the same
 * landmass for the fly-in. Tuned (on the 2754-wide world map) to keep real
 * archipelagos whole — Indonesia, Japan, Greece, the UK, New Zealand's two
 * main islands all cluster into one — while an ocean-separated overseas
 * territory (French Guiana, Alaska, the Canaries) falls into its own cluster
 * and drops out. Larger (~80) starts pulling Alaska back onto the US mainland
 * and the Canaries back onto Spain; this is the value that separates them.
 */
const FLY_CLUSTER_GAP = 40;

/**
 * Bbox of a country's main landmass for the answer fly-in: the largest
 * cluster of its map paths, padded. Countries whose `<g>` spans far-flung
 * overseas territories (France's French Guiana + Réunion, the USA's Alaska +
 * Hawaii, Spain's Canaries, Australia's Indian-Ocean islands, …) have a union
 * bbox that stretches across the globe, so the naive fly-in zooms the camera
 * all the way out. Clustering by proximity ({@link FLY_CLUSTER_GAP}) keeps
 * genuine archipelagos together but splits an ocean-separated territory off;
 * we then frame the biggest-by-area cluster (the mainland / home region).
 *
 * Falls back to the whole-country bbox for single-shape countries or when the
 * element can't be introspected (the common case is unaffected — a contiguous
 * country is one cluster, so this returns the same bbox as computeCountriesBbox).
 *
 * @param {any} svg
 * @param {string} code ISO2 country code
 * @param {{ left?: number, right?: number, top?: number, bottom?: number }} [extra]
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function computeMainlandBbox(svg, code, extra) {
  if (!svg || typeof svg.querySelector !== 'function') return null;
  if (typeof code !== 'string' || !MAP_CODE_PATTERN.test(code)) return null;
  const el = svg.querySelector(`#${code}`);
  if (!el || typeof el.querySelectorAll !== 'function') return computeCountriesBbox(svg, [code], extra);
  const boxes = [];
  for (const p of el.querySelectorAll('path, polygon, polyline')) {
    if (typeof p.getBBox !== 'function') continue;
    let b;
    try { b = p.getBBox(); } catch { continue; }
    if (!b || (b.width === 0 && b.height === 0)) continue;
    boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, area: b.width * b.height });
  }
  // Single shape (or nothing measurable): nothing to cluster, use the union.
  if (boxes.length < 2) return computeCountriesBbox(svg, [code], extra);
  // Union-find: connect paths whose bboxes are within FLY_CLUSTER_GAP.
  const parent = boxes.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (bboxGap(boxes[i], boxes[j]) <= FLY_CLUSTER_GAP) parent[find(i)] = find(j);
    }
  }
  // Pick the cluster with the largest total area (the main landmass).
  const areaByRoot = new Map();
  for (let i = 0; i < boxes.length; i++) {
    const r = find(i);
    areaByRoot.set(r, (areaByRoot.get(r) || 0) + boxes[i].area);
  }
  let bestRoot = -1;
  let bestArea = -1;
  for (const [r, a] of areaByRoot) if (a > bestArea) { bestArea = a; bestRoot = r; }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    if (find(i) !== bestRoot) continue;
    const b = boxes[i];
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (!Number.isFinite(minX)) return computeCountriesBbox(svg, [code], extra);
  return padBbox(minX, minY, maxX, maxY, extra);
}

/**
 * Set the SVG's viewBox to the bounding-box union of the named country
 * paths, plus padding. Used to focus a world map on a specific
 * continent without shipping a per-region asset. No-op when no codes
 * resolve.
 *
 * @param {{ querySelector(sel: string): any, setAttribute(name: string, value: string): void }} svg
 * @param {string[]} codes
 * @param {{ left?: number, right?: number, top?: number, bottom?: number }} [extra]
 */
export function cropToCountries(svg, codes, extra) {
  const bb = computeCountriesBbox(svg, codes, extra);
  if (!bb) return;
  svg.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
}

/**
 * Union the bbox of every descendant `<path>` of `el` and return it.
 * Used by `addHitTargets` to size a microstate's ring around the
 * country's complete geometry, not whatever the first path in DOM
 * order happens to be. Returns null when `el` has no path
 * descendants (the caller falls back to bbox'ing `el` itself — a
 * defensive path for any hypothetical single-path-no-wrapper country).
 *
 * `<circle>` and `<text>` descendants — the label locators and ISO
 * tags the BlankMap-World asset ships — are intentionally NOT
 * included: their positions are label-friendly offsets away from the
 * real landmass and would drag the union off into open water.
 *
 * @param {any} el
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function unionPathBbox(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return null;
  /** @type {ArrayLike<any>} */
  let paths;
  try { paths = el.querySelectorAll('path'); } catch { return null; }
  if (!paths || paths.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!p || typeof p.getBBox !== 'function') continue;
    let bb;
    try { bb = p.getBBox(); } catch { continue; }
    if (!bb || (bb.width === 0 && bb.height === 0)) continue;
    if (bb.x < minX) minX = bb.x;
    if (bb.y < minY) minY = bb.y;
    if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
    if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Bboxes of every `<path>` descendant of a microstate `<g>` (one per island
 * fragment), skipping empty / unmeasurable ones. Feeds `planIslandMarker`.
 *
 * @param {any} el
 * @returns {Array<{ x: number, y: number, width: number, height: number }>}
 */
function allPathBboxes(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return [];
  /** @type {ArrayLike<any>} */
  let paths;
  try { paths = el.querySelectorAll('path'); } catch { return []; }
  const out = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!p || typeof p.getBBox !== 'function') continue;
    let bb;
    try { bb = p.getBBox(); } catch { continue; }
    if (!bb || (bb.width === 0 && bb.height === 0)) continue;
    out.push({ x: bb.x, y: bb.y, width: bb.width, height: bb.height });
  }
  return out;
}

/**
 * Plan the visual marker for a (possibly multi-island) microstate from its
 * individual island bboxes. Pure geometry — returns which bbox the ring should
 * enclose, which island centers get a leader line back to that ring, and which
 * get an artificial land dot (their own footprint is sub-pixel).
 *
 *   - Single island, or a TIGHT cluster (the union is not much bigger than the
 *     largest island — Guadeloupe's touching lobes): one ring around the union,
 *     no leaders.
 *   - SPREAD islands, up to MARKER_MAX_POINTER_ISLANDS of them (Turks & Caicos /
 *     US Virgin Islands — a few specks strung across open water): ring on the
 *     largest island, a thin leader out to each of the others, so the circle
 *     stays small instead of a big empty disc. A many-island archipelago
 *     (Cape Verde) exceeds that cap and falls back to the enclosing circle.
 *
 * Dots are orthogonal: any island narrower than ISLAND_DOT_MAX_DIM gets one,
 * whether it hosts the ring or sits at the end of a leader.
 *
 * @param {Array<{ x: number, y: number, width: number, height: number }>} pieces
 * @returns {{ ring: { x: number, y: number, width: number, height: number },
 *   leaders: Array<{ cx: number, cy: number }>,
 *   dots: Array<{ cx: number, cy: number }> } | null}
 */
export function planIslandMarker(pieces) {
  const parts = (Array.isArray(pieces) ? pieces : [])
    .filter((p) => p && (p.width > 0 || p.height > 0));
  if (parts.length === 0) return null;
  const center = (p) => ({ cx: p.x + p.width / 2, cy: p.y + p.height / 2 });
  const maxDim = (p) => Math.max(p.width, p.height);
  const dots = parts.filter((p) => maxDim(p) < ISLAND_DOT_MAX_DIM).map(center);
  if (parts.length === 1) return { ring: parts[0], leaders: [], dots };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let main = parts[0], mainArea = parts[0].width * parts[0].height;
  for (const p of parts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.width); y1 = Math.max(y1, p.y + p.height);
    const a = p.width * p.height;
    if (a > mainArea) { mainArea = a; main = p; }
  }
  const union = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const spread = maxDim(union) > MARKER_SPREAD_FACTOR * maxDim(main)
    && parts.length <= MARKER_MAX_POINTER_ISLANDS;
  if (!spread) return { ring: union, leaders: [], dots };
  const leaders = parts.filter((p) => p !== main).map(center);
  return { ring: main, leaders, dots };
}

/**
 * Resolve a map click to a microstate by ring, not by the exact landmass
 * pixel under the pointer. Given the click point (svg user coords) and the
 * ring circles, return the `code` of the ring the point falls inside, picking
 * the one whose center is nearest RELATIVE to its radius — so a small circle
 * clicked dead-centre beats a big neighbour clicked at its rim. Returns null
 * when the point is inside no ring (the caller then falls back to the
 * ancestor-id walk for full-size countries).
 *
 * This is what makes the dense Caribbean click correctly: Guadeloupe,
 * Montserrat and Dominica rings all touch, but a click resolves to whichever
 * ring it sits deepest inside, deterministically and without depending on SVG
 * paint order (unlike native hit-testing on overlapping circles).
 *
 * @param {{ x: number, y: number }} pt  click point in svg user coords
 * @param {Array<{ cx: number, cy: number, r: number, code: string | null, hidden?: boolean }>} rings
 * @returns {string | null}
 */
export function pickNearestHitTarget(pt, rings) {
  if (!pt || !Array.isArray(rings)) return null;
  let best = null;
  let bestScore = Infinity;
  for (const ring of rings) {
    if (!ring || ring.hidden || !ring.code || !(ring.r > 0)) continue;
    const d = Math.hypot(pt.x - ring.cx, pt.y - ring.cy);
    if (d > ring.r) continue;
    const score = d / ring.r;
    if (score < bestScore) {
      bestScore = score;
      best = ring.code;
    }
  }
  return best;
}

/**
 * Make the asset's native microstate marker circles (`<circle class="circlexx">`
 * and the subnational-territory `<circle class="subxx">`) non-interactive.
 *
 * These are INVISIBLE by default (`opacity: 0` in worldMap.svg's own stylesheet)
 * but, like any painted SVG shape, still hit-test — and they're generous r≈6
 * discs planted at each microstate's label point. In the dense Caribbean they
 * overlap wildly (Montserrat's disc covers Guadeloupe's Basse-Terre lobe, etc.),
 * so a click on one island's land lands on a NEIGHBOUR's invisible marker and
 * resolves to the wrong country via the ancestor-id walk. On flagsdata we own
 * click resolution through the visible `.map-hit-target` rings + landmass-first
 * + `pickNearestHitTarget`, so these author markers must get out of the way.
 * We only read their geometry via `getBBox` (see `locatorBbox`), which is
 * unaffected by `pointer-events`, and they're invisible, so nothing changes
 * on screen.
 *
 * Scoped to flagsdata by its caller — the quiz still relies on these discs as
 * its microstate click area (it has no nearest-ring fallback), so don't call
 * this there.
 *
 * @param {Element | SVGElement} svg
 */
export function neutralizeMarkerCircles(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  let circles;
  try {
    circles = svg.querySelectorAll('.circlexx, .subxx');
  } catch { return; }
  for (let i = 0; i < circles.length; i++) {
    const c = /** @type {any} */ (circles[i]);
    if (c && typeof c.setAttribute === 'function') c.setAttribute('pointer-events', 'none');
  }
}

/**
 * Bbox of a microstate's `<circle class="circlexx">` locator (if it
 * has one). Used as the fallback ring position for antimeridian-
 * spanning countries where the union of path fragments produces a
 * meaningless half-the-map-wide bbox; the locator was placed by the
 * asset author at the country's label point, which sits on one of
 * the actual islands rather than in the middle of the open ocean.
 *
 * Returns null when the element has no locator or its bbox can't be
 * computed.
 *
 * @param {any} el
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function locatorBbox(el) {
  if (!el || typeof el.querySelector !== 'function') return null;
  let locator;
  try { locator = el.querySelector('circle'); } catch { return null; }
  if (!locator || typeof locator.getBBox !== 'function') return null;
  try {
    const bb = locator.getBBox();
    if (!bb || (bb.width === 0 && bb.height === 0)) return null;
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  } catch { return null; }
}

/**
 * Append a visible pink-ring `<circle class="map-hit-target">` over
 * each microstate so the click area is comfortably wide regardless of
 * the underlying path's geometry. Inherits the same answered / wrong
 * classes via `markCountry` so the click handler treats path and
 * overlay identically. Appended last so it draws over neighbouring
 * countries — a click in the overlay claims the microstate even if
 * the pixel sits in a neighbour's territory.
 *
 * @param {Element | SVGElement} svg
 * @param {number} radius  in viewBox units
 * @param {boolean} [hugIslands]  size each ring to its island (see HUG_* above)
 *   instead of the flat locator radius — used by the flagsdata browse map
 */
function addHitTargets(svg, radius, hugIslands = false) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return;
  /** @type {Document | null} */
  // @ts-ignore — ownerDocument is on real SVGs, not always on test fakes.
  const doc = svg.ownerDocument || null;
  if (!doc || typeof doc.createElementNS !== 'function') return;
  let smalls;
  try {
    smalls = svg.querySelectorAll('.is-small');
  } catch { return; }
  for (let i = 0; i < smalls.length; i++) {
    /** @type {any} */
    const elem = smalls[i];
    if (!elem || !elem.id) continue;
    // For `<g>`-wrapped microstates (BlankMap-World's structure for
    // Caribbean islands etc.), union the bbox of EVERY inner `<path>`
    // — the wrapper `<g>` also contains a `<circle class="circlexx">`
    // locator at a label-friendly offset that would shift the ring
    // center off into open water if included, so we explicitly union
    // the paths instead of bbox'ing the wrapper. Using ALL paths
    // (not just the first) matters for multi-island countries: the
    // Falkland Islands ship many path fragments — the first in DOM
    // order is a small outlying island, and East/West Falkland come
    // later, so the historical "use the first path" rule put the
    // ring on the wrong island. Same story for Saint Kitts & Nevis
    // (the first path is St Kitts, Nevis was orphaned). For any
    // direct-path microstate with no path descendants we fall back to
    // the element's own bbox.
    let bbox = unionPathBbox(elem);
    // Antimeridian-spanning microstates (Kiribati, in this asset) ship
    // path fragments on opposite sides of the date line — the union
    // bbox spans virtually the whole map, which would put the ring
    // center in the middle of the ocean AND inflate `data-country-r`
    // to ~globe-size, painting the entire map pink as soon as the
    // country is selected. Detect via "anything wider/taller than
    // half the asset's natural viewBox" and fall back to the `<g>`'s
    // sibling `<circle class="circlexx">` locator: that's an author-
    // chosen label point that sits on one of the real islands. We
    // also intentionally skip the country-r enclosure step in that
    // case (handled by the `oversized` flag below) so the ring stays
    // the normal constant-on-screen size.
    const naturalMaxDim = HIT_TARGET_FRACTION > 0 ? radius / HIT_TARGET_FRACTION : Infinity;
    const oversizeThreshold = naturalMaxDim * 0.4;
    let oversized = false;
    if (bbox && (bbox.width > oversizeThreshold || bbox.height > oversizeThreshold)) {
      oversized = true;
      bbox = locatorBbox(elem) || bbox;
    }
    // Hug mode: plan the marker from the country's individual islands — one
    // enclosing ring for a tight cluster (Guadeloupe), or a small ring on the
    // main island plus leaders to the others for a spread-out territory (Turks
    // & Caicos, US Virgin Islands). See planIslandMarker. `plan` also carries
    // the sub-pixel islands that need an artificial land dot (BVI, Bermuda).
    /** @type {ReturnType<typeof planIslandMarker>} */
    let plan = null;
    if (hugIslands && !oversized) {
      plan = planIslandMarker(allPathBboxes(elem));
      if (plan) bbox = plan.ring;
    } else if (hugIslands && oversized) {
      // Antimeridian country (Kiribati): the two island clusters sit on opposite
      // map edges, so there is no sane enclosing circle and a leader between
      // them would stretch across the whole world. Mark just the cluster at the
      // author's locator with a normal small hug ring + dot, instead of the flat
      // ~globe-scale ring that reads as a huge empty circle. `bbox` is currently
      // the locator; swap it for the actual island nearest the locator.
      const pieces = allPathBboxes(elem);
      if (pieces.length) {
        const lx = bbox.x + bbox.width / 2, ly = bbox.y + bbox.height / 2;
        const dist = (p) => Math.hypot(p.x + p.width / 2 - lx, p.y + p.height / 2 - ly);
        const main = pieces.reduce((a, b) => (dist(b) < dist(a) ? b : a));
        const md = Math.max(main.width, main.height);
        const center = { cx: main.x + main.width / 2, cy: main.y + main.height / 2 };
        plan = { ring: main, leaders: [], dots: md < ISLAND_DOT_MAX_DIM ? [center] : [] };
        bbox = main;
        oversized = false;   // size the ring like any other hugged island
      }
    }
    if (!bbox && typeof elem.getBBox === 'function') {
      try { bbox = elem.getBBox(); } catch { continue; }
    }
    if (!bbox || (bbox.width === 0 && bbox.height === 0)) continue;
    const rawCx = bbox.x + bbox.width / 2;
    const rawCy = bbox.y + bbox.height / 2;
    const { cx, cy } = offsetHitTargetCenter(elem.id, rawCx, rawCy);
    // For countries whose ring was shifted off the actual landmass to
    // separate from a co-located neighbour (mf / sx), draw a thin pink
    // leader line back to the real island bbox. Without it the rings
    // float in open water next to a visible-but-orphan landmass and
    // the player has to guess which country each ring belongs to.
    // Appended BEFORE the circle so the ring visually sits on top —
    // only the segment between the island and the ring's edge shows,
    // which reads as a balloon-pointer back to the country.
    if (cx !== rawCx || cy !== rawCy) {
      const leader = doc.createElementNS(SVG_NS, 'line');
      leader.setAttribute('x1', String(rawCx));
      leader.setAttribute('y1', String(rawCy));
      leader.setAttribute('x2', String(cx));
      leader.setAttribute('y2', String(cy));
      leader.setAttribute('class', 'map-hit-leader');
      leader.setAttribute('data-hit-for', elem.id);
      svg.appendChild(leader);
    }
    // `countryR` is the radius that encloses the country's own bbox (diagonal
    // / 2 + small pad). In hug mode the ring IS that size (floored), so a
    // speck gets a speck-sized circle; otherwise it's the flat locator radius.
    const countryR = oversized ? 0 : Math.hypot(bbox.width, bbox.height) / 2 + 0.5;
    const ringR = hugIslands && !oversized
      ? Math.max(HUG_MIN_RADIUS, countryR + HUG_RADIUS_MARGIN)
      : radius;
    const circle = doc.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(ringR));
    // `data-hit-for` carries the COUNTRY id (the outer `<g>` / `<path>`
    // with the ISO code), not the inner path-segment id that the bbox
    // came from. e.g. for `<g id="kn"><path id="kn-">...</path></g>`,
    // we want `data-hit-for="kn"` so the click handler resolves
    // correctly via byCode.
    circle.setAttribute('data-hit-for', elem.id);
    // `data-base-r` is the radius at the asset's natural viewBox.
    // mapZoom.js scales the live `r` attribute down as the viewBox
    // crops in, so the ring stays roughly the same on-screen size
    // regardless of zoom level (otherwise Liechtenstein's ring would
    // dwarf Switzerland on a zoomed-in Europe view).
    circle.setAttribute('data-base-r', String(ringR));
    // `data-country-r` (computed above) is the radius needed to enclose the
    // country's own bbox. mapZoom's rescaleHitTargets picks max(baseR *
    // scale, countryR) so the ring never renders smaller than the country it
    // points to. `oversized` (antimeridian-spanning) skips the enclosure so
    // the ring stays the normal constant-on-screen size — the alternative
    // would inflate the ring to half the map.
    circle.setAttribute('data-country-r', String(countryR));
    circle.setAttribute('class', 'map-hit-target');
    circle.setAttribute('fill', 'transparent');
    // Spread-island leaders: a thin pointer from the ring out to each of the
    // country's other islands, so a scattered territory reads as one country
    // without a big enclosing circle. Appended BEFORE the ring (same trick as
    // the mf/sx offset leader above) so the ring draws over the inner segment.
    if (plan && plan.leaders.length) {
      for (const lead of plan.leaders) {
        const line = doc.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(cx));
        line.setAttribute('y1', String(cy));
        line.setAttribute('x2', String(lead.cx));
        line.setAttribute('y2', String(lead.cy));
        line.setAttribute('class', 'map-hit-leader');
        line.setAttribute('data-hit-for', elem.id);
        svg.appendChild(line);
      }
    }
    svg.appendChild(circle);
    // Artificial land dots for islands too small to see (British Virgin
    // Islands, Bermuda, the outlying specks of Turks & Caicos) so no ring or
    // leader ends in empty water. Constant on screen via data-base-r (like the
    // rings), carry the country's data-hit-for so a click on the dot resolves,
    // and pick up is-marked (yellow) through flagFillTargets. Appended AFTER
    // the ring so they sit on top of it.
    if (plan && plan.dots.length) {
      for (const d of plan.dots) {
        const dot = doc.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(d.cx));
        dot.setAttribute('cy', String(d.cy));
        dot.setAttribute('r', String(ISLAND_DOT_RADIUS));
        dot.setAttribute('data-base-r', String(ISLAND_DOT_RADIUS));
        dot.setAttribute('data-country-r', String(ISLAND_DOT_MIN_RADIUS));
        dot.setAttribute('data-hit-for', elem.id);
        dot.setAttribute('class', 'map-island-dot');
        svg.appendChild(dot);
      }
    }
  }
}

/**
 * Tag the curated set of microstates with `.is-small` so they pick up
 * the pink-ring marker overlay. We used to auto-detect via getBBox
 * but the world-map asset wraps each country in a `<g>` that also
 * contains a hidden `<circle r=6>` locator. getBBox on the `<g>`
 * returns the inflated union, which dodged true microstates and
 * mis-tagged mid-size ones. A hardcoded list is data, not magic —
 * predictable and easy to extend.
 *
 * `scope` (optional Set of lowercase ISO2 codes) further filters —
 * an Asian round doesn't tag European microstates and vice versa.
 *
 * @param {Element | SVGElement} svg
 * @param {Set<string> | null} [scope]
 */
function tagMicrostates(svg, scope = null) {
  if (!svg || typeof svg.querySelector !== 'function') return;
  for (const code of MICROSTATE_CODES) {
    if (scope && !scope.has(code)) continue;
    /** @type {any} */
    const el = svg.querySelector(`#${code}`);
    if (el && el.classList) el.classList.add('is-small');
  }
}
