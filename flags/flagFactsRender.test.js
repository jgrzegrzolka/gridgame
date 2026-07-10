import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderFlagFacts, renderImageCredit } from './flagFactsRender.js';

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
      style: {},
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
  addedOn: '2026-07-01',
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

test('renderFlagFacts groups consecutive steps with the same year under one dotted node', () => {
  const doc = makeDoc();
  const facts = {
    addedOn: '2026-07-01',
    introKey: 'i',
    timeline: [
      { year: '1928', img: 'history/a.svg', captionKey: 'ca' },
      { year: '1928', img: 'history/b.svg', captionKey: 'cb' },
      { year: '1928', img: 'history/c.svg', captionKey: 'cc' },
      { year: '1930', img: 'history/d.svg', captionKey: 'cd' },
    ],
  };
  const t = makeT({ ca: 'A', cb: 'B', cc: 'C', cd: 'D' });
  const root = renderFlagFacts({ facts, t, doc });

  // One grouped <li> for the three 1928 flags, one plain <li> for 1930.
  const groups = findAllByClass(root, 'flag-facts-step-group');
  assert.equal(groups.length, 1);
  // The shared year renders once (group) plus once (the solo 1930 step) = 2 pills.
  assert.deepEqual(findAllByClass(root, 'flag-facts-year').map((e) => e.textContent), ['1928', '1930']);
  // Same-date flags collapse under one dot (no bracket); the solo step also gets
  // a dot, so two dots and no brackets in all.
  assert.equal(findAllByClass(root, 'flag-facts-bracket').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-node').length, 2);
  // All four captions still render, each with its flag.
  assert.deepEqual(findAllByClass(root, 'flag-facts-caption').map((e) => e.textContent), ['A', 'B', 'C', 'D']);
  assert.equal(findAllByClass(groups[0], 'flag-facts-group-img').length, 3);
});

test('renderFlagFacts does not group non-adjacent same-year steps or across an equation step', () => {
  const doc = makeDoc();
  const facts = {
    addedOn: '2026-07-01',
    introKey: 'i',
    timeline: [
      { year: '1900', img: 'history/a.svg', captionKey: 'ca' },
      { year: '1901', img: 'history/b.svg', captionKey: 'cb' },
      { year: '1900', img: 'history/c.svg', captionKey: 'cc' },
    ],
  };
  const t = makeT({ ca: 'A', cb: 'B', cc: 'C' });
  const root = renderFlagFacts({ facts, t, doc });
  // The two 1900 steps are not adjacent, so nothing groups: three plain steps.
  assert.equal(findAllByClass(root, 'flag-facts-step-group').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-node').length, 3);
});

test('renderFlagFacts renders partially-overlapping ranges as one grid cluster with parallel braces', () => {
  const doc = makeDoc();
  const facts = {
    addedOn: '2026-07-01',
    introKey: 'i',
    // A coloured variant (2004–2021) flown across a design change (2004–2013 →
    // 2013–2021): the ranges intersect but differ, marked as one overlap group.
    timeline: [
      { year: '2004–2013', img: 'history/a.svg', captionKey: 'ca', overlap: 'era' },
      { year: '2004–2021', img: 'history/b.svg', captionKey: 'cb', overlap: 'era' },
      { year: '2013–2021', img: 'history/c.svg', captionKey: 'cc', overlap: 'era' },
    ],
  };
  const t = makeT({ ca: 'A', cb: 'B', cc: 'C' });
  const root = renderFlagFacts({ facts, t, doc });

  // One overlap cluster <li>, not three separate dated nodes and not one bracket.
  assert.equal(findAllByClass(root, 'flag-facts-step-overlap').length, 1);
  assert.equal(findAllByClass(root, 'flag-facts-bracket').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-node').length, 0);

  // Each flag keeps its own date pill (three distinct dates → three pills).
  assert.deepEqual(findAllByClass(root, 'flag-facts-year').map((e) => e.textContent), [
    '2004–2013',
    '2004–2021',
    '2013–2021',
  ]);
  // Only the wrapping variant gets a brace (the two sequential flags span just
  // their own row, so they show only their inline pill); all three flags render.
  assert.equal(findAllByClass(root, 'flag-facts-group-img').length, 3);
  assert.deepEqual(findAllByClass(root, 'flag-facts-caption').map((e) => e.textContent), ['A', 'B', 'C']);

  // That one brace spans all three rows (grid-row 1 through 4).
  const braces = findAllByClass(root, 'flag-facts-brace-lane');
  assert.equal(braces.length, 1, 'only the spanning variant draws a brace');
  assert.equal(braces[0].style.gridRow, '1 / 4', 'the 2004–2021 variant brace spans every row');
});

test('renderFlagFacts collapses same-date flags within an overlap cluster to one brace', () => {
  const doc = makeDoc();
  // A long-running flag (1992–2001) over a short one (1996–1997) then a trio of
  // same-date variants (1997–2001): four flags, three distinct dates.
  const facts = {
    addedOn: '2026-07-01',
    introKey: 'i',
    timeline: [
      { year: '1992–2001', img: 'history/a.svg', captionKey: 'ca', overlap: 'war' },
      { year: '1996–1997', img: 'history/b.svg', captionKey: 'cb', overlap: 'war' },
      { year: '1997–2001', img: 'history/c.svg', captionKey: 'cc', overlap: 'war' },
      { year: '1997–2001', img: 'history/d.svg', captionKey: 'cd', overlap: 'war' },
    ],
  };
  const t = makeT({ ca: 'A', cb: 'B', cc: 'C', cd: 'D' });
  const root = renderFlagFacts({ facts, t, doc });

  assert.equal(findAllByClass(root, 'flag-facts-step-overlap').length, 1);
  // Every flag keeps its own inline date pill (four rows). Two braces are drawn:
  // the 1992–2001 flag spanning all four rows, and the 1997–2001 pair sharing one
  // (the lone 1996–1997 flag spans only its own row, so no brace).
  assert.deepEqual(findAllByClass(root, 'flag-facts-year').map((e) => e.textContent), [
    '1992–2001',
    '1996–1997',
    '1997–2001',
    '1997–2001',
  ]);
  assert.equal(findAllByClass(root, 'flag-facts-brace-lane').length, 2);
  assert.equal(findAllByClass(root, 'flag-facts-group-img').length, 4);
  assert.deepEqual(findAllByClass(root, 'flag-facts-caption').map((e) => e.textContent), ['A', 'B', 'C', 'D']);
});

test('renderFlagFacts keeps a shared-boundary handoff (1996–1997 → 1997–2001) as separate nodes', () => {
  const doc = makeDoc();
  const facts = {
    addedOn: '2026-07-01',
    introKey: 'i',
    timeline: [
      { year: '1996–1997', img: 'history/a.svg', captionKey: 'ca' },
      { year: '1997–2001', img: 'history/b.svg', captionKey: 'cb' },
    ],
  };
  const t = makeT({ ca: 'A', cb: 'B' });
  const root = renderFlagFacts({ facts, t, doc });
  // Touching at 1997 is a handoff, not an overlap: two plain dated nodes.
  assert.equal(findAllByClass(root, 'flag-facts-step-overlap').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-node').length, 2);
  assert.equal(findAllByClass(root, 'flag-facts-brace-lane').length, 0);
});

test('renderFlagFacts renders an equation step (parts + result) instead of a single flag', () => {
  const doc = makeDoc();
  const factsEq = {
    addedOn: '2026-07-01',
    introKey: 'flagFacts.gb.intro',
    timeline: [
      {
        year: '1606',
        img: 'history/gb-union1606.svg',
        captionKey: 'flagFacts.gb.union1606',
        parts: ['svg/gb-eng.svg', 'svg/gb-sct.svg'],
        partLabelKeys: ['flagFacts.gb.george', 'flagFacts.gb.andrew'],
      },
    ],
  };
  const t = makeT({
    'flagFacts.gb.intro': 'Intro.',
    'flagFacts.gb.union1606': 'England plus Scotland.',
    'flagFacts.gb.george': 'England',
    'flagFacts.gb.andrew': 'Scotland',
  });
  const root = renderFlagFacts({ facts: factsEq, t, doc, base: '../flags/' });

  // The step is flagged as an equation and carries no plain single image.
  assert.equal(findAllByClass(root, 'flag-facts-step-eq').length, 1);
  assert.equal(findAllByClass(root, 'flag-facts-img').length, 0);

  // Two `+`/`=` operators (one `+` between the two parts, one `=` before the result).
  const ops = findAllByClass(root, 'flag-facts-eq-op').map((e) => e.textContent);
  assert.deepEqual(ops, ['+', '=']);

  // Three flags in the equation: two parts + the result.
  const eqImgs = findAllByClass(root, 'flag-facts-eq-img');
  assert.deepEqual(eqImgs.map((e) => e.src), [
    '../flags/svg/gb-eng.svg',
    '../flags/svg/gb-sct.svg',
    '../flags/history/gb-union1606.svg',
  ]);
  assert.equal(findAllByClass(root, 'flag-facts-eq-result').length, 1);

  // Only the ingredient flags are labelled; the result flag isn't (the year +
  // caption above name it), though its alt text carries the caption.
  const labels = findAllByClass(root, 'flag-facts-eq-label').map((e) => e.textContent);
  assert.deepEqual(labels, ['England', 'Scotland']);
  assert.equal(eqImgs[2].alt, 'England plus Scotland.');

  // Year + description render above the equation (year first in the meta).
  assert.equal(findAllByClass(root, 'flag-facts-year')[0].textContent, '1606');
  assert.equal(findAllByClass(root, 'flag-facts-caption')[0].textContent, 'England plus Scotland.');
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

test('renderFlagFacts nests the orientation comparison inside its fact bullet, no caption/labels', () => {
  const doc = makeDoc();
  const factsCmp = {
    ...FACTS,
    factKeys: ['flagFacts.x.a', 'flagFacts.x.asym', 'flagFacts.x.b'],
    compare: {
      img: 'svg/gb.svg',
      afterFactKey: 'flagFacts.x.asym',
      correctKey: 'flagFacts.x.correct',
      invertedKey: 'flagFacts.x.inverted',
    },
  };
  const t = makeT({
    'flagFacts.didYouKnow': 'Did you know?',
    'flagFacts.x.a': 'A.',
    'flagFacts.x.asym': 'Asymmetry point.',
    'flagFacts.x.b': 'B.',
    'flagFacts.x.correct': 'Right way up',
    'flagFacts.x.inverted': 'Upside down',
  });
  const root = renderFlagFacts({ facts: factsCmp, t, doc, base: '../flags/' });

  const imgs = findAllByClass(root, 'flag-facts-compare-img');
  assert.equal(imgs.length, 2);
  // Both sides are the same source flag; only the second carries the flip class.
  assert.equal(imgs[0].src, '../flags/svg/gb.svg');
  assert.equal(imgs[1].src, '../flags/svg/gb.svg');
  assert.equal(findAllByClass(root, 'flag-facts-compare-img-inverted').length, 1);
  assert.ok(imgs[1].className.includes('flag-facts-compare-img-inverted'));
  assert.ok(!imgs[0].className.includes('flag-facts-compare-img-inverted'));

  // Alt text carries the orientation for a11y — no visible caption or labels.
  assert.deepEqual(imgs.map((e) => e.alt), ['Right way up', 'Upside down']);
  assert.equal(findAllByClass(root, 'flag-facts-compare-caption').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-compare-label').length, 0);

  // The row is nested inside the asymmetry <li>, and only that one.
  const items = findAllByClass(root, 'flag-facts-list-item');
  const asymLi = items.find((li) => li.textContent === 'Asymmetry point.');
  assert.ok(asymLi, 'asymmetry bullet exists');
  assert.equal(findAllByClass(asymLi, 'flag-facts-compare-row').length, 1);
  const aLi = items.find((li) => li.textContent === 'A.');
  assert.equal(findAllByClass(aLi, 'flag-facts-compare-row').length, 0);
});

test('renderFlagFacts omits the comparison when compare is absent', () => {
  const doc = makeDoc();
  const root = renderFlagFacts({ facts: FACTS, t: makeT({}), doc }); // FACTS has no compare
  assert.equal(findAllByClass(root, 'flag-facts-compare-row').length, 0);
  assert.equal(findAllByClass(root, 'flag-facts-compare-img').length, 0);
});

test('renderFlagFacts nests a flag gallery under the fact bullet it names', () => {
  const doc = makeDoc();
  const factsGal = {
    ...FACTS,
    factKeys: ['flagFacts.x.a', 'flagFacts.x.others', 'flagFacts.x.b'],
    galleries: [
      {
        afterFactKey: 'flagFacts.x.others',
        items: [
          { img: 'history/ie-plough.svg', labelKey: 'flagFacts.x.plough' },
          { img: 'history/ie-sunburst.svg', labelKey: 'flagFacts.x.sunburst' },
        ],
      },
    ],
  };
  const t = makeT({
    'flagFacts.didYouKnow': 'Did you know?',
    'flagFacts.x.a': 'A.',
    'flagFacts.x.others': 'Other flags.',
    'flagFacts.x.b': 'B.',
    'flagFacts.x.plough': 'Starry Plough',
    'flagFacts.x.sunburst': 'Sunburst',
  });
  const root = renderFlagFacts({ facts: factsGal, t, doc, base: '../flags/' });

  const imgs = findAllByClass(root, 'flag-facts-gallery-img');
  assert.equal(imgs.length, 2);
  assert.deepEqual(imgs.map((e) => e.src), [
    '../flags/history/ie-plough.svg',
    '../flags/history/ie-sunburst.svg',
  ]);
  // Label is both the visible caption and the alt text.
  assert.deepEqual(findAllByClass(root, 'flag-facts-gallery-label').map((e) => e.textContent), [
    'Starry Plough',
    'Sunburst',
  ]);
  assert.deepEqual(imgs.map((e) => e.alt), ['Starry Plough', 'Sunburst']);

  // The row nests inside the "others" bullet, and only that one.
  const items = findAllByClass(root, 'flag-facts-list-item');
  const othersLi = items.find((li) => li.textContent === 'Other flags.');
  assert.ok(othersLi, 'others bullet exists');
  assert.equal(findAllByClass(othersLi, 'flag-facts-gallery').length, 1);
  const aLi = items.find((li) => li.textContent === 'A.');
  assert.equal(findAllByClass(aLi, 'flag-facts-gallery').length, 0);
});

test('renderFlagFacts omits galleries when none are defined', () => {
  const doc = makeDoc();
  const root = renderFlagFacts({ facts: FACTS, t: makeT({}), doc }); // FACTS has no galleries
  assert.equal(findAllByClass(root, 'flag-facts-gallery').length, 0);
});

test('renderImageCredit builds an image-credit line with a sources link', () => {
  const doc = makeDoc();
  const t = makeT({
    'flagFacts.imageCredit': 'Flag images: flag-icons and Wikimedia Commons',
    'flagFacts.imageCreditLink': 'sources & licences',
  });
  const credit = renderImageCredit({ t, doc });

  assert.equal(credit.className, 'flag-facts-credit');
  assert.equal(
    findAllByClass(credit, 'flag-facts-credit-text')[0].textContent,
    'Flag images: flag-icons and Wikimedia Commons',
  );

  const link = findAllByClass(credit, 'flag-facts-credit-link')[0];
  assert.equal(link.tag, 'a');
  assert.equal(link.textContent, 'sources & licences');
  assert.match(link.href, /SOURCES\.md$/);
  // New tab, opened safely.
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
});

test('renderFlagFacts no longer embeds the credit (callers place it as a footer)', () => {
  const doc = makeDoc();
  const t = makeT({ 'flagFacts.gr.intro': 'Intro.' });
  const root = renderFlagFacts({ facts: FACTS, t, doc });
  assert.equal(findAllByClass(root, 'flag-facts-credit').length, 0);
});

test('renderFlagFacts sets strings via textContent, never innerHTML', () => {
  const doc = makeDoc();
  const t = makeT({ 'flagFacts.gr.intro': '<script>alert(1)</script>' });
  const root = renderFlagFacts({ facts: FACTS, t, doc });
  const p = findAllByClass(root, 'flag-facts-intro')[0];
  assert.equal(p.textContent, '<script>alert(1)</script>');
  assert.equal(p.children.length, 0);
});
