import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

/**
 * The PartyKit deploy trigger must cover everything the server actually bundles.
 *
 * The Flag Party WebSocket server (party/partyGameServer.js + party/server.js) is
 * deployed to Cloudflare by `.github/workflows/deploy-partykit.yml`, which only
 * runs when a push touches one of its `paths:` globs. That list is a HAND-MAINTAINED
 * copy of the server's transitive import closure, and the two drift: when the
 * question generators moved into `flags/partyQuestions/`, the `flags/party*.js` glob
 * stopped reaching them (it does not cross a directory), so changes to spotFlag.js /
 * superlative*.js deployed the client and left the server generating the OLD
 * questions. That is how the spot-the-flag country clause and the yellow/orange fix
 * shipped to the client but never to the server — a silent, confusing "why do I
 * never see it" failure with green tests and a green deploy.
 *
 * This walks the real import graph and asserts every bundled repo file matches a
 * trigger glob, so the next generator or shared-dep addition can't reopen the gap.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The two PartyKit entry points bundled to Cloudflare. */
const ENTRY_POINTS = ['party/partyGameServer.js', 'party/server.js'];

/** Walk relative `from '…'` imports from the entry points; return every repo-relative
 *  source/data file the server bundles (posix separators). */
function importClosure() {
  const seen = new Set();
  const norm = (/** @type {string} */ p) => p.split('\\').join('/');
  const walk = (/** @type {string} */ rel) => {
    rel = norm(rel);
    if (seen.has(rel)) return;
    seen.add(rel);
    let src;
    try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { return; }
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      let p = norm(relative(ROOT, resolve(dirname(join(ROOT, rel)), m[1])));
      if (!p.endsWith('.js') && !p.endsWith('.json')) p += '.js';
      walk(p);
    }
  };
  for (const e of ENTRY_POINTS) walk(e);
  return [...seen];
}

/** The quoted `- '…'` entries under the workflow's `paths:` filter. They are the
 *  only single-quoted list items in the file (steps use unquoted `- uses:` / `- run:`). */
function triggerGlobs() {
  const yml = readFileSync(join(ROOT, '.github/workflows/deploy-partykit.yml'), 'utf8');
  return [...yml.matchAll(/^\s+-\s+'([^']+)'\s*$/gm)].map((m) => m[1]);
}

/** GitHub Actions path glob → RegExp. `**` crosses directories, `*` does not. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i += 1; } else re += '[^/]*';
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

test('deploy-partykit paths cover every file the server bundles', () => {
  const globs = triggerGlobs().map(globToRegExp);
  const covered = (/** @type {string} */ f) => globs.some((g) => g.test(f));

  const closure = importClosure();
  // Sanity: the walk actually reached the generators — a broken regex must not turn
  // this into a vacuous pass.
  assert.ok(closure.includes('flags/partyQuestions/spotFlag.js'),
    'closure walk should reach the spot-the-flag generator');
  assert.ok(closure.includes('party/partyGameServer.js'), 'closure walk should include the entry point');

  const uncovered = closure.filter((f) => !covered(f));
  assert.deepEqual(uncovered, [],
    'these files are bundled by the PartyKit server but no deploy-partykit.yml path triggers on them, ' +
    'so a change to them deploys the client and leaves the server stale — add a matching path glob:\n  ' +
    uncovered.join('\n  '));
});
