import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';
import { SessionService } from '../../core/session.service';
import { UnityService } from '../../core/unity.service';

type Axis = 'yaw' | 'pitch' | 'roll';

/** ~30 Hz, matching the throttle of Unity's TransformRotationPublisher. */
const SEND_INTERVAL_MS = 33;
/** After we send, ignore inbound echoes for this long so sliders don't jitter. */
const ECHO_SUPPRESS_MS = 300;

@Component({
  selector: 'app-scene-controls',
  standalone: true,
  imports: [DecimalPipe, MatButtonModule, MatSliderModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scene-controls.component.html',
  styleUrls: ['./scene-controls.component.css'],
})
export class SceneControlsComponent implements OnDestroy {
  private readonly unity = inject(UnityService);
  private readonly session = inject(SessionService);

  readonly yaw = signal(0);
  readonly pitch = signal(0);
  readonly roll = signal(0);
  readonly readOnly = this.session.isViewing;
  readonly disabled = computed(() => this.unity.wsState() !== 'open' || this.readOnly());

  private activeDrags = 0;
  private suppressEchoUntil = 0;
  private lastSendAt = 0;
  private pendingSend: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Bidirectional sync: reflect poses broadcast by Unity (e.g. mouse drags
    // inside the scene) unless the user is interacting with a slider or we are
    // inside the echo-suppression window of our own sends.
    effect(() => {
      const rot = this.unity.rotation();
      if (!rot) return;
      if (this.activeDrags > 0) return;
      if (Date.now() < this.suppressEchoUntil) return;
      this.yaw.set(rot.yaw);
      this.pitch.set(rot.pitch);
      this.roll.set(rot.roll);
    });
  }

  ngOnDestroy(): void {
    if (this.pendingSend) clearTimeout(this.pendingSend);
  }

  onValueChange(axis: Axis, value: number): void {
    this[axis].set(value);
    this.queueSend();
  }

  onDragStart(): void {
    this.activeDrags++;
  }

  onDragEnd(): void {
    this.activeDrags = Math.max(0, this.activeDrags - 1);
    this.sendNow();
  }

  reset(): void {
    this.yaw.set(0);
    this.pitch.set(0);
    this.roll.set(0);
    this.sendNow();
  }

  formatLabel = (value: number): string => `${Math.round(value)}°`;

  private queueSend(): void {
    const elapsed = Date.now() - this.lastSendAt;
    if (elapsed >= SEND_INTERVAL_MS) {
      this.sendNow();
      return;
    }
    if (this.pendingSend) return;
    // Trailing send so the final slider value always reaches Unity.
    this.pendingSend = setTimeout(() => {
      this.pendingSend = null;
      this.sendNow();
    }, SEND_INTERVAL_MS - elapsed);
  }

  private sendNow(): void {
    if (this.pendingSend) {
      clearTimeout(this.pendingSend);
      this.pendingSend = null;
    }
    this.lastSendAt = Date.now();
    this.suppressEchoUntil = this.lastSendAt + ECHO_SUPPRESS_MS;
    this.unity.sendRotation(this.yaw(), this.pitch(), this.roll());
  }
}
