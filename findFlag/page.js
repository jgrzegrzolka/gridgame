import { CONTINENTS, flagsGamePool, loadCountries, attachMetrics } from '../flags/group.js';
import {
  ALL_FLAG_COLORS,
  ALL_MOTIFS,
  STRIPES_ORIENTATIONS_FOR_RANDOM,
  METRIC_KEYS,
  suggest,
  exactSingleMatch,
} from '../flags/engine.js';
import { buildMetricTierItems } from '../flags/metricTiers.js';
import { METRIC_FILES } from '../flags/metrics/index.js';
import {
  findTargets,
  findPool,
  classifyGuess,
  isFindIncludeAll,
  setFindIncludeAll,
  parseFilterFromUrl,
  serializeFilter,
  filterToCategory,
  pillLabel,
  pickRandomMix,
} from '../flags/findFlag.js';
import { emptyFilters, matchesFilters, createColorCountLock } from '../flags/flagsFilter.js';
import { createColorCountPicker } from '../colorCountPicker.js';
import { pickCelebration } from '../flags/quiz.js';
import { t, countryName, withLocalizedAliases } from '../i18n.js';
import { runCelebration } from '../confetti.js';
import { bindTileCountry, refreshTileNames } from '../langRefresh.js';
import { refreshChooserI18n } from './chooserI18n.js';
import { shareUrl, makeColorSwatch } from '../common.js';
import { getOrCreateDeviceId } from '../flags/identity.js';
import { bumpShare, pushEngagementBlob } from '../flags/engagementCounters.js';
import { ensureProfile } from '../flags/autoProfile.js';
import { refreshAchievementsAndDiff } from '../flags/achievementsBaseline.js';
import { celebrate } from '../flags/achievementCelebrate.js';

/**
 * Options the Random button (and the result page's "Random next" link)
 * pass to pickRandomMix. Keeps the modifier probabilities one knob:
 *   - onlyColorsProbability: 0.25 — when colour pills end up in the
 *     mix, attach the "no other colours" modifier ~1 in 4 times. Makes
 *     "find every flag whose colours are exactly red + white" mixes
 *     reachable from Random, not just from manual chooser play.
 *   - colorCountProbability: 0.10 — independently, attach a random
 *     colorCount picker constraint (any of =/>=/<= × 2..5). Less
 *     frequent because it's a less natural puzzle shape than the
 *     "only these colours" framing.
 *   - populationProbability: 0.15 — attach a random population tier
 *     (one of the six POPULATION_BREAKS_FOR_RANDOM). Mutually exclusive
 *     with colorCount inside pickRandomMix, so a mix never stacks both
 *     scalar modifiers. Middling frequency: population is a recognizable,
 *     satisfying constraint, but common enough thresholds that it stays
 *     discoverable without dominating.
 *   - areaProbability: 0.12, attach a random land-area tier (one of the
 *     six AREA_BREAKS_FOR_RANDOM). Mutually exclusive with BOTH colorCount
 *     and population, so a mix carries at most one scalar modifier. Slightly
 *     rarer than population since it only fires when population didn't.
 * Tune these here; flags/findFlag.js's pickRandomMix is a pure
 * generator and stays opt-in.
 */
const RANDOM_MIX_OPTIONS = /** @type {const} */ ({
  onlyColorsProbability: 0.25,
  colorCountProbability: 0.10,
  populationProbability: 0.15,
  areaProbability: 0.12,
  densityProbability: 0.10,
  gdpProbability: 0.08,
  gdpPerCapitaProbability: 0.06,
  coffeeProbability: 0.06,
  wineProbability: 0.06,
  cocoaProbability: 0.06,
  bananaProbability: 0.06,
  elevationProbability: 0.10,
  coastlineProbability: 0.10,
  forestProbability: 0.10,
});

/**
 * Pick a fresh random mix from the full (continent + color + motif)
 * tag inventory and navigate to it. Used by the in-game "Random" link
 * and the result page's "Random next" link — both want the same
 * "give me a new puzzle" jump, so the pool-build and navigation live
 * in one place. (The chooser's Random button uses its own narrower
 * pool — only pills that are actually visible there.)
 * @param {import('../flags/group.js').Country[]} all
 */
/**
 * Wire `el` so a click shares the current page URL (in-game or result —
 * both already have `?f=<filter>` in the address bar so we don't need
 * to re-serialize). On the 'copied' branch, toggles `.copied` for 1.5 s
 * to swap the share-icon glyph for the green checkmark (see common.css).
 * 'shared' / 'dismissed' / 'failed' all stay silent — same reasoning as
 * TTT's onShareClick. See `common.js::shareUrl` for the full state model.
 *
 * @param {HTMLElement} el
 */
function attachShareHandler(el) {
  el.addEventListener('click', async () => {
    const result = await shareUrl(window.location.href, {
      title: t('findFlag.shareTitle', 'Yet Another Quiz — flag puzzle'),
      text: t('findFlag.shareText', "I built a flag puzzle. Can you find them all?"),
    });
    if (result === 'copied') {
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 1500);
    }
    // Engagement event: log shares of a custom puzzle. contextHint is
    // the raw `?f=…` filter string so the "shared 5 different filters"
    // achievement (Feature O) can count distinct payloads. Falls
    // through to a generic "no filter" hint if for some reason the
    // URL doesn't carry one — defensive only, the share affordance is
    // gated to filter-set states.
    if (result === 'shared' || result === 'copied') {
      const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
      void ensureProfile(deviceId);
      // Feature S Phase 3: local counter + syncBlob push replaces the
      // engagementEvents POST. Catches "Custom Crafter" once Phase 4
      // rewires the achievement evaluator to localStorage. The
      // pre-Phase-3 contextHint (filter string) had no consumer and
      // is dropped.
      bumpShare(window.localStorage, 'findflag');
      void pushEngagementBlob(deviceId, window.localStorage);
      void refreshAchievementsAndDiff(deviceId).then((newly) => {
        if (newly.length > 0) void celebrate(newly);
      });
    }
  });
}

