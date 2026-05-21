import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import type { UnityStatus } from '../../../shared/ipc-contract';

@Injectable({ providedIn: 'root' })
export class UnityService implements OnDestroy {
  private readonly _status = signal<UnityStatus>({
    ready: false,
    wsPort: null,
    error: null,
    logPath: null,
    metadata: null,
  });

  readonly status = this._status.asReadonly();
  readonly ready = computed(() => this._status().ready);
  readonly error = computed(() => this._status().error);

  private unsubscribe: (() => void) | null = null;
  private socket: WebSocket | null = null;
  private currentPort: number | null = null;

  constructor() {
    this.unsubscribe = window.electronAPI.unity.onStatus((status) => {
      this._status.set(status);
      this.syncSocket(status);
    });
    void this.bootstrap();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.closeSocket();
  }

  async restart(): Promise<void> {
    this.closeSocket();
    await window.electronAPI.unity.restart();
  }

  private async bootstrap(): Promise<void> {
    const initial = await window.electronAPI.unity.getStatus();
    this._status.set(initial);
    this.syncSocket(initial);
  }

  private syncSocket(status: UnityStatus): void {
    if (status.ready && status.wsPort && status.wsPort !== this.currentPort) {
      this.closeSocket();
      this.openSocket(status.wsPort);
    } else if (!status.ready && this.socket) {
      this.closeSocket();
    }
  }

  private openSocket(port: number): void {
    this.currentPort = port;
    const url = `ws://127.0.0.1:${port}/`;
    try {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        console.log(`[UnityService] connected to ${url}`);
      });
      ws.addEventListener('message', (event) => {
        console.debug(`[UnityService] msg`, event.data);
      });
      ws.addEventListener('close', () => {
        if (this.socket === ws) {
          this.socket = null;
          this.currentPort = null;
        }
      });
      ws.addEventListener('error', (err) => {
        console.warn(`[UnityService] socket error`, err);
      });
      this.socket = ws;
    } catch (err) {
      console.error(`[UnityService] failed to open ${url}`, err);
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      try { this.socket.close(); } catch { /* noop */ }
      this.socket = null;
    }
    this.currentPort = null;
  }
}
