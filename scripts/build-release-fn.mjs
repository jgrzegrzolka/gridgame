/**
 * Bundle the release Function App into a deployable single-file artifact.
 *
 * The Function imports from `flags/*` (via validate.js) which is outside
 * its own directory tree, so we can't just zip `infra/release-fn/` — the
 * relative-path imports wouldn't resolve at runtime. esbuild bundles
 * everything (incl. countries.json) into one ESM file, keeps the
 * `@azure/*` packages external so Oryx resolves them at deploy time
 * against the runtime's own node_modules.
 *
 * Output layout under `infra/release-fn/dist/`:
 *   index.mjs       — bundled function entry
 *   host.json       — copied verbatim
 *   package.json    — minimal manifest with `@azure/*` dependencies +
 *                     `main: "index.mjs"` + `type: "module"`
 *
 * Deploy step: `Compress-Archive -Path dist/* -DestinationPath release-fn.zip`,
 * then `az functionapp deployment source config-zip`. See
 * infra/operations.md for the full command.
 */

import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'infra', 'release-fn', 'src', 'index.js');
const DIST = join(ROOT, 'infra', 'release-fn', 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

await build({
  entryPoints: [SRC],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(DIST, 'index.mjs'),
  external: ['@azure/functions', '@azure/identity', '@azure/storage-blob'],
  loader: { '.json': 'json' },
  // Function App's worker runtime expects to load the entry point via
  // CommonJS require() under the hood — when format=esm output uses
  // import.meta or top-level await, this still works because Node's
  // ESM loader handles it. The bundle here is pure ESM exports + the
  // app.timer() registration as a top-level side effect.
  banner: {
    js: '// Bundled by scripts/build-release-fn.mjs — do not edit by hand.',
  },
});

await copyFile(
  join(ROOT, 'infra', 'release-fn', 'host.json'),
  join(DIST, 'host.json'),
);

const distPkg = {
  name: 'release-fn',
  version: '1.0.0',
  type: 'module',
  main: 'index.mjs',
  dependencies: {
    '@azure/functions': '^4.5.0',
    '@azure/identity': '^4.4.1',
    '@azure/storage-blob': '^12.24.0',
  },
};
await writeFile(
  join(DIST, 'package.json'),
  JSON.stringify(distPkg, null, 2) + '\n',
);

// Install the @azure/* deps INTO dist/node_modules so we can deploy a
// self-contained zip — Linux Consumption with WEBSITE_RUN_FROM_PACKAGE
// doesn't reliably run Oryx during zip-deploy, leaving the runtime
// without `@azure/functions` and silently dropping every registration.
// Installing locally avoids the failure mode entirely.
console.log('release-fn: installing runtime deps into dist/node_modules');
execSync('npm install --omit=dev --no-audit --no-fund --silent', {
  cwd: DIST,
  stdio: 'inherit',
});

console.log('release-fn: bundled to infra/release-fn/dist/');
