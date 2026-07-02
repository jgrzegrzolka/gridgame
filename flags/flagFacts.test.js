import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FLAG_FACTS, getFlagFacts } from './flagFacts.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('getFlagFacts returns the entry for a known country', () => {
  const facts = getFlagFacts('gr');
  assert.ok(facts);
  assert.equal(typeof facts.introKey, 'string');
  assert.ok(Array.isArray(facts.timeline));
  assert.ok(facts.timeline.length >= 2);
});

test('getFlagFacts returns null for a country with no story', () => {
  assert.equal(getFlagFacts('us'), null);
  assert.equal(getFlagFacts('zz'), null);
});

test('every timeline step is well-formed', () => {
  for (const [code, facts] of Object.entries(FLAG_FACTS)) {
    assert.ok(facts.introKey.startsWith('flagFacts.'), `${code} introKey`);
    // addedOn drives the flag-of-the-day rotation's append-safety — a missing
    // or malformed one would silently break eligibility, so pin the shape.
    assert.match(facts.addedOn, /^\d{4}-\d{2}-\d{2}$/, `${code} addedOn is YYYY-MM-DD`);
    for (const step of facts.timeline) {
      assert.equal(typeof step.year, 'string', `${code} year`);
      assert.ok(step.year.length > 0, `${code} year non-empty`);
      assert.ok(step.captionKey.startsWith('flagFacts.'), `${code} captionKey`);
      assert.ok(step.img.endsWith('.svg'), `${code} img is svg`);
      // img is relative to flags/, and either a current flag (svg/) or a
      // superseded design (history/). No other location is expected.
      assert.ok(
        step.img.startsWith('history/') || step.img.startsWith('svg/'),
        `${code} img under history/ or svg/`,
      );
      // Equation steps: every part is an svg under the same roots, and any
      // partLabelKeys line up one-to-one with the parts.
      for (const part of step.parts ?? []) {
        assert.ok(part.endsWith('.svg'), `${code} part is svg`);
        assert.ok(
          part.startsWith('history/') || part.startsWith('svg/'),
          `${code} part under history/ or svg/`,
        );
      }
      if (step.partLabelKeys) {
        assert.ok(Array.isArray(step.parts), `${code} partLabelKeys needs parts`);
        assert.equal(step.partLabelKeys.length, step.parts.length, `${code} label/part count`);
        for (const key of step.partLabelKeys) {
          assert.ok(key.startsWith('flagFacts.'), `${code} partLabelKey`);
        }
      }
    }
    // factKeys is optional; when present every entry is an i18n key.
    for (const key of facts.factKeys ?? []) {
      assert.ok(key.startsWith('flagFacts.'), `${code} factKey`);
    }
    // compare is optional; when present its img is an svg under the known
    // roots, its alt keys are i18n keys, and afterFactKey names a real bullet
    // in this story's factKeys (else the comparison would silently never
    // render — it only attaches to an existing fact).
    if (facts.compare) {
      const c = facts.compare;
      assert.ok(c.img.endsWith('.svg'), `${code} compare img is svg`);
      assert.ok(
        c.img.startsWith('history/') || c.img.startsWith('svg/'),
        `${code} compare img under history/ or svg/`,
      );
      for (const key of [c.correctKey, c.invertedKey]) {
        assert.ok(key.startsWith('flagFacts.'), `${code} compare alt key`);
      }
      assert.ok(
        (facts.factKeys ?? []).includes(c.afterFactKey),
        `${code} compare afterFactKey must be one of factKeys`,
      );
    }
  }
});

test('every referenced flag image exists on disk', () => {
  // Guards against a typo in a filename shipping a broken <img> — the
  // renderer can't catch that, but the file layout is fixed at build time.
  for (const facts of Object.values(FLAG_FACTS)) {
    for (const step of facts.timeline) {
      for (const img of [step.img, ...(step.parts ?? [])]) {
        const abs = join(HERE, img);
        assert.ok(existsSync(abs), `missing asset: flags/${img}`);
      }
    }
    if (facts.compare) {
      const abs = join(HERE, facts.compare.img);
      assert.ok(existsSync(abs), `missing asset: flags/${facts.compare.img}`);
    }
  }
});

test('every i18n key referenced by the catalog is present in en.json and pl.json', () => {
  const en = JSON.parse(readFileSync(join(HERE, '..', 'i18n', 'en.json'), 'utf8'));
  const pl = JSON.parse(readFileSync(join(HERE, '..', 'i18n', 'pl.json'), 'utf8'));
  /** @param {Record<string, any>} obj @param {string} dotted */
  const has = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj) != null;

  for (const facts of Object.values(FLAG_FACTS)) {
    const keys = [
      facts.introKey,
      ...facts.timeline.map((s) => s.captionKey),
      ...facts.timeline.flatMap((s) => s.partLabelKeys ?? []),
      ...(facts.factKeys ?? []),
      ...(facts.compare ? [facts.compare.correctKey, facts.compare.invertedKey] : []),
    ];
    for (const key of keys) {
      assert.ok(has(en, key), `en.json missing ${key}`);
      assert.ok(has(pl, key), `pl.json missing ${key}`);
    }
  }
  // The "Did you know?" heading and the image-credit line are referenced by
  // the renderer, not the catalog — pin them so a language file can't drop them.
  for (const key of ['flagFacts.didYouKnow', 'flagFacts.imageCredit', 'flagFacts.imageCreditLink']) {
    assert.ok(has(en, key), `en.json missing ${key}`);
    assert.ok(has(pl, key), `pl.json missing ${key}`);
  }
});
