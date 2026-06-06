import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Find every *.html file under the repo, skipping vendor directories and
 * anything that starts with a dot (`.claude`, `.partykit`, etc.).
 *
 * @param {string} dir
 * @returns {string[]}
 */
function findHtmlFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findHtmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/**
 * Number of `../` segments needed to reach the repo root from a file at
 * `relPath`. For `index.html` (root) the result is 0; for
 * `daily/archive.html` it's 1; for `flagQuiz/stats/index.html` it's 2.
 *
 * @param {string} relPath
 * @returns {number}
 */
function depthFromRoot(relPath) {
  return relPath.split('/').length - 1;
}

/**
 * Pull each occurrence of `<a class="back" ...>` (or `<span class="back" ...>`
 * for the disabled-on-root case) as a flat tag string. The chrome-button
 * markup is single-line in every page, which keeps a regex enough — no
 * HTML parser dependency for one tag.
 *
 * @param {string} html
 * @returns {string[]}
 */
function backTags(html) {
  return html.match(/<(?:a|span|button)[^>]*\bclass="back"[^>]*>/g) ?? [];
}

// The back/home button is THE most-touched piece of chrome — there's one
// on nearly every page in the repo and players hit it after every game.
// One page going to "the wrong home" (e.g. archive sending you back to
// the daily landing instead of the site root) feels like the menu is
// broken, not like a fix-on-this-page deal. Pin the convention so a
// future page can't quietly drift again.
test('back button: every page-level chrome "Home" affordance lands on the site root with the canonical aria-label', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relative(HERE, file).split(sep).join('/');
    const html = readFileSync(file, 'utf-8');
    for (const tag of backTags(html)) {
      const expectedHref = depthFromRoot(rel) === 0 ? null : '../'.repeat(depthFromRoot(rel));
      const ariaDisabled = /\baria-disabled="true"/.test(tag);

      if (!/\baria-label="Home"/.test(tag)) {
        offenders.push(`${rel}: back is missing aria-label="Home" — got: ${tag}`);
      }
      if (!/\bdata-i18n-attr="aria-label:back"/.test(tag)) {
        offenders.push(`${rel}: back is missing data-i18n-attr="aria-label:back" — got: ${tag}`);
      }

      // Root has a static disabled span (no href, can't navigate from
      // home to home). Everywhere else must navigate to the root.
      if (ariaDisabled) {
        if (expectedHref !== null) {
          offenders.push(`${rel}: back is aria-disabled but page isn't the root — got: ${tag}`);
        }
        continue;
      }
      const hrefMatch = tag.match(/\bhref="([^"]*)"/);
      const href = hrefMatch ? hrefMatch[1] : null;
      if (href !== expectedHref) {
        offenders.push(
          `${rel}: back href is "${href}", expected "${expectedHref}" (page is ${depthFromRoot(rel)} folder${depthFromRoot(rel) === 1 ? '' : 's'} deep)`,
        );
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});
