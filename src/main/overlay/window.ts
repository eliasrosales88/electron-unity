import { BrowserWindow } from 'electron';

export interface OverlayWindowOptions {
  parent: BrowserWindow;
  url: string;
  preload: string;
}

export function createOverlayWindow(opts: OverlayWindowOptions): BrowserWindow {
  const bounds = opts.parent.getContentBounds();

  const overlay = new BrowserWindow({
    parent: opts.parent,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlay.setMenuBarVisibility(false);
  overlay.loadURL(opts.url);

  return overlay;
}
