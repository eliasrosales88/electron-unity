import { Injectable, effect, inject, signal } from '@angular/core';
import { UnityService } from './unity.service';

export const PANEL_EXPANDED_WIDTH = 360;
export const PANEL_COLLAPSED_WIDTH = 56;

/**
 * Keeps the transparent overlay window and the Unity child HWND laid out
 * side-by-side. While Unity is loading or errored the overlay covers the whole
 * window ('modal'); once ready it docks to the left edge with the panel width,
 * and the main process shifts Unity right by the same amount so the two
 * surfaces never overlap.
 */
@Injectable({ providedIn: 'root' })
export class OverlayBoundsService {
  private readonly unity = inject(UnityService);

  private readonly _panelWidth = signal(PANEL_EXPANDED_WIDTH);
  readonly panelWidth = this._panelWidth.asReadonly();

  constructor() {
    effect(() => {
      const modal = !this.unity.ready() || !!this.unity.error();
      const width = this._panelWidth();
      if (modal) {
        window.electronAPI?.overlay?.setBounds({ mode: 'modal' });
      } else {
        window.electronAPI?.overlay?.setBounds({ mode: 'dock-left', width });
      }
    });
  }

  setPanelWidth(width: number): void {
    this._panelWidth.set(Math.max(1, Math.round(width)));
  }
}
