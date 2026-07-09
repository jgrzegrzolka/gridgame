import { CONTINENTS, loadCountries } from '../flags/group.js';
import { ALL_FLAG_COLORS, ALL_MOTIFS, STRIPES_ORIENTATIONS_FOR_RANDOM, foldDiacritics } from '../flags/engine.js';
import { emptyFilters, matchesFilters, createColorCountLock } from '../flags/flagsFilter.js';
import { createColorCountPicker } from '../colorCountPicker.js';
import { t, countryName } from '../i18n.js';
import { bindTileCountry, refreshTileNames } from '../langRefresh.js';
import { openFlagZoom, wireFlagZoomBackdropClose } from '../flags/flagZoom.js';
import { wireFlagLightbox, wireFlagLightboxAll } from '../flags/flagLightbox.js';
import { getFlagFacts } from '../flags/flagFacts.js';
import { renderFlagFacts } from '../flags/flagFactsRender.js';
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
    const facts = c ? getFlagFacts(c.code) : null;
    zoom.classList.toggle('has-facts', !!facts);
    zoomFacts.hidden = !facts;
    if (!facts) return;
    const subtree = renderFlagFacts({ facts, t, doc: document, base: '../flags/' });
    if (subtree) zoomFacts.appendChild(subtree);
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
    if (SHOW_DATA) zoomData.textContent = JSON.stringify(c, null, 2);
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
    wrap.className = 'flag';
    wrap.dataset.name = displayName;
    bindTileCountry(wrap, c);
    wrap.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = displayName;
    img.loading = 'lazy';
    wrap.appendChild(img);
    return wrap;
  }

  // No status filter on by default: first load shows all 269 entries
  // (sovereign states plus territories, subnational regions, and orgs
  // like EU / ASEAN). The Status pills are normal toggles for anyone who
  // wants to narrow the view.
  const filters = emptyFilters();
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

  // Show-map toggle in the burger menu — flagsdata's burger panel ships
  // empty (just the coffee link), so we prepend the toggle here at
  // boot. Reuses the shared `buildToggleLi` from common.js.
  const burgerMenuEl = /** @type {HTMLUListElement | null} */ (
    document.querySelector('#burger-panel .menu')
  );
  if (burgerMenuEl) {
    // Insert the toggle BEFORE the coffee link's <li> so the menu
    // reads: nickname (top, with its own bottom-border divider) →
    // show-map → coffee. Falls back to append-at-end if the page
    // ever stops carrying a coffee link.
    const toggleLi = buildToggleLi({
      label: t('menu.showMap', 'Show map'),
      labelKey: 'menu.showMap',
      initial: isFlagsdataShowMap(),
      // Apply live (mount / collapse in place) as well as persist — the same
      // path the map's own hide chip drives, so the two controls stay in step.
      onChange: (checked) => applyMapPreference(checked),
    });
    const coffeeLink = burgerMenuEl.querySelector('.menu-coffee');
    const coffeeLi = coffeeLink ? coffeeLink.closest('li') : null;
    if (coffeeLi) burgerMenuEl.insertBefore(toggleLi, coffeeLi);
    else burgerMenuEl.appendChild(toggleLi);
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
      // The map here always fills the content column (see index.css) — no
      // corner resize handle; fullscreen covers the "see it bigger" case.
      resizable: false,
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
        // boundsExpand: drag / zoom ~15% past the world map's edges into open
        // ocean (the antimeridian Pacific islands can be pulled off the edge)
        // while the map still rests at its tight default framing. Matches the
        // flagQuiz `countries` variant.
        mapHandle = attachZoomPan(svg, { containZoomOut: true, freePan: false, boundsExpand: 0.15 });
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
   * Single entry point for both controls: persist to `gridgame.flagsdata.showMap`,
   * apply live, and sync the burger toggle so the two never disagree.
   * @param {boolean} show
   */
  function applyMapPreference(show) {
    setFlagsdataShowMap(localStorage, show);
    setMapVisible(show);
    syncMapMenuToggle(show);
  }
  /**
   * Reflect the current visibility on the burger menu's "Show map" checkbox.
   * Sets `.checked` directly (no `change` dispatch) so it can't loop back
   * through the toggle's own handler.
   * @param {boolean} show
   */
  function syncMapMenuToggle(show) {
    if (!burgerMenuEl) return;
    const textSpan = burgerMenuEl.querySelector('.scope-toggle-text[data-i18n="menu.showMap"]');
    const label = textSpan && textSpan.closest('.scope-toggle');
    const input = /** @type {HTMLInputElement | null} */ (
      label ? label.querySelector('input[type="checkbox"]') : null
    );
    if (input) input.checked = show;
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
    let pillTotal = 0;
    for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'>} */ (['continent','color','motif','status','stripesOnly'])) {
      pillTotal += filters[k].include.size + filters[k].exclude.size;
    }
    if (filters.colorCount !== null) pillTotal++;
    const anyActive = pillTotal > 0 || nameQuery !== '';
    clearBtn.hidden = !anyActive;
    // Include name search in the toggle badge count — once the search
    // is hidden behind the mobile Filters toggle, the badge is the
    // user's only cue that something is filtering. Counting it as one
    // "active filter" (alongside each pill) matches that mental model.
    updateFilterToggle(pillTotal + (nameQuery !== '' ? 1 : 0));
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

  /** @param {number} count */
  function updateFilterToggle(count) {
    const badge = document.getElementById('filter-toggle-count');
    if (!badge) return;
    badge.textContent = count > 0 ? String(count) : '';
    badge.hidden = count === 0;
  }

  /**
   * @param {string} labelKey
   * @param {string} labelFallback
   * @param {'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'} group
   * @param {Array<{ value: string, label: string }>} entries
   */
  function buildFilterGroup(labelKey, labelFallback, group, entries) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-group';
    const labelEl = document.createElement('span');
    labelEl.className = 'filter-label';
    // data-i18n hooks the section title into applyStringsToDocument so a
    // soft language switch re-translates it for free.
    labelEl.setAttribute('data-i18n', labelKey);
    labelEl.textContent = t(labelKey, labelFallback);
    wrap.appendChild(labelEl);
    for (const { value, label: pillLabel } of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.dataset.group = group;
      btn.dataset.value = value;
      btn.textContent = pillLabel;
      // Reflect any pre-seeded filter state on the pill. No status filter
      // is seeded by default now, so on first paint every pill starts
      // inactive; this still handles include/exclude if a default returns.
      if (filters[group].include.has(value)) btn.classList.add('active');
      else if (filters[group].exclude.has(value)) btn.classList.add('exclude');
      btn.addEventListener('click', () => {
        const { include, exclude } = filters[group];
        if (include.has(value)) {
          include.delete(value);
          exclude.add(value);
          btn.classList.remove('active');
          btn.classList.add('exclude');
        } else if (exclude.has(value)) {
          exclude.delete(value);
          btn.classList.remove('exclude');
        } else {
          include.add(value);
          btn.classList.add('active');
        }
        if (group === 'color') colorCountLock.sync();
        applyFilter();
      });
      wrap.appendChild(btn);
    }
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
  // The wrapper does the row-claim on desktop (flex-basis: 100% on a
  // plain div wraps reliably where the same on an <input> doesn't).
  // The wrapper gets inserted into groupsWrap further down, so the
  // mobile collapse toggle covers it too.
  const searchWrap = document.createElement('div');
  searchWrap.className = 'name-search-wrap';
  searchWrap.appendChild(searchInput);

  // Search sits OUTSIDE the collapsible groups so it's always reachable —
  // search and filter are different mental models: search is "I know what
  // I want, take me there", filter is "narrow the population to a
  // category". Hiding search behind the toggle would put a click in front
  // of the faster path.
  filterBar.appendChild(searchWrap);

  // Collapse toggle on every viewport. Default initial state differs:
  //   - mobile (≤600 px): closed — the filter bar would otherwise eat
  //     half the viewport on a phone
  //   - desktop: open — preserves what desktop users used to get
  //     unconditionally, so today's landing experience is unchanged.
  // The badge shows how many include/exclude pills are currently active
  // so the user knows whether filtering is happening while the panel is
  // closed.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.id = 'filter-toggle';
  toggleBtn.className = 'filter-toggle';
  toggleBtn.setAttribute('aria-controls', 'filter-groups');
  // data-i18n on the inner title span re-translates the "Filters" label
  // for free on soft language switches; count and chevron stay siblings.
  toggleBtn.innerHTML = `<span data-i18n="flagsdata.filters">${t('flagsdata.filters', 'Filters')}</span><span id="filter-toggle-count" class="filter-toggle-count" hidden></span><span class="filter-toggle-chevron" aria-hidden="true">▾</span>`;
  const startOpen = window.matchMedia('(min-width: 601px)').matches;
  filterBar.classList.toggle('is-open', startOpen);
  toggleBtn.setAttribute('aria-expanded', String(startOpen));
  toggleBtn.addEventListener('click', () => {
    const open = filterBar.classList.toggle('is-open');
    toggleBtn.setAttribute('aria-expanded', String(open));
  });
  // Wrap the toggle in a full-width row so it sits alone above the pill
  // groups. Without this it would share row 2 with the first pill group
  // (toggle is a natural-width inline-flex; the pills would just flow in
  // beside it).
  const toggleRow = document.createElement('div');
  toggleRow.className = 'filter-toggle-row';
  toggleRow.appendChild(toggleBtn);
  filterBar.appendChild(toggleRow);

  const groupsWrap = document.createElement('div');
  groupsWrap.id = 'filter-groups';
  groupsWrap.className = 'filter-groups';
  filterBar.appendChild(groupsWrap);

  groupsWrap.appendChild(
    buildFilterGroup('flagsdata.filterStatus', 'Status', 'status', STATUS_VALUES.map((v) => ({ value: v, label: statusLabel(v) }))),
  );
  groupsWrap.appendChild(
    buildFilterGroup('flagsdata.filterContinent', 'Continent', 'continent', [...CONTINENTS, 'Other'].map((v) => ({ value: v, label: continentLabel(v) }))),
  );
  const colorGroup = buildFilterGroup('flagsdata.filterColors', 'Colors', 'color', ALL_FLAG_COLORS.map((v) => ({ value: v, label: colorLabel(v) })));
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
    buildFilterGroup('flagsdata.filterMotifs', 'Motifs', 'motif', ALL_MOTIFS.map((v) => ({ value: v, label: motifLabel(v) }))),
  );
  // Two pills: "horizontal stripes only" + "vertical stripes only". Selects
  // pure-stripe flags (no overlay/charge/canton) — the field is null for
  // anything else, so charged tricolours (Mexico, Spain, Egypt) and
  // non-stripe layouts (Canada, Switzerland, UK) are excluded by design.
  groupsWrap.appendChild(
    buildFilterGroup('flagsdata.filterStripes', 'Stripes', 'stripesOnly', STRIPES_ORIENTATIONS_FOR_RANDOM.map((v) => ({ value: v, label: stripesOnlyLabel(v) }))),
  );

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.id = 'filter-clear';
  clearBtn.setAttribute('data-i18n', 'flagsdata.clear');
  clearBtn.textContent = t('flagsdata.clear', 'Clear');
  clearBtn.hidden = true;
  clearBtn.addEventListener('click', () => {
    for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'>} */ (['continent','color','motif','status','stripesOnly'])) {
      filters[k].include.clear();
      filters[k].exclude.clear();
    }
    colorCountLock.reset();
    if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
    colorCountPicker.reset();
    for (const el of filterBar.querySelectorAll('.pill.active, .pill.exclude')) {
      el.classList.remove('active');
      el.classList.remove('exclude');
    }
    searchInput.value = '';
    nameQuery = '';
    applyFilter();
  });
  // Clear sits on the same row as the toggle (right-aligned), not inside
  // the collapsible groups. It only renders when at least one filter is
  // active, so the user can reset without expanding the bar — particularly
  // useful when filters are collapsed but the count badge says "3".
  toggleRow.appendChild(clearBtn);

  fetch('../flags/countries.json')
    .then((r) => r.json())
    .then(loadCountries)
    .then((all) => {
      const sections = document.getElementById('sections');
      renderAll(sections, all);
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
      const group = btn.dataset.group;
      const value = btn.dataset.value ?? '';
      if (group === 'status') btn.textContent = statusLabel(value);
      else if (group === 'continent') btn.textContent = continentLabel(value);
      else if (group === 'color') btn.textContent = colorLabel(value);
      else if (group === 'motif') btn.textContent = motifLabel(value);
      else if (group === 'stripesOnly') btn.textContent = stripesOnlyLabel(value);
    }
  });
}
