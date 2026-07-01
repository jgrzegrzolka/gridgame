import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderFlagFacts } from './flagFactsRender.js';

/** Stub `Document` that records the tree we built. */
function makeDoc() {
  /** @type {any} */
  const doc = {};
  doc.createElement = (/** @type {string} */ tag) => {
    /** @type {any} */
    const el = {
      tag,
      className: '',
      textContent: '',
      src: '',
      alt: '',
      loading: '',
      children: [],
      appendChild(/** @type {any} */ c) { this.children.push(c); return c; },
    };
    return el;
  };
  return doc;
}

/** Translator that returns a fixed map, falling back to '' for unknown keys. */
function makeT(/** @type {Record<string, string>} */ map) {
  return (/** @type {string} */ key, /** @type {string} */ fallback) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

/** Flatten all elements with a given className. */
function findAllByClass(/** @type {any} */ el, /** @type {string} */ cls) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} node */
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.className === 'string' && node.className.split(' ').includes(cls)) out.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  walk(el);
  return out;
}

const FACTS = {
  introKey: 'flagFacts.gr.intro',
  timeline: [
    { year: '1453–1793', img: 'history/gr-ottoman.svg', captionKey: 'flagFacts.gr.ottoman' },
    { year: '1978', img: 'svg/gr.svg', captionKey: 'flagFacts.gr.current' },
  ],
};

test('renderFlagFacts returns null when facts is falsy', () => {
  const doc = makeDoc();
  assert.equal(renderFlagFacts({ facts: null, t: makeT({}), doc }), null);
});

test('renderFlagFacts splits the intro into one paragraph per blank-line block', () => {
  const doc = makeDoc();
  const t = makeT({ 'flagFacts.gr.intro': 'First para.\n\nSecond para.' });
  const root = renderFlagFacts({ facts: FACTS, t, doc });
  const paras = findAllByClass(root, 'flag-facts-intro');
  assert.equal(paras.length, 2);
  assert.equal(paras[0].textContent, 'First para.');
  assert.equal(paras[1].textContent, 'Second para.');
});

test('renderFlagFacts builds one timeline step per entry with year, caption and image', () => {
  const doc = makeDoc();
  const t = makeT({
    'flagFacts.gr.intro': 'Intro.',
    'flagFacts.gr.ottoman': 'Red flag with a blue stripe.',
    'flagFacts.gr.current': 'Nine stripes today.',
  });
  const root = renderFlagFacts({ facts: FACTS, t, doc, base: '../flags/' });

  const steps = findAllByClass(root, 'flag-facts-step');
  assert.equal(steps.length, 2);

  const years = findAllByClass(root, 'flag-facts-year').map((e) => e.textContent);
  assert.deepEqual(years, ['1453–1793', '1978']);

  const caps = findAllByClass(root, 'flag-facts-caption').map((e) => e.textContent);
  assert.deepEqual(caps, ['Red flag with a blue stripe.', 'Nine stripes today.']);

  const imgs = findAllByClass(root, 'flag-facts-img');
  assert.equal(imgs[0].src, '../flags/history/gr-ottoman.svg');
  assert.equal(imgs[1].src, '../flags/svg/gr.svg');
  // Caption doubles as alt text for the historical flag.
  assert.equal(imgs[0].alt, 'Red flag with a blue stripe.');
  assert.equal(imgs[0].loading, 'lazy');
});

test('renderFlagFacts: empty intro string yields no intro paragraphs but still renders the timeline', () => {
  const doc = makeDoc();
  const t = makeT({ 'flagFacts.gr.ottoman': 'x', 'flagFacts.gr.current': 'y' }); // intro missing → ''
  const root = renderFlagFacts({ facts: FACTS, t, doc });
  assert.equal(findAllByClass(root, 'flag-facts-intro').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-step').length, 2);
});

test('renderFlagFacts renders the "Did you know?" list from factKeys, skipping blanks', () => {
  const doc = makeDoc();
  const factsWithExtra = {
    ...FACTS,
    factKeys: ['flagFacts.gr.fact.a', 'flagFacts.gr.fact.missing', 'flagFacts.gr.fact.b'],
  };
  const t = makeT({
    'flagFacts.didYouKnow': 'Did you know?',
    'flagFacts.gr.fact.a': 'Fact A.',
    'flagFacts.gr.fact.b': 'Fact B.',
    // .missing has no translation → '' → skipped
  });
  const root = renderFlagFacts({ facts: factsWithExtra, t, doc });
  const heading = findAllByClass(root, 'flag-facts-extra-title');
  assert.equal(heading.length, 1);
  assert.equal(heading[0].textContent, 'Did you know?');
  const items = findAllByClass(root, 'flag-facts-list-item');
  assert.deepEqual(items.map((e) => e.textContent), ['Fact A.', 'Fact B.']);
});

test('renderFlagFacts omits the extra section entirely when factKeys is absent', () => {
  const doc = makeDoc();
  const t = makeT({ 'flagFacts.gr.ottoman': 'x', 'flagFacts.gr.current': 'y' });
  const root = renderFlagFacts({ facts: FACTS, t, doc }); // FACTS has no factKeys
  assert.equal(findAllByClass(root, 'flag-facts-extra').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-list').length, 0);
});

test('renderFlagFacts sets strings via textContent, never innerHTML', () => {
  const doc = makeDoc();
  const t = makeT({ 'flagFacts.gr.intro': '<script>alert(1)</script>' });
  const root = renderFlagFacts({ facts: FACTS, t, doc });
  const p = findAllByClass(root, 'flag-facts-intro')[0];
  assert.equal(p.textContent, '<script>alert(1)</script>');
  assert.equal(p.children.length, 0);
});
