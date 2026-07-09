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

// The chrome `.back` button was the most-touched piece of chrome and lived
// in the corner of every page — until we replaced it with an inline
// "Home" link inside the existing action rows (give-up-row / result-links).
// The replacement removed the disabled-on-home oddity and the menu-cluster
// shift between pages. Pin the new shape so a future page can't quietly
// reintroduce `.back` or ship a non-root Home href.
test('chrome: the legacy `.back` button is gone from every page', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relative(HERE, file).split(sep).join('/');
    const html = readFileSync(file, 'utf-8');
    if (/<(?:a|span|button)[^>]*\bclass="back"/.test(html)) {
      offenders.push(`${rel}: still has a class="back" element — should have been removed`);
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// "Buy me a coffee" was a corner chrome button on every page until we
// moved it into the burger menu (last item) site-wide. The move freed
// up a chrome slot AND activated the home burger, which previously had
// no items and rendered greyed-out as the first impression. Pin that
// it stays out of the chrome cluster.
test('chrome: the legacy `.coffee` chrome button is gone from every page', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relative(HERE, file).split(sep).join('/');
    const html = readFileSync(file, 'utf-8');
    if (/<(?:a|span|button)[^>]*\bclass="coffee"/.test(html)) {
      offenders.push(`${rel}: still has a class="coffee" element — should have been removed`);
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// Every page except the root must give the player a way home — an inline
// link in an action row, with the correct relative href and the shared
// `menu.home` i18n key. One page going to "the wrong home" feels like
// the menu is broken, not like a fix-on-this-page deal.
test('chrome: every non-root page has at least one Home link pointing at the site root', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relative(HERE, file).split(sep).join('/');
    const depth = depthFromRoot(rel);
    if (depth === 0) continue;
    const html = readFileSync(file, 'utf-8');
    const expectedHref = '../'.repeat(depth);

    const homeLinks = html.match(/<a[^>]*\bdata-i18n="menu\.home"[^>]*>/g) ?? [];
    if (homeLinks.length === 0) {
      offenders.push(`${rel}: no <a data-i18n="menu.home"> link found`);
      continue;
    }
    for (const tag of homeLinks) {
      const hrefMatch = tag.match(/\bhref="([^"]*)"/);
      const href = hrefMatch ? hrefMatch[1] : null;
      if (href !== expectedHref) {
        offenders.push(
          `${rel}: Home link href is "${href}", expected "${expectedHref}" (page is ${depth} folder${depth === 1 ? '' : 's'} deep) — got: ${tag}`,
        );
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// Symmetric guard: the root must NOT carry a Home link in its content
// rows. The whole point of the rewrite was to drop the no-op affordance
// on home itself.
test('chrome: the root index.html does NOT carry a Home link', () => {
  const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
  const homeLinks = html.match(/<a[^>]*\bdata-i18n="menu\.home"[^>]*>/g) ?? [];
  assert.equal(homeLinks.length, 0, `root index.html unexpectedly has ${homeLinks.length} Home link(s)`);
});

// Every HTML page that ships the `#lang-toggle` element must also ship
// the inline non-module <script> that paints `data-current` from
// localStorage + navigator.language. Without it, the lang flag is blank
// until the deferred i18n.js module graph resolves — on a cold CF→SWA
// edge that's hundreds of ms of empty-button time on the first visit
// after deploy. The inline paint replaces the synchronous paint that
// used to live inside `bootI18n()`; if a new page adds `#lang-toggle`
// but forgets the inline script (or — worse — copy-edits one copy out
// of sync with the others), the regression would be silent without
// this guard.
//
// The canonical block is embedded here as a single source of truth.
// Pages are checked by exact substring match against this block —
// any drift in any copy fails the test. Updating the block here is
// the single point of change; the pre-existing "every page has it"
// shape means a one-place edit + a sed across the HTML keeps them
// in lockstep.
const LANG_TOGGLE_SYNC_PAINT = `    <script>
      // Sync lang-flag paint — sets data-current before any module imports
      // start, so the toggle shows the flag with first paint instead of
      // after the i18n.js graph resolves. Pinned by chrome.test.js.
      (function () {
        var lang = null;
        try {
          var s = localStorage.getItem('gridgame.lang');
          if (s === 'en' || s === 'pl') lang = s;
        } catch (e) {}
        if (!lang) {
          var n = (navigator.language || '').toLowerCase().split('-')[0];
          lang = n === 'pl' ? 'pl' : 'en';
        }
        document.getElementById('lang-toggle').setAttribute('data-current', lang);
      })();
    </script>`;

test('chrome: every page with #lang-toggle ships the canonical synchronous paint script', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    // Normalize CRLF → LF so the test isn't sensitive to line-ending
    // style on Windows checkouts (the repo holds these as CRLF; the
    // canonical literal below is LF).
    const html = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
    if (!html.includes('id="lang-toggle"')) continue;
    if (!html.includes(LANG_TOGGLE_SYNC_PAINT)) {
      const rel = relative(HERE, file).split(sep).join('/');
      offenders.push(`${rel}: inline sync paint missing or drifted from the canonical block in chrome.test.js`);
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// A ship-dark home tile (rendered `hidden`, revealed by bootHome() only with
// ?test) must actually stay hidden. `.game-tile { display: flex }` outweighs
// the UA `[hidden]` rule, so index.css needs an explicit `.game-tile[hidden]`
// display:none guard — without it the tile leaks to every visitor. This bit us
// on the Flag Party tile in prod; pin it so it can't silently come back.
test('chrome: a hidden .game-tile is actually hidden (no ship-dark leak)', () => {
  const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
  const hasHiddenTile = /<a[^>]*\bclass="game-tile"[^>]*\bhidden\b|<a[^>]*\bhidden\b[^>]*\bclass="game-tile"/.test(html);
  if (!hasHiddenTile) return; // no ship-dark tile today → nothing to guard
  const css = readFileSync(join(HERE, 'index.css'), 'utf-8').replace(/\s+/g, ' ');
  assert.match(
    css,
    /\.game-tile\[hidden\]\s*\{\s*display:\s*none/,
    'index.html has a hidden .game-tile but index.css lacks the `.game-tile[hidden] { display: none }` guard — the tile will leak to all visitors',
  );
});
