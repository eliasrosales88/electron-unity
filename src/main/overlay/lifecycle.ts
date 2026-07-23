import { BrowserWindow, Rectangle, screen } from 'electron';
import type { OverlayLayout } from '../../shared/ipc-contract';
import { hwndFromBuffer, setWindowRegion, type RegionRect } from '../unity/win32';

export interface OverlayLink {
  dispose(): void;
  applyLayout(layout: OverlayLayout): void;
}

export function linkOverlayToMain(main: BrowserWindow, overlay: BrowserWindow): OverlayLink {
  let disposed = false;
  let lastLayout: OverlayLayout = { modal: true, panels: [] };
  let firstShown = false;

  // Chromium can reset a window's region across resizes and DPI changes, so
  // this is re-applied on every bounds update rather than set once.
  const applyRegion = (contentBounds: Rectangle) => {
    const hwnd = hwndFromBuffer(overlay.getNativeWindowHandle());
    const rects = computeRegionRects(lastLayout, contentBounds);
    if (!setWindowRegion(hwnd, rects)) {
      console.warn(
        '[overlay] SetWindowRgn failed; the overlay stays rectangular and will ' +
        'swallow clicks meant for the Unity scene'
      );
    }
  };

  const applyBounds = () => {
    if (disposed || overlay.isDestroyed() || main.isDestroyed()) return;
    // While minimized the content bounds collapse to zero; writing that through
    // would leave the overlay with an empty region and no surface at all.
    if (main.isMinimized()) return;
    const contentBounds = main.getContentBounds();
    if (contentBounds.width <= 0 || contentBounds.height <= 0) return;
    // The overlay always spans the whole content area; which parts of it are
    // actually a window is decided by the clipping region below.
    overlay.setBounds({ ...contentBounds });
    applyRegion(contentBounds);

    if (!firstShown && main.isVisible()) {
      firstShown = true;
      overlay.showInactive();
      // Windows DWM workaround: a transparent BrowserWindow doesn't composite
      // its transparent regions until something invalidates it. Nudge the
      // bounds by 1px so the underlying Unity child HWND shows through without
      // requiring a user interaction.
      setTimeout(() => {
        if (disposed || overlay.isDestroyed()) return;
        const b = overlay.getBounds();
        overlay.setBounds({ ...b, width: b.width + 1 });
        overlay.setBounds(b);
      }, 50);
    }
  };

  // During a native Windows title-bar drag the 'move' stream runs inside the OS
  // modal move loop, which starves JS timers: the old trailing debounce here
  // never fired until the drag ENDED, so the overlay lagged behind and snapped
  // into place on release. Follow synchronously instead so the overlay tracks
  // the window on every 'move' the OS delivers. The panel content still freezes
  // mid-drag (same blocked browser thread) — only the position is kept glued.
  const followNow = () => {
    applyBounds();
  };

  const onShow = () => {
    if (disposed || overlay.isDestroyed()) return;
    applyBounds();
    if (!overlay.isVisible()) overlay.showInactive();
  };

  const onHideLike = () => {
    if (disposed || overlay.isDestroyed()) return;
    if (overlay.isVisible()) overlay.hide();
  };

  const onClosed = () => {
    if (disposed) return;
    disposed = true;
    if (!overlay.isDestroyed()) overlay.destroy();
  };

  main.on('move', followNow);
  main.on('resize', followNow);
  main.on('show', onShow);
  main.on('restore', onShow);
  main.on('minimize', onHideLike);
  main.on('hide', onHideLike);
  main.on('closed', onClosed);

  overlay.webContents.once('did-finish-load', () => {
    if (disposed || overlay.isDestroyed() || main.isDestroyed()) return;
    applyBounds();
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      main.off('move', followNow);
      main.off('resize', followNow);
      main.off('show', onShow);
      main.off('restore', onShow);
      main.off('minimize', onHideLike);
      main.off('hide', onHideLike);
      main.off('closed', onClosed);
      if (!overlay.isDestroyed()) overlay.destroy();
    },
    applyLayout(layout: OverlayLayout) {
      lastLayout = layout;
      applyBounds();
    },
  };
}

/**
 * Physical-pixel rects, relative to the overlay's top-left, that should remain
 * a real window. `null` means "no region" — the whole overlay stays a window,
 * which is what the loading and error screens need.
 */
function computeRegionRects(layout: OverlayLayout, contentBounds: Rectangle): RegionRect[] | null {
  if (layout.modal) return null;

  const sf = screen.getDisplayMatching(contentBounds).scaleFactor || 1;
  const heightPx = Math.round(contentBounds.height * sf);
  const rects: RegionRect[] = [];

  for (const panel of layout.panels) {
    // A zero-width panel contributes no rect at all — clamping it up to 1px
    // would leave a dead sliver of window along the edge.
    const width = Math.min(Math.max(0, Math.round(panel.width)), contentBounds.width);
    if (width <= 0) continue;
    const widthPx = Math.round(width * sf);
    rects.push({
      x: panel.side === 'left' ? 0 : Math.round(contentBounds.width * sf) - widthPx,
      y: 0,
      width: widthPx,
      height: heightPx,
    });
  }

  return rects;
}
