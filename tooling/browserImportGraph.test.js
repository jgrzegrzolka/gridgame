import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  parseRelativeImports,
  hasJsonModuleAttr,
  collectReachable,
  findJsonModuleOffenders,
} from './browserImportGraph.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// resolve() prepends a drive letter on Windows; normalize to POSIX keys for the
// in-memory fixtures below.
const norm = (/** @type {string} */ p) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// ---- unit: pure logic on fixtures ------------------------------------------

test('parseRelativeImports finds from-imports, export-from, and bare imports', () => {
  const src = [
    "import { a } from './a.js';",
    "import b from '../b/b.js';",
    "export { c } from './c.js';",
    "import './side.js';",
    "import x from 'some-package';", // bare package — ignored
    "import d from './d.json' with { type: 'json' };",
  ].join('\n');
  assert.deepEqual(parseRelativeImports(src).sort(), [
    '../b/b.js',
    './a.js',
    './c.js',
    './d.json',
    './side.js',
  ]);
});

test('parseRelativeImports handles multi-line import blocks', () => {
  const src = "import {\n  one,\n  two,\n} from '../flags/thing.js';";
  assert.deepEqual(parseRelativeImports(src), ['../flags/thing.js']);
});

test('hasJsonModuleAttr detects with and assert forms, ignores others', () => {
  assert.equal(hasJsonModuleAttr("import x from './x.json' with { type: 'json' };"), true);
  assert.equal(hasJsonModuleAttr("import x from './x.json' assert { type: 'json' };"), true);
  assert.equal(hasJsonModuleAttr('const x = fetch("./x.json").then(r => r.json());'), false);
  assert.equal(hasJsonModuleAttr("import { a } from './a.js';"), false);
});

test('hasJsonModuleAttr ignores the pattern inside a comment', () => {
  // This is exactly what caused a false positive: a doc comment quoting the rule.
  assert.equal(hasJsonModuleAttr("// avoid: import x from './x.json' with { type: 'json' }"), false);
  assert.equal(
    hasJsonModuleAttr("/* only Node: import x from './x.json' with { type: 'json' } */\nexport const y = 1;"),
    false,
  );
});

test('collectReachable follows relative .js imports only', () => {
  const files = {
    '/app/page.js': "import './a.js'; import './data.json' with { type: 'json' };",
    '/app/a.js': "import { b } from './sub/b.js';",
    '/app/sub/b.js': 'export const b = 1;',
    '/app/orphan.js': 'export const nope = 1;', // not imported by anyone
  };
  const read = (/** @type {string} */ p) => files[norm(p)] ?? null;
  const reachable = collectReachable(['/app/page.js'], read);
  const rel = [...reachable].map(norm).sort();
  assert.deepEqual(rel, ['/app/a.js', '/app/page.js', '/app/sub/b.js']);
  assert.ok(!rel.includes('/app/orphan.js'));
});

test('findJsonModuleOffenders flags a reachable JSON-module importer', () => {
  const files = {
    '/app/page.js': "import './reg.js';",
    '/app/reg.js': "import data from './data.json' with { type: 'json' };\nexport default data;",
  };
  const read = (/** @type {string} */ p) => files[norm(p)] ?? null;
  const reachable = collectReachable(['/app/page.js'], read);
  const offenders = findJsonModuleOffenders(reachable, read).map(norm);
  assert.deepEqual(offenders, ['/app/reg.js']);
});

// ---- integration: the real repo must stay clean ----------------------------

/** Every `page.js` is a browser entry point (HTML calls its bootX in a module script). */
function findPageEntries(/** @type {string} */ dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...findPageEntries(full));
    else if (ent.name === 'page.js') out.push(full);
  }
  return out;
}

const read = (/** @type {string} */ p) => {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
};

test('no browser-reachable module statically imports JSON', () => {
  const entries = findPageEntries(REPO);
  assert.ok(entries.length >= 10, `expected many page.js entries, found ${entries.length}`);
  const reachable = collectReachable(entries, read);
  // Sanity: the walk actually traversed the graph, it didn't silently find nothing.
  assert.ok(reachable.size > 40, `import walk looks broken: only ${reachable.size} files reached`);
  const offenders = findJsonModuleOffenders(reachable, read).map((p) => p.replace(REPO, '').replace(/\\/g, '/'));
  assert.deepEqual(
    offenders,
    [],
    `Browser-reachable modules must not statically import JSON (import … with { type: 'json' }).\n` +
      `That works in Node but breaks in browsers (blank page — see #767/#769). Load JSON via ` +
      `fetch().then(r => r.json()) instead.\nOffenders:\n  ${offenders.join('\n  ')}`,
  );
});
