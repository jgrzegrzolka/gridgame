/**
 * Deploy-time JS cache-bust pass.
 *
 * Walks every shipped .js file and appends `?v=<sha>` to relative
 * .js / .json paths inside string and template literals. Covers static
 * imports, dynamic imports, export-froms, JSON fetches, and the
 * `const url = './foo.json'; fetch(url)` indirection.
 *
 * Why a separate pass (not the HTML sed): the HTML sed only versions
 * <script>/<link> hrefs. Sub-modules imported by a fresh page.js
 * (e.g. `import '../flags/quiz.js'`) and JSON fetches
 * (`fetch('../flags/countries.json')`) carry no version in source —
 * without this pass, a fresh page.js?v=<sha> would static-import the
 * OLD cached quiz.js after a shared-module edit, masking the deploy.
 *
 * Why not just bundle: see scripts/minify.mjs's header for the
 * "one module instance per URL" rationale that bundling would break.
 *
 * Order in the deploy workflow: runs AFTER the HTML __BUILD__ sed and
 * BEFORE minify, so minify's source maps reflect the rewritten URLs.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// String-literal paths: '<rel>.js' / "<rel>.json" / etc. The body
// excludes `?` so already-versioned paths don't match (idempotent
// re-runs and any future explicitly-versioned URLs both fall through).
const STRING_PATH = /(['"])(\.\.?\/[^'"?\s]+\.(?:js|json))\1/g;

// Template-literal paths ending in `.json`. Requires at least one
// `${…}` interpolation in the literal, which is the actual signal that
// it's a runtime-built fetch URL — a backtick-quoted `countries.json`
// in a doc comment has no interpolation and is left alone.
const TEMPLATE_JSON_PATH = /(`[^`]*\$\{[^}]+\}[^`]*\.json)`/g;

/**
 * @param {string} source
 * @param {string} suffix  e.g. "?v=<sha>"
 * @returns {string}
 */
export function applyCacheBust(source, suffix) {
  return source
    .replace(STRING_PATH, `$1$2${suffix}$1`)
    .replace(TEMPLATE_JSON_PATH, `$1${suffix}\``);
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'party',     // PartyKit server, deployed separately
  'scripts',   // build scripts — not shipped, and would self-rewrite
]);

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {Promise<string[]>}
 */
async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const name = entry.name;
      if (name.endsWith('.test.js')) continue;
      if (name.endsWith('.js.map')) continue;
      if (name.endsWith('.js')) out.push(join(dir, name));
    }
  }
  return out;
}

async function main() {
  const sha = process.argv[2] || process.env.GITHUB_SHA;
  if (!sha) {
    console.error('cache-bust: missing SHA (pass as first arg or set GITHUB_SHA)');
    process.exit(1);
  }
  const suffix = `?v=${sha}`;
  const files = await walk('.');
  let rewritten = 0;
  for (const file of files) {
    const before = await readFile(file, 'utf8');
    const after = applyCacheBust(before, suffix);
    if (after !== before) {
      await writeFile(file, after, 'utf8');
      rewritten++;
    }
  }
  console.log(`cache-bust: rewrote ${rewritten}/${files.length} files with ${suffix}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
