/**
 * Shared rendering for the "applied filter" criteria, one entry per active
 * constraint in a `Filters` object. Two consumers, two containers, one shared
 * label + icon vocabulary:
 *
 *   - flagsdata's filter bar (`flagsdata/page.js`) renders BOXED, interactive
 *     chips with a removal `×` (via `buildFilterChip`).
 *   - the findFlag + daily play-screen criteria headers render INLINE title
 *     text, dot-separated, no box (via `renderCriteriaInline`). Metrics carry a
 *     hue-tinted icon, colours a swatch, flag-design tokens (charge motifs /
 *     stripes / colour count) a flag glyph, world facts (continent / status /
 *     the political eu-member motif) nothing, so you can tell "on the flag"
 *     from "about the country" at a glance (see `isFlagDesignCriterion`).
 *
 * The label text + the icon/swatch identity are the drift-prone parts, so they
 * live here and nowhere else (CLAUDE.md's "same mechanism = same code"). The
 * two containers differ on purpose: a box can group "Coffee · over 10K tonnes"
 * with the middot, but an unboxed inline title can't (the middot would blur into
 * the criteria separator), so the inline metric label drops it to a space
 * ("Coffee over 10K tonnes") via the `metricSep` argument.
 *
 * Box chip styling lives in `common.css` (`.filter-chip*`); inline styling in
 * `findFlag/index.css` (`.crit*`, loaded on all three play pages).
 */

import { activeFilterChips } from './flagsFilter.js';
import { pillLabel } from './findFlag.js';
import { CHARGE_MOTIFS } from './engine.js';
import { METRIC_HUES, METRIC_SHORT, metricIconSpan } from './metricVisuals.js';
import { makeColorSwatch } from '../common.js';

/** @typedef {import('./flagsFilter.js').Filters} Filters */
/** @typedef {import('./flagsFilter.js').FilterChip} FilterChip */

/**
 * Flag glyph marking a flag-design criterion (motif / stripes / colour count)
 * in the inline header — a small two-tone flag: a teal field with a cream
 * Nordic cross offset to the hoist. Invented (no country flies it), so it reads
 * "this criterion is about the flag's design" without impersonating a real one.
 * The two fixed hues are the documented exception to the 8-colour palette rule,
 * same standing as the flag SVGs and the colour swatches (a mark that depicts a
 * flag can't be built from the brand tokens). Sized / placed by
 * `.find-cat .crit-flag`; unlike the old line glyph it does NOT tint with the
 * text, so that CSS drops the opacity fade the mono mark relied on.
 */
const FLAG_GLYPH =
  '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="1.8" fill="#2a9d8f"/><rect x="7.6" y="4" width="3" height="16" fill="#f4efe6"/><rect x="2" y="10.5" width="20" height="3" fill="#f4efe6"/></svg>';

/**
 * A distinct little coloured icon per charge motif, so a criterion reads by its
 * picture as well as its word — "star or moon" wears a crescent + star, "cross" a
 * red cross — instead of every motif sharing the one generic {@link FLAG_GLYPH}.
 * Rendered on every criteria surface (findFlag / daily headers, the Flag Party
 * spot-the-flag prompt, the tic-tac-toe grid marks) through {@link motifIconEl},
 * so a motif looks the same everywhere.
 *
 * These are small illustrations, not palette-bound chrome: like the flag
 * thumbnail (`FLAG_GLYPH` above) and the metric icons, they carry their own
 * illustrative colour rather than the eight CSS tokens. Keyed by motif value
 * (engine `CHARGE_MOTIFS`); a charge without an entry falls back to the glyph.
 * `animal` is a paw standing in for "some creature" — a flag's actual lion or
 * eagle can't survive the shrink to ~1em.
 * @type {Record<string, string>}
 */