// sessionStorage key for the one-shot `mode` hint that survives a
// `window.location.search = …` navigation. Random click sites set it
// to 'random' before navigating; bootFindFlag reads + clears it on
// mount and falls back to 'custom' when absent (which covers the Play
// button + any externally-shared `?f=…` link). Used only by the
// `findflag_play` engagement event payload (Feature M Part B).
const MODE_HINT_KEY = 'findFlag.mode';

function goRandom(all) {
  /** @type {Array<{ group: 'continent' | 'color' | 'motif' | 'stripesOnly', value: string }>} */
  const pool = [
    ...CONTINENTS.filter((v) => all.some((c) => c.continent === v))
      .map((v) => ({ group: /** @type {'continent'} */ ('continent'), value: /** @type {string} */ (v) })),
    ...ALL_FLAG_COLORS.filter((v) => all.some((c) => c.colors.includes(v)))
      .map((v) => ({ group: /** @type {'color'} */ ('color'), value: v })),
    ...ALL_MOTIFS.filter((v) => all.some((c) => (c.motifs ?? []).includes(v)))
      .map((v) => ({ group: /** @type {'motif'} */ ('motif'), value: v })),
    ...STRIPES_ORIENTATIONS_FOR_RANDOM.filter((v) => all.some((c) => c.stripesOnly === v))
      .map((v) => ({ group: /** @type {'stripesOnly'} */ ('stripesOnly'), value: /** @type {string} */ (v) })),
  ];
  const f = pickRandomMix(pool, all, RANDOM_MIX_OPTIONS);
  const params = new URLSearchParams({ f: serializeFilter(f) });
  try { sessionStorage.setItem(MODE_HINT_KEY, 'random'); } catch {}
  window.location.search = `?${params.toString()}`;
}

