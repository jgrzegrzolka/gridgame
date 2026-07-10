/**
 * Static import-graph tools for the browser-code guard (tooling/browserImportGraph.test.js).
 *
 * Purpose: catch the class of bug that broke prod in #767 — a browser-reachable
 * module statically importing JSON (`import x from './x.json' with { type: 'json' }`).
 * That works in Node but many browsers reject it and blank the page. Unit tests
 * can't see it (Node runs the import fine), so we guard it structurally: walk the
 * static import graph from the page entry points and forbid the JSON-module
 * attribute anywhere a browser actually loads. See memory
 * project_browser_fetch_json_not_import.
 *
 * Pure + dependency-injected (readFile passed in) so the logic is unit-tested on
 * fixtures, then run against the real repo.
 */

import { dirname, resolve } from 'node:path';

/**
 * Strip block and line comments so a comment that *mentions* import syntax (e.g.
 * a doc comment explaining the JSON-module rule) isn't mistaken for real code.
 * The line-comment rule leaves `://` alone so URLs in strings survive.
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Relative import/export specifiers in a module's source. Covers
 * `import … from './x.js'`, `export … from './x.js'`, and bare
 * `import './x.js'`. Only relative specifiers (starting with '.') are returned;
 * bare-package and dynamic imports are ignored (not part of the static graph we
 * ship to the browser).
 * @param {string} source
 * @returns {string[]}
 */
export function parseRelativeImports(source) {
  source = stripComments(source);
  /** @type {string[]} */
  const specs = [];
  const fromRe = /\bfrom\s*['"]([^'"]+)['"]/g;
  const bareRe = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = fromRe.exec(source))) if (m[1].startsWith('.')) specs.push(m[1]);
  while ((m = bareRe.exec(source))) if (m[1].startsWith('.')) specs.push(m[1]);
  return specs;
}

/**
 * True if the source uses a JSON-module import attribute
 * (`with { type: 'json' }` or the older `assert { type: 'json' }`).
 * @param {string} source
 * @returns {boolean}
 */
export function hasJsonModuleAttr(source) {
  return /(?:with|assert)\s*\{\s*type\s*:\s*['"]json['"]\s*\}/.test(stripComments(source));
}

/**
 * The set of absolute .js file paths reachable from `entryPaths` by following
 * relative `.js` imports. `.json` (and other non-.js) specifiers are not
 * traversed — a JSON import is text inside the importing .js file, so the
 * attribute scan on that file already catches it. Missing files are skipped.
 * @param {string[]} entryPaths absolute paths
 * @param {(absPath: string) => (string | null)} readFile returns source or null if absent
 * @returns {Set<string>}
 */
export function collectReachable(entryPaths, readFile) {
  const visited = new Set();
  const stack = [...entryPaths];
  while (stack.length) {
    const file = /** @type {string} */ (stack.pop());
    if (visited.has(file)) continue;
    const src = readFile(file);
    if (src == null) continue;
    visited.add(file);
    for (const spec of parseRelativeImports(src)) {
      if (!spec.endsWith('.js')) continue;
      const target = resolve(dirname(file), spec);
      if (!visited.has(target)) stack.push(target);
    }
  }
  return visited;
}

/**
 * Files in the reachable set whose source uses a JSON-module import attribute.
 * @param {Iterable<string>} reachable
 * @param {(absPath: string) => (string | null)} readFile
 * @returns {string[]}
 */
export function findJsonModuleOffenders(reachable, readFile) {
  const offenders = [];
  for (const file of reachable) {
    const src = readFile(file);
    if (src && hasJsonModuleAttr(src)) offenders.push(file);
  }
  return offenders;
}
