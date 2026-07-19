import { CONTINENTS, loadCountries, attachMetrics } from '../flags/group.js';
import { ALL_FLAG_COLORS, ALL_MOTIFS, STRIPES_ORIENTATIONS_FOR_RANDOM, METRIC_KEYS, foldDiacritics } from '../flags/engine.js';
import { emptyFilters, matchesFilters, createColorCountLock, activeFilterChips } from '../flags/flagsFilter.js';
import { makeColorSwatch } from '../common.js';
import { buildMetricTierItems } from '../flags/metricTiers.js';
import { buildFilterChip, chipLabelText } from '../flags/filterChips.js';
import { createColorCountPicker } from '../colorCountPicker.js';
import { createMetric } from '../flags/metrics.js';
import { METRIC_FILES } from '../flags/metrics/index.js';
import { computeLensView } from '../flags/metricLens.js';
import { createMetricHub } from '../flags/metricHub.js';
import { chipMetrics, cutsFor, resolveCut } from '../flags/metricCuts.js';
import { fitChipRow, rowGap } from '../flags/chipRowFit.js';
import { t, countryName } from '../i18n.js';
import { bindTileCountry, refreshTileNames } from '../langRefresh.js';
import { openFlagZoom, wireFlagZoomBackdropClose } from '../flags/flagZoom.js';
import { wireFlagLightbox, wireFlagLightboxAll } from '../flags/flagLightbox.js';
import { getFlagFacts } from '../flags/flagFacts.js';
import { renderFlagFacts, renderImageCredit } from '../flags/flagFactsRender.js';
import { mountFlagMap, addHideButton, highlightCountry, unhighlightCountry, computeCountriesBbox, pickNearestHitTarget, neutralizeMarkerCircles } from '../flagQuiz/flagMap.js';
import { mountCaribInset, CARIB_INSET_CODES } from '../flagQuiz/caribInset.js';
import { attachZoomPan } from '../flagQuiz/mapZoom.js';
import { buildToggleLi } from '../common.js';

/**
 * Per-device "Show map" preference for flagsdata. Defaults to true.
 * Stored under a flagsdata-specific key so toggling the quiz's show-
 * map off doesn't kill the map on the browse page (and vice versa) —
 * they're independent surfaces with different jobs.
 *
 * Storage convention mirrors `isQuizShowMap`: `'true'` or missing
 * reads as default-on; `'false'` is the persisted opt-out.
 *
 * @param {{ getItem(k: string): string | null } | null} [store]
 * @returns {boolean}
 */
const FLAGSDATA_SHOW_MAP_KEY = 'gridgame.flagsdata.showMap';
function isFlagsdataShowMap(store) {
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return true;
  try { return s.getItem(FLAGSDATA_SHOW_MAP_KEY) !== 'false'; } catch { return true; }
}
/**
 * @param {{ setItem(k: string, v: string): void }} store
 * @param {boolean} value
 */
function setFlagsdataShowMap(store, value) {
  if (!store) return;
  try { store.setItem(FLAGSDATA_SHOW_MAP_KEY, value ? 'true' : 'false'); } catch { /* ignore */ }
}

/**
 * Per-device "Full width" preference for flagsdata. Defaults to FALSE
 * (the site's centred column is the norm; edge-to-edge is the opt-in).
 * Unlike show-map, the sense is inverted: only an explicit `'true'`
 * turns it on, so a missing key reads as the centred default. The sync
 * head script in index.html reads this same key/value to stamp `is-wide`
 * before first paint — keep the literal in step if this key ever moves.
 *
 * @param {{ getItem(k: string): string | null } | null} [store]
 * @returns {boolean}
 */
const FLAGSDATA_WIDE_KEY = 'gridgame.flagsdata.wide';
function isFlagsdataWide(store) {
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return false;
  try { return s.getItem(FLAGSDATA_WIDE_KEY) === 'true'; } catch { return false; }
}
/**
 * @param {{ setItem(k: string, v: string): void }} store
 * @param {boolean} value
 */
function setFlagsdataWide(store, value) {
  if (!store) return;
  try { store.setItem(FLAGSDATA_WIDE_KEY, value ? 'true' : 'false'); } catch { /* ignore */ }
}

/** @param {string} v */
function statusLabel(v) {
  return t(`status.${v}`, STATUS_LABELS[/** @type {keyof typeof STATUS_LABELS} */ (v)]);
}

/** @param {string} name */
function continentLabel(name) {
  if (name === 'Other') return t('continent.other', 'Other');
  const key = name.toLowerCase().replace(/ /g, '-');
  return t(`variant.${key}`, name);
}

/** @param {string} v */
function colorLabel(v) {
  return t(`color.${v}`, v);
}

/** @param {string} v */
function motifLabel(v) {
  return t(`motif.${v}`, v);
}

/** @param {string} v */
function stripesOnlyLabel(v) {
  return t(`stripesOnly.${v}`, `${v} stripes only`);
}

/** @typedef {import('../flags/group.js').Country} Country */
/** @typedef {import('../flags/group.js').Sovereignty} Sovereignty */

/** @type {Sovereignty[]} */
const STATUS_VALUES = ['sovereign', 'non_un', 'territory', 'other'];
/** @type {Record<Sovereignty, string>} */
const STATUS_LABELS = {
  sovereign: 'Sovereign',
  non_un: 'Non-UN',
  territory: 'Territory / Region',
  other: 'Other',
};

