import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import type { SessionState } from '../../../shared/session-contract';
import { PoseInterpolator, RENDER_DELAY_MS } from './pose-interpolator';
import { UnityService } from './unity.service';

/** Window over which the inbound pose rate is averaged, in samples. */
const RATE_WINDOW = 20;

const IDLE_STATE: SessionState = {
  role: 'idle',
  connection: 'unconfigured',
  code: null,
  presenter: null,
  viewerCount: 0,
  lobby: [],
  counters: { sent: 0, received: 0, failed: 0 },
  error: null,
};

/**
 * Renderer half of the session feature.
 *
 * Main owns SignalR; this service is the bridge between that and the Unity
 * WebSocket, which lives here. Presenting means forwarding whatever Unity
 * broadcasts; viewing means replaying the remote stream into Unity through the
 * very same `rotation` command the sliders emit — Unity cannot tell the two
 * apart, so no new protocol is involved.
 */
@Injectable({ providedIn: 'root' })
export class SessionService implements OnDestroy {
  private readonly unity = inject(UnityService);

  private readonly _state = signal<SessionState>(IDLE_STATE);
  private readonly _poseRateHz = signal(0);

  readonly state = this._state.asReadonly();
  readonly role = computed(() => this._state().role);
  readonly connection = computed(() => this._state().connection);
  readonly code = computed(() => this._state().code);
  readonly lobby = computed(() => this._state().lobby);
  readonly counters = computed(() => this._state().counters);
  readonly error = computed(() => this._state().error);
  readonly viewerCount = computed(() => this._state().viewerCount);
  readonly presenter = computed(() => this._state().presenter);
  readonly isViewing = computed(() => this._state().role === 'viewing');
  readonly isPresenting = computed(() => this._state().role === 'presenting');
  readonly canAct = computed(() => this._state().connection === 'connected');
  /** Inbound poses per second while viewing — the honest fluidity readout. */
  readonly poseRateHz = this._poseRateHz.asReadonly();

  private readonly interpolator = new PoseInterpolator();
  private readonly arrivals: number[] = [];
  private unsubscribeState: (() => void) | null = null;
  private unsubscribePose: (() => void) | null = null;
  private pumpHandle: number | null = null;

  constructor() {
    const api = window.electronAPI?.session;
    if (api) {
      this.unsubscribeState = api.onState((state) => this._state.set(state));
      this.unsubscribePose = api.onRemotePose((pose) => {
        const now = performance.now();
        this.interpolator.push(pose, now);
        this.trackRate(now);
      });
      void api.getState().then((state) => this._state.set(state));
    }

    // Presenting: every pose Unity broadcasts goes straight out. No throttle —
    // main paces publishes against the round trip instead, so the rate degrades
    // with the network rather than against a number we guessed here.
    //
    // Both effects depend on `role()`, never on `_state()` directly: the
    // counters live in that state and tick on every message, so reading the
    // whole object here would re-run the effect on our own publish and spin the
    // stream into a feedback loop. A computed only notifies when its value
    // actually changes, which breaks that cycle.
    effect(() => {
      const rotation = this.unity.rotation();
      if (!rotation) return;
      if (this.role() !== 'presenting') return;
      window.electronAPI?.session?.publishPose(rotation.yaw, rotation.pitch, rotation.roll);
    });

    effect(() => {
      if (this.role() === 'viewing') this.startPump();
      else this.stopPump();
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeState?.();
    this.unsubscribePose?.();
    this.stopPump();
  }

  async create(title: string): Promise<void> {
    await window.electronAPI.session.create(title);
  }

  async join(code: string): Promise<void> {
    await window.electronAPI.session.join(code);
  }

  async leave(): Promise<void> {
    await window.electronAPI.session.leave();
  }

  private startPump(): void {
    if (this.pumpHandle !== null) return;
    this.interpolator.clear();
    this.arrivals.length = 0;
    this._poseRateHz.set(0);

    const tick = () => {
      this.pumpHandle = requestAnimationFrame(tick);
      if (!this.interpolator.isReady) return;
      const pose = this.interpolator.evaluate(performance.now() - RENDER_DELAY_MS);
      if (pose) this.unity.sendRotation(pose.yaw, pose.pitch, pose.roll);
    };
    this.pumpHandle = requestAnimationFrame(tick);
  }

  private stopPump(): void {
    if (this.pumpHandle === null) return;
    cancelAnimationFrame(this.pumpHandle);
    this.pumpHandle = null;
    this.interpolator.clear();
    this._poseRateHz.set(0);
  }

  private trackRate(nowMs: number): void {
    this.arrivals.push(nowMs);
    if (this.arrivals.length > RATE_WINDOW) this.arrivals.shift();
    if (this.arrivals.length < 2) return;
    const span = this.arrivals[this.arrivals.length - 1] - this.arrivals[0];
    if (span <= 0) return;
    this._poseRateHz.set(Math.round(((this.arrivals.length - 1) / span) * 1000));
  }
}
