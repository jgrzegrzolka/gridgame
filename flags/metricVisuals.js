/**
 * Shared visual identity for the world-metric family: per-metric icon, hue,
 * and short label. One entry per metric key (the same keys as
 * `flags/metrics/index.js` METRIC_FILES), consumed by:
 *
 *   - the metric hub (flags/metricHub.js) on /flagsdata/ and /findFlag/
 *     (chips, panel leads, and flagsdata's applied-filter chips),
 *   - Flag Party's setup chips and the in-round superlative prompt lead
 *     (flagParty/page.js maps its round ids to metric keys via the values
 *     file each round fetches).
 *
 * DELIBERATE PALETTE EXCEPTION, sanctioned like the per-tile flag strip and
 * the colour-swatch dots: each metric carries its own hue so the growing fact
 * family stays scannable (you recognise Population by its teal before reading
 * the label). The hue reaches exactly these metric-identity surfaces (chips,
 * panel lead, prompt lead) and no gameplay tile. This file is the single
 * source: neither CSS nor any page redeclares a metric hue.
 *
 * Adding a metric: one icon + one hue + one short label here (the metricVisuals
 * test fails until all three exist for every registered metric key).
 *
 * Icons are inline `<svg>` strings in one shared line style (24-box, 1.8
 * stroke, currentColor) so they tint via CSS `color`. Rendered with innerHTML
 * by consumers.
 */

/** @type {Record<string, string>} */
export const METRIC_ICONS = {
  // Population: a person with a second, receding silhouette (many people).
  population: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.4M17 15c2.3.5 4 2.4 4 5"/></svg>',
  // Land area: a low mountain range over a baseline (terrain / landmass).
  area: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M4 20l5-9 3.5 5L15 12l5 8"/></svg>',
  // Population density: a tight grid of dots (people per square).
  density: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  // GDP total: a stack of coins (an economy's overall size).
  gdp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 11v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/></svg>',
  // GDP per capita: a single $ coin (wealth per head).
  gdpPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7v10"/><path d="M14.5 9.2c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 1.2 1 1.6 2.5 1.9s2.5.7 2.5 1.9c0 1.2-1.1 1.9-2.5 1.9-1 0-1.9-.3-2.5-1"/></svg>',
  // Coffee production: a steaming coffee cup with a handle.
  coffee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z"/><path d="M17 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 3.5v2M12 3.5v2"/></svg>',
  // Wine production: a wine glass on a base.
  wine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10l-1 6a4 4 0 0 1-8 0z"/><path d="M12 14v5"/><path d="M8 19h8"/></svg>',
  // Cocoa production: a cocoa pod (elongated ridged fruit) with a stem.
  cocoa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5c3 2 4 6 2.5 9.5s-5.5 5.5-9 5-5.5-4-4.5-7.5 4-8 8-8c1.4 0 2 .5 3 1z"/><path d="M11 6.5v11"/></svg>',
  // Banana production: a curved banana.
  banana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5c0 7 4 12 11 12 1.6 0 2.8-.3 3.5-.8-1 .3-6 .2-9.5-3.2S6.7 5.6 7 4.5C6.2 4.9 5 4.5 5 5z"/></svg>',
  // Apple production: a round apple with a leaf and stem.
  apple: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8c-1-1.5-3-2.5-5-2-2 .5-3 2.5-3 5 0 4 3 8 5.5 8 .9 0 1.4-.4 2.5-.4s1.6.4 2.5.4C17 19 20 15 20 11c0-2.5-1-4.5-3-5-2-.5-4 .5-5 2z"/><path d="M12 8c0-2 .5-3.5 2.5-4.5"/></svg>',
  // Highest elevation: a single tall peak with a snowcap (distinct from area's low range).
  elevation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M12 4L20 20H4z"/><path d="M9.4 11.7l2.6 1.6 2.6-1.6"/></svg>',
  // Coastline length: three stacked waves (water / shoreline), distinct from the peak.
  coastline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8c1.5 0 1.5 1.5 3 1.5S10.5 8 12 8s1.5 1.5 3 1.5S19.5 8 21 8"/><path d="M3 13c1.5 0 1.5 1.5 3 1.5S10.5 13 12 13s1.5 1.5 3 1.5S19.5 13 21 13"/><path d="M3 18c1.5 0 1.5 1.5 3 1.5S10.5 18 12 18s1.5 1.5 3 1.5S19.5 18 21 18"/></svg>',
  // Forest cover: a two-tier pine with a centred trunk, distinct from elevation's bare peak.
  forest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 7.5 10H10l-3.5 5h4v4h3v-4h4L14 10h2.5z"/></svg>',
  // Oil production: an oil derrick (a pumpjack tower) with a ground line.
  oil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21 9 5l8 12M7 15h6M4 21h16M9 5l3-2 1 3"/></svg>',
  // Rice production: a bowl of rice with a pair of chopsticks resting across it.
  rice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16a8 8 0 0 1-16 0zM8 12a4 4 0 0 1 8 0M14 5l5-2M15 8l5-2"/></svg>',
  // Coal production: a chunky lump of coal (an irregular faceted rock).
  coal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9 3 15l4 4 8 1 5-5-2-6-6-3zM6 9l6 2m0 0 3-4m-3 4-1 8m1-8 8 1"/></svg>',
  // Sheep per capita: a woolly body (bumpy top) with a small head and two legs.
  sheepPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8a2.5 2.5 0 0 1 4.5-1.5A2.5 2.5 0 0 1 17 8a2.5 2.5 0 0 1 .3 5A2.5 2.5 0 0 1 15 15H9a2.5 2.5 0 0 1-2.3-3.5A2.5 2.5 0 0 1 9 8z"/><circle cx="6.5" cy="9.5" r="2"/><path d="M5 8 3.5 7"/><path d="M10 15.5V18M14 15.5V18"/></svg>',
  // Cattle per capita: a cow head, horns and ears out to the sides, a broad
  // muzzle with two nostrils. Reads as a cow to tell it apart from the sheep.
  cattlePerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6.5C6 4 4 4 3.5 5.5"/><path d="M17 6.5C18 4 20 4 20.5 5.5"/><path d="M6.5 9C4.5 8.3 3 9 2.8 10.5"/><path d="M17.5 9C19.5 8.3 21 9 21.2 10.5"/><path d="M6.5 8.5a5.5 4.5 0 0 1 11 0c0 3-1.2 4.8-2.8 6C13.7 15.3 12.9 15.6 12 15.6s-1.7-.3-2.7-1.1C7.7 13.3 6.5 11.5 6.5 8.5z"/><ellipse cx="12" cy="13.3" rx="3.3" ry="2.1"/><path d="M10.6 13v.6M13.4 13v.6"/></svg>',
  // Beer per capita: a foaming tankard, handle to the right, a fill line under
  // the foam head. Reads as a beer mug to set it apart from the food/animal ones.
  beerPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9h8v9.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5V9z"/><path d="M14.5 11H17a2.5 2.5 0 0 1 0 5h-2.5"/><path d="M6.5 9a1.9 1.9 0 0 1-.3-3.8 2 2 0 0 1 3.9-.7 2 2 0 0 1 3.9.7A1.9 1.9 0 0 1 14.5 9"/><path d="M6.5 12h8"/></svg>',
};

