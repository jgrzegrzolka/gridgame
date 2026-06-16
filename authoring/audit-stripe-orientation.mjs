#!/usr/bin/env node
// Author-side review tool for the stripesOnly classification.
//
// Prints horizontal / vertical / null tallies per continent, then a flat
// list of every flagged country. Also surfaces suspect rows where the
// classification looks inconsistent with the rest of the data — e.g.
// `stripesOnly` set on a country whose motifs include a charge, which
// would mean the flag isn't actually pure stripes.
//
// Run: `node authoring/audit-stripe-orientation.mjs`
// (Mirrors authoring/audit-ambiguity.mjs in shape.)

import { readFileSync } from 'node:fs';
import { CHARGE_MOTIFS as CHARGE_MOTIFS_LIST } from '../flags/engine.js';

const CHARGE_MOTIFS = new Set(CHARGE_MOTIFS_LIST);

const VALID = new Set(['horizontal', 'vertical', null]);

const countries = JSON.parse(readFileSync('flags/countries.json', 'utf8'));

/** @type {Record<string, { horizontal: string[], vertical: string[], nullCount: number }>} */
const byCont = {};
const suspect = [];
const invalid = [];

for (const c of countries) {
  const cont = c.continent ?? 'Other';
  if (!byCont[cont]) byCont[cont] = { horizontal: [], vertical: [], nullCount: 0 };

  if (!VALID.has(c.stripesOnly)) {
    invalid.push(`${c.code} ${c.name}: stripesOnly=${JSON.stringify(c.stripesOnly)}`);
    continue;
  }

  if (c.stripesOnly === 'horizontal') byCont[cont].horizontal.push(`${c.code} ${c.name}`);
  else if (c.stripesOnly === 'vertical') byCont[cont].vertical.push(`${c.code} ${c.name}`);
  else byCont[cont].nullCount++;

  if (c.stripesOnly !== null) {
    const motifs = c.motifs ?? [];
    const charges = motifs.filter((m) => CHARGE_MOTIFS.has(m));
    if (charges.length) {
      suspect.push(`${c.code} ${c.name} tagged ${c.stripesOnly} but motifs include ${charges.join(', ')} — contradicts "pure stripes"`);
    }
  }
}

for (const cont of Object.keys(byCont).sort()) {
  const b = byCont[cont];
  console.log(`=== ${cont} (h=${b.horizontal.length}, v=${b.vertical.length}, null=${b.nullCount}) ===`);
  if (b.horizontal.length) console.log(`  horizontal: ${b.horizontal.join(', ')}`);
  if (b.vertical.length)   console.log(`  vertical:   ${b.vertical.join(', ')}`);
}

const totalH = Object.values(byCont).reduce((s, b) => s + b.horizontal.length, 0);
const totalV = Object.values(byCont).reduce((s, b) => s + b.vertical.length, 0);
const totalN = Object.values(byCont).reduce((s, b) => s + b.nullCount, 0);
console.log(`\nTotal: horizontal=${totalH}, vertical=${totalV}, null=${totalN}`);

if (invalid.length) {
  console.error(`\nINVALID stripesOnly values (${invalid.length}):`);
  for (const s of invalid) console.error('  ' + s);
}

if (suspect.length) {
  console.error(`\nSUSPECT classifications (${suspect.length}):`);
  for (const s of suspect) console.error('  ' + s);
}

if (invalid.length || suspect.length) process.exit(1);