const MOTIF_ICONS = {
  cross: '<svg viewBox="0 0 24 24" fill="#cf2b2b"><rect x="1.5" y="10" width="21" height="4" rx="0.5"/><rect x="7" y="2.5" width="4" height="19" rx="0.5"/></svg>',
  'star-or-moon': '<svg viewBox="0 0 24 24" fill="#e0b400"><path d="M14.8 12.6a5.4 5.4 0 1 1-4-6.9 4.3 4.3 0 1 0 4 6.9z"/><path d="M18.6 4.4l.85 2.1 2.25.2-1.7 1.5.55 2.2-1.95-1.2-1.95 1.2.55-2.2-1.7-1.5 2.25-.2z"/></svg>',
  'union-jack': '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="1.4" fill="#2d5fa8"/><path d="M3.4 6.7L20.6 17.3M20.6 6.7L3.4 17.3" stroke="#fff" stroke-width="2.6"/><path d="M3.4 6.7L20.6 17.3M20.6 6.7L3.4 17.3" stroke="#c0392b" stroke-width="1.1"/><path d="M12 6V18M2.5 12H21.5" stroke="#fff" stroke-width="4"/><path d="M12 6V18M2.5 12H21.5" stroke="#c0392b" stroke-width="2.2"/></svg>',
  bird: '<svg viewBox="0 0 24 24" fill="#3c4650"><ellipse cx="12.6" cy="13.6" rx="5.3" ry="4.3"/><circle cx="8" cy="8.9" r="3"/><path d="M5.2 8.3L2 7.4l3 2z"/><path d="M16.6 12.4l5.4-1.4-4.1 4.6z"/><path d="M9 11.4c1.9.2 3.3 1.2 4 2.9-1.7.6-3.3.6-4.9-.1z" fill="#2b333b"/><circle cx="7.1" cy="8.5" r="0.75" fill="#fff"/></svg>',
  animal: '<svg viewBox="0 0 24 24" fill="#7a5230"><ellipse cx="8" cy="7.5" rx="2.1" ry="2.7"/><ellipse cx="14.2" cy="6.6" rx="2.1" ry="2.7"/><ellipse cx="4" cy="12.6" rx="1.9" ry="2.4"/><ellipse cx="18.2" cy="12.6" rx="1.9" ry="2.4"/><path d="M11.2 12.4c3 0 5.3 2.1 5.3 4.7S13.9 21.4 11.2 21.4 5.9 19.8 5.9 17.1 8.2 12.4 11.2 12.4z"/></svg>',
  weapon: '<svg viewBox="0 0 24 24"><path d="M12 2.2L13.3 6V15H10.7V6z" fill="#9aa2ab"/><path d="M12 2.2L13.3 6h-1.3z" fill="#c3ccd4"/><rect x="7.3" y="15" width="9.4" height="2.3" rx="1.1" fill="#c8a02e"/><rect x="11" y="17.2" width="2" height="3.1" fill="#7a5230"/><circle cx="12" cy="21" r="1.5" fill="#c8a02e"/></svg>',
  'coat-of-arms': '<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 2.3v6.4c0 4.9-3.2 8.2-7.5 9.8-4.3-1.6-7.5-4.9-7.5-9.8V4.8z" fill="#c8a02e"/><path d="M12 5.4l4.6 1.4v4.3c0 3-1.9 5-4.6 6z" fill="#c0392b"/></svg>',
};

const CHARGE_MOTIF_SET = new Set(CHARGE_MOTIFS);

/**
 * Does this criterion describe the flag's visible design (→ gets the flag
 * glyph), as opposed to a fact about the country (→ no mark)?
 *
 *   - stripes-only pills: yes (a layout of the flag itself).
 *   - motif pills: only the actual charges drawn on the flag. `eu-member` lives
 *     in the motif group but is a *political* membership tag, not a visual
 *     element (engine.js `CHARGE_MOTIFS` excludes it for exactly this reason),
 *     so it reads mark-less like continent / status. `union-jack` IS a charge
 *     (the flag literally carries it) and keeps the glyph.
 *   - colour count: yes (a property of the flag's palette).
 *   - `color` is deliberately NOT here — its swatch is a richer flag cue.
 *
 * @param {FilterChip} ref
 * @returns {boolean}
 */
