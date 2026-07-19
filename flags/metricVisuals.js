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
  // Tea production: a single tea leaf, a broad teardrop with a diagonal midrib.
  // Reads as a leaf (the harvested crop) to set it apart from coffee's mug and
  // cocoa's ridged pod.
  tea: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19C4 12 8 5 18 4c1 8-4 15-13 15z"/><path d="M5 19C8 15 12 12 16 10"/></svg>',
  // Sugarcane production: an upright cane stalk with three node rings and two
  // blade leaves splaying from the top. Reads as a tall grass stem, distinct
  // from the tea leaf and the rice bowl.
  sugarcane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21V6"/><path d="M8.8 17h4.4M8.8 13h4.4M8.8 9h4.4"/><path d="M11 6C8 4.5 6 5 4.5 3"/><path d="M11 6c3-1.5 5-1 6.5-3"/></svg>',
  // Gold production: a bullion bar (a trapezoid ingot with a bevelled top face).
  // Reads as a gold bar, unmistakable against the coin-stack GDP and the food
  // icons; the mining domain's first metric.
  gold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18l2-7h12l2 7z"/><path d="M6 11l1.6-2h8.8L18 11"/></svg>',
  // Alcohol per capita: a martini/cocktail glass (triangular bowl on a stemmed
  // base) with an olive on a pick. Reads as spirits/mixed drinks, setting the
  // whole-alcohol metric apart from beer's tankard and wine's rounded glass.
  alcoholPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16l-8 8z"/><path d="M12 13v6"/><path d="M8 19h8"/><path d="M14.5 8.5 18 5"/></svg>',
  // Meat per capita: a drumstick, a rounded meaty body with the bone knuckle
  // poking out at the bottom-left. Reads as a portion of meat, distinct from the
  // animal-head livestock icons (sheep / cattle).
  meatPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.7 5.4a4.6 4.6 0 0 1 4.9 4.9c-.6 3-2.9 3.6-4.6 3.6-1 2-3.6 2.6-5.2 1s-1-4.2 1-5.2c0-1.7.6-3.9 3.9-4.3z"/><path d="M8.8 14.2 5.5 17.5M5 16l3 3"/></svg>',
  // Bordering countries: two adjacent territory blocks separated by a dashed
  // boundary line down the middle. Reads as "a border between neighbours",
  // distinct from the geographic terrain / water icons.
  borders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h5v12H4z"/><path d="M15 6h5v12h-5z"/><path d="M12 3.5v17" stroke-dasharray="2 2.6"/></svg>',
  // Olive oil production: a slender cruet bottle (narrow neck, rounded body, a
  // fill line) with a single olive leaf sprigging off the neck. Reads as "oil
  // in a bottle", distinct from the tea leaf, the wine glass, and the coffee cup.
  oliveOil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h4"/><path d="M9.5 6c0 1.5-1.5 2.2-1.5 4.2V18a1.3 1.3 0 0 0 1.3 1.3h5.4A1.3 1.3 0 0 0 16 18v-7.8c0-2-1.5-2.7-1.5-4.2"/><path d="M8.6 13h6.8"/><path d="M14 6c.9-1.4 2.6-1.6 3.5-.7-.9 1.4-2.6 1.6-3.5.7z"/></svg>',
  // Honey production: a honey dipper (the grooved wand) with a drip of honey
  // falling below. Reads as "honey off the dipper", distinct from the olive-oil
  // cruet, the coffee cup, and the drink glasses.
  honey: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5v4"/><path d="M8.5 7.5h7l-.6 6.2a2.9 2.9 0 0 1-5.8 0z"/><path d="M9 10.5h6M9.4 13h5.2"/><path d="M12 17.2c0 1.7-1.4 2.3-1.4 3.6a1.4 1.4 0 0 0 2.8 0c0-1.3-1.4-1.9-1.4-3.6z"/></svg>',
  // Government integrity (displayed name; data is Transparency International's
  // CPI, key `corruption`): a balance scale (a central post, a beam, two hanging
  // pans). Reads as justice / clean governance, distinct from the economic
  // coin/bar and the produce icons.
  corruption: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v15"/><path d="M8.5 20h7"/><path d="M5 7h14"/><path d="M5 7 3 11M5 7l2 4"/><path d="M3 11a2 1.6 0 0 0 4 0"/><path d="M19 7l-2 4M19 7l2 4"/><path d="M17 11a2 1.6 0 0 0 4 0"/></svg>',
  // Average temperature: a thermometer (a stem with a filled bulb and two tick
  // marks). Reads as heat / climate, distinct from every economic and produce
  // icon in the family.
  temperature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M10 8h1.6M10 11h1.6"/><circle cx="12" cy="18" r="1.6" fill="currentColor" stroke="none"/></svg>',
  // Happiness: a smiling face (a circle, two dot eyes, an upturned mouth).
  // Reads as wellbeing / life satisfaction, unmistakable against the economic
  // and produce icons.
  happiness: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
  // Tourist arrivals per capita: a suitcase (a rounded body with a top handle and
  // a centre seam). Reads as travel / luggage, distinct from every economic and
  // produce icon in the family.
  tourismPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M12 8v12"/></svg>',
  // Electricity use per capita: a lightning bolt. Reads as electric power,
  // unmistakable against the drink / food / economic icons.
  electricityPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-2 8 9-12h-7z"/></svg>',
  mcdonaldsPerMillion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10a4 4 0 0 1 8 0v10M12 10a4 4 0 0 1 8 0v10"/></svg>',
  // A medal for the count, a laurel wreath for the per-capita cut. Two different
  // silhouettes rather than one icon twice, so the chips read apart at 24px.
  nobel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.6 9.6 6 2l6 3 6-3-2.6 7.6"/></svg>',
  nobelPerCapita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4.5-1.7-7-5.5-7-9.7 0-3.4 1.6-6.3 3.4-8.3 1.2 3.2 1.2 5.6 0 7.6"/><path d="M12 21c4.5-1.7 7-5.5 7-9.7 0-3.4-1.6-6.3-3.4-8.3-1.2 3.2-1.2 5.6 0 7.6"/></svg>',
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
  tea: '#1f9e7a',
  sugarcane: '#7cb518',
  gold: '#d4a017',
  alcoholPerCapita: '#b5468a',
  meatPerCapita: '#c85a3c',
  borders: '#5f6bd0',
  oliveOil: '#808000',
  honey: '#e08214',
  corruption: '#4b3f9e',
  temperature: '#d84315',
  happiness: '#ec407a',
  tourismPerCapita: '#1183c7',
  electricityPerCapita: '#f4b400',
  // Brand red. The golden-arches yellow would be the more literal pick, but the
  // yellow region already carries electricity / beer / gold / honey; red only has
  // temperature and meat, so the chip stays tellable apart.
  mcdonaldsPerMillion: '#da291c',
  // The literal pick would be medal gold, but that region already carries gold /
  // honey / electricity / beer / GDP. Academic purple is the next-most-legible
  // reading of "prize", and it sits clear of density's muted lavender by being far
  // more saturated. The per-capita sibling deliberately does NOT share the hue: a
  // player must be able to tell the two Nobel rounds apart from the chip alone.
  nobel: '#6a1b9a',
  nobelPerCapita: '#ad1457',
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
  coffee: { key: 'party.modeShort.superlativeCoffee', fallback: 'Coffee production' },
  wine: { key: 'party.modeShort.superlativeWine', fallback: 'Wine production' },
  cocoa: { key: 'party.modeShort.superlativeCocoa', fallback: 'Cocoa production' },
  banana: { key: 'party.modeShort.superlativeBanana', fallback: 'Banana production' },
  apple: { key: 'party.modeShort.superlativeApple', fallback: 'Apple production' },
  elevation: { key: 'party.modeShort.superlativeElevation', fallback: 'Elevation' },
  coastline: { key: 'party.modeShort.superlativeCoastline', fallback: 'Coastline' },
  forest: { key: 'party.modeShort.superlativeForest', fallback: 'Forest' },
  oil: { key: 'party.modeShort.superlativeOil', fallback: 'Oil production' },
  rice: { key: 'party.modeShort.superlativeRice', fallback: 'Rice production' },
  coal: { key: 'party.modeShort.superlativeCoal', fallback: 'Coal production' },
  sheepPerCapita: { key: 'party.modeShort.superlativeSheep', fallback: 'Sheep' },
  cattlePerCapita: { key: 'party.modeShort.superlativeCattle', fallback: 'Cattle' },
  beerPerCapita: { key: 'party.modeShort.superlativeBeer', fallback: 'Beer consumption' },
  tea: { key: 'party.modeShort.superlativeTea', fallback: 'Tea production' },
  sugarcane: { key: 'party.modeShort.superlativeSugarcane', fallback: 'Sugarcane production' },
  gold: { key: 'party.modeShort.superlativeGold', fallback: 'Gold production' },
  alcoholPerCapita: { key: 'party.modeShort.superlativeAlcohol', fallback: 'Alcohol consumption' },
  meatPerCapita: { key: 'party.modeShort.superlativeMeat', fallback: 'Meat consumption' },
  borders: { key: 'party.modeShort.superlativeBorders', fallback: 'Borders' },
  oliveOil: { key: 'party.modeShort.superlativeOliveOil', fallback: 'Olive oil production' },
  honey: { key: 'party.modeShort.superlativeHoney', fallback: 'Honey production' },
  corruption: { key: 'party.modeShort.superlativeCorruption', fallback: 'Integrity' },
  temperature: { key: 'party.modeShort.superlativeTemperature', fallback: 'Temperature' },
  happiness: { key: 'party.modeShort.superlativeHappiness', fallback: 'Happiness' },
  tourismPerCapita: { key: 'party.modeShort.superlativeTourism', fallback: 'Tourism' },
  electricityPerCapita: { key: 'party.modeShort.superlativeElectricity', fallback: 'Electricity' },
  mcdonaldsPerMillion: { key: 'party.modeShort.superlativeMcdonalds', fallback: "McDonald's" },
  nobel: { key: 'party.modeShort.superlativeNobel', fallback: 'Nobel laureates' },
  nobelPerCapita: { key: 'party.modeShort.superlativeNobelPc', fallback: 'Nobels per million' },
};

/**
 * Build the leading `<span>` for a metric's icon: the class the caller wants,
 * the metric's SVG from {@link METRIC_ICONS} as innerHTML (empty for an unknown
 * key, never `undefined`). The one place the "make a span, drop in the metric
 * glyph" idiom lives — chips, the hub panel lead, and the criteria header all
 * used to hand-roll it, which is how a missing `|| ''` guard or a stale class
 * drifts. The hue differs per surface (some tint the icon, some a parent), so
 * that stays with the caller.
 *
 * @param {string} key  metric key (same keys as METRIC_ICONS)
 * @param {string} [className]
 * @param {Document} [doc]
 * @returns {HTMLSpanElement}
 */
export function metricIconSpan(key, className = 'mhub-ic', doc = document) {
  const ic = doc.createElement('span');
  ic.className = className;
  ic.innerHTML = METRIC_ICONS[key] || '';
  return ic;
}
