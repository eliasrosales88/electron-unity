import { ipcMain } from 'electron';
import {
  IpcChannels,
  type OverlayLayout,
  type PanelLayout,
  type PanelMode,
  type PanelSide,
} from '../../shared/ipc-contract';
import type { OverlayLink } from '../overlay/lifecycle';
import { unityLifecycle } from '../unity/lifecycle';

export function registerOverlayHandlers(link: OverlayLink): () => void {
  const onSetLayout = (_event: unknown, value: unknown) => {
    if (!isOverlayLayout(value)) {
      console.warn('[overlay] rejected malformed layout:', JSON.stringify(value));
      return;
    }
    link.applyLayout(value);
    // Only 'push' panels take space away from Unity; 'overlay' ones are drawn
    // on top of the scene and leave its geometry untouched.
    unityLifecycle.setInsets({
      left: insetFor(value, 'left'),
      right: insetFor(value, 'right'),
    });
  };

  ipcMain.on(IpcChannels.OverlaySetLayout, onSetLayout);

  return () => {
    ipcMain.removeListener(IpcChannels.OverlaySetLayout, onSetLayout);
  };
}

function insetFor(layout: OverlayLayout, side: PanelSide): number {
  if (layout.modal) return 0;
  return layout.panels
    .filter(p => p.side === side && p.mode === 'push')
    .reduce((total, p) => total + Math.max(0, p.width), 0);
}

function isOverlayLayout(value: unknown): value is OverlayLayout {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.modal !== 'boolean') return false;
  if (!Array.isArray(v.panels)) return false;
  return v.panels.every(isPanelLayout);
}

function isPanelLayout(value: unknown): value is PanelLayout {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const sides: PanelSide[] = ['left', 'right'];
  const modes: PanelMode[] = ['push', 'overlay'];
  if (!sides.includes(v.side as PanelSide)) return false;
  if (!modes.includes(v.mode as PanelMode)) return false;
  return typeof v.width === 'number' && Number.isFinite(v.width) && v.width >= 0;
}
