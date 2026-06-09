import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveUnityExe, resolveUnityRoot, unityLogDir } from './paths';

export interface SpawnedUnity {
  child: ChildProcess;
  pid: number;
  logPath: string;
}

export interface SpawnOptions {
  port: number;
  parentHwnd: bigint;
  initialWidth?: number;
  initialHeight?: number;
  extraArgs?: string[];
}

export function spawnUnity(opts: SpawnOptions): SpawnedUnity {
  const exe = resolveUnityExe();
  const cwd = resolveUnityRoot();
  const logPath = path.join(unityLogDir(), `unity-${Date.now()}.log`);

  const args = [
    `--ws-mode=host`,
    `--ws-port=${opts.port}`,
    `-parentHWND`, opts.parentHwnd.toString(10), `0`,
    `-popupwindow`,
    `-screen-fullscreen`, `0`,
    `-screen-width`, String(opts.initialWidth ?? 1280),
    `-screen-height`, String(opts.initialHeight ?? 720),
    `-logFile`, logPath,
    ...(opts.extraArgs ?? []),
  ];

  const child = spawn(exe, args, {
    cwd,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn Unity at ${exe}`);
  }

  const logStream = fs.createWriteStream(logPath + '.stdout.log', { flags: 'a' });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  return { child, pid: child.pid, logPath };
}