function isFlagDesignCriterion(ref) {
  if (ref.kind === 'scalar') return ref.group === 'colorCount';
  if (ref.group === 'stripesOnly') return true;
  if (ref.group === 'motif') return CHARGE_MOTIF_SET.has(ref.value);
  return false;
}

/**
 * Localized label for one chip descriptor. Pure — no DOM — so it's unit-tested.
 *
 *   - pill chip: the bare noun ("red", "cross", "Africa"). By default an
 *     excluded value renders the same bare noun and the caller's styling carries
 *     the negation (flagsdata's strike-through). Pass `spellExclude` to instead
 *     write it out — "not cross" / "bez herbu" (the localized prefix + genitive
 *     from pillLabel) — for the read-only inline header, where a struck word
 *     reads as "removed" rather than "excluded".
 *   - colorCount scalar: the same phrasing TTT uses ("only 3 colours" /
 *     "tylko 3 kolory"), via pillLabel's filter.onlyN/atLeastN/atMostN keys.
 *   - metric scalar: "<short name><metricSep><threshold>" so a unit-only tier
 *     ("over 100K tonnes") always names its fact. `metricSep` is " · " for the
 *     boxed flagsdata chip and a plain " " for the unboxed inline header (see
 *     the module note).
 *
 * @param {FilterChip} ref
 * @param {Filters} filters
 * @param {(key: string, fallback: string) => string} t
 * @param {string} [metricSep]
 * @param {boolean} [spellExclude]  write excluded pills as "not X" instead of the bare noun
 * @returns {string}
 */
export function chipLabelText(ref, filters, t, metricSep = ' · ', spellExclude = false) {
  if (ref.kind === 'pill') {
    return pillLabel(ref.group, ref.value, spellExclude && ref.exclude ? 'exclude' : 'include', t);
  }
  if (ref.group === 'colorCount') {
    const c = filters.colorCount;
    if (!c) return '';
    // Route through pillLabel so this reads exactly like the TTT category label
    // ("only 2 colours" / "tylko 2 kolory") — same filter.onlyN/atLeastN/atMostN
    // i18n keys, which already carry the per-N plural grammar. Don't reinvent a
    // "Colors = N" form here; it drifts from TTT and reads worse.
    const value = c.op === '=' ? String(c.n) : `${c.op}${c.n}`;
    return pillLabel('colorCount', value, 'include', t);
  }
  const cons = /** @type {{ op: string, n: number } | null} */ (/** @type {any} */ (filters)[ref.group]);
  if (!cons) return '';
  const short = METRIC_SHORT[ref.group];
  const tierText = pillLabel(/** @type {any} */ (ref.group), `${cons.op}${cons.n}`, 'include', t);
  return `${short ? t(short.key, short.fallback) : ref.group}${metricSep}${tierText}`;
}

/**
 * Build a BOXED chip element for one active filter: the swatch / metric
 * icon+hue / exclude-strike treatment. Label text is caller-supplied (default
 * is `chipLabelText`); pass `onRemove` to get the interactive `×` button
 * (flagsdata's bar), omit it for a read-only chip.
 *
 * @param {FilterChip} ref
 * @param {string} labelText
 * @param {{ doc?: Document, onRemove?: (() => void) | null, removeLabel?: string }} [opts]
 * @returns {HTMLSpanElement}
 */
