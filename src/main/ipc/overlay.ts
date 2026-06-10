import { ipcMain } from 'electron';
import { IpcChannels, type OverlayBoundsRequest } from '../../shared/ipc-contract';
import type { OverlayLink } from '../overlay/lifecycle';
import { unityLifecycle } from '../unity/lifecycle';

export function registerOverlayHandlers(link: OverlayLink): () => void {
  const onSetBounds = (_event: unknown, req: unknown) => {
    if (!isBoundsRequest(req)) return;
    link.applyBoundsRequest(req);
    // Keep the Unity child HWND out of the docked strip so they never overlap.
    unityLifecycle.setLeftInset(req.mode === 'dock-left' ? req.width : 0);
  };

  ipcMain.on(IpcChannels.OverlaySetBounds, onSetBounds);

  return () => {
    ipcMain.removeListener(IpcChannels.OverlaySetBounds, onSetBounds);
  };
}

function isBoundsRequest(value: unknown): value is OverlayBoundsRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.mode === 'modal') return true;
  if (v.mode === 'dock-left') {
    return typeof v.width === 'number' && Number.isFinite(v.width) && v.width > 0;
  }
  return false;
}
