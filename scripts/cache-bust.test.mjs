import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyCacheBust } from './cache-bust.mjs';

const SUFFIX = '?v=abc123';

test('cache-bust rewrites a static `import … from` path', () => {
  const src = `import { foo } from '../flags/quiz.js';`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `import { foo } from '../flags/quiz.js${SUFFIX}';`,
  );
});

test('cache-bust rewrites an `export … from` re-export path', () => {
  const src = `export { x } from './bar.js';`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `export { x } from './bar.js${SUFFIX}';`,
  );
});

test('cache-bust rewrites a dynamic `import()` path', () => {
  const src = `const m = await import('./foo.js');`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `const m = await import('./foo.js${SUFFIX}');`,
  );
});

test('cache-bust rewrites a side-effect-only `import "…"`', () => {
  const src = `import './setup.js';`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `import './setup.js${SUFFIX}';`,
  );
});

test('cache-bust rewrites a static-literal JSON fetch', () => {
  const src = `fetch('../flags/countries.json')`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `fetch('../flags/countries.json${SUFFIX}')`,
  );
});

test('cache-bust rewrites the assigned-then-fetched indirection (e.g. daily/page.js catalogUrl)', () => {
  // The literal lives in the assignment, not at the fetch site.
  // Rewriting the literal makes the variable carry the versioned URL
  // through to the fetch — no need to touch the fetch line itself.
  const src = `const url = './daily_puzzles.json'; fetch(url);`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `const url = './daily_puzzles.json${SUFFIX}'; fetch(url);`,
  );
});

test('cache-bust rewrites a template-literal JSON fetch with `${…}` interpolation (i18n.js shape)', () => {
  const src = 'fetch(`${base}i18n/${lang}.json`)';
  assert.equal(
    applyCacheBust(src, SUFFIX),
    'fetch(`${base}i18n/${lang}.json' + SUFFIX + '`)',
  );
});

test('cache-bust leaves backtick-quoted identifiers in doc comments alone (no `${…}` → not a runtime URL)', () => {
  // engine.js mentions `countries.json` inside a /** … */ block.
  // No interpolation → TEMPLATE_JSON_PATH does not match → comment
  // text is preserved verbatim.
  const src = '// see `countries.json` for the source data';
  assert.equal(applyCacheBust(src, SUFFIX), src);
});

test('cache-bust leaves already-versioned URLs alone (re-runs are idempotent)', () => {
  const src = `import x from './foo.js?v=old';`;
  assert.equal(applyCacheBust(src, SUFFIX), src);
});

test('cache-bust leaves absolute URLs alone (no leading ./ or ../)', () => {
  const src = `fetch('https://example.com/data.json');`;
  assert.equal(applyCacheBust(src, SUFFIX), src);
});

test('cache-bust handles double-quoted string-literal paths', () => {
  const src = `import x from "./foo.js";`;
  assert.equal(
    applyCacheBust(src, SUFFIX),
    `import x from "./foo.js${SUFFIX}";`,
  );
});

test('cache-bust is idempotent — a second pass over already-rewritten source is a no-op', () => {
  const src = `import x from './foo.js';\nfetch('./data.json');`;
  const once = applyCacheBust(src, SUFFIX);
  const twice = applyCacheBust(once, SUFFIX);
  assert.equal(twice, once);
});

test('cache-bust rewrites an HTML inline `import … from` (.html files go through the same regex as .js)', () => {
  // Why this matters: HTML inline <script type="module"> blocks import
  // shared modules like '../i18n.js'. If cache-bust didn't walk .html,
  // those would ship bare while the JS-side imports of the same module
  // ship versioned — two URLs, two ES module instances, split top-level
  // state (e.g. bootI18n's cachedStrings would not be visible to
  // page.js's t()).
  const src = `<script type="module">
    import { bootI18n } from '../i18n.js';
    import { bootFindFlag } from './page.js';
  </script>`;
  const out = applyCacheBust(src, SUFFIX);
  assert.match(out, /\.\.\/i18n\.js\?v=abc123/);
  assert.match(out, /\.\/page\.js\?v=abc123/);
});

test('cache-bust leaves HTML elements that already carry `?v=__BUILD__` alone (the HTML sed handles those)', () => {
  // `<script src="./page.js?v=__BUILD__">` and `<link href="../common.css?v=__BUILD__">`
  // ship with the placeholder so the HTML __BUILD__ sed (in deploy.yml)
  // can swap it for the SHA. Cache-bust's STRING_PATH regex excludes
  // anything with a `?`, so these fall through untouched.
  const src = `<script type="module" src="./page.js?v=__BUILD__"></script>
<link rel="stylesheet" href="../common.css?v=__BUILD__">
<link rel="icon" type="image/svg+xml" href="../favicon.svg?v=__BUILD__">`;
  assert.equal(applyCacheBust(src, SUFFIX), src);
});

test('cache-bust rewrites multiple paths in the same source', () => {
  const src = `
    import { a } from './a.js';
    import { b } from '../b.js';
    fetch('./data.json');
  `;
  const out = applyCacheBust(src, SUFFIX);
  assert.match(out, /\.\/a\.js\?v=abc123/);
  assert.match(out, /\.\.\/b\.js\?v=abc123/);
  assert.match(out, /\.\/data\.json\?v=abc123/);
});
