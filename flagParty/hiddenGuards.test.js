import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'index.css'), 'utf-8');
const html = readFileSync(join(HERE, 'index.html'), 'utf-8');
const pageJs = readFileSync(join(HERE, 'page.js'), 'utf-8');

/**
 * The `.party section[hidden]` / `.game-tile[hidden]` trap, generalised.
 *
 * A base rule `.foo { display: flex }` (or inline-flex) OUTWEIGHS the UA
 * `[hidden] { display: none }` — same specificity, the author rule wins — so
 * setting `el.hidden = true` in JS does NOT hide a `.foo` element unless
 * index.css ALSO carries a `.foo[hidden] { display: none }` guard. Miss it and
 * the element stays on screen with whatever content it last held (this bit the
 * ship-dark home tile in prod, and the draft pick screen where a player who
 * already picked kept seeing their old hand while watching the next pick).
 *
 * This pins the invariant so it can't silently come back: every flagParty
 * element that (a) has a bare-class flex display and (b) is toggled via
 * `.hidden` in page.js MUST have the `[hidden]` guard.
 */

/** Parse CSS into `{ sel, body }` rules (good enough for this hand-written file).
 *  Comments are stripped first, else a `/* … *\/` round before a rule leaks into
 *  the captured selector and a bare `.foo {` stops looking bare. */
function cssRules(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

const RULES = cssRules(css);

/** Class names whose BARE single-class rule sets a flex display. Excludes
 *  compound (`.pick-hand.sent`) and descendant (`.prompt.superlative .prompt-lead`)
 *  selectors, whose display is conditional, not the unconditional base. */
function flexBaseClasses() {
  const set = new Set();
  for (const r of RULES) {
    if (!/display:\s*(?:inline-)?flex/.test(r.body)) continue;
    for (const sel of r.sel.split(',').map((s) => s.trim())) {
      const bare = sel.match(/^\.([a-z][\w-]*)$/i);
      if (bare) set.add(bare[1]);
    }
  }
  return set;
}

/** Whether some rule's selector list carries `.cls[hidden]` with display:none. */
function hasHiddenGuard(cls) {
  const needle = `.${cls}[hidden]`;
  return RULES.some((r) => r.sel.includes(needle) && /display:\s*none/.test(r.body));
}

/** Map every `const x = $('id')` ref to its id, then id -> classes via index.html,
 *  so a `x.hidden = ...` toggle can be traced back to the element's classes. */
function toggledClasses() {
  /** @type {Record<string, string>} */
  const refToId = {};
  for (const m of pageJs.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\$\('([^']+)'\)/g)) {
    refToId[m[1]] = m[2];
  }
  /** @type {Record<string, string[]>} */
  const idToClasses = {};
  for (const tag of html.match(/<[a-z][^>]*>/gi) || []) {
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
    const cls = (tag.match(/\bclass="([^"]+)"/) || [])[1];
    if (id && cls) idToClasses[id] = cls.split(/\s+/);
  }
  const classes = new Set();
  for (const m of pageJs.matchAll(/(\w+)\.hidden\s*=/g)) {
    const id = refToId[m[1]];
    if (!id) continue;
    for (const c of idToClasses[id] || []) classes.add(c);
  }
  return classes;
}

test('flagParty: every flex element toggled via .hidden has a [hidden] guard', () => {
  const flex = flexBaseClasses();
  const toggled = toggledClasses();
  const needGuard = [...toggled].filter((c) => flex.has(c));
  // Sanity: the parse actually found the known offenders, so a silent regex break
  // can't turn this into a vacuous pass.
  assert.ok(needGuard.includes('pick-hand'), 'expected to detect .pick-hand as a flex + hidden-toggled element');
  for (const cls of needGuard) {
    assert.ok(
      hasHiddenGuard(cls),
      `.${cls} has a flex display and is toggled via .hidden in page.js, but index.css lacks a ` +
        `\`.${cls}[hidden] { display: none }\` guard — it will stay visible (with stale content) when hidden`,
    );
  }
});
