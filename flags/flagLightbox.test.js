import test from 'node:test';
import assert from 'node:assert/strict';
import { openFlagLightbox, wireFlagLightbox, wireFlagLightboxAll } from './flagLightbox.js';

/**
 * A fake element good enough for the module's DOM touches. Typed `any` (like
 * flagZoom.test.js's fake) so dynamically-added props — `classList`, the
 * `__flagLightbox` cache on the doc — don't trip strict type-checking.
 *
 * @param {string} tag
 * @returns {any}
 */
function fakeEl(tag) {
  /** @type {Record<string, Array<(e:any)=>void>>} */
  const handlers = {};
  const el = /** @type {any} */ ({
    tag,
    src: '',
    alt: '',
    className: '',
    dataset: /** @type {Record<string,string>} */ ({}),
    attrs: /** @type {Record<string,string>} */ ({}),
    children: /** @type {any[]} */ ([]),
    classes: /** @type {string[]} */ ([]),
    modalCount: 0,
    closeCount: 0,
    /** @param {string} k @param {string} v */
    setAttribute(k, v) { this.attrs[k] = v; },
    /** @param {any} c */
    appendChild(c) { this.children.push(c); return c; },
    /** @param {string} type @param {(e:any)=>void} l */
    addEventListener(type, l) { (handlers[type] ||= []).push(l); },
    showModal() { this.modalCount += 1; },
    close() { this.closeCount += 1; },
    /** @param {string} type @param {any} e */
    _fire(type, e) { for (const l of handlers[type] || []) l(e); },
  });
  el.classList = { add: (/** @type {string} */ c) => el.classes.push(c) };
  return el;
}

/**
 * A fake document that mints fake elements and records the body tree.
 * @returns {any}
 */
function fakeDoc() {
  return /** @type {any} */ ({
    body: fakeEl('body'),
    /** @param {string} tag */
    createElement(tag) { return fakeEl(tag); },
  });
}

test('openFlagLightbox creates one overlay, reuses it, and sets src/alt + opens', () => {
  const doc = fakeDoc();
  openFlagLightbox('flags/svg/pl.svg', 'Poland', doc);

  const lb = doc.__flagLightbox;
  assert.ok(lb, 'overlay cached on the document');
  assert.equal(lb.dialog.tag, 'dialog');
  assert.equal(lb.dialog.className, 'flag-lightbox');
  assert.equal(lb.img.src, 'flags/svg/pl.svg');
  assert.equal(lb.img.alt, 'Poland');
  assert.equal(lb.dialog.modalCount, 1);
  assert.equal(doc.body.children.length, 1, 'overlay appended to body once');

  // Second open reuses the same overlay (no duplicate appended).
  openFlagLightbox('flags/svg/fr.svg', 'France', doc);
  assert.equal(doc.__flagLightbox, lb, 'same overlay reused');
  assert.equal(lb.img.src, 'flags/svg/fr.svg');
  assert.equal(doc.body.children.length, 1, 'still only one overlay in body');
  assert.equal(lb.dialog.modalCount, 2);
});

test('openFlagLightbox flips the overlay image when flipped=true, and resets it otherwise', () => {
  const doc = fakeDoc();
  openFlagLightbox('flags/svg/gb.svg', 'UK upside down', doc, true);
  const lb = doc.__flagLightbox;
  assert.equal(lb.img.className, 'flag-lightbox-flipped');
  // A later normal open on the reused overlay clears the flip.
  openFlagLightbox('flags/svg/pl.svg', 'Poland', doc);
  assert.equal(lb.img.className, '');
});

test('wireFlagLightbox propagates data-lightbox-flip to the lightbox on open', () => {
  const doc = fakeDoc();
  const img = doc.createElement('img');
  img.src = 'flags/svg/gb.svg';
  img.alt = 'UK upside down';
  img.dataset.lightboxFlip = '1';
  wireFlagLightbox(img, undefined, doc);
  img._fire('click', {});
  assert.equal(doc.__flagLightbox.img.className, 'flag-lightbox-flipped');
});

