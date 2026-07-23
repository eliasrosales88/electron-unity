#!/usr/bin/env node
// Stages the handful of modules that @microsoft/signalr loads at RUNTIME rather
// than at bundle time. Its Node transports deliberately use __non_webpack_require__
// (the real require, see dist/cjs/HttpConnection.js + FetchHttpClient.js), so
// webpack never bundles them — they must exist as real files in the packaged app.
//
// forge.config.ts ships resources-staging/node_modules as `resources/node_modules`,
// which Node finds by walking up from the bundle at
// resources/app.asar/.webpack/main/index.js into resources/node_modules.
//
// Roots (always required on Node): ws, eventsource, tough-cookie, fetch-cookie.
// node-fetch and abort-controller are intentionally omitted — Electron's Node
// provides global fetch and AbortController, so signalr skips those requires.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
// Resolve straight from the hoisted top-level node_modules rather than
// require.resolve — modern packages (e.g. psl) restrict `exports` and hide
// ./package.json, which would break subpath resolution.
const nodeModules = path.join(repoRoot, 'node_modules');

const ROOTS = ['ws', 'eventsource', 'tough-cookie', 'fetch-cookie'];
const destRoot = path.join(repoRoot, 'resources-staging', 'node_modules');

async function main() {
  await fs.rm(destRoot, { recursive: true, force: true });
  await fs.mkdir(destRoot, { recursive: true });

  const seen = new Set();
  const queue = [...ROOTS];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);

    const srcDir = path.join(nodeModules, ...name.split('/'));
    const pkgJsonPath = path.join(srcDir, 'package.json');
    const destDir = path.join(destRoot, ...name.split('/'));
    await fs.cp(srcDir, destDir, { recursive: true });

    const pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }

  console.log(
    `[stage-vendor] Staged ${seen.size} runtime modules → resources-staging/node_modules/`,
  );
  console.log(`[stage-vendor]   ${[...seen].sort().join(', ')}`);
}

main().catch((err) => {
  console.error(`[stage-vendor] FAILED: ${err.message}`);
  process.exit(1);
});
