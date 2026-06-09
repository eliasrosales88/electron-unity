import { ipcMain } from 'electron';
import { IpcChannels, type OverlayBoundsRequest } from '../../shared/ipc-contract';
import type { OverlayLink } from '../overlay/lifecycle';

export function registerOverlayHandlers(link: OverlayLink): () => void {
  const onSetBounds = (_event: unknown, req: unknown) => {
    if (!isBoundsRequest(req)) return;
    link.applyBoundsRequest(req);
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
  if (v.mode === 'compact') {
    return typeof v.width === 'number' && typeof v.height === 'number';
  }
  return false;
}
