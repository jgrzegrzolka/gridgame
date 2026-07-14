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
 * Provisional flag glyph marking a flag-design criterion (motif / stripes /
 * colour count) in the inline header. Line style + currentColor so it tints
 * with the surrounding text. NOTE: Jan wants a different mark here eventually —
 * swap this one constant when the replacement lands.
 */
const FLAG_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 5h10l-2.2 3.2L16 11H6"/></svg>';

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
    // Charge motifs / stripes-only / colour-count describe what's ON the flag,
    // so they get the flag glyph. eu-member (political, not a charge) falls
    // through to no mark, reading as a country fact like continent / status.
    crit.appendChild(flagGlyphEl(doc));
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