export function bootFindFlag() {
  const chooserEl = document.getElementById('chooser');
  const gameEl = document.getElementById('game');
  const resultEl = document.getElementById('result');

  const zoom = /** @type {HTMLDialogElement} */ (document.getElementById('zoom'));
  const zoomImg = zoom.querySelector('img');
  const zoomName = zoom.querySelector('p');
  function openZoom(c) {
    zoomImg.src = `../flags/svg/${c.code}.svg`;
    const displayName = countryName(c);
    zoomImg.alt = displayName;
    zoomName.textContent = displayName;
    zoom.showModal();
  }
  zoom.addEventListener('click', (e) => {
    if (e.target === zoom) zoom.close();
  });

  function flagTile(c) {
    const displayName = countryName(c);
    const li = document.createElement('li');
    li.className = 'find-tile';
    li.dataset.name = displayName;
    bindTileCountry(li, c);
    li.addEventListener('click', () => openZoom(c));
    const img = document.createElement('img');
    img.src = `../flags/svg/${c.code}.svg`;
    img.alt = displayName;
    img.loading = 'lazy';
    li.appendChild(img);
    return li;
  }

  const includeAll = isFindIncludeAll();
  const initialFilter = parseFilterFromUrl(window.location.search);

  const scopeToggleEl = /** @type {HTMLInputElement | null} */ (document.getElementById('scope-toggle-input'));
  if (scopeToggleEl) {
    scopeToggleEl.checked = includeAll;
    scopeToggleEl.addEventListener('change', () => {
      setFindIncludeAll(localStorage, scopeToggleEl.checked);
      // Let the toggle's slide animation finish (CSS transition is 150 ms)
      // and give the user a beat to register the new position before the
      // page reloads — without this, the change event triggers an instant
      // reload and the user never sees the thumb move.
      setTimeout(() => window.location.reload(), 350);
    });
  }

  return Promise.all([
    fetch('../flags/countries.json').then((r) => r.json()).then(loadCountries),
    // The metrics power the chooser's threshold sections + matchesFilters.
    // A failed fetch degrades gracefully: attaching over `null` leaves every
    // country without the field, so the section renders empty (tiers 0-count →
    // dropped) and no filter is offered.
    ...METRIC_FILES.map((m) =>
      fetch(`../flags/metrics/${m.file}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => [m.key, j ? j.values : null])),
  ])
    .then(([raw, ...metricPairs]) => {
      // Attach AFTER withLocalizedAliases: its clone path (re-wrapping a
      // renamed Country through createCountry) would drop an extra field
      // set beforehand, so denormalize onto the final pool objects.
      const all = withLocalizedAliases(flagsGamePool(raw, includeAll));
      attachMetrics(all, Object.fromEntries(metricPairs));
      /** @type {{ refreshI18n: (newAll: import('../flags/group.js').Country[]) => void } | null} */
      let activeHandle = null;
      if (!initialFilter) {
        activeHandle = renderChooser(all);
        chooserEl.hidden = false;
      } else {
        const category = filterToCategory(initialFilter, t);
        const targets = findTargets(all, category);
        if (targets.length < 1) {
          // The user landed on a URL whose intersection is empty (only
          // possible via hand-edited `?f=…` mixes — the chooser disables
          // Play when the live total is 0). Fall back to the chooser
          // instead of starting a 0/0 game that can only end in give-up.
          activeHandle = renderChooser(all);
          chooserEl.hidden = false;
        } else {
          activeHandle = startGame(category, initialFilter, all);
          // Engagement event: a custom-puzzle play just started.
          // Captures the raw `?f=…` filter (so achievements can count
          // distinct payloads) and a mode hint derived from a
          // sessionStorage flag the Random buttons set before
          // navigating. Absent flag → 'custom' (Play-button click or
          // externally-shared link). One-shot: the flag clears so a
          // subsequent in-tab navigation defaults back to 'custom'.
          const filterRaw = new URLSearchParams(window.location.search).get('f') ?? '';
          if (filterRaw) {
            /** @type {'random' | 'custom'} */
            let mode = 'custom';
            try {
              if (sessionStorage.getItem(MODE_HINT_KEY) === 'random') mode = 'random';
              sessionStorage.removeItem(MODE_HINT_KEY);
            } catch {
              /* sessionStorage unavailable — default mode is fine */
            }
            const deviceId = getOrCreateDeviceId(window.localStorage, () => window.crypto.randomUUID());
            void ensureProfile(deviceId);
            // Feature S Phase 3 dropped the findflag_play engagement
            // event — pure analytics, no achievement consumed it.
            // ensureProfile still fires so the auto-profile row gets
            // created on first findFlag play.
          }
        }
      }

      // Soft language switch: re-run withLocalizedAliases so any new
      // suggestion matching honours the new language's aliases, then
      // hand the fresh pool to whichever surface is active (chooser or
      // game). Tile names re-paint via refreshTileNames — that covers
      // both in-game and result tiles in one walk. data-i18n surfaces
      // (button labels, section titles with attributes, the result
      // prefix span) re-translate upstream in applyStringsToDocument.
      document.addEventListener('langchanged', () => {
        const newAll = withLocalizedAliases(flagsGamePool(raw, includeAll));
        refreshTileNames();
        if (activeHandle) activeHandle.refreshI18n(newAll);
      });
    })
    .catch((err) => {
      document.body.textContent = `${t('game.failedToLoad', 'Failed to load:')} ${err.message}`;
    });

  /**
   * @param {import('../flags/group.js').Country[]} all
   * @returns {{ refreshI18n: (newAll: import('../flags/group.js').Country[]) => void }}
   */
  function renderChooser(all) {
    const sectionsEl = document.getElementById('chooser-sections');
    sectionsEl.innerHTML = '';

    const filter = emptyFilters();

    // Each section's items are the same pills as the legacy chooser —
    // continents/colors/motifs from the engine's RANDOM constants, with
    // 0-count entries dropped so the chooser only ever offers playable
    // tags. Status / "Other continent" deliberately stay out: keeping
    // the chooser's tag inventory the same as before the refactor.
    // titleKey + fallback (not the resolved string) so refreshI18n can
    // re-translate on a soft language switch.
    const sections = /** @type {const} */ ([
      {
        titleKey: 'findFlag.sections.continents',
        titleFallback: 'Continents',
        group: /** @type {'continent'} */ ('continent'),
        items: CONTINENTS.map((value) => ({
          value: /** @type {string} */ (value),
          count: all.filter((c) => c.continent === value).length,
        })).filter((it) => it.count > 0),
      },
      {
        titleKey: 'findFlag.sections.colors',
        titleFallback: 'Colors',
        group: /** @type {'color'} */ ('color'),
        items: ALL_FLAG_COLORS.map((value) => ({
          value,
          count: all.filter((c) => c.colors.includes(value)).length,
        })).filter((it) => it.count > 0),
      },
      {
        titleKey: 'findFlag.sections.motifs',
        titleFallback: 'Motifs',
        group: /** @type {'motif'} */ ('motif'),
        items: ALL_MOTIFS.map((value) => ({
          value,
          count: all.filter((c) => (c.motifs ?? []).includes(value)).length,
        })).filter((it) => it.count > 0),
      },
      {
        titleKey: 'findFlag.sections.stripes',
        titleFallback: 'Stripes',
        group: /** @type {'stripesOnly'} */ ('stripesOnly'),
        items: STRIPES_ORIENTATIONS_FOR_RANDOM.map((value) => ({
          value: /** @type {string} */ (value),
          count: all.filter((c) => c.stripesOnly === value).length,
        })).filter((it) => it.count > 0),
      },
    ]);

    /** @type {Array<{ btn: HTMLButtonElement, group: 'continent' | 'color' | 'motif' | 'stripesOnly', value: string, labelSpan: HTMLSpanElement }>} */
    const allPills = [];
    // Population pills live in their own array, deliberately NOT in `allPills`:
    // population is scalar (single-select, one { op, n } — not an include/
    // exclude value set), and the Random button feeds `allPills` straight into
    // pickRandomMix's pill pool where a population entry would blow up (no
    // include/exclude Set to .add into). Random reaches population via the
    // separate populationProbability modifier path instead.
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const populationPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const areaPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const densityPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const gdpPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const gdpPerCapitaPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const coffeePills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const winePills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const cocoaPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const bananaPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const elevationPills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const coastlinePills = [];
    /** @type {Array<{ btn: HTMLButtonElement, value: string, labelSpan: HTMLSpanElement }>} */
    const forestPills = [];
    /** @type {Array<{ h: HTMLHeadingElement, key: string, fallback: string }>} */
    const sectionHeaders = [];
    /** @type {HTMLSpanElement | null} */
    let onlyColorsLabelSpan = null;

    // "No other colours" toggle pill — state lives in the shared
    // createColorCountLock so flagsdata and findFlag can't drift on what
    // "only these colours" means. Page owns the DOM (button below) and
    // calls into the lock from three places: the toggle click, every
    // color-include pill click (sync), and Clear (reset).
    const colorCountLock = createColorCountLock(filter);
    /** @type {HTMLButtonElement | null} */
    let onlyColorsBtn = null;

    // "Colour count" widget — segmented op + N picker shared with the
    // flagsdata filter bar. Both surfaces write to `filter.colorCount`,
    // so engaging the picker resets the lock and vice versa.
    const colorCountPicker = createColorCountPicker(filter, t, {
      onChange: () => updateBar(),
      onPicked: () => {
        // Picker just took over `filter.colorCount`. Disengage the lock
        // *cosmetically* — DON'T call lock.reset() here, because that
        // would clobber the value the picker just wrote.
        colorCountLock.disengage();
        if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
      },
    });

    for (const sec of sections) {
      const secEl = document.createElement('section');
      secEl.className = 'chooser-section';
      const h = document.createElement('h2');
      h.textContent = t(sec.titleKey, sec.titleFallback);
      sectionHeaders.push({ h, key: sec.titleKey, fallback: sec.titleFallback });
      secEl.appendChild(h);
      const wrap = document.createElement('div');
      wrap.className = 'chooser-pills';
      for (const it of sec.items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'pill-label';
        labelSpan.textContent = pillLabel(sec.group, it.value, 'include', t);
        const countSpan = document.createElement('span');
        countSpan.className = 'pill-count';
        countSpan.textContent = String(it.count);
        // Colour pills lead with the flag-colour swatch dot (shared with the
        // flagsdata filter bar). Sibling of the label span, so the langchanged
        // relabel (labelSpan.textContent) leaves it untouched.
        if (sec.group === 'color') btn.appendChild(makeColorSwatch(it.value));
        btn.appendChild(labelSpan);
        btn.appendChild(countSpan);
        const group = sec.group;
        const value = it.value;
        btn.addEventListener('click', () => cyclePill(group, value, btn));
        wrap.appendChild(btn);
        allPills.push({ btn, group, value, labelSpan });
      }
      // After the Colors section render the "no other colours" modifier
      // pill. Single toggle; when active, filter.colorCount is bound to the
      // number of include colours. Adding/removing colour pills auto-updates
      // the count via the lock's sync() call in cyclePill.
      if (sec.group === 'color') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill pill-modifier';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'pill-label';
        labelSpan.textContent = t('findFlag.noOtherColors', 'no other colours');
        onlyColorsLabelSpan = labelSpan;
        btn.appendChild(labelSpan);
        btn.addEventListener('click', () => {
          const on = colorCountLock.toggle();
          btn.classList.toggle('active', on);
          // Lock just took over the colour-count primitive — tell the
          // picker pill to disengage cosmetically (drops its op/n to
          // defaults, paints inactive). Doesn't touch `filter.colorCount`.
          colorCountPicker.disengage();
          updateBar();
        });
        wrap.appendChild(btn);
        onlyColorsBtn = btn;
        // Colour-count compound pill — sits next to "no other colours"
        // since both drive the same `filter.colorCount` primitive.
        wrap.appendChild(colorCountPicker.el);
      }
      secEl.appendChild(wrap);
      sectionsEl.appendChild(secEl);
    }

    // Population section — rendered outside the loop above because its pills
    // are single-select (scalar `filter.population`), not the include/exclude
    // tristate the other sections cycle through. Tiers are the six curated
    // breakpoints the TTT generator uses (POPULATION_BREAKS_FOR_RANDOM), so
    // the surfaces can't drift; 0-count tiers are dropped like every other
    // section so the chooser only offers playable filters.
    {
      // Shared tier builder — same {value, op, n, count} the flagsdata filter
      // bar renders, counted via the engine's canonical predicate (no
      // re-inlined `c.population >= n`), 0-count tiers dropped. One definition
      // of a tier across both surfaces.
      const popItems = buildMetricTierItems('population', all);

      if (popItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.population', 'Population');
        sectionHeaders.push({ h, key: 'findFlag.sections.population', fallback: 'Population' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of popItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('population', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectPopulation(op, n, btn));
          wrap.appendChild(btn);
          populationPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Land-area section, the km² twin of Population, same single-select scalar
    // (`filter.area`) shape and the same shared tier builder.
    {
      const areaItems = buildMetricTierItems('area', all);
      if (areaItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.area', 'Land area');
        sectionHeaders.push({ h, key: 'findFlag.sections.area', fallback: 'Land area' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of areaItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('area', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectArea(op, n, btn));
          wrap.appendChild(btn);
          areaPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Population-density section, same single-select scalar (`filter.density`).
    {
      const densityItems = buildMetricTierItems('density', all);
      if (densityItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.density', 'Population density');
        sectionHeaders.push({ h, key: 'findFlag.sections.density', fallback: 'Population density' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of densityItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('density', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectDensity(op, n, btn));
          wrap.appendChild(btn);
          densityPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // GDP section, same single-select scalar (`filter.gdp`).
    {
      const gdpItems = buildMetricTierItems('gdp', all);
      if (gdpItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.gdp', 'GDP');
        sectionHeaders.push({ h, key: 'findFlag.sections.gdp', fallback: 'GDP' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of gdpItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('gdp', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectGdp(op, n, btn));
          wrap.appendChild(btn);
          gdpPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // GDP-per-capita section, same single-select scalar (`filter.gdpPerCapita`).
    {
      const gdpPerCapitaItems = buildMetricTierItems('gdpPerCapita', all);
      if (gdpPerCapitaItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.gdpPerCapita', 'GDP per capita');
        sectionHeaders.push({ h, key: 'findFlag.sections.gdpPerCapita', fallback: 'GDP per capita' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of gdpPerCapitaItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('gdpPerCapita', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectGdpPerCapita(op, n, btn));
          wrap.appendChild(btn);
          gdpPerCapitaPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Coffee-production section, same single-select scalar (`filter.coffee`).
    // Sparse `>=`-only tiers, so the pills read "over 10K tonnes" etc.
    {
      const coffeeItems = buildMetricTierItems('coffee', all);
      if (coffeeItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.coffee', 'Coffee production');
        sectionHeaders.push({ h, key: 'findFlag.sections.coffee', fallback: 'Coffee production' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of coffeeItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('coffee', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectCoffee(op, n, btn));
          wrap.appendChild(btn);
          coffeePills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Wine-production section, same single-select scalar (`filter.wine`).
    // Sparse `>=`-only tiers, so the pills read "over 10K tonnes" etc.
    {
      const wineItems = buildMetricTierItems('wine', all);
      if (wineItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.wine', 'Wine production');
        sectionHeaders.push({ h, key: 'findFlag.sections.wine', fallback: 'Wine production' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of wineItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('wine', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectWine(op, n, btn));
          wrap.appendChild(btn);
          winePills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Cocoa-production section, same single-select scalar (`filter.cocoa`).
    // Sparse `>=`-only tiers, so the pills read "over 10K tonnes" etc.
    {
      const cocoaItems = buildMetricTierItems('cocoa', all);
      if (cocoaItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.cocoa', 'Cocoa production');
        sectionHeaders.push({ h, key: 'findFlag.sections.cocoa', fallback: 'Cocoa production' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of cocoaItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('cocoa', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectCocoa(op, n, btn));
          wrap.appendChild(btn);
          cocoaPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Banana-production section, same single-select scalar (`filter.banana`).
    // Sparse `>=`-only tiers, so the pills read "over 10K tonnes" etc.
    {
      const bananaItems = buildMetricTierItems('banana', all);
      if (bananaItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.banana', 'Banana production');
        sectionHeaders.push({ h, key: 'findFlag.sections.banana', fallback: 'Banana production' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of bananaItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('banana', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectBanana(op, n, btn));
          wrap.appendChild(btn);
          bananaPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Highest-elevation section, same single-select scalar (`filter.elevation`).
    // Dense two-directional tiers (both `>= N m` and `<= N m`), like area.
    {
      const elevationItems = buildMetricTierItems('elevation', all);
      if (elevationItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.elevation', 'Highest elevation');
        sectionHeaders.push({ h, key: 'findFlag.sections.elevation', fallback: 'Highest elevation' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of elevationItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('elevation', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectElevation(op, n, btn));
          wrap.appendChild(btn);
          elevationPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Coastline section, same single-select scalar (`filter.coastline`).
    // Dense two-directional tiers (both `>= N km` and `<= N km`), like area.
    {
      const coastlineItems = buildMetricTierItems('coastline', all);
      if (coastlineItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.coastline', 'Coastline length');
        sectionHeaders.push({ h, key: 'findFlag.sections.coastline', fallback: 'Coastline length' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of coastlineItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('coastline', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectCoastline(op, n, btn));
          wrap.appendChild(btn);
          coastlinePills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    // Forest-cover section, same single-select scalar (`filter.forest`).
    // Dense two-directional tiers (both `>= N%` and `<= N%`), intensive so
    // size-independent, like density.
    {
      const forestItems = buildMetricTierItems('forest', all);
      if (forestItems.length > 0) {
        const secEl = document.createElement('section');
        secEl.className = 'chooser-section';
        const h = document.createElement('h2');
        h.textContent = t('findFlag.sections.forest', 'Forest cover');
        sectionHeaders.push({ h, key: 'findFlag.sections.forest', fallback: 'Forest cover' });
        secEl.appendChild(h);
        const wrap = document.createElement('div');
        wrap.className = 'chooser-pills';
        for (const it of forestItems) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pill';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'pill-label';
          labelSpan.textContent = pillLabel('forest', it.value, 'include', t);
          const countSpan = document.createElement('span');
          countSpan.className = 'pill-count';
          countSpan.textContent = String(it.count);
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          const { op, n } = it;
          btn.addEventListener('click', () => selectForest(op, n, btn));
          wrap.appendChild(btn);
          forestPills.push({ btn, value: it.value, labelSpan });
        }
        secEl.appendChild(wrap);
        sectionsEl.appendChild(secEl);
      }
    }

    const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById('find-play'));
    const randomBtn = document.getElementById('find-random');

    // "Clear all" shares the first section's heading line (e.g. "CONTINENTS …
    // Clear all"), right-aligned. Built here per render — not a static HTML
    // element — because renderChooser wipes #chooser-sections on every rebuild
    // (scope toggle), so a moved static button would be destroyed. Keeps
    // data-i18n so applyStringsToDocument retranslates it on a language switch,
    // same as the old static markup did.
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'find-clear';
    clearBtn.id = 'find-clear';
    clearBtn.setAttribute('data-i18n', 'findFlag.clear');
    clearBtn.textContent = t('findFlag.clear', 'Clear all');
    clearBtn.hidden = true;
    const firstHead = sectionsEl.querySelector('.chooser-section h2');
    if (firstHead) {
      const headRow = document.createElement('div');
      headRow.className = 'chooser-section-head';
      firstHead.replaceWith(headRow);
      headRow.append(firstHead, clearBtn);
    }

    const playLabel = () => t('findFlag.play', 'Play');

    function updateBar() {
      let selCount = 0;
      for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'>} */ (['continent','color','motif','status','stripesOnly'])) {
        selCount += filter[k].include.size + filter[k].exclude.size;
      }
      if (filter.colorCount !== null) selCount++;
      if (filter.population !== null) selCount++;
      if (filter.area !== null) selCount++;
      if (filter.density !== null) selCount++;
      if (selCount === 0) {
        // Nothing selected — bare "Play" (no zero-count to read as a sad
        // empty result; the user hasn't picked anything yet).
        playBtn.textContent = playLabel();
        playBtn.disabled = true;
        clearBtn.hidden = true;
        return;
      }
      const matchCount = all.filter((c) => matchesFilters(c, filter)).length;
      // Once anything is selected, show the live match count IN the
      // button — "Play (83)" or "Play (0)". The 0 case stays informative:
      // "your filter matches nothing, adjust it." Min playable size is 1.
      playBtn.textContent = `${playLabel()} (${matchCount})`;
      playBtn.disabled = matchCount < 1;
      clearBtn.hidden = false;
    }

    /**
     * @param {'continent' | 'color' | 'motif' | 'stripesOnly'} group
     * @param {string} value
     * @param {HTMLButtonElement} btn
     */
    function cyclePill(group, value, btn) {
      const g = filter[group];
      if (g.include.has(value)) {
        g.include.delete(value);
        g.exclude.add(value);
        btn.classList.remove('active');
        btn.classList.add('exclude');
      } else if (g.exclude.has(value)) {
        g.exclude.delete(value);
        btn.classList.remove('exclude');
      } else {
        g.include.add(value);
        btn.classList.add('active');
      }
      // Colour-include count may have changed — if "no other colours" is on,
      // colorCount tracks it. (No-op if the lock is off.)
      if (group === 'color') colorCountLock.sync();
      updateBar();
    }

    /**
     * Single-select population tier. Clicking the active tier clears it
     * (toggle off); clicking any other tier replaces the selection —
     * population is scalar, so two tiers can never both apply. Repaints the
     * whole population row's active state from `filter.population` so the
     * previously-active pill deactivates without tracking it separately.
     *
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectPopulation(op, n, btn) {
      const isActive = filter.population !== null && filter.population.op === op && filter.population.n === n;
      filter.population = isActive ? null : { op, n };
      for (const p of populationPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select land-area tier, twin of selectPopulation.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectArea(op, n, btn) {
      const isActive = filter.area !== null && filter.area.op === op && filter.area.n === n;
      filter.area = isActive ? null : { op, n };
      for (const p of areaPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select population-density tier, twin of selectArea.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectDensity(op, n, btn) {
      const isActive = filter.density !== null && filter.density.op === op && filter.density.n === n;
      filter.density = isActive ? null : { op, n };
      for (const p of densityPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select GDP tier, twin of selectDensity.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectGdp(op, n, btn) {
      const isActive = filter.gdp !== null && filter.gdp.op === op && filter.gdp.n === n;
      filter.gdp = isActive ? null : { op, n };
      for (const p of gdpPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select GDP-per-capita tier, twin of selectGdp.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectGdpPerCapita(op, n, btn) {
      const isActive = filter.gdpPerCapita !== null && filter.gdpPerCapita.op === op && filter.gdpPerCapita.n === n;
      filter.gdpPerCapita = isActive ? null : { op, n };
      for (const p of gdpPerCapitaPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select coffee-production tier, twin of selectGdp.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectCoffee(op, n, btn) {
      const isActive = filter.coffee !== null && filter.coffee.op === op && filter.coffee.n === n;
      filter.coffee = isActive ? null : { op, n };
      for (const p of coffeePills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select wine-production tier, twin of selectCoffee.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectWine(op, n, btn) {
      const isActive = filter.wine !== null && filter.wine.op === op && filter.wine.n === n;
      filter.wine = isActive ? null : { op, n };
      for (const p of winePills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select cocoa-production tier, twin of selectCoffee.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectCocoa(op, n, btn) {
      const isActive = filter.cocoa !== null && filter.cocoa.op === op && filter.cocoa.n === n;
      filter.cocoa = isActive ? null : { op, n };
      for (const p of cocoaPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select banana-production tier, twin of selectCoffee.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectBanana(op, n, btn) {
      const isActive = filter.banana !== null && filter.banana.op === op && filter.banana.n === n;
      filter.banana = isActive ? null : { op, n };
      for (const p of bananaPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select highest-elevation tier, twin of selectArea.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectElevation(op, n, btn) {
      const isActive = filter.elevation !== null && filter.elevation.op === op && filter.elevation.n === n;
      filter.elevation = isActive ? null : { op, n };
      for (const p of elevationPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select coastline tier, twin of selectElevation.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectCoastline(op, n, btn) {
      const isActive = filter.coastline !== null && filter.coastline.op === op && filter.coastline.n === n;
      filter.coastline = isActive ? null : { op, n };
      for (const p of coastlinePills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    /**
     * Single-select forest-cover tier, twin of selectCoastline.
     * @param {'>=' | '<='} op
     * @param {number} n
     * @param {HTMLButtonElement} btn
     */
    function selectForest(op, n, btn) {
      const isActive = filter.forest !== null && filter.forest.op === op && filter.forest.n === n;
      filter.forest = isActive ? null : { op, n };
      for (const p of forestPills) {
        p.btn.classList.toggle('active', !isActive && p.btn === btn);
      }
      updateBar();
    }

    playBtn.addEventListener('click', () => {
      if (playBtn.disabled) return;
      const params = new URLSearchParams({ f: serializeFilter(filter) });
      window.location.search = `?${params.toString()}`;
    });

    clearBtn.addEventListener('click', () => {
      for (const k of /** @type {Array<'continent' | 'color' | 'motif' | 'status' | 'stripesOnly'>} */ (['continent','color','motif','status','stripesOnly'])) {
        filter[k].include.clear();
        filter[k].exclude.clear();
      }
      colorCountLock.reset();
      if (onlyColorsBtn) onlyColorsBtn.classList.remove('active');
      colorCountPicker.reset();
      for (const k of METRIC_KEYS) filter[k] = null;
      for (const { btn } of allPills) {
        btn.classList.remove('active', 'exclude');
      }
      for (const { btn } of populationPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of areaPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of densityPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of gdpPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of gdpPerCapitaPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of coffeePills) {
        btn.classList.remove('active');
      }
      for (const { btn } of winePills) {
        btn.classList.remove('active');
      }
      for (const { btn } of cocoaPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of bananaPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of elevationPills) {
        btn.classList.remove('active');
      }
      for (const { btn } of coastlinePills) {
        btn.classList.remove('active');
      }
      for (const { btn } of forestPills) {
        btn.classList.remove('active');
      }
      updateBar();
    });

    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        if (allPills.length === 0) return;
        // Strip the DOM-bound `btn` field — pickRandomMix only needs the
        // (group, value) shape, and decoupling here keeps the helper
        // testable against pure data.
        const pool = allPills.map(({ group, value }) => ({ group, value }));
        const f = pickRandomMix(pool, all, RANDOM_MIX_OPTIONS);
        const params = new URLSearchParams({ f: serializeFilter(f) });
        try { sessionStorage.setItem(MODE_HINT_KEY, 'random'); } catch {}
        window.location.search = `?${params.toString()}`;
      });
    }

    // Land the chooser on a playable starter rather than a blank slate:
    // one random continent + one random colour pre-included, so Play is
    // live on first paint. The user can refine or Clear from there.
    // Violet is excluded from the initial-colour pool because it only
    // appears on Dominica + Northern Mariana Islands (COA only), so a
    // continent × violet starter collapses to 0-2 answers — a confusing
    // landing experience. Violet stays available as a manual chooser
    // pick and in the explicit Random button's pool.
    const continentPills = allPills.filter((p) => p.group === 'continent');
    const colorPills = allPills.filter((p) => p.group === 'color' && p.value !== 'violet');
    if (continentPills.length > 0) {
      const pick = continentPills[Math.floor(Math.random() * continentPills.length)];
      cyclePill(pick.group, pick.value, pick.btn);
    }
    if (colorPills.length > 0) {
      const pick = colorPills[Math.floor(Math.random() * colorPills.length)];
      cyclePill(pick.group, pick.value, pick.btn);
    }

    updateBar();

    return {
      /**
       * Re-translate every chooser surface that was painted with `t()`
       * at render time. Delegates to the pure helper in `chooserI18n.js`
       * so the repaint contract is unit-tested without a fake document.
       * `data-i18n`-marked elements (Clear button, static Random label,
       * etc.) are handled upstream by `applyStringsToDocument` before
       * this fires. `newAll` is unused today (pill counts don't shift
       * on a re-alias) but kept in the signature so a future "live
       * count refresh" can plug in without a contract change.
       *
       * @param {import('../flags/group.js').Country[]} _newAll
       */
      refreshI18n(_newAll) {
        refreshChooserI18n({ sectionHeaders, allPills, populationPills, areaPills, densityPills, gdpPills, gdpPerCapitaPills, coffeePills, winePills, cocoaPills, bananaPills, elevationPills, coastlinePills, forestPills, onlyColorsLabelSpan, updateBar });
      },
    };
  }

  /**
   * @param {import('../flags/engine.js').Category} category
   * @param {import('../flags/flagsFilter.js').Filters} filter
   * @param {import('../flags/group.js').Country[]} all
   * @returns {{ refreshI18n: (newAll: import('../flags/group.js').Country[]) => void }}
   */
  function startGame(category, filter, all) {
    let targets = findTargets(all, category);
    // pool is rebuilt on a soft language switch — the suggestion matcher
    // reads each Country's `aliases`, which are baked at
    // withLocalizedAliases time. targetCodes is mutated in place so the
    // `state` object captured below keeps pointing at the same Set.
    let pool = findPool(all);
    const targetCodes = new Set(targets.map((c) => c.code));
    const foundCodes = new Set();
    const state = { targetCodes, foundCodes };

    const catEl = document.getElementById('find-cat');
    const countEl = document.getElementById('find-count');
    const inputEl = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
    const sugEl = document.getElementById('find-suggestions');
    const foundEl = document.getElementById('find-found');
    const giveUpEl = document.getElementById('give-up');
    const gameRandomEl = /** @type {HTMLAnchorElement} */ (document.getElementById('game-random'));
    const gameShareEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('game-share'));

    catEl.textContent = category.label;
    updateCount();

    let matches = [];
    let selected = 0;
    let finished = false;

    function updateCount() {
      countEl.textContent = `${foundCodes.size} / ${targetCodes.size}`;
    }
    /* Brief flash on each correct guess. Remove → force reflow → add
     * re-triggers the CSS animation on consecutive matches. Called
     * from the match branch only, not from the initial updateCount(). */
    function pulseCount() {
      countEl.classList.remove('find-count--pulse');
      void countEl.offsetWidth;
      countEl.classList.add('find-count--pulse');
    }

    function renderSuggestions() {
      sugEl.innerHTML = '';
      matches.forEach((c, i) => {
        const li = document.createElement('li');
        if (i === selected) li.classList.add('selected');
        const span = document.createElement('span');
        span.textContent = countryName(c);
        li.appendChild(span);
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          submitCountry(c);
        });
        li.addEventListener('mouseenter', () => {
          selected = i;
          renderSelected();
        });
        sugEl.appendChild(li);
      });
      sugEl.hidden = matches.length === 0;
    }
    function renderSelected() {
      for (const [i, li] of sugEl.querySelectorAll('li').entries()) {
        li.classList.toggle('selected', i === selected);
      }
    }
    function updateSuggestions() {
      matches = suggest(pool, inputEl.value, { excludeCodes: foundCodes });
      selected = 0;
      renderSuggestions();
      const auto = exactSingleMatch(matches, inputEl.value);
      if (auto) submitCountry(auto);
    }

    function shakeInput() {
      inputEl.classList.remove('shake');
      void inputEl.offsetWidth; // force a reflow so re-adding .shake restarts the animation.
      inputEl.classList.add('shake');
    }
    function flashWrong() {
      inputEl.classList.remove('wrong', 'shake');
      void inputEl.offsetWidth;
      inputEl.classList.add('wrong', 'shake');
      setTimeout(() => inputEl.classList.remove('wrong', 'shake'), 700);
    }

    function appendFound(c) {
      foundEl.insertBefore(flagTile(c), foundEl.firstChild);
    }

    function submitCountry(c) {
      const outcome = classifyGuess(state, c);
      if (outcome.kind === 'match') {
        foundCodes.add(c.code);
        appendFound(c);
        updateCount();
        pulseCount();
        inputEl.value = '';
        matches = [];
        renderSuggestions();
        if (foundCodes.size === targetCodes.size) finish();
        return;
      }
      if (outcome.kind === 'duplicate') {
        shakeInput();
        return;
      }
      if (outcome.kind === 'wrong-category') {
        flashWrong();
        inputEl.value = '';
        matches = [];
        renderSuggestions();
        return;
      }
      shakeInput();
    }

    inputEl.addEventListener('input', updateSuggestions);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = matches[selected];
        if (picked) submitCountry(picked);
        else shakeInput();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (matches.length === 0) return;
        selected = (selected + 1) % matches.length;
        renderSelected();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (matches.length === 0) return;
        selected = (selected - 1 + matches.length) % matches.length;
        renderSelected();
        return;
      }
      if (e.key === 'Escape') {
        inputEl.value = '';
        matches = [];
        renderSuggestions();
      }
    });

    giveUpEl.addEventListener('click', () => finish());

    gameRandomEl.addEventListener('click', (e) => {
      e.preventDefault();
      goRandom(all);
    });

    // Touch-only reveal — matches TTT's `matchMedia('(pointer: coarse)')`
    // pattern (ticTacToe/page.js, line 76). Desktop users have the URL
    // already in the address bar; reserving the share-icon for phones
    // where it actually triggers the native share sheet keeps the
    // chrome-button cluster lighter on the surface where it adds
    // less value. The click handler is still wired in both modes so
    // a future "reveal on desktop too" toggle wouldn't need rewiring.
    const isTouchDevice = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    if (gameShareEl) {
      attachShareHandler(gameShareEl);
      if (isTouchDevice) gameShareEl.hidden = false;
    }
    const resultShareEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('result-share'));
    if (resultShareEl) {
      attachShareHandler(resultShareEl);
      if (isTouchDevice) resultShareEl.hidden = false;
    }

    function finish() {
      if (finished) return;
      finished = true;
      const found = foundCodes.size;
      const total = targetCodes.size;

      // findFlag is play-and-walk-away now — no per-category best score,
      // no "Your best" line, no record-tracking. No "You found X / Y"
      // headline either: the Found / Missed grids below already make the
      // score self-evident. Celebration tier comes from the shared
      // pickCelebration helper so daily / findFlag / quiz all read the
      // same way: confetti for partial, fireworks (alone, not stacked)
      // for a clean sweep.
      const { tier, intensity } = pickCelebration({ found, total });
      runCelebration(tier, { intensity });

      // Found section duplicates the in-game .find-found grid onto the
      // result screen. Without it the user never sees the flag they
      // just submitted: clicking the last target auto-finishes, the
      // game section vanishes, and the result screen would only show
      // what they missed.
      const foundFlags = targets.filter((c) => foundCodes.has(c.code));
      const foundResultEl = document.getElementById('find-result-found');
      foundResultEl.innerHTML = '';
      for (const c of foundFlags) foundResultEl.appendChild(flagTile(c));
      document.getElementById('found-title').hidden = foundFlags.length === 0;

      const missed = targets.filter((c) => !foundCodes.has(c.code));
      const missedEl = document.getElementById('find-missed');
      missedEl.innerHTML = '';
      for (const c of missed) missedEl.appendChild(flagTile(c));
      document.getElementById('missed-title').hidden = missed.length === 0;

      /** @type {HTMLAnchorElement} */ (document.getElementById('play-again')).href =
        window.location.pathname + window.location.search;

      /** @type {HTMLAnchorElement} */ (document.getElementById('play-random')).onclick = (e) => {
        e.preventDefault();
        goRandom(all);
      };

      gameEl.hidden = true;
      resultEl.hidden = false;
    }

    gameEl.hidden = false;
    if (!('ontouchstart' in window)) inputEl.focus();

    return {
      /**
       * Soft language switch: swap in the re-aliased country list (so
       * the suggestion matcher accepts the new language's names),
       * re-derive targets in the new pool by code, re-translate the
       * category label, and re-paint the tiles + suggestion list. The
       * result section's `data-i18n` strings (prefix, found-title,
       * missed-title) re-translate upstream via
       * `applyStringsToDocument`; only the tile names (read from
       * `countryName`) need page-local work, and `refreshTileNames`
       * already covers both the in-game and result lists.
       *
       * @param {import('../flags/group.js').Country[]} newAll
       */
      refreshI18n(newAll) {
        all = newAll;
        pool = findPool(all);
        // Re-translate the category label by re-deriving it from the
        // stored filter — `category.label` was baked at first render
        // and would otherwise read in the boot-time language.
        const fresh = filterToCategory(filter, t);
        targets = findTargets(all, fresh);
        targetCodes.clear();
        for (const c of targets) targetCodes.add(c.code);
        catEl.textContent = fresh.label;
        refreshTileNames();
        renderSuggestions();
      },
    };
  }
}
