import { BrowserWindow, Rectangle } from 'electron';
import type { OverlayBoundsRequest } from '../../shared/ipc-contract';

export interface OverlayLink {
  dispose(): void;
  applyBoundsRequest(req: OverlayBoundsRequest): void;
}

export function linkOverlayToMain(main: BrowserWindow, overlay: BrowserWindow): OverlayLink {
  let disposed = false;
  let lastRequest: OverlayBoundsRequest = { mode: 'modal' };
  let firstShown = false;
  let pendingFollow: NodeJS.Timeout | null = null;

  const applyBounds = () => {
    if (disposed || overlay.isDestroyed() || main.isDestroyed()) return;
    const target = computeOverlayBounds(lastRequest, main.getContentBounds());
    overlay.setBounds(target);

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

  const followNow = () => {
    if (pendingFollow) clearTimeout(pendingFollow);
    pendingFollow = setTimeout(() => {
      pendingFollow = null;
      applyBounds();
    }, 16);
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
      if (pendingFollow) clearTimeout(pendingFollow);
      main.off('move', followNow);
      main.off('resize', followNow);
      main.off('show', onShow);
      main.off('restore', onShow);
      main.off('minimize', onHideLike);
      main.off('hide', onHideLike);
      main.off('closed', onClosed);
      if (!overlay.isDestroyed()) overlay.destroy();
    },
    applyBoundsRequest(req: OverlayBoundsRequest) {
      lastRequest = req;
      applyBounds();
    },
  };
}

function computeOverlayBounds(req: OverlayBoundsRequest, mainBounds: Rectangle): Rectangle {
  if (req.mode === 'modal') {
    return { ...mainBounds };
  }

  const marginX = req.marginX ?? 12;
  const marginY = req.marginY ?? 12;
  const width = Math.min(Math.max(1, Math.round(req.width)), mainBounds.width);
  const height = Math.min(Math.max(1, Math.round(req.height)), mainBounds.height);
  const x = mainBounds.x + Math.max(0, mainBounds.width - width - marginX);
  const y = mainBounds.y + Math.min(marginY, Math.max(0, mainBounds.height - height));
  return { x, y, width, height };
}
