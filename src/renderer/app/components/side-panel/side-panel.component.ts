import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import {
  OverlayBoundsService,
  PANEL_COLLAPSED_WIDTH,
  PANEL_EXPANDED_WIDTH,
} from '../../core/overlay-bounds.service';
import { UnityService } from '../../core/unity.service';
import { SceneControlsComponent } from '../scene-controls/scene-controls.component';
import { WsInspectorComponent } from '../ws-inspector/ws-inspector.component';

@Component({
  selector: 'app-side-panel',
  standalone: true,
  imports: [NgClass, MatButtonModule, MatDividerModule, SceneControlsComponent, WsInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './side-panel.component.html',
  styleUrls: ['./side-panel.component.css'],
})
export class SidePanelComponent {
  private readonly overlayBounds = inject(OverlayBoundsService);
  readonly unity = inject(UnityService);

  readonly collapsed = signal(false);
  readonly wsState = this.unity.wsState;

  constructor() {
    // The overlay window (and therefore Unity's left inset) follows the
    // panel's expanded/collapsed width.
    effect(() => {
      this.overlayBounds.setPanelWidth(
        this.collapsed() ? PANEL_COLLAPSED_WIDTH : PANEL_EXPANDED_WIDTH,
      );
    });
  }

  toggle(): void {
    this.collapsed.update((v) => !v);
  }
}
