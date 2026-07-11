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
 *
 * @param {{
 *   sectionHeaders: SectionHeader[],
 *   allPills: PillRef[],
 *   populationPills?: PopulationPillRef[],
 *   areaPills?: AreaPillRef[],
 *   densityPills?: DensityPillRef[],
 *   onlyColorsLabelSpan: { textContent: string } | null,
 *   updateBar: () => void,
 * }} deps
 */
export function refreshChooserI18n({ sectionHeaders, allPills, populationPills = [], areaPills = [], densityPills = [], onlyColorsLabelSpan, updateBar }) {
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
  if (onlyColorsLabelSpan) {
    onlyColorsLabelSpan.textContent = t('findFlag.noOtherColors', 'no other colours');
  }
  // updateBar rewrites the Play button label ("Play (N)" or "Play")
  // programmatically, so its data-i18n was already overwritten at boot.
  // Calling it here re-applies the current-language playLabel over
  // whatever applyStringsToDocument restored.
  updateBar();
}
