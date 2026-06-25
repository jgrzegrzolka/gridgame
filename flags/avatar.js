/**
 * Deterministic identicon avatar for a deviceId. Same input always renders
 * the same 5x5 mirrored grid in the same colour — the visual companion to
 * `defaultNickname()`. Two users with the same deviceId see the same avatar
 * on every device, no server lookup required.
 *
 * Mirrored 5x5 grid (3 unique columns × 5 rows = 15 bits) is the GitHub /
 * Gravatar style: the symmetry reads as an intentional pattern rather than
 * random noise, which makes users recognise their own avatar faster.
 *
 * Bit source: FNV-1a of the deviceId + a salt, so the colour pick and the
 * pattern pick come from independent hashes — same deviceId never re-uses
 * the colour-derived bits to drive the cells (which would correlate colour
 * and shape).
 */

import { fnv1a } from './nickname.js';

/**
 * Palette tuned for legibility on the page background (`var(--page-bg-color)`) and
 * inside the menu's white panel. Each entry has enough chroma to read
 * as a distinct colour at 24 px while staying within a friendly,
 * non-neon family. Order is stable — re-ordering re-keys every
 * deviceId's avatar colour, so do it intentionally.
 */
export const PALETTE = Object.freeze([
  '#660033', // brand maroon
  '#0e7490', // teal
  '#7c3aed', // purple
  '#b91c1c', // red
  '#047857', // green
  '#b45309', // amber
  '#1d4ed8', // blue
  '#be185d', // pink
  '#4d7c0f', // lime
  '#a16207', // ochre
  '#5b21b6', // indigo
  '#0f766e', // deep teal
]);

/**
 * Build the SVG markup for a deviceId's identicon. Returns a self-contained
 * `<svg>…</svg>` string with no external references (no CSS classes, no
 * fonts) — safe to drop into `innerHTML` because every byte comes from the
 * fixed palette + deterministic hash, never from user input.
 *
 * @param {string} deviceId
 * @param {{ size?: number }} [opts]
 * @returns {string}
 */
export function avatarSvg(deviceId, opts = {}) {
  const size = opts.size ?? 24;
  const safeId = typeof deviceId === 'string' ? deviceId : '';
  const colorHash = fnv1a(safeId);
  const patternHash = fnv1a(`${safeId}:pattern`);
  const color = PALETTE[colorHash % PALETTE.length];

  // 15 unique cells (3 cols × 5 rows). Each bit decides whether the cell
  // (and its horizontal mirror) is painted. Bit packing: row r, col c maps
  // to bit (r * 3 + c), so the low 15 bits of patternHash drive the grid.
  let rects = '';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const bit = (patternHash >>> (row * 3 + col)) & 1;
      if (!bit) continue;
      rects += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
      // Column 2 is the centre — no mirror needed. Columns 0 and 1 mirror
      // to columns 4 and 3 respectively.
      if (col !== 2) {
        rects += `<rect x="${4 - col}" y="${row}" width="1" height="1"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${size}" height="${size}" fill="${color}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${rects}</svg>`;
}
