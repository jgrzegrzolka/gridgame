import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAVICON_PATH = join(HERE, 'favicon.svg');

/*
 * Regression pin for a real shipped bug (#434 → #435): the favicon
 * comment referenced `--primary-color` / `--secondary-color` literally,
 * and the XML rule "no `--` inside a comment body" silently broke the
 * SVG. Browsers stuck on the previously-cached version, every cache-
 * flush instruction failed to help, and the only way to find it was
 * opening /favicon.svg directly in the address bar. The double-hyphen
 * scan below catches the entire class — any future SVG comment that
 * mentions CSS custom properties will trip this test, and the cleanup
 * is forced before the broken icon ever ships.
 */
test('favicon.svg comments do not contain the forbidden `--` sequence', () => {
  const src = readFileSync(FAVICON_PATH, 'utf8');
  const matches = [...src.matchAll(/<!--([\s\S]*?)-->/g)];
  for (const m of matches) {
    const body = m[1];
    assert.ok(
      !body.includes('--'),
      `SVG comment contains a double-hyphen sequence (XML-illegal):\n  ${JSON.stringify(body.slice(0, 120))}`,
    );
  }
});

test('favicon.svg is well-formed: opens with <svg, closes with </svg>', () => {
  const src = readFileSync(FAVICON_PATH, 'utf8').trim();
  assert.ok(src.startsWith('<svg'), 'favicon.svg should start with <svg');
  assert.ok(src.endsWith('</svg>'), 'favicon.svg should end with </svg>');
});
