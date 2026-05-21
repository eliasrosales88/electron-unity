import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import type { UnityStatus } from '../../../shared/ipc-contract';

export interface UnityWsMessage {
  id: number;
  receivedAt: number;
  raw: string;
}

const MAX_BUFFERED_MESSAGES = 200;

@Injectable({ providedIn: 'root' })
export class UnityService implements OnDestroy {
  private readonly _status = signal<UnityStatus>({
    ready: false,
    wsPort: null,
    error: null,
    logPath: null,
    metadata: null,
  });

  private readonly _messages = signal<UnityWsMessage[]>([]);
  private readonly _wsState = signal<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  private readonly _wsPort = signal<number | null>(null);
  private nextMessageId = 1;

  readonly status = this._status.asReadonly();
  readonly ready = computed(() => this._status().ready);
  readonly error = computed(() => this._status().error);
  readonly messages = this._messages.asReadonly();
  readonly wsState = this._wsState.asReadonly();
  readonly wsPort = this._wsPort.asReadonly();

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
    this._wsPort.set(port);
    this._wsState.set('connecting');
    const url = `ws://127.0.0.1:${port}/`;
    console.log(`[UnityService] opening ${url}`);
    try {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        console.log(`[UnityService] connected to ${url}`);
        this._wsState.set('open');
      });
      ws.addEventListener('message', (event) => {
        this.recordMessage(event.data);
      });
      ws.addEventListener('close', (ev) => {
        console.warn(`[UnityService] socket closed`, ev.code, ev.reason);
        if (this.socket === ws) {
          this.socket = null;
          this.currentPort = null;
          this._wsState.set('closed');
        }
      });
      ws.addEventListener('error', (err) => {
        console.warn(`[UnityService] socket error`, err);
        this._wsState.set('error');
      });
      this.socket = ws;
    } catch (err) {
      console.error(`[UnityService] failed to open ${url}`, err);
      this._wsState.set('error');
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      try { this.socket.close(); } catch { /* noop */ }
      this.socket = null;
    }
    this.currentPort = null;
    this._wsPort.set(null);
    this._wsState.set('idle');
  }

  clearMessages(): void {
    this._messages.set([]);
  }

  private recordMessage(data: unknown): void {
    const raw = typeof data === 'string' ? data : safeStringify(data);
    const entry: UnityWsMessage = {
      id: this.nextMessageId++,
      receivedAt: Date.now(),
      raw,
    };
    this._messages.update((arr) => {
      const next = [entry, ...arr];
      return next.length > MAX_BUFFERED_MESSAGES ? next.slice(0, MAX_BUFFERED_MESSAGES) : next;
    });
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
