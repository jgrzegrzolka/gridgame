/**
 * Generate raster WebP thumbnails of every flag SVG.
 *
 * Reads `flags/svg/*.svg`, writes `flags/webp/{code}.webp` at 300 px wide
 * (auto-height to preserve each flag's native aspect ratio), quality 80.
 *
 * Why a separate raster format alongside the SVGs:
 * - A handful of SVGs carry dense coat-of-arms path data (rs Serbia
 *   ~178 KB, sh-ta ~289 KB, bo Bolivia ~101 KB, mx Mexico ~83 KB, es
 *   Spain ~80 KB). Brotli-on-the-wire shaves ~70 % but they're still
 *   chunky enough to stall the daily result panel when several
 *   appear at once. `svgo` can't help further — they're already
 *   minimal-path. The dense detail just doesn't compress.
 * - WebP at 300 × auto / q80 brings even the worst offenders under
 *   ~10 KB, with no visible quality loss at thumbnail display sizes
 *   (~100-150 px). One file size for every consumer because browsers
 *   downscale cleanly to 30 px (TTT cells) and up to 200 px
 *   (flagsdata grid).
 * - SVG is still the source of truth (lossless, editable). Zoom-in
 *   surfaces (the daily / findFlag zoom dialogs) keep using SVG so
 *   you get vector quality when the flag fills the viewport.
 *
 * Run via `npm run build:webp`. Outputs are committed to the repo —
 * same pattern as the SVGs themselves: predictable, no CI dependency,
 * no deploy-time work. `flags.test.js` pins parity so a missed rebuild
 * surfaces in CI rather than on a slow request in prod.
 */

import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import sharp from 'sharp';

const SVG_DIR = fileURLToPath(new URL('../flags/svg/', import.meta.url));
const WEBP_DIR = fileURLToPath(new URL('../flags/webp/', import.meta.url));

// 400 / q90 chosen after q80 / 300 showed visible artefacts on flags
// with fine geometric detail at thumbnail size (GB diagonals, KR
// trigram bars, CN star edges, JP red-circle edge). The bigger raster
// lands the cleaner downscale; q90 stops the WebP encoder from
// smoothing high-contrast edges. Catalog roughly doubles (~810 → 1700
// KiB) but still ~25 % of the SVG-source total and well under the
// daily-result-stall threshold.
const WIDTH = 400;
const QUALITY = 90;

async function main() {
  await mkdir(WEBP_DIR, { recursive: true });
  const files = (await readdir(SVG_DIR)).filter((f) => f.endsWith('.svg'));
  let totalSvgBytes = 0;
  let totalWebpBytes = 0;
  let written = 0;
  for (const file of files) {
    const code = basename(file, '.svg');
    const svgPath = join(SVG_DIR, file);
    const webpPath = join(WEBP_DIR, `${code}.webp`);
    const svgStat = await stat(svgPath);
    totalSvgBytes += svgStat.size;
    const buf = await sharp(svgPath, { density: 256 })
      .resize({ width: WIDTH, withoutEnlargement: false })
      .webp({ quality: QUALITY })
      .toBuffer();
    await writeFile(webpPath, buf);
    totalWebpBytes += buf.length;
    written += 1;
  }
  const svgKb = (totalSvgBytes / 1024).toFixed(1);
  const webpKb = (totalWebpBytes / 1024).toFixed(1);
  const ratio = totalWebpBytes / totalSvgBytes;
  console.log(
    `Wrote ${written} WebP files. SVG total ${svgKb} KiB → WebP total ${webpKb} KiB ` +
    `(${(ratio * 100).toFixed(1)}%).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
