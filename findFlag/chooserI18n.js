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
 *
 * @param {{
 *   sectionHeaders: SectionHeader[],
 *   allPills: PillRef[],
 *   onlyColorsLabelSpan: { textContent: string } | null,
 *   updateBar: () => void,
 * }} deps
 */
export function refreshChooserI18n({ sectionHeaders, allPills, onlyColorsLabelSpan, updateBar }) {
  for (const sh of sectionHeaders) {
    sh.h.textContent = t(sh.key, sh.fallback);
  }
  for (const p of allPills) {
    p.labelSpan.textContent = pillLabel(p.group, p.value, 'include', t);
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
