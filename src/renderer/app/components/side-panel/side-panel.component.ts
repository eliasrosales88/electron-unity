import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import type { PanelMode, PanelSide } from '../../../../shared/ipc-contract';
import {
  OverlayLayoutService,
  PANEL_COLLAPSED_WIDTH,
  PANEL_EXPANDED_WIDTH,
} from '../../core/overlay-layout.service';
import { UnityService } from '../../core/unity.service';

@Component({
  selector: 'app-side-panel',
  standalone: true,
  imports: [NgClass, MatButtonModule, MatDividerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './side-panel.component.html',
  styleUrls: ['./side-panel.component.css'],
})
export class SidePanelComponent implements OnDestroy {
  private readonly layout = inject(OverlayLayoutService);
  readonly unity = inject(UnityService);
  private readonly panelId = this.layout.createPanelId();

  readonly side = input<PanelSide>('left');
  /** 'push' insets the Unity scene; 'overlay' draws on top of it. */
  readonly mode = input<PanelMode>('push');
  readonly heading = input('Panel');

  readonly collapsed = signal(false);
  readonly wsState = this.unity.wsState;

  readonly width = computed(() => (this.collapsed() ? PANEL_COLLAPSED_WIDTH : PANEL_EXPANDED_WIDTH));
  /** Chevron points towards the edge the panel is docked to. */
  readonly toggleGlyph = computed(() => {
    const pointsLeft = this.side() === 'left' ? !this.collapsed() : this.collapsed();
    return pointsLeft ? '‹' : '›';
  });

  constructor() {
    // The overlay window's clipping region — and, in push mode, Unity's inset —
    // follow whatever this panel reports here.
    effect(() => {
      this.layout.setPanel(this.panelId, {
        side: this.side(),
        mode: this.mode(),
        width: this.width(),
      });
    });
  }

  ngOnDestroy(): void {
    this.layout.removePanel(this.panelId);
  }

  toggle(): void {
    this.collapsed.update(v => !v);
  }
}