export function buildFilterChip(ref, labelText, opts = {}) {
  const { doc = document, onRemove = null, removeLabel = 'Remove filter' } = opts;
  const chip = doc.createElement('span');
  chip.className = 'filter-chip' + (ref.kind === 'pill' && ref.exclude ? ' is-exclude' : '');
  if (ref.kind === 'pill' && ref.group === 'color') {
    chip.appendChild(makeColorSwatch(ref.value, doc));
  }
  // A metric chip wears its metric's icon + hue (shared with the hub chips and
  // Flag Party), so "over 100K tonnes" can never read as the wrong fact.
  if (ref.kind === 'scalar' && ref.group !== 'colorCount') {
    chip.classList.add('is-metric');
    chip.style.setProperty('--mc', METRIC_HUES[ref.group] || 'currentColor');
    chip.appendChild(metricIconSpan(ref.group, 'mhub-ic', doc));
  }
  const label = doc.createElement('span');
  label.className = 'filter-chip-label';
  label.textContent = labelText;
  chip.appendChild(label);
  if (onRemove) {
    const x = doc.createElement('button');
    x.type = 'button';
    x.className = 'filter-chip-x';
    x.setAttribute('aria-label', removeLabel);
    x.textContent = '×';
    x.addEventListener('click', onRemove);
    chip.appendChild(x);
  }
  return chip;
}

/**
 * Build one INLINE criterion span: leading mark (swatch / flag glyph / metric
 * icon) + label. Country facts (continent / status) get no mark; the exclude
 * strike-through is applied to the whole span.
 *
 * @param {FilterChip} ref
 * @param {Filters} filters
 * @param {(key: string, fallback: string) => string} t
 * @param {Document} doc
 * @returns {HTMLSpanElement}
 */
function buildCriterionInline(ref, filters, t, doc) {
  const crit = doc.createElement('span');
  crit.className = 'crit' + (ref.kind === 'pill' && ref.exclude ? ' crit-exclude' : '');
  if (ref.kind === 'pill' && ref.group === 'color') {
    crit.appendChild(makeColorSwatch(ref.value, doc));
  } else if (isFlagDesignCriterion(ref)) {
    // A charge motif wears its own icon; stripes-only / colour-count are
    // structural design properties (not a motif), so they keep the generic flag
    // glyph. eu-member (political, not a charge) falls through to no mark, reading
    // as a country fact like continent / status.
    crit.appendChild(ref.group === 'motif' ? motifIconEl(ref.value, doc) : flagGlyphEl(doc));
  } else if (ref.kind === 'scalar') {
    // World-fact metric: the icon carries the hue (words stay in ink so every
    // metric reads at title size — some hues are too light for text).
    const ic = metricIconSpan(ref.group, 'crit-ic', doc);
    ic.style.color = METRIC_HUES[ref.group] || 'currentColor';
    crit.appendChild(ic);
  }
  const label = doc.createElement('span');
  label.className = 'crit-label';
  // Inline header spells excluded pills out ("not coat of arms") in ink — this
  // is a read-only title, so a struck word would read as "removed", not "not".
  label.textContent = chipLabelText(ref, filters, t, ' ', true);
  crit.appendChild(label);
  return crit;
}

/** @param {Document} doc */
function flagGlyphEl(doc) {
  const el = doc.createElement('span');
  el.className = 'crit-flag';
  el.innerHTML = FLAG_GLYPH;
  return el;
}

/** The mark for a motif criterion: its own {@link MOTIF_ICONS} icon, or the
 *  generic flag glyph for a charge we haven't drawn one for. `.crit-motif` sizes
 *  it in common.css exactly like `.crit-flag`, so it drops into the same slot.
 *  @param {string} motif @param {Document} doc */
function motifIconEl(motif, doc) {
  const svg = MOTIF_ICONS[motif];
  if (!svg) return flagGlyphEl(doc);
  const el = doc.createElement('span');
  el.className = 'crit-motif';
  el.innerHTML = svg;
  return el;
}

/**
 * Leading mark for an engine {@link import('./engine.js').Category} — the same
 * swatch / flag-glyph / metric-icon vocabulary `buildCriterionInline` gives a
 * filter chip, but keyed off the category's `id` prefix (tic-tac-toe categories
 * come from the engine factories and carry no `Filters`). Returns `null` for a
 * country fact that earns no mark (continent / statehood / the political
 * eu-member motif), so "about the flag" reads apart from "about the country" on
 * the grid exactly as it does in the findFlag + daily header.
 *
 *   - `hasColor:<c>`               → colour swatch
 *   - `colorCount:*` / `stripesOnly:*` → flag glyph (a property of the design)
 *   - `hasMotif:<m>`               → flag glyph for a charge, else no mark
 *   - `<metricKey>:*` (population, area, …) → hue-tinted metric icon
 *   - `continent:*` / `statehood:*` / anything else → null
 *
 * @param {import('./engine.js').Category} category
 * @param {Document} [doc]
 * @returns {HTMLSpanElement | null}
 */
