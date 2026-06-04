/**
 * Deploy-time minification.
 *
 * Walks every source .js and .css file in the repo, minifies each one in
 * place with esbuild, and writes a .map alongside. Intended to run inside
 * the GitHub Pages deploy step — the working tree there is throwaway, so
 * overwriting source files is fine. Locally the repo stays readable.
 *
 * Why per-file (no bundling): bundling would merge import graphs and
 * change file identity, which clashes with the project's "every page has
 * its own inline <script type='module'>" pattern (one module instance per
 * imported URL — see i18n.js cachedStrings for why that matters). A pure
 * minify pass keeps URLs and module identity intact and still gets us the
 * ~30% transfer-size win that gzip-on-top-of-text leaves on the table.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'party',     // PartyKit server, deployed via `partykit deploy` not Pages
  'scripts',   // build scripts themselves
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
      // Skip tests and existing source maps; everything else .js / .css is in scope.
      if (name.endsWith('.test.js')) continue;
      if (name.endsWith('.js.map') || name.endsWith('.css.map')) continue;
      if (name.endsWith('.js') || name.endsWith('.css')) {
        out.push(join(dir, name));
      }
    }
  }
  return out;
}

const entryPoints = await walk('.');
if (entryPoints.length === 0) {
  console.error('minify: no .js / .css files found');
  process.exit(1);
}

await build({
  entryPoints,
  outdir: '.',
  allowOverwrite: true,
  bundle: false,        // see header comment
  minify: true,
  sourcemap: true,
  format: 'esm',        // browser-side ESM
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`minify: processed ${entryPoints.length} files`);