export function bootFlagsData() {
  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomData = /** @type {HTMLElement} */ (zoom.querySelector('.country-data'));
  // The full JSON dump under the zoomed flag is a data-audit tool for
  // checking colour/motif/status fields against the SVG — not something
  // a regular visitor needs. Gate behind a `?audit` query string so it's
  // off by default everywhere (local and prod alike) and can be enabled
  // by appending `?audit` when investigating an anomaly. Same behaviour
  // both environments — no localhost special-case — so what dev sees is
  // what prod sees once the flag is on.
  const SHOW_DATA = new URLSearchParams(window.location.search).has('audit');
  if (!SHOW_DATA) zoomData.hidden = true;
  const zoomFacts = /** @type {HTMLElement} */ (zoom.querySelector('.country-facts'));
  // Image-credit footer, a sibling after `.country-data` so it reads as the
  // popup's footer (below the audit JSON), not sandwiched between the story
  // and the raw data. Filled by paintFacts.
  const zoomCredit = /** @type {HTMLElement} */ (zoom.querySelector('.country-credit'));

  // The flag currently shown in the zoom, so a soft language switch can
  // re-render its facts panel in the new language while the dialog stays
  // open (softReload keeps it open across the switch).
  /** @type {Country | null} */
  let zoomCountry = null;

  /**
   * Populate the facts panel for the zoomed country (or empty + hide it
   * when there's no story). Adds `has-facts` to the dialog so the CSS can
   * widen + scroll the popup only when there's content to show.
   *
   * @param {Country | null} c
   */
  function paintFacts(c) {
    zoomFacts.innerHTML = '';
    zoomCredit.innerHTML = '';
    const facts = c ? getFlagFacts(c.code) : null;
    zoom.classList.toggle('has-facts', !!facts);
    zoomFacts.hidden = !facts;
    // Credit shows only when there's a story (unchanged), but now lives in its
    // own footer slot after the JSON rather than at the tail of the facts panel.
    zoomCredit.hidden = !facts;
    if (!facts) return;
    const subtree = renderFlagFacts({ facts, t, doc: document, base: '../flags/' });
    if (subtree) zoomFacts.appendChild(subtree);
    zoomCredit.appendChild(renderImageCredit({ t, doc: document }));
    // The story's historical flags enlarge in the same lightbox as the
    // headline flag. Re-wired each paint because the subtree is rebuilt.
    wireFlagLightboxAll(zoomFacts, t);
  }

  /** @param {Country} c */
  function openZoom(c) {
    const displayName = countryName(c);
    openFlagZoom(zoom, { code: c.code, displayName, svgBase: '../flags/svg/' });
    // showModal() autofocuses the first focusable child (the × button),
    // which paints a focus ring on every open. Move focus to the dialog
    // itself (tabindex="-1", outline suppressed) so the × only shows a ring
    // when a keyboard user Tabs to it. Esc still closes natively.
    zoom.focus();
    zoomCountry = c;
    paintFacts(c);
    if (SHOW_DATA) {
      // Fold in the world-metric values (population, …) that live outside
      // countries.json, so the audit dump shows them too. Each metric's value
      // map is sparse, so a country the metric doesn't cover reads `null`.
      const metrics = {};
      for (const m of METRIC_FILES) {
        metrics[m.key] = metricsData[m.key]?.values?.[c.code] ?? null;
      }
      zoomData.textContent = JSON.stringify({ ...c, ...metrics }, null, 2);
    }
  }
  wireFlagZoomBackdropClose(zoom);
  // Tap the headline flag to enlarge it in a lightbox (shared with the home
  // page + flagQuiz). Wired once; reads the img's live src on tap.
  wireFlagLightbox(zoom.querySelector('img'), t);
  // Explicit close button (top-right). The backdrop-tap target shrinks to a
  // thin frame once the facts popup goes near-full-screen on mobile, so the
  // × is the reliable way out. Native Esc-to-close still works too.
  const zoomCloseBtn = zoom.querySelector('.zoom-close');
  if (zoomCloseBtn) zoomCloseBtn.addEventListener('click', () => zoom.close());
  // Clear the tracked country when the dialog closes so a later soft
  // language switch doesn't try to re-render a stale facts panel.
  zoom.addEventListener('close', () => { zoomCountry = null; });

  /** @param {Country} c */
  function flagTile(c) {
    const displayName = countryName(c);
    const wrap = document.createElement('div');
    // `flag-tile` (common.css) carries the shared thumbnail + hover name-strip;
    // `flag` keeps the page-local bits (zoom cursor, the metric-lens overlay).
    wrap.className = 'flag flag-tile';
    wrap.dataset.name = displayName;
    bindTileCountry(wrap, c);
    wrap.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = displayName;
    img.loading = 'lazy';
    wrap.appendChild(img);
    // Metric-lens overlay — a top strip showing "#rank · value" for the active
    // metric. Empty + hidden until a lens is picked (renderLens fills it).
    const metric = document.createElement('span');
    metric.className = 'flag-metric';
    metric.hidden = true;
    wrap.appendChild(metric);
    return wrap;
  }

  // Sovereign is preselected on first load (Jan's call, 2026-07-13): the
  // page opens on the 195 recognisable countries, with the full 269
  // (territories, subnational regions, org flags) one visible tap away.
  // The default is an ordinary include on the always-visible Sovereign
  // teaser pill, so nothing is hidden: the pill renders active, the count
  // reads "195 / 269", and tapping the pill (or Clear) shows everything.
  const filters = emptyFilters();
  filters.status.include.add('sovereign');
  /** Diacritic-folded substring of the name search input. Empty means the
   * filter is off. Stored as the folded form so we don't refold per-tile
   * on every input event — the per-country fold is the same idea, computed
   * once in renderAll. */
  let nameQuery = '';

  // "No other colours" toggle pill — state lives in the shared
  // createColorCountLock so findFlag and flagsdata can't drift on what
  // "only these colours" means. Page owns the DOM (button below) and
  // calls into the lock from three places: the toggle click, every
  // color pill click (sync), and Clear (reset).
  const colorCountLock = createColorCountLock(filters);
  /** @type {HTMLButtonElement | null} */
  let onlyColorsBtn = null;

  // "Colour count" widget — segmented op + N picker shared with the
  // findFlag chooser. Both surfaces write to `filters.colorCount`, so
  // engaging the picker resets the lock and vice versa.
  const colorCountPicker = createColorCountPicker(filters, t, {
    onChange: () => applyFilter(),
    onPicked: () => {
      // Picker just took over `filters.colorCount`. Disengage the lock
      // *cosmetically* — DON'T call lock.reset() here, because that
      // would clobber the value the picker just wrote.
      colorCountLock.disengage();
      if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
    },
  });

  /** @type {{ items: Country[], foldedTerms: string[][], tiles: HTMLElement[], count: HTMLElement } | null} */
  let state = null;
  /** The grid element, kept so the lens can reorder its children on sort. */
  let gridEl = /** @type {HTMLElement | null} */ (null);

  // --- Metric lens state (Feature DE). Off by default: flagsdata stays a flag
  // explorer, the lens is opt-in. `lensKey` is the active metric key (or null),
  // `lensMetric` its createMetric instance (rebuilt when items load), `lensSort`
  // the tile order. All metric logic lives here via createMetric — it never
  // enters the shared per-flag filter DSL. See DATA_FEATURE.md Feature DE.
  /** The open CHIP, which for a grouped subject is not the metric being read —
   * see `lensMetricKey()`.
   * @type {string | null} */
  let lensKey = null;
  /** Which cut each grouped chip is showing, remembered for the session so a
   * chip you set to "Per person" is still per person when you come back to it
   * (and so a tier applied to that cut stays interpretable after the panel
   * closes). Ungrouped metrics never appear here.
   * @type {Record<string, 'total' | 'per'>} */
  const lensCutByKey = {};
  /** @type {ReturnType<typeof createMetric> | null} */
  let lensMetric = null;
  /** @type {'default' | 'desc' | 'asc'} */
  let lensSort = 'default';
  /** Raw metric data, fetched at boot (browser can't statically import JSON).
   * @type {Record<string, import('../flags/metrics.js').MetricData>} */
  let metricsData = {};

  // "Full width" toggle in the burger menu — flagsdata's burger panel ships
  // with just the coffee link, so we insert the toggle here at boot. Lets the
  // browse page drop its centred column so more flag columns and a wider map
  // fit the screen. Off by default; persisted per device. The sync head script
  // already applied `is-wide` on first paint; this keeps it live + in step.
  const burgerMenuEl = /** @type {HTMLUListElement | null} */ (
    document.querySelector('#burger-panel .menu')
  );
  if (burgerMenuEl) {
    // Insert BEFORE the coffee link's <li> so the menu reads: nickname (top,
    // its own divider) → full-width → coffee. Falls back to append-at-end if
    // the page ever stops carrying a coffee link.
    const toggleLi = buildToggleLi({
      label: t('menu.wideScreen', 'Full width'),
      labelKey: 'menu.wideScreen',
      initial: isFlagsdataWide(),
      // No reload — flipping a CSS class on <html> reflows the layout live.
      reload: false,
      onChange: (checked) => applyWidePreference(checked),
    });
    // Desktop-only affordance: below the 756px content cap the body already
    // fills the viewport, so the toggle would be a no-op. A media query in
    // index.css hides it on narrow screens (see `.flagsdata-wide-toggle`).
    toggleLi.classList.add('flagsdata-wide-toggle');
    const coffeeLink = burgerMenuEl.querySelector('.menu-coffee');
    const coffeeLi = coffeeLink ? coffeeLink.closest('li') : null;
    if (coffeeLi) burgerMenuEl.insertBefore(toggleLi, coffeeLi);
    else burgerMenuEl.appendChild(toggleLi);
  }

  /**
   * Persist the "Full width" choice and reflect it live by toggling the
   * `is-wide` class on <html> (the same class the sync head script stamps on
   * load). The CSS override lives in index.css.
   * @param {boolean} wide
   */
  function applyWidePreference(wide) {
    setFlagsdataWide(localStorage, wide);
    document.documentElement.classList.toggle('is-wide', wide);
    // A map resized (session-only inline width) while full-width would keep
    // that width when the centred column returns, where the body clips it to a
    // centred slice. Drop it so the map falls back to filling whichever layout
    // is now active; the handle is hidden in the column anyway.
    if (flagMapEl) flagMapEl.style.width = '';
  }

  // World contour map below the grid — every country matching the active
  // filter is highlighted with a flat yellow fill (`markCountry`), not its
  // flag. flagsdata highlights the whole world at once, so painting ~250 flag
  // <image>s would decode a raster per country and hitch the tab; a solid fill
  // has no decode, so it stays smooth and needs none of the tint / throttled-
  // reveal / re-reveal-on-zoom machinery flagQuiz's flag map carries. Mount is
  // async; `mapSvg` stays null until the fetch resolves and `syncMapFlags`
  // safely no-ops in the meantime. Gated on the per-device show-map preference.
  const flagMapEl = /** @type {HTMLElement | null} */ (
    document.getElementById('flag-map-section')
  );
  /** @type {SVGElement | null} */
  let mapSvg = null;
  /** @type {ReturnType<typeof attachZoomPan> | null} */
  let mapHandle = null;
  /** @type {Map<string, Country> | null} */
  let byCode = null;
  // Codes currently marked on the map. Kept so each filter change only touches
  // the delta — mark the newly-matched countries, un-mark the ones that dropped
  // out — instead of clearing and re-marking the whole (up to ~250-country) set
  // on every keystroke of the name search.
  /** @type {Set<string>} */
  let flaggedCodes = new Set();

  /** @param {string[]} visibleCodes */
  function syncMapFlags(visibleCodes) {
    if (!mapSvg) return;
    const next = new Set(visibleCodes);
    for (const code of flaggedCodes) {
      if (!next.has(code)) unhighlightCountry(mapSvg, code);
    }
    for (const code of next) {
      if (!flaggedCodes.has(code)) highlightCountry(mapSvg, code);
    }
    flaggedCodes = next;
  }
  // Map a click to svg user coords via the live screen CTM, so ring
  // hit-testing works at any zoom / pan. Null off the real DOM (tests).
  /** @param {any} svg @param {any} e @returns {{x:number,y:number}|null} */
  function svgPointFromEvent(svg, e) {
    if (!svg || typeof svg.getScreenCTM !== 'function'
      || typeof svg.createSVGPoint !== 'function') return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const local = p.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }
  // Snapshot the microstate ring circles (center, current radius, country,
  // and whether hidden as a suppressed inset speck) for pickNearestHitTarget.
  /** @param {any} svg */
  function microstateRings(svg) {
    /** @type {Array<{cx:number,cy:number,r:number,code:string|null,hidden:boolean}>} */
    const out = [];
    const nodes = svg.querySelectorAll('.map-hit-target');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      out.push({
        cx: parseFloat(el.getAttribute('cx')),
        cy: parseFloat(el.getAttribute('cy')),
        r: parseFloat(el.getAttribute('r')),
        code: el.getAttribute('data-hit-for'),
        hidden: !!(el.classList && el.classList.contains('carib-insetted')),
      });
    }
    return out;
  }
  // A comfortable zoom box around a microstate's marker ring — used for
  // antimeridian countries (Kiribati) whose landmass bbox spans the map, so we
  // frame the marker instead. Floored to MARKER_VIEW_SPAN vbu so the view keeps
  // some ocean context around the tiny ring rather than filling with it.
  const MARKER_VIEW_SPAN = 60;
  /** @param {any} svg @param {string} code @returns {{x:number,y:number,width:number,height:number}|null} */
  function markerRingBox(svg, code) {
    const ring = svg.querySelector(`.map-hit-target[data-hit-for="${code}"]`);
    if (!ring) return null;
    const cx = parseFloat(ring.getAttribute('cx'));
    const cy = parseFloat(ring.getAttribute('cy'));
    const r = parseFloat(ring.getAttribute('r'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return null;
    const span = Math.max(MARKER_VIEW_SPAN, r * 4);
    return { x: cx - span / 2, y: cy - span / 2, width: span, height: span };
  }
  /** Union of two {x,y,width,height} boxes. */
  function unionBbox(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.width, b.x + b.width);
    const y1 = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: x1 - x, height: y1 - y };
  }
  // Countries whose `<g>` spans the antimeridian on the world map —
  // their full bbox is the whole map width, so including them in a
  // smart-zoom bbox union would defeat the zoom. They still get
  // marked via syncMapFlags; they just don't pull the crop.
  // Mirrors the same list flagQuiz uses for per-variant crops.
  const ANTIMERIDIAN = new Set(['us', 'ru', 'fj', 'ki']);
  // --- Map show / hide (mirrors flagQuiz/page.js) --------------------------
  // The hide chip (top-left of the map) and the burger "Show map" toggle are
  // two faces of one control: either collapses the map to a slim strip (SVG
  // unmounted — the real perf relief) or re-mounts it, persisting the choice to
  // `gridgame.flagsdata.showMap`. Same mechanism + shared CSS as the quiz map,
  // per CLAUDE.md's "same behaviour = same code".
  let mapMounted = false;

  function mountMap() {
    if (!flagMapEl) return;
    mapMounted = true;
    flagMapEl.hidden = false;
    flagMapEl.setAttribute('aria-hidden', 'false');
    // Leaving the collapsed strip: drop `.is-collapsed` so the chip flips back
    // to its "hide" glyph. mountFlagMap replaces innerHTML, rebuilding the chip.
    flagMapEl.classList.remove('is-collapsed');
    // A fresh SVG carries no marks; reset so applyFilter re-marks the current
    // selection from a clean slate instead of diffing against a stale set.
    flaggedCodes = new Set();
    void mountFlagMap({
      container: flagMapEl,
      url: '../flagQuiz/worldMap.svg',
      fullscreenLabel: t('menu.fullscreen', 'Toggle fullscreen'),
      // Resizable via the bottom-right corner handle, but index.css only
      // reveals the handle in full-width mode. In the centred 756px column the
      // map already fills its width and a wider drag would just be clipped by
      // the body (overflow-x: clip); full-width mode spans the viewport, so the
      // centred map can grow to the window edges exactly like the quiz map.
      resizable: true,
      // Microstate rings here are non-interactive markers (clicks resolve on
      // the island itself), so size each to its own island rather than a flat
      // locator radius — the full-size rings dwarf tiny territories like
      // Montserrat / Turks & Caicos and overlap their neighbours.
      hugIslands: true,
      // Top-left chip → collapse the map in place (chip flips to a "show" map
      // glyph) and persist, the same path the burger toggle drives.
      onToggle: toggleMapVisibility,
      toggleLabel: t('menu.hideMap', 'Hide map'),
    }).then((svg) => {
      mapSvg = svg;
      if (svg) {
        mapHandle = attachZoomPan(svg, { containZoomOut: true, freePan: false });
        // The asset's invisible microstate marker discs (`.circlexx` / `.subxx`,
        // r≈6, opacity 0) still hit-test and blanket the Caribbean, stealing
        // clicks from the island underneath and resolving to a neighbour. We
        // own click resolution here via the visible hit-target rings +
        // landmass-first + pickNearestHitTarget, so switch those discs off.
        neutralizeMarkerCircles(svg);
        // Anguilla, Saint-Martin, Sint Maarten and Saint-Barthélemy sit piled
        // on top of one another in worldMap.svg (sub-pixel specks, overlapping
        // rings, ambiguous clicks). Redraw them at zoom in open North-Atlantic
        // ocean, and hide the in-place specks + rings so nothing is doubled.
        // The inset islands carry data-hit-for, so clicks + filter highlighting
        // flow through the same machinery as the rest of the map.
        // Open Atlantic just east of the Lesser Antilles arc, with a pointer
        // line back to the islands' real location (~826,542 on this map) so
        // it reads as a zoom of that spot rather than free-floating.
        mountCaribInset(svg, {
          x: 900, y: 440, scale: 0.5,
          connectTo: { x: 826, y: 542 },
        });
        for (const code of CARIB_INSET_CODES) {
          const inPlace = svg.querySelector(`#${code}`);
          if (inPlace) inPlace.classList.add('carib-insetted');
          const specks = svg.querySelectorAll(
            `.map-hit-target[data-hit-for="${code}"], .map-hit-leader[data-hit-for="${code}"], .map-island-dot[data-hit-for="${code}"]`,
          );
          specks.forEach((el) => el.classList.add('carib-insetted'));
        }
      }
      // Apply the current filter selection now that the map is
      // mounted — without this, the initial filter state would
      // never get reflected on the map.
      if (state) applyFilter();
    });
  }

  function hideMap() {
    if (!flagMapEl) return;
    mapMounted = false;
    if (mapHandle) mapHandle.teardown();
    mapHandle = null;
    mapSvg = null;
    flaggedCodes = new Set();
    renderCollapsedMap();
  }

  /**
   * Render the collapsed strip: the section stays visible but holds only the
   * toggle chip (no SVG), so the chip keeps its exact top-left position and
   * flips to the "show map" glyph. Shared by hideMap and the initial paint when
   * the map is off. Rebuilt here because mountFlagMap's innerHTML wipes it.
   */
  function renderCollapsedMap() {
    if (!flagMapEl) return;
    flagMapEl.hidden = false;
    flagMapEl.setAttribute('aria-hidden', 'false');
    flagMapEl.classList.add('is-collapsed');
    flagMapEl.innerHTML = '';
    addHideButton(flagMapEl, t('menu.showMap', 'Show map'), toggleMapVisibility);
  }

  /** @param {boolean} show */
  function setMapVisible(show) { if (show) mountMap(); else hideMap(); }
  /** The chip's click: flip to the opposite of the current state. */
  function toggleMapVisibility() { applyMapPreference(!mapMounted); }
  /**
   * Single entry point for the map's toggle chip: persist to
   * `gridgame.flagsdata.showMap` and apply live. The chip (a "show" chip even
   * on the collapsed strip) is the only show/hide control — no burger toggle.
   * @param {boolean} show
   */
  function applyMapPreference(show) {
    setFlagsdataShowMap(localStorage, show);
    setMapVisible(show);
  }

  // Click → flag-zoom popup. Registered once on the container (which persists
  // across mount/collapse); safely no-ops while collapsed since `mapSvg` and
  // `byCode` are null / the strip has no country elements. Resolution order:
  //   1. a `data-hit-for` element directly under the pointer (the inset
  //      islands carry it) — an explicit hit wins;
  //   2. the actual LANDMASS clicked — walk up the ancestors for the first
  //      id that's a known country code. Land wins over rings: every piece
  //      of Guadeloupe (both butterfly wings + Marie-Galante) resolves to
  //      Guadeloupe even though the outlying pieces sit outside Guadeloupe's
  //      own ring and inside a neighbour's;
  //   3. only when the click hit open ocean (no landmass), the nearest
  //      microstate ring the point falls inside — so clicking just off a
  //      tiny island still selects it.
  if (flagMapEl) {
    flagMapEl.addEventListener('click', (e) => {
      if (!byCode) return;
      const target = /** @type {any} */ (e.target);
      if (!target) return;
      let code = (typeof target.getAttribute === 'function')
        ? target.getAttribute('data-hit-for')
        : null;
      if (!code) {
        let el = /** @type {Element | null} */ (target);
        while (el) {
          const id = el.id;
          if (id && byCode.has(id)) { code = id; break; }
          el = el.parentElement;
        }
      }
      if (!code && mapSvg) {
        const pt = svgPointFromEvent(mapSvg, e);
        if (pt) code = pickNearestHitTarget(pt, microstateRings(mapSvg));
      }
      if (!code) return;
      const country = byCode.get(code);
      if (!country) return;
      openZoom(country);
    });
  }

  // Initial paint: live map or the collapsed chip per the saved preference.
  if (flagMapEl) {
    if (isFlagsdataShowMap()) mountMap();
    else renderCollapsedMap();
  }

  // Folded search terms for a country's name filter: the English canonical
  // name (so English search works in any UI language, matching how the quiz
  // answer-input resolves names), the current localized display name, and any
  // aliases (e.g. "Great Britain" / "Holland"). The localized name changes on
  // a soft language switch, so these are rebuilt in the `langchanged` handler.
  /** @param {Country} c @returns {string[]} */
  function searchTermsFor(c) {
    const terms = [foldDiacritics(c.name), foldDiacritics(countryName(c))];
    if (c.aliases) for (const a of c.aliases) terms.push(foldDiacritics(a));
    return terms;
  }

  function renderAll(parent, items) {
    const h2 = document.createElement('h2');
    // Use data-i18n so applyStringsToDocument re-translates the heading
    // on a soft language switch without a manual listener. The count
    // span is appended as a child so the text-only re-application from
    // applyTextContent doesn't clobber it: we keep the title inside its
    // own span and put the count outside that.
    const h2Title = document.createElement('span');
    h2Title.setAttribute('data-i18n', 'domain.flags');
    h2Title.textContent = t('domain.flags', 'Flags');
    h2.appendChild(h2Title);
    const countSpan = document.createElement('span');
    countSpan.className = 'section-count';
    countSpan.textContent = String(items.length);
    h2.appendChild(countSpan);
    parent.appendChild(h2);
    const grid = document.createElement('div');
    grid.className = 'grid';
    /** @type {HTMLElement[]} */
    const tiles = [];
    /** @type {string[][]} */
    const foldedTerms = [];
    for (const c of items) {
      const tile = flagTile(c);
      tiles.push(tile);
      foldedTerms.push(searchTermsFor(c));
      grid.appendChild(tile);
    }
    parent.appendChild(grid);
    gridEl = grid;
    state = { items, foldedTerms, tiles, count: countSpan };
    // Build the code→country lookup once items are known — the click
    // handler on the map needs it to resolve a clicked path's ISO2
    // code to a Country for the flag-zoom popup.
    byCode = new Map(items.map((c) => [c.code, c]));
  }

  function applyFilter() {
    if (!state) return;
    let visible = 0;
    /** @type {string[]} */
    const visibleCodes = [];
    for (let i = 0; i < state.items.length; i++) {
      const catMatch = matchesFilters(state.items[i], filters);
      const nameMatch =
        nameQuery === '' || state.foldedTerms[i].some((term) => term.includes(nameQuery));
      const show = catMatch && nameMatch;
      state.tiles[i].hidden = !show;
      if (show) {
        visible++;
        visibleCodes.push(state.items[i].code);
      }
    }
    state.count.textContent =
      visible === state.items.length ? String(visible) : `${visible} / ${state.items.length}`;
    // The applied-filters chips sit next to the search box: EVERY applied
    // filter chips there (pills and metric tiers alike, one consistent
    // treatment), each removable via its x. There is no global Clear:
    // per-chip removal covers it, and the lone corner button read as clutter
    // (Jan's review).
    renderChips();
    // Reflect the active filter on the world map below the grid: every
    // visible country wears its flag (stamped into its silhouette),
    // hidden countries stay grey. No-op until the map's mounted (async
    // fetch); diffs against the currently-stamped set so only the delta
    // repaints.
    syncMapFlags(visibleCodes);
    // Smart zoom: when the filter narrows the visible set, zoom the
    // map to its bbox. When the filter is cleared (all visible), reset
    // to the original world view. The landmass-bbox computation excludes
    // antimeridian-wrapping countries (US, Russia, Fiji, Kiribati)
    // since their `<g>` spans the whole map width and would defeat
    // the zoom. Routes through mapHandle.setView so mapZoom's
    // internal `current` state stays in sync — future user gestures
    // pick up from the new crop instead of the stale original.
    if (mapHandle && mapSvg) {
      if (visible === state.items.length) {
        mapHandle.reset();
      } else {
        const cropCodes = visibleCodes.filter((c) => !ANTIMERIDIAN.has(c));
        let bbox = cropCodes.length > 0 ? computeCountriesBbox(mapSvg, cropCodes) : null;
        // Antimeridian countries were dropped above (map-wide landmass bbox),
        // but a microstate like Kiribati still has a small marker ring at one
        // island cluster. Fold a padded box around that ring into the target so
        // filtering to (or including) it frames the marker instead of leaving
        // the map parked on a stale view — the case that made Kiribati look
        // "not shown". Countries with no ring (US, Russia) stay excluded.
        for (const code of visibleCodes) {
          if (!ANTIMERIDIAN.has(code)) continue;
          const box = markerRingBox(mapSvg, code);
          if (box) bbox = bbox ? unionBbox(bbox, box) : box;
        }
        if (bbox) mapHandle.setView(bbox);
      }
    }
  }

  /**
   * Apply the active metric lens: fill each tile's overlay with "#rank · value"
   * (or dim it as no-data), and reorder the grid by the current sort. No-ops to
   * a clean flag wall when no lens is active. Cheap and rare — only runs on
   * lens / sort / language change, never per filter.
   */
  function renderLens() {
    if (!state || !gridEl) return;
    const { order, cells } = computeLensView(lensMetric, state.items, { sort: lensSort });
    const active = !!lensMetric;
    gridEl.classList.toggle('lens-active', active);
    const noDataText = t('flagsdata.noData', 'no data');
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      const badge = /** @type {HTMLElement | null} */ (tile.querySelector('.flag-metric'));
      if (!active) {
        tile.classList.remove('nodata');
        if (badge) { badge.hidden = true; badge.textContent = ''; }
        continue;
      }
      const cell = cells[i];
      tile.classList.toggle('nodata', !cell.hasData);
      if (badge) {
        badge.hidden = false;
        // Sovereign states carry a rank ("#12 · 84.5M"); non-sovereign places
        // (territories, non-UN states, org flags) show their value without a
        // number, since the ranking only counts the 195 sovereign countries.
        badge.textContent = !cell.hasData
          ? noDataText
          : cell.rank != null
            ? `#${cell.rank} · ${cell.display}`
            : cell.display;
      }
    }
    // Reorder the DOM to match the sort. appendChild moves existing nodes; the
    // index-aligned state arrays are untouched, so applyFilter's per-index hide
    // keeps working. Natural order when sort is default or the lens is off.
    const target =
      active && lensSort !== 'default' ? order : state.items.map((_, i) => i);
    for (const i of target) gridEl.appendChild(state.tiles[i]);
  }

  /**
   * Render a colour pill's content: the flag-colour swatch dot + label text.
   * The swatch hue is a documented exception to the seven-colour palette — it
   * shows the literal flag colour, like the flag SVGs themselves — with the
   * hex owned by CSS keyed off `data-value`. Centralised so the initial build
   * and the langchanged re-label stay in sync (a bare `textContent =` would
   * wipe the swatch span).
   * @param {HTMLElement} btn @param {string} value @param {string} labelText
   */
  function paintColorPill(btn, value, labelText) {
    btn.replaceChildren();
    btn.append(makeColorSwatch(value), document.createTextNode(labelText));
  }

  /**
   * Repaint the applied-filters chips next to the search box. One chip per
   * applied filter, EVERY applied filter, so "what is filtering right now"
   * always reads in one place regardless of what the rows below show.
   * Membership and order come from the pure `activeFilterChips`; each
   * chip's x clears just that one filter.
   */
  function renderChips() {
    if (!chipsWrap) return;
    chipsWrap.replaceChildren();
    const removeLabel = t('flagsdata.removeFilter', 'Remove filter');
    for (const ref of activeFilterChips(filters)) {
      // Shared chip factory (flags/filterChips.js) owns the swatch / metric
      // icon+hue / exclude-strike visuals \u2014 the same component the findFlag +
      // daily play headers render. The bar supplies the removal handler; the
      // pill label stays local (pillText carries flagsdata's own i18n keys).
      chipsWrap.appendChild(
        buildFilterChip(ref, chipLabel(ref), { onRemove: () => removeChip(ref), removeLabel }),
      );
    }
  }

  /**
   * Localized label for one chip. Pill chips reuse the group's own pill-label
   * helper; the colorCount scalar reads as "Colors = 3" (reusing the group
   * label) to sidestep plural grammar; the metric scalars lead with the
   * metric's short name so a unit-only tier ("over 100K tonnes") always
   * names its fact.
   * @param {import('../flags/flagsFilter.js').FilterChip} ref
   * @returns {string}
   */
  function chipLabel(ref) {
    // Pill nouns stay local \u2014 pillText resolves a couple of values (the "Other"
    // continent) through flagsdata's own i18n keys. The colorCount + metric
    // labels are shared with the play headers via chipLabelText.
    if (ref.kind === 'pill') return pillText(ref.group, ref.value);
    return chipLabelText(ref, filters, t);
  }

  /**
   * Clear the single filter a chip stands for, mirroring what a second click
   * on its pill (or the colour-count x) would do, then re-run the filter.
   * @param {import('../flags/flagsFilter.js').FilterChip} ref
   */
  function removeChip(ref) {
    if (ref.kind === 'pill') {
      const set = ref.exclude ? filters[ref.group].exclude : filters[ref.group].include;
      set.delete(ref.value);
      repaintFilterPills(ref.group, ref.value);
      if (ref.group === 'color') colorCountLock.sync();
    } else if (ref.group === 'colorCount') {
      filters.colorCount = null;
      colorCountLock.reset();
      colorCountPicker.reset();
      if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
    } else {
      filters[ref.group] = null;
      hub.update();
    }
    applyFilter();
  }

  /** @typedef {'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'} PillGroup */

  /** Localized pill text for one (group, value). Single mapping shared by the
   * pill factory, the chip labels, and the langchanged relabel walk.
   * @param {PillGroup} group @param {string} value */
  function pillText(group, value) {
    if (group === 'status') return statusLabel(value);
    if (group === 'continent') return continentLabel(value);
    if (group === 'color') return colorLabel(value);
    if (group === 'motif') return motifLabel(value);
    return stripesOnlyLabel(value);
  }

  /**
   * One shared include → exclude → off cycle for a filter value, used by the
   * group pills AND their teaser twins on the summary row. State mutates
   * first, then EVERY pill carrying (group, value) repaints, so a value that
   * renders in two places can never show two states.
   * @param {PillGroup} group @param {string} value
   */
  function cycleFilterPill(group, value) {
    const { include, exclude } = filters[group];
    if (include.has(value)) {
      include.delete(value);
      exclude.add(value);
    } else if (exclude.has(value)) {
      exclude.delete(value);
    } else {
      include.add(value);
    }
    if (group === 'color') colorCountLock.sync();
    repaintFilterPills(group, value);
    applyFilter();
  }

  /** Repaint every pill for one (group, value) from the filter state: the
   * group row's pill and, for teaser values, its summary-row twin.
   * @param {PillGroup} group @param {string} value */
  function repaintFilterPills(group, value) {
    const g = filters[group];
    const sel = `.pill[data-group="${group}"][data-value="${CSS.escape(value)}"]`;
    for (const p of filterBar.querySelectorAll(sel)) {
      p.classList.toggle('active', g.include.has(value));
      p.classList.toggle('exclude', g.exclude.has(value));
    }
  }

  /**
   * Build one tristate filter pill for (group, value). Used by the group rows
   * and the summary-row teasers, so both render and behave identically.
   * @param {PillGroup} group @param {string} value
   */
  function makeFilterPill(group, value) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill';
    btn.dataset.group = group;
    btn.dataset.value = value;
    if (group === 'color') paintColorPill(btn, value, pillText(group, value));
    else btn.textContent = pillText(group, value);
    // Reflect any pre-seeded filter state on the pill. Nothing is seeded by
    // default today; this still handles include/exclude if a default returns.
    if (filters[group].include.has(value)) btn.classList.add('active');
    else if (filters[group].exclude.has(value)) btn.classList.add('exclude');
    btn.addEventListener('click', () => cycleFilterPill(group, value));
    return btn;
  }

  /**
   * @param {string} labelKey
   * @param {string} labelFallback
   * @param {PillGroup} group
   * @param {string[]} values
   */
  function buildFilterGroup(labelKey, labelFallback, group, values) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-group';
    const labelEl = document.createElement('span');
    labelEl.className = 'filter-label';
    // data-i18n hooks the section title into applyStringsToDocument so a
    // soft language switch re-translates it for free.
    labelEl.setAttribute('data-i18n', labelKey);
    labelEl.textContent = t(labelKey, labelFallback);
    wrap.appendChild(labelEl);
    for (const value of values) wrap.appendChild(makeFilterPill(group, value));
    return wrap;
  }

  const filterBar = document.getElementById('filter-bar');

  // Name search — substring match, diacritic-folded against the
  // localized country name, ANDed with the category pills. On desktop
  // it sits in its own row at the top of the filter bar; on mobile
  // it's appended into .filter-groups so the existing collapse toggle
  // hides it behind "Filters" along with the pills (rationale: once
  // it's part of the filter set, it should follow the same show/hide
  // contract — otherwise the user sees a search box but no pills,
  // which makes the toggle feel inconsistent).
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'name-search';
  searchInput.className = 'name-search';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('autocapitalize', 'off');
  searchInput.setAttribute('autocorrect', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchInput.placeholder = t('flagsdata.searchName', 'Search by name…');
  // data-i18n-attr re-translates the placeholder on a soft language
  // switch — applyStringsToDocument handles it for free.
  searchInput.setAttribute('data-i18n-attr', 'placeholder:flagsdata.searchName');
  searchInput.addEventListener('input', () => {
    nameQuery = foldDiacritics(searchInput.value.trim());
    applyFilter();
  });
  const searchWrap = document.createElement('div');
  searchWrap.className = 'name-search-wrap';
  searchWrap.appendChild(searchInput);

  // The bar is fixed rows that never restructure (Jan's reviews,
  // 2026-07-13): the search row (applied-filter chips + Clear beside the
  // box), the STATUS row (the real first filter group, its label never
  // changes), and the world-facts row. Expanding only ADDS the remaining
  // group rows under Status; the toggle keeps its exact spot at the end of
  // the Status row, so nothing on screen jumps or relabels.
  const chipsWrap = document.createElement('div');
  chipsWrap.id = 'filter-chips';
  chipsWrap.className = 'filter-chips';

  // The Status pills live HERE (this row IS the status group); the
  // collapsible groupsWrap below holds only the remaining groups.
  const previewWrap = document.createElement('div');
  previewWrap.className = 'filter-preview';
  /** @type {HTMLElement[]} */
  const previewEls = STATUS_VALUES.map((v) => {
    const btn = makeFilterPill('status', v);
    previewWrap.appendChild(btn);
    return btn;
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = 'filter-toggle';
  addBtn.className = 'filter-add';
  addBtn.setAttribute('aria-controls', 'filter-groups');
  filterBar.classList.remove('is-open');
  addBtn.setAttribute('aria-expanded', 'false');
  /**
   * Layout pass for the bar's ONE toggle + the Status row's narrow-screen
   * fit. The toggle lives permanently at the end of the Status row and
   * governs the whole bar: collapsed, "+ N more" counts every pill in the
   * folded groups PLUS every world-facts chip the hub's fit hid; expanded,
   * "less" folds both back. One switch, one mental model.
   *
   * Status-pill visibility depends on whether the bar is OPEN:
   *   - Collapsed: fill-to-fit keeps the row to one line, hiding the overflow
   *     Status pills behind "+ N more" (a phone shows Sovereign + Non-UN, the
   *     rest fold in). The collapsed bar stays compact and single-line.
   *   - Expanded: every Status pill is pinned so all four show, wrapping to a
   *     second line if the phone is too narrow. Expanding is the user asking
   *     to see everything, so nothing hides — the earlier bug was that the fit
   *     hid Territory / Region and Other by width alone, EVEN when expanded, so
   *     they were unreachable. On wide screens all four fit one line either way.
   */
  const previewPinned = previewEls.map(() => true);
  function refitPreview() {
    const open = filterBar.classList.contains('is-open');
    // The world-facts row hides entirely while collapsed (CSS on .mhub), so
    // the honest count is every folded group pill plus every metric chip.
    const folded = groupsWrap.querySelectorAll('.pill[data-group][data-value]').length
      + METRIC_FILES.length;
    addBtn.textContent = open
      ? t('metricHub.less', 'less')
      : `+ ${folded} ${t('metricHub.more', 'more')}`;
    const gap = rowGap(previewRow, 8);
    fitChipRow({
      items: previewEls,
      moreBtn: addBtn,
      avail: (/** @type {any} */ (previewRow).clientWidth || 0)
        - previewLabel.getBoundingClientRect().width - gap,
      gap,
      measure: (el) => el.getBoundingClientRect().width,
      // Pin (show all) only when expanded; collapsed keeps the dense fit.
      pinned: open ? previewPinned : undefined,
      alwaysMore: true,
    });
  }
  addBtn.addEventListener('click', () => {
    const open = filterBar.classList.toggle('is-open');
    addBtn.setAttribute('aria-expanded', String(open));
    // Filters and world facts expand and collapse as one section.
    hub.setExpanded(open);
    refitPreview();
  });
  let previewRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(refitPreview);
  });

  // Row 1: search and the applied-filter chips (each removable via its x;
  // there is no global Clear button).
  const searchRow = document.createElement('div');
  searchRow.className = 'filter-search-row';
  searchRow.append(searchWrap, chipsWrap);
  filterBar.appendChild(searchRow);

  // Row 2: the Status row, always visible, label and all: the collapsed bar
  // simply shows the first filter group, and expanding adds the rest below.
  const previewLabel = document.createElement('span');
  previewLabel.className = 'filter-label';
  previewLabel.setAttribute('data-i18n', 'flagsdata.filterStatus');
  previewLabel.textContent = t('flagsdata.filterStatus', 'Status');
  const previewRow = document.createElement('div');
  previewRow.className = 'filter-preview-row';
  previewRow.append(previewLabel, previewWrap, addBtn);
  filterBar.appendChild(previewRow);

  const groupsWrap = document.createElement('div');
  groupsWrap.id = 'filter-groups';
  groupsWrap.className = 'filter-groups';
  filterBar.appendChild(groupsWrap);

  // Status is NOT built here: the always-visible row above is the status
  // group. These are the groups the toggle folds.
  groupsWrap.appendChild(
    buildFilterGroup('flagsdata.filterContinent', 'Continent', 'continent', [...CONTINENTS, 'Other']),
  );
  const colorGroup = buildFilterGroup('flagsdata.filterColors', 'Colors', 'color', [...ALL_FLAG_COLORS]);
  // Append the "no other colours" modifier pill at the end of the Colors
  // row — same placement as findFlag's chooser, same toggle semantics.
  const onlyBtn = document.createElement('button');
  onlyBtn.type = 'button';
  onlyBtn.className = 'pill pill-modifier';
  onlyBtn.setAttribute('data-i18n', 'findFlag.noOtherColors');
  onlyBtn.textContent = t('findFlag.noOtherColors', 'no other colours');
  onlyBtn.addEventListener('click', () => {
    const on = colorCountLock.toggle();
    onlyBtn.classList.toggle('active', on);
    // Lock just took over the colour-count primitive — tell the
    // picker pill to disengage cosmetically (drops its op/n to
    // defaults, paints inactive). Doesn't touch `filters.colorCount`.
    colorCountPicker.disengage();
    applyFilter();
  });
  colorGroup.appendChild(onlyBtn);
  onlyColorsBtn = onlyBtn;
  // Colour-count compound pill — sits next to "no other colours" since
  // both drive the same `filters.colorCount` primitive. Single pill
  // with three click zones (op cycles =/≥/≤, N cycles 2/3/4/5, × clears).
  colorGroup.appendChild(colorCountPicker.el);
  groupsWrap.appendChild(colorGroup);

  groupsWrap.appendChild(
    buildFilterGroup('flagsdata.filterMotifs', 'Motifs', 'motif', [...ALL_MOTIFS]),
  );
  // Two pills: "horizontal stripes only" + "vertical stripes only". Selects
  // pure-stripe flags (no overlay/charge/canton) — the field is null for
  // anything else, so charged tricolours (Mexico, Spain, Egypt) and
  // non-stripe layouts (Canada, Switzerland, UK) are excluded by design.
  groupsWrap.appendChild(
    buildFilterGroup('flagsdata.filterStripes', 'Stripes', 'stripesOnly', [...STRIPES_ORIENTATIONS_FOR_RANDOM]),
  );

  // --- World-facts hub (Feature DE, hub form) ----------------------------
  // One home per metric: the shared icon-chip row + inline panel
  // (flags/metricHub.js, also mounted by findFlag's chooser). On this page
  // opening a metric's panel doubles as switching the lens on: the tiles
  // show "#rank · value" sorted Highest-first, and the panel carries the
  // sort direction plus the metric's threshold tiers. Metric *lens* logic
  // still goes through createMetric and never enters the shared per-flag
  // filter DSL; the tiers write the same `filters[key]` scalar the old
  // per-metric pill groups did.

  // Highest / Lowest lives in the hub panel, so it only exists while a
  // lens is on. 'default' order never needs a button anymore: no lens =
  // the countries.json order (English A–Z).
  const lensSortWrap = document.createElement('div');
  lensSortWrap.className = 'lens-sort';
  /** @type {Array<['desc' | 'asc', string, string]>} */
  const SORTS = [
    ['desc', 'flagsdata.sortHighest', 'Highest'],
    ['asc', 'flagsdata.sortLowest', 'Lowest'],
  ];
  for (const [val, key, fb] of SORTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.sort = val;
    b.setAttribute('data-i18n', key);
    b.textContent = t(key, fb);
    // Resting state is unpressed; setLens → syncSortPressed paints the real
    // state the moment a panel opens (desc by default).
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      lensSort = val;
      syncSortPressed();
      renderLens();
    });
    lensSortWrap.appendChild(b);
  }

  // Total / Per person, the cut control. Same segmented-control markup and
  // stylesheet as the sort beside it (CLAUDE.md: same mechanism = same code) —
  // both answer "which view of this metric", so they must not look like two
  // different kinds of control. Rebuilt per open because the labels are
  // per-subject: population's normalised cut is per km², not per person.
  const lensCutWrap = document.createElement('div');
  lensCutWrap.className = 'lens-sort';

  /** @param {string} chipKey */
  function buildCutControl(chipKey) {
    lensCutWrap.replaceChildren();
    const cuts = cutsFor(chipKey);
    if (!cuts) return;
    const current = lensCutByKey[chipKey] ?? 'total';
    for (const c of cuts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.cut = c.cut;
      b.setAttribute('data-i18n', c.label.key);
      b.textContent = t(c.label.key, c.label.fallback);
      b.setAttribute('aria-pressed', String(c.cut === current));
      b.addEventListener('click', () => setCut(chipKey, c.cut));
      lensCutWrap.appendChild(b);
    }
  }

  /**
   * Switch which cut a chip reads. A tier applied to the cut we're leaving is
   * cleared: a threshold is a statement about one metric ("over $1T"), and
   * carrying it onto the per-person view would filter the grid by a number the
   * reader can no longer see or reach.
   * @param {string} chipKey @param {'total' | 'per'} cut
   */
  function setCut(chipKey, cut) {
    const from = resolveCut(chipKey, lensCutByKey[chipKey] ?? 'total');
    lensCutByKey[chipKey] = cut;
    const to = resolveCut(chipKey, cut);
    if (from !== to && from && /** @type {any} */ (filters)[from] != null) {
      /** @type {any} */ (filters)[from] = null;
      applyFilter();
    }
    // Rebuild the lens on the new metric, then let the hub re-read the panel:
    // its title, hue and tier pills all describe the resolved metric. The sort
    // survives the switch — opening a metric picks Highest, but flipping to the
    // per-person view of the SAME subject is a comparison, and silently
    // throwing the reader back to Highest would undo the question they asked.
    const keepSort = lensSort;
    setLens(chipKey);
    if (keepSort !== 'default') {
      lensSort = keepSort;
      syncSortPressed();
      renderLens();
    }
    hub.refreshPanel();
  }

  const hub = createMetricHub({
    t,
    // One chip per subject: the normalised halves (density, GDP per capita,
    // the per-million Nobel and Olympic cuts) are reached through their
    // subject's cut control instead of taking a second slot in a 39-chip row.
    metrics: chipMetrics(METRIC_FILES),
    // A chip stands for its subject; this is the metric it currently reads.
    resolveKey: (key) => resolveCut(key, lensCutByKey[key] ?? 'total') ?? key,
    label: { key: 'metricHub.title', fallback: 'Statistics' },
    // Tiers count against the full loaded set (same as the old filter
    // groups); empty until countries.json resolves, which only matters if a
    // panel is opened during the initial load.
    tierItems: (key) => (state ? buildMetricTierItems(key, state.items) : []),
    getTier: (key) => /** @type {{op: '>=' | '<=', n: number} | null} */ (filters[key] ?? null),
    onTierChange: (key, tier) => {
      /** @type {any} */ (filters)[key] = tier;
      applyFilter();
    },
    // Panel open = lens on. Opening picks Highest first (a metric with
    // unchanged order shows numbers but no story); closing restores the
    // resting A–Z wall.
    onPanelToggle: (key) => setLens(key),
    // Cut first, then sort: you choose which number you are looking at before
    // you choose which end of it. A subject with no second cut renders the
    // sort alone rather than a one-button segmented control.
    panelExtras: (key) => {
      buildCutControl(key);
      return cutsFor(key) ? [lensCutWrap, lensSortWrap] : [lensSortWrap];
    },
    // No hub-side "+ N more": the bar's single toggle (Status row) expands
    // and collapses the world facts together with the filter groups.
    moreButton: false,
  });
  // Last row of the bar, AFTER the collapsible pill groups: expanding
  // "+ N more" must open the groups directly under the teaser row they
  // continue, never push content between the teasers and their expansion.
  // The hub stays always visible either way (it changes how the same set is
  // presented rather than narrowing it).
  filterBar.appendChild(hub.el);
  // Hub exists now: run the first toggle paint + narrow-screen fit (it
  // reads the hub's hidden-chip count for the honest "+ N more").
  refitPreview();

  function syncSortPressed() {
    for (const b of lensSortWrap.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-sort') === lensSort));
    }
  }

  /** The metric the open chip is actually reading (chip key for an ungrouped
   * metric, the chosen cut for a grouped one).
   * @returns {string | null} */
  function lensMetricKey() {
    return lensKey ? resolveCut(lensKey, lensCutByKey[lensKey] ?? 'total') : null;
  }

  /** @param {string | null} key */
  function setLens(key) {
    lensKey = key;
    lensSort = key ? 'desc' : 'default';
    const metricKey = lensMetricKey();
    lensMetric =
      metricKey && state && metricsData[metricKey]
        ? createMetric(metricsData[metricKey], state.items)
        : null;
    syncSortPressed();
    renderLens();
  }

  // Metric JSON is fetched (not statically imported) so it loads in every
  // browser. A metric file failing to load only disables that lens — it must
  // never block the flag grid, so these resolve to null and are filtered out.
  const metricsReady = Promise.all(
    METRIC_FILES.map((m) =>
      fetch(`../flags/metrics/${m.file}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => (data ? /** @type {const} */ ([m.key, data]) : null))
        .catch(() => null),
    ),
  ).then((entries) => {
    metricsData = Object.fromEntries(entries.filter(Boolean));
  });

  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((all) => {
      const sections = document.getElementById('sections');
      renderAll(sections, all);
      // Once both the countries and the metric data are in, activate any lens
      // picked before the data resolved (buttons mount at boot, data is async).
      metricsReady.then(() => {
        // Denormalize each metric onto the countries so the tier filter's
        // predicate (`c.<metric> op n`, via matchesFilters) resolves. The lens
        // reads the values map directly, but the filter reads the field. The
        // hub's tier panels count against this loaded, attached set (its
        // `tierItems` closure re-runs on every panel open), so a new metric
        // needs no edit here.
        attachMetrics(all, Object.fromEntries(
          METRIC_FILES.map((m) => [m.key, metricsData[m.key] ? metricsData[m.key].values : null]),
        ));
        const bootKey = lensMetricKey();
        if (bootKey && metricsData[bootKey]) lensMetric = createMetric(metricsData[bootKey], all);
        renderLens();
        applyFilter();
      });
      renderLens();
      // Reflect the initial (unfiltered) selection now that `state` is
      // ready. Closes a mount-vs-data race: if `worldMap.svg` resolved
      // before `countries.json`, the map-mount's own `applyFilter()` was
      // skipped (state was still null) and nothing re-triggered it, so the
      // flags never stamped until the user touched a filter. Safe to call
      // before the map mounts too — `syncMapFlags` no-ops until `mapSvg`
      // is set, and the mount's `.then` re-runs `applyFilter` once it is.
      applyFilter();
    })
    .catch((err) => {
      document.getElementById('sections').textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  // Soft language switch: tile hover labels + `<img>.alt` re-translate
  // via the shared refreshTileNames walk; the dynamic pill labels (whose
  // text depends on group + value, not on a fixed i18n key) re-translate
  // here. Static labels (section headings, search placeholder, Clear,
  // Filters, no-other-colours) carry `data-i18n` / `data-i18n-attr` and
  // are handled upstream by `applyStringsToDocument`.
  document.addEventListener('langchanged', () => {
    refreshTileNames();
    // The name filter matches the localized display name, which just changed —
    // rebuild the per-country search terms and re-run the filter so the current
    // query keeps matching in the new language (English still matches always).
    if (state) {
      state.foldedTerms = state.items.map(searchTermsFor);
      applyFilter();
    }
    // Re-render the open zoom in the new language (softReload keeps the
    // dialog open across the switch): the country-name line (the dialog's
    // first <p>, set once by openFlagZoom) and the facts panel below it.
    if (zoom.open && zoomCountry) {
      const nameP = zoom.querySelector('p');
      if (nameP) nameP.textContent = countryName(zoomCountry);
      paintFacts(zoomCountry);
    }
    const pills = /** @type {NodeListOf<HTMLButtonElement>} */ (
      filterBar.querySelectorAll('.pill[data-group][data-value]')
    );
    for (const btn of pills) {
      const group = /** @type {PillGroup} */ (btn.dataset.group);
      const value = btn.dataset.value ?? '';
      if (group === 'color') paintColorPill(btn, value, pillText(group, value));
      else btn.textContent = pillText(group, value);
    }
    // Chips carry localized labels: rebuild them, then re-run the Status
    // row fit (translated labels change widths; the toggle text re-composes,
    // it can't ride data-i18n).
    renderChips();
    refitPreview();
    // The hub owns every metric label (chips, panel lead, tier pills);
    // renderLens refreshes the "no data" overlay text.
    hub.refreshI18n();
    renderLens();
  });
}
