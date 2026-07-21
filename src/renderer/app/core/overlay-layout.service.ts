import { Injectable, effect, inject, signal } from '@angular/core';
import type { OverlayLayout, PanelLayout } from '../../../shared/ipc-contract';
import { UnityService } from './unity.service';

export const PANEL_EXPANDED_WIDTH = 360;
export const PANEL_COLLAPSED_WIDTH = 56;

let nextPanelId = 0;

/**
 * Collects what each side panel currently occupies and publishes it to the main
 * process as a single layout.
 *
 * The main process turns that into two things: the clipping region of the
 * overlay window (only the panel strips stay a real window, so clicks anywhere
 * else land on the Unity child natively), and the insets applied to Unity —
 * which only 'push' panels contribute to.
 *
 * While Unity is starting or has failed, the layout goes 'modal': the region is
 * dropped so the whole window is interactive for the loading and error screens.
 */
@Injectable({ providedIn: 'root' })
export class OverlayLayoutService {
  private readonly unity = inject(UnityService);
  private readonly panels = signal<ReadonlyMap<number, PanelLayout>>(new Map());

  constructor() {
    effect(() => {
      const modal = !this.unity.ready() || !!this.unity.error();
      const layout: OverlayLayout = {
        modal,
        panels: modal ? [] : [...this.panels().values()],
      };
      window.electronAPI?.overlay?.setLayout(layout);
    });
  }

  /** Stable id for one panel instance, handed out once at construction. */
  createPanelId(): number {
    return nextPanelId++;
  }

  setPanel(id: number, layout: PanelLayout): void {
    this.panels.update(current => new Map(current).set(id, layout));
  }

  removePanel(id: number): void {
    this.panels.update(current => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }
}
