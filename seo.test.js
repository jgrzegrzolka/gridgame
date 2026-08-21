import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The one host search engines should ever be pointed at. Production serves
 * `www` and the apex 301-redirects to it (see CLAUDE.md `## Hosting`), so a
 * canonical / og:url / sitemap entry naming the apex names a URL that does
 * not return 200. Google resolves the redirect, but the site is then telling
 * it two different things about which URL is authoritative.
 */
const SITE_ORIGIN = 'https://www.yetanotherquiz.com';

/**
 * Pages deliberately kept out of search results. Two kinds:
 *   - personal views (a profile, a personal stats page) — useful to the
 *     person they belong to, noise in an index.
 *   - authoring previews under `daily/` — internal tooling.
 * Each must carry a `noindex` robots meta AND stay out of the sitemap.
 * Path form is repo-relative with forward slashes.
 */
const NOINDEX_PAGES = new Set([
  'daily/backlog/index.html',
  'daily/backlog/play.html',
  'daily/ideas/index.html',
  'daily/ideas/play.html',
  'flagQuiz/stats/index.html',
  'profile/index.html',
  'profile/sync/index.html',
]);

/** @param {string} dir @returns {string[]} */
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

/** @param {string} file @returns {string} repo-relative, forward slashes */
function relPath(file) {
  return relative(HERE, file).split(sep).join('/');
}

/**
 * The public URL a given HTML file is served at. `index.html` becomes a
 * directory URL (`/daily/`); any other name keeps its filename
 * (`/daily/archive.html`).
 *
 * @param {string} rel
 * @returns {string}
 */
function urlForPage(rel) {
  if (rel === 'index.html') return `${SITE_ORIGIN}/`;
  if (rel.endsWith('/index.html')) return `${SITE_ORIGIN}/${rel.slice(0, -'index.html'.length)}`;
  return `${SITE_ORIGIN}/${rel}`;
}

/** @returns {string[]} every `<loc>` in sitemap.xml, in document order */
function sitemapLocs() {
  const xml = readFileSync(join(HERE, 'sitemap.xml'), 'utf-8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

// A canonical pointing at the apex contradicts the sitemap, which points at
// www. Pin the host so the two can never drift apart again.
test('seo: every canonical and og:url names the www origin', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relPath(file);
    const html = readFileSync(file, 'utf-8');
    const urls = [
      ...[...html.matchAll(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"/g)].map((m) => m[1]),
    ];
    for (const url of urls) {
      if (!url.startsWith(`${SITE_ORIGIN}/`)) {
        offenders.push(`${rel}: "${url}" does not start with ${SITE_ORIGIN}/`);
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// Every page that is meant to be found should declare where it lives.
test('seo: every indexable page has a canonical matching its own URL', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relPath(file);
    if (NOINDEX_PAGES.has(rel)) continue;
    const html = readFileSync(file, 'utf-8');
    const m = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/);
    if (!m) {
      offenders.push(`${rel}: no rel="canonical"`);
      continue;
    }
    const expected = urlForPage(rel);
    if (m[1] !== expected) offenders.push(`${rel}: canonical is "${m[1]}", expected "${expected}"`);
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// The sitemap is the list handed to Search Console. If a real page is
// missing from it, that page is relying on crawl discovery alone.
test('seo: every indexable page appears in sitemap.xml', () => {
  const locs = new Set(sitemapLocs());
  /** @type {string[]} */
  const offenders = [];
  for (const file of findHtmlFiles(HERE)) {
    const rel = relPath(file);
    if (NOINDEX_PAGES.has(rel)) continue;
    const url = urlForPage(rel);
    if (!locs.has(url)) offenders.push(`${rel}: ${url} is missing from sitemap.xml`);
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// The reverse direction: a sitemap entry for a page that no longer exists
// is a soft-404 handed straight to Google.
test('seo: every sitemap entry points at a page that exists', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const loc of sitemapLocs()) {
    if (!loc.startsWith(`${SITE_ORIGIN}/`)) {
      offenders.push(`${loc}: not on ${SITE_ORIGIN}`);
      continue;
    }
    const path = loc.slice(`${SITE_ORIGIN}/`.length);
    const rel = path === '' || path.endsWith('/') ? `${path}index.html` : path;
    if (!existsSync(join(HERE, rel))) offenders.push(`${loc}: no such file (${rel})`);
    if (NOINDEX_PAGES.has(rel)) offenders.push(`${loc}: listed in the sitemap but marked noindex`);
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// robots.txt Disallow keeps a crawler off the URL; a noindex meta keeps the
// page out of the index even when it's reached by a link from elsewhere.
// Personal and preview pages need the meta, not just the Disallow.
test('seo: every page kept out of search carries a noindex robots meta', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const rel of NOINDEX_PAGES) {
    const file = join(HERE, rel);
    if (!existsSync(file)) {
      offenders.push(`${rel}: listed in NOINDEX_PAGES but the file is gone — update the list`);
      continue;
    }
    const html = readFileSync(file, 'utf-8');
    const m = html.match(/<meta[^>]*name="robots"[^>]*content="([^"]+)"/);
    if (!m) offenders.push(`${rel}: no <meta name="robots">`);
    else if (!/noindex/.test(m[1])) offenders.push(`${rel}: robots meta is "${m[1]}", missing noindex`);
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});

// The sitemap is only discoverable if robots.txt says where it is, and it
// must name the same origin as the entries inside it.
test('seo: robots.txt points at the sitemap on the www origin', () => {
  const robots = readFileSync(join(HERE, 'robots.txt'), 'utf-8');
  const m = robots.match(/^Sitemap:\s*(\S+)$/m);
  assert.ok(m, 'robots.txt has no Sitemap: line');
  assert.equal(m[1], `${SITE_ORIGIN}/sitemap.xml`);
});

// `Disallow` blocks the fetch; `noindex` needs the fetch to be read. Putting
// both on one path means the noindex is never seen and the URL can still be
// indexed from an inbound link. Pin that the two never overlap.
test('seo: no noindex page is also blocked by robots.txt', () => {
  const robots = readFileSync(join(HERE, 'robots.txt'), 'utf-8');
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)$/gm)].map((m) => m[1]);
  /** @type {string[]} */
  const offenders = [];
  for (const rule of disallowed) {
    if (rule === '/') {
      offenders.push('Disallow: / blocks the entire site');
      continue;
    }
    for (const rel of NOINDEX_PAGES) {
      const url = urlForPage(rel).slice(SITE_ORIGIN.length);
      if (url.startsWith(rule)) {
        offenders.push(`${rel} is noindex but robots.txt also has "Disallow: ${rule}" — the crawler can never read the noindex`);
      }
    }
  }
  assert.deepEqual(offenders, [], '\n  ' + offenders.join('\n  '));
});
