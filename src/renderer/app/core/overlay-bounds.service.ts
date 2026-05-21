import { Injectable, OnDestroy, effect, inject } from '@angular/core';
import { UnityService } from './unity.service';

const COMPACT_MARGIN = 12;

@Injectable({ providedIn: 'root' })
export class OverlayBoundsService implements OnDestroy {
  private readonly unity = inject(UnityService);

  private element: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private rafPending = false;

  constructor() {
    effect(() => {
      const ready = this.unity.ready();
      const error = this.unity.error();
      const modal = !ready || !!error;
      if (modal) {
        this.sendModal();
      } else {
        this.scheduleCompact();
      }
    });
  }

  ngOnDestroy(): void {
    this.unregisterInspector();
  }

  registerInspector(el: HTMLElement): void {
    this.element = el;
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => this.scheduleCompact());
    this.observer.observe(el);
    this.scheduleCompact();
  }

  unregisterInspector(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.element = null;
  }

  private sendModal(): void {
    window.electronAPI?.overlay?.setBounds({ mode: 'modal' });
  }

  private scheduleCompact(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.sendCompact();
    });
  }

  private sendCompact(): void {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width <= 0 || height <= 0) return;
    window.electronAPI?.overlay?.setBounds({
      mode: 'compact',
      width,
      height,
      marginX: COMPACT_MARGIN,
      marginY: COMPACT_MARGIN,
    });
  }
}
