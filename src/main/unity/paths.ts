import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { UnityBuildMetadata } from '../../shared/ipc-contract';

const EXPECTED_PROTOCOL_VERSION = 1;
const EXECUTABLE = 'PanelScene.exe';
const METADATA_FILE = 'unity-build.json';

export function resolveUnityRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'unity');
  }
  return path.join(app.getAppPath(), 'resources-staging', 'unity');
}

export function resolveUnityExe(): string {
  return path.join(resolveUnityRoot(), EXECUTABLE);
}

export function resolveMetadataPath(): string {
  return path.join(resolveUnityRoot(), METADATA_FILE);
}

export class UnityBuildMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnityBuildMissingError';
  }
}

export class UnityProtocolMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnityProtocolMismatchError';
  }
}

export function readBuildMetadata(): UnityBuildMetadata {
  const exePath = resolveUnityExe();
  if (!fs.existsSync(exePath)) {
    throw new UnityBuildMissingError(
      `Unity executable not found at:\n  ${exePath}\n\n` +
      `Run \`npm run stage:unity\` after building Unity (or set UNITY_BUILD_DIR).`
    );
  }

  const metadataPath = resolveMetadataPath();
  if (!fs.existsSync(metadataPath)) {
    throw new UnityBuildMissingError(
      `unity-build.json not found alongside the executable:\n  ${metadataPath}\n\n` +
      `Rebuild Unity with the updated BuildScript.cs that emits metadata.`
    );
  }

  const raw = fs.readFileSync(metadataPath, 'utf8');
  const metadata = JSON.parse(raw) as UnityBuildMetadata;
  if (metadata.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
    throw new UnityProtocolMismatchError(
      `Protocol version mismatch: Unity build is v${metadata.protocolVersion}, ` +
      `Electron expects v${EXPECTED_PROTOCOL_VERSION}.`
    );
  }
  return metadata;
}

export function unityLogDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
