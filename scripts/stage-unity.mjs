#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PROTOCOL_VERSION = 1;
const REQUIRED_FILES = ['PanelScene.exe', 'UnityPlayer.dll', 'unity-build.json'];
const REQUIRED_DIRS = ['PanelScene_Data'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function resolveSourceDir() {
  if (process.env.UNITY_BUILD_DIR) {
    const abs = path.resolve(process.env.UNITY_BUILD_DIR);
    if (!(await pathExists(abs))) {
      throw new Error(`UNITY_BUILD_DIR points to a non-existent path: ${abs}`);
    }
    return abs;
  }
  return path.resolve(repoRoot, '..', 'panel_scene_unity', 'Builds', 'Windows');
}

async function validate(srcDir) {
  for (const f of REQUIRED_FILES) {
    if (!(await pathExists(path.join(srcDir, f)))) {
      throw new Error(`Unity build is missing required file: ${f}\n  Looked in: ${srcDir}\n  Did you run BuildScript.BuildWindowsStandalone in Unity?`);
    }
  }
  for (const d of REQUIRED_DIRS) {
    if (!(await pathExists(path.join(srcDir, d)))) {
      throw new Error(`Unity build is missing required directory: ${d}\n  Looked in: ${srcDir}`);
    }
  }

  const metadataRaw = await fs.readFile(path.join(srcDir, 'unity-build.json'), 'utf8');
  let metadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch (e) {
    throw new Error(`unity-build.json is not valid JSON: ${e.message}`);
  }
  if (metadata.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
    throw new Error(
      `Protocol version mismatch: Unity build says v${metadata.protocolVersion}, ` +
      `Electron expects v${EXPECTED_PROTOCOL_VERSION}. Rebuild Unity or update Electron's expectation.`
    );
  }
  return metadata;
}

async function main() {
  const srcDir = await resolveSourceDir();
  const destDir = path.join(repoRoot, 'resources-staging', 'unity');

  console.log(`[stage-unity] Source: ${srcDir}`);
  const metadata = await validate(srcDir);

  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  await fs.cp(srcDir, destDir, { recursive: true, force: true });

  console.log(
    `[stage-unity] Staged Unity build ${metadata.gitCommit ?? 'unknown'} ` +
    `@ ${metadata.buildTimestamp ?? '?'} → ${path.relative(repoRoot, destDir)}/`
  );
}

main().catch(err => {
  console.error(`[stage-unity] FAILED: ${err.message}`);
  process.exit(1);
});