test('clicking the overlay closes it', () => {
  const doc = fakeDoc();
  openFlagLightbox('flags/svg/pl.svg', 'Poland', doc);
  const lb = doc.__flagLightbox;
  lb.dialog._fire('click', {});
  assert.equal(lb.dialog.closeCount, 1);
});

test('wireFlagLightbox marks the flag as an activatable control, once', () => {
  const doc = fakeDoc();
  const img = doc.createElement('img');
  img.src = 'flags/svg/af.svg';
  img.alt = 'Afghanistan';

  wireFlagLightbox(img, (k, fb) => (k === 'zoom.enlarge' ? 'Enlarge flag' : fb), doc);
  assert.equal(img.dataset.lightboxWired, '1');
  assert.deepEqual(img.classes, ['flag-zoomable']);
  assert.equal(img.attrs.role, 'button');
  assert.equal(img.attrs.tabindex, '0');
  assert.equal(img.attrs['aria-label'], 'Enlarge flag');

  // Idempotent: a second call must not re-add the class / re-wire.
  wireFlagLightbox(img, undefined, doc);
  assert.deepEqual(img.classes, ['flag-zoomable']);
});

test('wireFlagLightbox opens the lightbox on click with the img current src/alt', () => {
  const doc = fakeDoc();
  const img = doc.createElement('img');
  img.src = 'flags/svg/af.svg';
  img.alt = 'Afghanistan';
  wireFlagLightbox(img, undefined, doc);

  // src changes after wiring (new country opened) — open() must read it live.
  img.src = 'flags/svg/gb.svg';
  img.alt = 'United Kingdom';
  img._fire('click', {});

  const lb = doc.__flagLightbox;
  assert.equal(lb.img.src, 'flags/svg/gb.svg');
  assert.equal(lb.img.alt, 'United Kingdom');
  assert.equal(lb.dialog.modalCount, 1);
});

test('wireFlagLightbox opens on Enter and Space, preventing default', () => {
  const doc = fakeDoc();
  const img = doc.createElement('img');
  img.src = 'flags/svg/fr.svg';
  img.alt = 'France';
  wireFlagLightbox(img, undefined, doc);

  let prevented = 0;
  img._fire('keydown', { key: 'Enter', preventDefault() { prevented += 1; } });
  img._fire('keydown', { key: ' ', preventDefault() { prevented += 1; } });
  img._fire('keydown', { key: 'a', preventDefault() { prevented += 1; } }); // ignored

  assert.equal(prevented, 2, 'only Enter + Space prevent default + open');
  assert.equal(doc.__flagLightbox.dialog.modalCount, 2);
});

test('wireFlagLightbox is a no-op on a null image', () => {
  assert.doesNotThrow(() => wireFlagLightbox(null, undefined, fakeDoc()));
});

test('wireFlagLightboxAll wires every flag image under a container', () => {
  const doc = fakeDoc();
  const a = doc.createElement('img');
  a.src = 'flags/history/af-1928.svg';
  const b = doc.createElement('img');
  b.src = 'flags/history/af-kingdom.svg';
  const root = /** @type {any} */ ({ querySelectorAll: (/** @type {string} */ sel) => (sel === 'img' ? [a, b] : []) });

  wireFlagLightboxAll(root, undefined, doc);
  assert.equal(a.dataset.lightboxWired, '1');
  assert.equal(b.dataset.lightboxWired, '1');

  // A timeline flag opens the lightbox with its own src (not the headline's).
  b._fire('click', {});
  assert.equal(doc.__flagLightbox.img.src, 'flags/history/af-kingdom.svg');
});

test('wireFlagLightboxAll is a no-op on a container without querySelectorAll', () => {
  assert.doesNotThrow(() => wireFlagLightboxAll(null, undefined, fakeDoc()));
  assert.doesNotThrow(() => wireFlagLightboxAll({}, undefined, fakeDoc()));
});
