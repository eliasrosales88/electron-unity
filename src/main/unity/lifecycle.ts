import { BrowserWindow, dialog } from 'electron';
import treeKill from 'tree-kill';
import { allocateEphemeralPort } from './port';
import {
  attachUnityToWindow,
  resizeUnityToWindow,
  hideUnity,
  showUnity,
  requestUnityClose,
} from './embed';
import { awaitUnitySnapshot } from './handshake';
import { spawnUnity } from './spawn';
import {
  readBuildMetadata,
  UnityBuildMissingError,
  UnityProtocolMismatchError,
} from './paths';
import { hwndFromBuffer } from './win32';
import type { UnityBuildMetadata, UnityStatus } from '../../shared/ipc-contract';

const HANDSHAKE_TIMEOUT_MS = 30_000;

type StatusListener = (status: UnityStatus) => void;

interface RunningUnity {
  unityPid: number;
  unityHwnd: bigint;
  logPath: string;
  wsPort: number;
  child: import('node:child_process').ChildProcess;
}

export class UnityLifecycle {
  private window: BrowserWindow | null = null;
  private running: RunningUnity | null = null;
  private pendingChild: import('node:child_process').ChildProcess | null = null;
  private metadata: UnityBuildMetadata | null = null;
  private status: UnityStatus = {
    ready: false,
    wsPort: null,
    error: null,
    logPath: null,
    metadata: null,
  };
  private listeners = new Set<StatusListener>();
  private shuttingDown = false;
  private resizeHandler: (() => void) | null = null;
  private resizeDebounce: NodeJS.Timeout | null = null;

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  getStatus(): UnityStatus {
    return { ...this.status };
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private setStatus(patch: Partial<UnityStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) {
      try { l(this.status); } catch { /* noop */ }
    }
  }

  async start(): Promise<void> {
    if (!this.window) throw new Error('UnityLifecycle.start: no window attached');
    if (this.running) return;

    this.shuttingDown = false;
    this.setStatus({ ready: false, error: null, logPath: null, wsPort: null });

    try {
      this.metadata = readBuildMetadata();
      this.setStatus({ metadata: this.metadata });
    } catch (err) {
      const e = err as Error;
      if (err instanceof UnityBuildMissingError || err instanceof UnityProtocolMismatchError) {
        dialog.showErrorBox('Unity build problem', e.message);
      }
      this.setStatus({ error: e.message });
      throw err;
    }

    const parentHwnd = hwndFromBuffer(this.window.getNativeWindowHandle());
    const port = await allocateEphemeralPort();
    console.log(`[Unity] allocated port ${port}, parentHwnd=0x${parentHwnd.toString(16)}`);

    const initialBounds = this.window.getContentBounds();
    const spawned = spawnUnity({
      port,
      parentHwnd,
      initialWidth: Math.max(640, initialBounds.width),
      initialHeight: Math.max(480, initialBounds.height),
    });
    console.log(`[Unity] spawned pid=${spawned.pid}, log=${spawned.logPath}`);

    this.pendingChild = spawned.child;
    spawned.child.once('exit', (code, signal) => this.onChildExit(code, signal));

    console.log(`[Unity] awaiting WS snapshot on port ${port} (timeout ${HANDSHAKE_TIMEOUT_MS}ms)`);
    try {
      await awaitUnitySnapshot(port, HANDSHAKE_TIMEOUT_MS);
      console.log(`[Unity] WS snapshot received, attaching window`);
    } catch (err) {
      this.killChild(spawned.child.pid);
      this.pendingChild = null;
      const msg = (err as Error).message;
      this.setStatus({ error: `Unity handshake failed: ${msg}`, logPath: spawned.logPath });
      dialog.showErrorBox('Unity failed to start', `${msg}\n\nLog: ${spawned.logPath}`);
      throw err;
    }

    const { unityHwnd } = await attachUnityToWindow(parentHwnd, spawned.pid);
    console.log(`[Unity] attached unityHwnd=0x${unityHwnd.toString(16)} as child of 0x${parentHwnd.toString(16)}`);

    this.running = {
      unityPid: spawned.pid,
      unityHwnd,
      logPath: spawned.logPath,
      wsPort: port,
      child: spawned.child,
    };
    this.pendingChild = null;

    resizeUnityToWindow(this.window, unityHwnd);
    this.installResizeListener();
    console.log(`[Unity] resize + listener installed, marking ready`);

    this.setStatus({
      ready: true,
      wsPort: port,
      logPath: spawned.logPath,
      error: null,
    });

    this.window.focus();
  }

  private installResizeListener(): void {
    if (!this.window) return;
    const handler = () => {
      if (this.resizeDebounce) clearTimeout(this.resizeDebounce);
      this.resizeDebounce = setTimeout(() => {
        if (this.window && this.running) {
          resizeUnityToWindow(this.window, this.running.unityHwnd);
        }
      }, 16);
    };
    this.resizeHandler = handler;
    this.window.on('resize', handler);
    this.window.on('move', handler);
  }

  private removeResizeListener(): void {
    if (this.window && this.resizeHandler) {
      this.window.off('resize', this.resizeHandler);
      this.window.off('move', this.resizeHandler);
    }
    this.resizeHandler = null;
    if (this.resizeDebounce) {
      clearTimeout(this.resizeDebounce);
      this.resizeDebounce = null;
    }
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.shuttingDown) return;
    const pid = this.running?.unityPid ?? 'unknown';
    const logPath = this.running?.logPath ?? null;
    console.warn(`[Unity] child pid=${pid} exited unexpectedly (code=${code}, signal=${signal})`);
    this.running = null;
    this.removeResizeListener();
    this.setStatus({
      ready: false,
      wsPort: null,
      error: `Unity exited unexpectedly (code=${code}, signal=${signal ?? 'none'})`,
      logPath,
    });
  }

  async restart(): Promise<void> {
    await this.shutdown();
    await this.start();
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.removeResizeListener();

    if (this.running) {
      const { unityHwnd, child } = this.running;
      this.running = null;
      try { requestUnityClose(unityHwnd); } catch { /* noop */ }
      const exited = await waitForExit(child, 2000);
      if (!exited) this.killChild(child.pid);
    } else if (this.pendingChild) {
      const child = this.pendingChild;
      this.pendingChild = null;
      this.killChild(child.pid);
    }
  }

  private killChild(pid: number | undefined): void {
    if (!pid) return;
    try { treeKill(pid, 'SIGKILL'); } catch { /* noop */ }
  }

  hideUnityWindow(): void {
    if (this.running) hideUnity(this.running.unityHwnd);
  }

  showUnityWindow(): void {
    if (this.running) showUnity(this.running.unityHwnd);
  }
}

function waitForExit(child: import('node:child_process').ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (child.exitCode !== null) { resolve(true); return; }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

export const unityLifecycle = new UnityLifecycle();