export function categoryIconEl(category, doc = document) {
  const id = category && category.id ? String(category.id) : '';
  const sep = id.indexOf(':');
  const kind = sep === -1 ? id : id.slice(0, sep);
  const value = sep === -1 ? '' : id.slice(sep + 1);
  if (kind === 'hasColor') return makeColorSwatch(value, doc);
  if (kind === 'colorCount' || kind === 'stripesOnly') return flagGlyphEl(doc);
  if (kind === 'hasMotif') return CHARGE_MOTIF_SET.has(value) ? motifIconEl(value, doc) : null;
  if (Object.prototype.hasOwnProperty.call(METRIC_HUES, kind)) {
    const ic = metricIconSpan(kind, 'crit-ic', doc);
    ic.style.color = METRIC_HUES[kind] || 'currentColor';
    return ic;
  }
  return null;
}

/**
 * Paint one category into `el` as its icon (if it earns one) + a localized
 * label span, replacing the plain `el.textContent = label` the tic-tac-toe grid
 * headers used. The label is caller-localized (the page's `translateCategoryLabel`),
 * so this stays DOM-only and the icon logic lives in one place.
 *
 * @param {HTMLElement} el
 * @param {import('./engine.js').Category} category
 * @param {string} label  already-localized category label
 * @param {Document} [doc]
 */
export function renderCategoryLabel(el, category, label, doc = document) {
  el.textContent = '';
  const icon = categoryIconEl(category, doc);
  if (icon) el.appendChild(icon);
  const text = doc.createElement('span');
  text.className = 'cat-label';
  text.textContent = label;
  el.appendChild(text);
}

/**
 * Paint a "row × col" pair into `el` (the tic-tac-toe picker header) with each
 * side wearing its {@link categoryIconEl} mark. The `×` sits in its own muted
 * span so it never blurs into a criterion's label.
 *
 * @param {HTMLElement} el
 * @param {import('./engine.js').Category} rowCat
 * @param {import('./engine.js').Category} colCat
 * @param {string} rowLabel  already-localized row label
 * @param {string} colLabel  already-localized col label
 * @param {Document} [doc]
 */
export function renderCategoryPair(el, rowCat, colCat, rowLabel, colLabel, doc = document) {
  el.textContent = '';
  const row = doc.createElement('span');
  renderCategoryLabel(row, rowCat, rowLabel, doc);
  const times = doc.createElement('span');
  times.className = 'cat-times';
  times.textContent = ' × ';
  const col = doc.createElement('span');
  renderCategoryLabel(col, colCat, colLabel, doc);
  el.appendChild(row);
  el.appendChild(times);
  el.appendChild(col);
}

/**
 * Render the INLINE criteria header for a `Filters` object — one dot-separated
 * criterion per active constraint, in `activeFilterChips` order. Used by the
 * findFlag + daily play-screen headers; the caller drops the returned fragment
 * into `#find-cat` (replacing the old plain-text title).
 *
 * @param {Filters} filters
 * @param {(key: string, fallback: string) => string} t
 * @param {Document} [doc]
 * @returns {DocumentFragment}
 */
export function renderCriteriaInline(filters, t, doc = document) {
  const frag = doc.createDocumentFragment();
  activeFilterChips(filters).forEach((ref, i) => {
    if (i > 0) {
      const sep = doc.createElement('span');
      sep.className = 'crit-sep';
      sep.textContent = '·';
      frag.appendChild(sep);
    }
    frag.appendChild(buildCriterionInline(ref, filters, t, doc));
  });
  return frag;
}

