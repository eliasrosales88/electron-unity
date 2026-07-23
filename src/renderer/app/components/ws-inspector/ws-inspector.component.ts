import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UnityService, UnityWsMessage } from '../../core/unity.service';

@Component({
  selector: 'app-ws-inspector',
  standalone: true,
  imports: [DatePipe, NgClass, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Styles are global (src/renderer/_panels.scss) — see side-panel for why.
  templateUrl: './ws-inspector.component.html',
})
export class WsInspectorComponent {
  private readonly unity = inject(UnityService);

  readonly messages = this.unity.messages;
  readonly wsState = this.unity.wsState;
  readonly wsPort = this.unity.wsPort;
  readonly collapsed = signal(false);
  readonly prettyPrint = signal(true);
  readonly count = computed(() => this.messages().length);

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  togglePretty(): void {
    this.prettyPrint.update((v) => !v);
  }

  clear(): void {
    this.unity.clearMessages();
  }

  format(msg: UnityWsMessage): string {
    if (!this.prettyPrint()) return msg.raw;
    try {
      return JSON.stringify(JSON.parse(msg.raw), null, 2);
    } catch {
      return msg.raw;
    }
  }

  trackById = (_: number, msg: UnityWsMessage): number => msg.id;
}
