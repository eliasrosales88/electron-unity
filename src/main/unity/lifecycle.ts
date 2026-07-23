import { BrowserWindow, dialog } from 'electron';
import treeKill from 'tree-kill';
import { allocateEphemeralPort } from './port';
import {
  attachUnityToWindow,
  resizeUnityToWindow,
  hideUnity,
  showUnity,
  requestUnityClose,
  type UnityInsets,
} from './embed';
import { awaitUnitySnapshot } from './handshake';
import { spawnUnity } from './spawn';
import {
  readBuildMetadata,
  UnityBuildMissingError,
  UnityProtocolMismatchError,
} from './paths';
import { hwndFromBuffer, focusUnity, raiseUnityToTop } from './win32';
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
  private focusHandler: (() => void) | null = null;
  private resizeDebounce: NodeJS.Timeout | null = null;
  private insetsDip: UnityInsets = { left: 0, right: 0 };

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /**
   * Reserves strips at the window edges (in DIPs) for panels in 'push' mode.
   * Unity's child HWND is laid out in whatever space is left over.
   */
  setInsets(insets: UnityInsets): void {
    const next: UnityInsets = {
      left: Math.max(0, Math.round(insets.left)),
      right: Math.max(0, Math.round(insets.right)),
    };
    if (next.left === this.insetsDip.left && next.right === this.insetsDip.right) return;
    this.insetsDip = next;
    if (this.window && this.running) {
      resizeUnityToWindow(this.window, this.running.unityHwnd, this.insetsDip);
    }
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

    resizeUnityToWindow(this.window, unityHwnd, this.insetsDip);
    this.installResizeListener();
    console.log(`[Unity] resize + listener installed, marking ready`);

    this.setStatus({
      ready: true,
      wsPort: port,
      logPath: spawned.logPath,
      error: null,
    });

    // Bring the app to the foreground, then hand keyboard focus back to the
    // Unity child. The order matters: window.focus() steals the focus that
    // resizeUnityToWindow just gave Unity, and an unfocused Unity player
    // ignores mouse input entirely — the scene would stay dead until some
    // later resize happened to call focusUnity() again.
    this.window.focus();
    focusUnity(unityHwnd);
  }

  private installResizeListener(): void {
    if (!this.window) return;
    const handler = () => {
      if (this.resizeDebounce) clearTimeout(this.resizeDebounce);
      this.resizeDebounce = setTimeout(() => {
        if (this.window && this.running) {
          resizeUnityToWindow(this.window, this.running.unityHwnd, this.insetsDip);
        }
      }, 16);
    };
    this.resizeHandler = handler;
    this.window.on('resize', handler);
    this.window.on('move', handler);
    // Restoring from minimized/hidden does not necessarily emit 'resize', so
    // without these the Unity child would keep whatever geometry it had while
    // the window was away.
    this.window.on('restore', handler);
    this.window.on('show', handler);

    // Coming back from the background, Windows restores focus to whichever of
    // our windows was last active — usually the overlay, since that is what the
    // user clicks. Unity would then stay unfocused and keep ignoring the mouse
    // while the panel still worked. Focus on the *main* window means the user
    // is heading for the scene, so hand it straight to the Unity child. Focus
    // on the overlay is left alone so the panel keeps the keyboard.
    const onFocus = () => {
      if (!this.running) return;
      // Order matters: get Unity back on top of the Chromium sibling first, so
      // the scene is actually hit-testable, then hand it the keyboard focus.
      raiseUnityToTop(this.running.unityHwnd);
      focusUnity(this.running.unityHwnd);
    };
    this.focusHandler = onFocus;
    this.window.on('focus', onFocus);
  }

  private removeResizeListener(): void {
    if (this.window && this.resizeHandler) {
      this.window.off('resize', this.resizeHandler);
      this.window.off('move', this.resizeHandler);
      this.window.off('restore', this.resizeHandler);
      this.window.off('show', this.resizeHandler);
    }
    if (this.window && this.focusHandler) {
      this.window.off('focus', this.focusHandler);
    }
    this.focusHandler = null;
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