/** @type {Record<string, string>} */
export const METRIC_HUES = {
  population: '#2f8f9d',
  area: '#3f8f5b',
  density: '#7b5ea7',
  gdp: '#c0821e',
  gdpPerCapita: '#4f6bb0',
  coffee: '#7d4f28',
  wine: '#9a4658',
  cocoa: '#a84a30',
  banana: '#9c8410',
  apple: '#c62828',
  elevation: '#5c7a94',
  coastline: '#2f77a6',
  forest: '#2e7d32',
  oil: '#37474f',
  rice: '#7e8b3d',
  coal: '#424242',
  sheepPerCapita: '#a9825f',
  cattlePerCapita: '#6d4c41',
  beerPerCapita: '#e0a11e',
};

/**
 * Short label per metric: the compact chip text ("Coffee", not "Coffee
 * production"; the icon + panel lead carry the rest). Reuses Flag Party's
 * `party.modeShort.*` strings (both languages already ship them) so the same
 * fact wears the same name on every surface; the key names are historical,
 * not party-specific.
 *
 * @type {Record<string, { key: string, fallback: string }>}
 */
export const METRIC_SHORT = {
  population: { key: 'party.modeShort.superlativePop', fallback: 'Population' },
  area: { key: 'party.modeShort.superlativeArea', fallback: 'Land area' },
  density: { key: 'party.modeShort.superlativeDensity', fallback: 'Density' },
  gdp: { key: 'party.modeShort.superlativeGdp', fallback: 'GDP' },
  gdpPerCapita: { key: 'party.modeShort.superlativeGdppc', fallback: 'GDP per capita' },
  coffee: { key: 'party.modeShort.superlativeCoffee', fallback: 'Coffee' },
  wine: { key: 'party.modeShort.superlativeWine', fallback: 'Wine' },
  cocoa: { key: 'party.modeShort.superlativeCocoa', fallback: 'Cocoa' },
  banana: { key: 'party.modeShort.superlativeBanana', fallback: 'Banana' },
  apple: { key: 'party.modeShort.superlativeApple', fallback: 'Apple' },
  elevation: { key: 'party.modeShort.superlativeElevation', fallback: 'Elevation' },
  coastline: { key: 'party.modeShort.superlativeCoastline', fallback: 'Coastline' },
  forest: { key: 'party.modeShort.superlativeForest', fallback: 'Forest' },
  oil: { key: 'party.modeShort.superlativeOil', fallback: 'Oil' },
  rice: { key: 'party.modeShort.superlativeRice', fallback: 'Rice' },
  coal: { key: 'party.modeShort.superlativeCoal', fallback: 'Coal' },
  sheepPerCapita: { key: 'party.modeShort.superlativeSheep', fallback: 'Sheep' },
  cattlePerCapita: { key: 'party.modeShort.superlativeCattle', fallback: 'Cattle' },
  beerPerCapita: { key: 'party.modeShort.superlativeBeer', fallback: 'Beer' },
};
