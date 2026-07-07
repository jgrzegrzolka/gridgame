import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCaribInset, CARIB_INSET_CODES } from './caribInset.js';

// Minimal SVG-ish DOM: enough for mountCaribInset (createElementNS,
// setAttribute, appendChild, textContent) plus a querySelectorAll walk so
// assertions can inspect what got injected.
function makeNode(tag) {
  const attrs = new Map();
  const children = [];
  const node = {
    tagName: tag,
    children,
    _attrs: attrs,
    _text: '',
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    appendChild: (c) => { children.push(c); return c; },
    set textContent(v) { node._text = String(v); },
    get textContent() { return node._text; },
  };
  return node;
}

function walk(node, out = []) {
  for (const c of node.children) { out.push(c); walk(c, out); }
  return out;
}

function makeSvg() {
  const doc = { createElementNS: (_ns, tag) => makeNode(tag) };
  return { ownerDocument: doc, children: [], appendChild(c) { this.children.push(c); return c; } };
}

test('CARIB_INSET_CODES are the four piled north-cluster islands', () => {
  assert.deepStrictEqual(CARIB_INSET_CODES, ['ai', 'mf', 'sx', 'bl']);
});

test('mountCaribInset injects a framed group of clickable island paths', () => {
  const svg = makeSvg();
  const g = mountCaribInset(svg, { x: 950, y: 250, scale: 0.85 });
  assert.strictEqual(svg.children.length, 1, 'one group appended to the svg');
  assert.strictEqual(g.getAttribute('class'), 'carib-inset');
  assert.strictEqual(g.getAttribute('transform'), 'translate(950,250) scale(0.85)');

  const nodes = walk(g);
  const frame = nodes.find((n) => n.getAttribute('class') === 'carib-inset-frame');
  assert.ok(frame, 'has a frame rect');
  assert.strictEqual(frame.tagName, 'rect');

  const islands = nodes.filter((n) => n.getAttribute('class') === 'carib-island');
  assert.strictEqual(islands.length, 4, 'one path per island');
  // Each island resolves to its own country and carries real geometry.
  const seen = islands.map((p) => p.getAttribute('data-hit-for'));
  assert.deepStrictEqual([...seen].sort(), ['ai', 'bl', 'mf', 'sx']);
  for (const p of islands) {
    assert.strictEqual(p.tagName, 'path');
    const d = p.getAttribute('d');
    assert.ok(d && d.startsWith('M') && d.length > 20, `${p.getAttribute('data-hit-for')} has a path`);
  }
});

test('mountCaribInset renders a title only when given one', () => {
  const withTitle = mountCaribInset(makeSvg(), { x: 0, y: 0, scale: 1, title: 'Lesser Antilles' });
  const titled = walk(withTitle).find((n) => n.getAttribute('class') === 'carib-inset-title');
  assert.ok(titled && titled.textContent === 'Lesser Antilles');

  const noTitle = mountCaribInset(makeSvg(), { x: 0, y: 0, scale: 1 });
  assert.ok(!walk(noTitle).some((n) => n.getAttribute('class') === 'carib-inset-title'));
});

test('mountCaribInset draws a pointer line + anchor to connectTo', () => {
  const svg = makeSvg();
  mountCaribInset(svg, { x: 900, y: 440, scale: 0.6, connectTo: { x: 826, y: 542 } });
  const link = svg.children.find((n) => n.getAttribute('class') === 'carib-inset-link');
  const anchor = svg.children.find((n) => n.getAttribute('class') === 'carib-inset-anchor');
  assert.ok(link, 'has a pointer line');
  assert.strictEqual(link.getAttribute('x1'), '826');
  assert.strictEqual(link.getAttribute('y1'), '542');
  assert.strictEqual(link.getAttribute('x2'), '900', 'line ends at the inset left edge');
  assert.ok(anchor && anchor.getAttribute('x1') === '826' && anchor.getAttribute('y1') === '542');
  // No connectTo → no pointer.
  const plain = makeSvg();
  mountCaribInset(plain, { x: 0, y: 0, scale: 1 });
  assert.ok(!plain.children.some((n) => n.getAttribute('class') === 'carib-inset-link'));
});

test('mountCaribInset is a no-op on an invalid svg', () => {
  assert.strictEqual(mountCaribInset(null, { x: 0, y: 0, scale: 1 }), null);
  assert.strictEqual(mountCaribInset({}, { x: 0, y: 0, scale: 1 }), null);
});
