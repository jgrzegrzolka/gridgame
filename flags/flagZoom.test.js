import test from 'node:test';
import assert from 'node:assert/strict';
import { openFlagZoom, wireFlagZoomBackdropClose } from './flagZoom.js';

function fakeDialog() {
  const img = { src: '', alt: '' };
  const p = { textContent: '' };
  let modalCount = 0;
  let closeCount = 0;
  /** @type {Array<(e: any) => void>} */
  const listeners = [];
  const dialog = {
    /** @param {string} sel */
    querySelector(sel) {
      if (sel === 'img') return img;
      if (sel === 'p') return p;
      return null;
    },
    showModal() { modalCount += 1; },
    close() { closeCount += 1; },
    /**
     * @param {string} _type
     * @param {(e: any) => void} l
     */
    addEventListener(_type, l) { listeners.push(l); },
    _img: img,
    _p: p,
    _modalCount: () => modalCount,
    _closeCount: () => closeCount,
    /** @param {any} e */
    _fire(e) { for (const l of listeners) l(e); },
  };
  return dialog;
}

test('openFlagZoom sets img src + alt + paragraph text, then opens', () => {
  const d = fakeDialog();
  openFlagZoom(d, { code: 'es', displayName: 'Spain', svgBase: '../flags/svg/' });
  assert.equal(d._img.src, '../flags/svg/es.svg');
  assert.equal(d._img.alt, 'Spain');
  assert.equal(d._p.textContent, 'Spain');
  assert.equal(d._modalCount(), 1);
});

test('openFlagZoom respects the provided svgBase (different page roots)', () => {
  const d = fakeDialog();
  openFlagZoom(d, { code: 'fr', displayName: 'France', svgBase: '../flags/svg/' });
  assert.equal(d._img.src, '../flags/svg/fr.svg');
});

test('openFlagZoom is a no-op when the dialog is null', () => {
  assert.doesNotThrow(() => openFlagZoom(
    /** @type {any} */ (null),
    { code: 'de', displayName: 'Germany', svgBase: '../flags/svg/' },
  ));
});

test('wireFlagZoomBackdropClose closes only when the click target IS the dialog', () => {
  const d = fakeDialog();
  wireFlagZoomBackdropClose(d);
  // Click on inner content — target is the <img>, not the dialog → no close.
  d._fire({ target: d._img });
  assert.equal(d._closeCount(), 0);
  // Click on the backdrop — target IS the dialog → close fires.
  d._fire({ target: d });
  assert.equal(d._closeCount(), 1);
});

test('wireFlagZoomBackdropClose tolerates a null dialog', () => {
  assert.doesNotThrow(() => wireFlagZoomBackdropClose(/** @type {any} */ (null)));
});
