import { t } from '../i18n.js';
import { pillLabel } from '../flags/findFlag.js';

/**
 * Re-translate every chooser surface that `renderChooser` painted at
 * render time. Pulled out of `findFlag/page.js` so a unit test can
 * pin the three repaint paths (section headings, pill labels via
 * `pillLabel(group, value, "include", t)`, and the "no other colours"
 * modifier) plus the `updateBar` callback that rewrites the "Play (N)"
 * button label, without standing up the full chooser DOM.
 *
 * Why a helper rather than a method on the chooser handle: the
 * handle's `refreshI18n` is closure-bound to `renderChooser`'s locals,
 * so testing it directly would require building the entire chooser
 * against a fake document. This shape lets the page hand the locals
 * in as data and lets tests drive the same data shape with plain
 * objects.
 *
 * @typedef {{ h: { textContent: string }, key: string, fallback: string }} SectionHeader
 * @typedef {{ labelSpan: { textContent: string }, group: 'continent' | 'color' | 'motif' | 'stripesOnly', value: string }} PillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} PopulationPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} AreaPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} DensityPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} GdpPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} GdpPerCapitaPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} CoffeePillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} WinePillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} CocoaPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} BananaPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} ElevationPillRef
 * @typedef {{ labelSpan: { textContent: string }, value: string }} CoastlinePillRef
 *
 * @param {{
 *   sectionHeaders: SectionHeader[],
 *   allPills: PillRef[],
 *   populationPills?: PopulationPillRef[],
 *   areaPills?: AreaPillRef[],
 *   densityPills?: DensityPillRef[],
 *   gdpPills?: GdpPillRef[],
 *   gdpPerCapitaPills?: GdpPerCapitaPillRef[],
 *   coffeePills?: CoffeePillRef[],
 *   winePills?: WinePillRef[],
 *   cocoaPills?: CocoaPillRef[],
 *   bananaPills?: BananaPillRef[],
 *   elevationPills?: ElevationPillRef[],
 *   coastlinePills?: CoastlinePillRef[],
 *   onlyColorsLabelSpan: { textContent: string } | null,
 *   updateBar: () => void,
 * }} deps
 */
export function refreshChooserI18n({ sectionHeaders, allPills, populationPills = [], areaPills = [], densityPills = [], gdpPills = [], gdpPerCapitaPills = [], coffeePills = [], winePills = [], cocoaPills = [], bananaPills = [], elevationPills = [], onlyColorsLabelSpan, updateBar }) {
  for (const sh of sectionHeaders) {
    sh.h.textContent = t(sh.key, sh.fallback);
  }
  for (const p of allPills) {
    p.labelSpan.textContent = pillLabel(p.group, p.value, 'include', t);
  }
  // Population pills carry only their id suffix (">=10000000"); pillLabel's
  // population branch maps it to the localized tier label.
  for (const p of populationPills) {
    p.labelSpan.textContent = pillLabel('population', p.value, 'include', t);
  }
  // Area pills, same shape ("<=1000" etc.), via pillLabel's area branch.
  for (const p of areaPills) {
    p.labelSpan.textContent = pillLabel('area', p.value, 'include', t);
  }
  // Density pills ("<=10" etc.) via pillLabel's density branch.
  for (const p of densityPills) {
    p.labelSpan.textContent = pillLabel('density', p.value, 'include', t);
  }
  // GDP pills (">=100000000000" etc.) via pillLabel's gdp branch.
  for (const p of gdpPills) {
    p.labelSpan.textContent = pillLabel('gdp', p.value, 'include', t);
  }
  // GDP-per-capita pills (">=30000" etc.) via pillLabel's gdpPerCapita branch.
  for (const p of gdpPerCapitaPills) {
    p.labelSpan.textContent = pillLabel('gdpPerCapita', p.value, 'include', t);
  }
  // Coffee pills (">=10000" etc.) via pillLabel's coffee branch.
  for (const p of coffeePills) {
    p.labelSpan.textContent = pillLabel('coffee', p.value, 'include', t);
  }
  // Wine pills (">=10000" etc.) via pillLabel's wine branch.
  for (const p of winePills) {
    p.labelSpan.textContent = pillLabel('wine', p.value, 'include', t);
  }
  // Cocoa pills (">=10000" etc.) via pillLabel's cocoa branch.
  for (const p of cocoaPills) {
    p.labelSpan.textContent = pillLabel('cocoa', p.value, 'include', t);
  }
  // Banana pills (">=10000" etc.) via pillLabel's banana branch.
  for (const p of bananaPills) {
    p.labelSpan.textContent = pillLabel('banana', p.value, 'include', t);
  }
  // Elevation pills (">=1000" etc.) via pillLabel's elevation branch.
  for (const p of elevationPills) {
    p.labelSpan.textContent = pillLabel('elevation', p.value, 'include', t);
  }
  if (onlyColorsLabelSpan) {
    onlyColorsLabelSpan.textContent = t('findFlag.noOtherColors', 'no other colours');
  }
  // updateBar rewrites the Play button label ("Play (N)" or "Play")
  // programmatically, so its data-i18n was already overwritten at boot.
  // Calling it here re-applies the current-language playLabel over
  // whatever applyStringsToDocument restored.
  updateBar();
}
