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
    }
    // factKeys is optional; when present every entry is an i18n key.
    for (const key of facts.factKeys ?? []) {
      assert.ok(key.startsWith('flagFacts.'), `${code} factKey`);
    }
  }
});

test('every referenced flag image exists on disk', () => {
  // Guards against a typo in a filename shipping a broken <img> — the
  // renderer can't catch that, but the file layout is fixed at build time.
  for (const facts of Object.values(FLAG_FACTS)) {
    for (const step of facts.timeline) {
      const abs = join(HERE, step.img);
      assert.ok(existsSync(abs), `missing asset: flags/${step.img}`);
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
      ...(facts.factKeys ?? []),
    ];
    for (const key of keys) {
      assert.ok(has(en, key), `en.json missing ${key}`);
      assert.ok(has(pl, key), `pl.json missing ${key}`);
    }
  }
  // The "Did you know?" heading is referenced by the renderer, not the
  // catalog — pin it here so a language file can't drop it.
  assert.ok(has(en, 'flagFacts.didYouKnow'), 'en.json missing flagFacts.didYouKnow');
  assert.ok(has(pl, 'flagFacts.didYouKnow'), 'pl.json missing flagFacts.didYouKnow');
});
