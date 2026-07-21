import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import type { UnityStatus } from '../../../shared/ipc-contract';

export interface UnityWsMessage {
  id: number;
  receivedAt: number;
  raw: string;
}

/** Pose of the Unity panel as reported by `snapshot` / `rotation` messages (degrees). */
export interface PanelRotation {
  yaw: number;
  pitch: number;
  roll: number;
  receivedAt: number;
}

const MAX_BUFFERED_MESSAGES = 200;
const WIRE_PROTOCOL_VERSION = 1;

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
  private readonly _rotation = signal<PanelRotation | null>(null);
  private nextMessageId = 1;
  private readonly startedAt = performance.now();

  readonly status = this._status.asReadonly();
  readonly ready = computed(() => this._status().ready);
  readonly error = computed(() => this._status().error);
  readonly messages = this._messages.asReadonly();
  readonly wsState = this._wsState.asReadonly();
  readonly wsPort = this._wsPort.asReadonly();
  /** Latest pose broadcast by Unity (snapshot or rotation), or null before the first one. */
  readonly rotation = this._rotation.asReadonly();

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

  /**
   * Sends a `rotation` command to Unity over the state-sync WebSocket
   * (degrees; protocol v1). The host applies it via HostRotationApplier and
   * re-broadcasts the resulting pose to every client, including this one.
   * Returns false when the socket is not open.
   */
  sendRotation(yaw: number, pitch: number, roll: number): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const t = (performance.now() - this.startedAt) / 1000;
    const payload = JSON.stringify({
      v: WIRE_PROTOCOL_VERSION,
      type: 'rotation',
      yaw: round2(yaw),
      pitch: round2(pitch),
      roll: round2(roll),
      t: Math.round(t * 1000) / 1000,
    });
    try {
      this.socket.send(payload);
      return true;
    } catch (err) {
      console.warn('[UnityService] failed to send rotation', err);
      return false;
    }
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
    this.tryParseRotation(raw, entry.receivedAt);
  }

  private tryParseRotation(raw: string, receivedAt: number): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const msg = parsed as Record<string, unknown>;
    if (msg.v !== WIRE_PROTOCOL_VERSION) return;
    if (msg.type !== 'rotation' && msg.type !== 'snapshot') return;
    if (typeof msg.yaw !== 'number' || typeof msg.pitch !== 'number' || typeof msg.roll !== 'number') return;
    this._rotation.set({ yaw: msg.yaw, pitch: msg.pitch, roll: msg.roll, receivedAt });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