/** The muted middot between two criteria. @param {Document} doc */
function critSepEl(doc) {
  const sep = doc.createElement('span');
  sep.className = 'crit-sep';
  sep.textContent = '·';
  return sep;
}

/**
 * Criteria header for a Flag Party spot-the-flag spec: the colour/motif half through
 * {@link renderCriteriaInline} (identical swatch / motif marks to every other
 * criteria surface), then a text-only "not <country>" criterion per country rule-out
 * clause. Country clauses are spot-only and are NOT a Filters group, so they arrive
 * as bare codes rather than inside `filters`.
 *
 * **No flag mark, deliberately.** A thumbnail beside "not France" would hand the room
 * the exact tile to avoid, and the whole point of the clause is that you must
 * RECOGNISE the flag among the four yourself — it renders like a country fact
 * (continent / statehood), name only.
 *
 * @param {Filters} filters  the colour/motif half of the spec
 * @param {string[]} countryCodes  countries to rule out, rendered "not <name>"
 * @param {(key: string, fallback: string) => string} t
 * @param {Document} [doc]
 * @returns {DocumentFragment}
 */
export function renderSpotCriteria(filters, countryCodes, t, doc = document) {
  const frag = renderCriteriaInline(filters, t, doc);
  for (const code of countryCodes) {
    if (frag.children.length) frag.appendChild(critSepEl(doc));
    const crit = doc.createElement('span');
    crit.className = 'crit crit-exclude';
    const label = doc.createElement('span');
    label.className = 'crit-label';
    // Spelled out in ink like every other exclude ("not France" / "nie Francja"),
    // with the country's own name from the shared `country.<code>` i18n keys.
    label.textContent = t('party.spotExcludeCountry', 'not {c}').replace('{c}', t(`country.${code}`, code));
    crit.appendChild(label);
    frag.appendChild(crit);
  }
  return frag;
}

/**
 * Inline criteria header for a SUPERLATIVE puzzle — the ranking metric's
 * hue-tinted icon leading the hand-written title. A superlative ranks by a
 * metric rather than matching a filter, so there's no chip chain to build; the
 * icon just gives the header the same "here's the metric" visual cue a filter
 * puzzle gets from its metric chip (e.g. the population glyph before "The 5 most
 * populous countries of Europe"). The same `.crit-ic` sizing/hue idiom as
 * `buildCriterionInline`'s scalar branch, so the icon matches everywhere.
 *
 * @param {string} metricKey  the entry's `metric` (same keys as METRIC_ICONS)
 * @param {string} label      the puzzle's hand-written title
 * @param {Document} [doc]
 * @returns {DocumentFragment}
 */
export function renderMetricLeadInline(metricKey, label, doc = document) {
  const frag = doc.createDocumentFragment();
  const ic = metricIconSpan(metricKey, 'crit-ic', doc);
  ic.style.color = METRIC_HUES[metricKey] || 'currentColor';
  frag.appendChild(ic);
  const text = doc.createElement('span');
  text.className = 'crit-label';
  text.textContent = label;
  frag.appendChild(text);
  return frag;
}

/**
 * Inline criteria header led by the flag glyph — for a manual puzzle whose theme
 * is about the flag's design but ISN'T expressible as a filter token (e.g.
 * "triangles from the hoist": there's no triangle motif), so it can't render
 * chips yet still deserves the "this is about the flag" cue. Same flag glyph +
 * `.crit-label` idiom as the chip path, just leading a hand-written title.
 *
 * @param {string} label  the puzzle's hand-written title
 * @param {Document} [doc]
 * @returns {DocumentFragment}
 */
export function renderFlagLeadInline(label, doc = document) {
  const frag = doc.createDocumentFragment();
  frag.appendChild(flagGlyphEl(doc));
  const text = doc.createElement('span');
  text.className = 'crit-label';
  text.textContent = label;
  frag.appendChild(text);
  return frag;
}
