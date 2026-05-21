import { app, BrowserWindow } from 'electron';
import { registerAppInfoHandlers } from './ipc/app-info';
import { registerUnityHandlers } from './ipc/unity';
import { registerOverlayHandlers } from './ipc/overlay';
import { unityLifecycle } from './unity/lifecycle';
import { createOverlayWindow } from './overlay/window';
import { linkOverlayToMain, OverlayLink } from './overlay/lifecycle';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const OVERLAY_WINDOW_WEBPACK_ENTRY: string;
declare const OVERLAY_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayLink: OverlayLink | null = null;
let unsubscribeUnityIpc: (() => void) | null = null;
let unsubscribeOverlayIpc: (() => void) | null = null;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    height: 720,
    width: 1280,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  unityLifecycle.attachWindow(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();

    overlayWindow = createOverlayWindow({
      parent: mainWindow,
      url: OVERLAY_WINDOW_WEBPACK_ENTRY,
      preload: OVERLAY_WINDOW_PRELOAD_WEBPACK_ENTRY,
    });

    overlayLink = linkOverlayToMain(mainWindow, overlayWindow);
    unsubscribeUnityIpc = registerUnityHandlers(overlayWindow);
    unsubscribeOverlayIpc = registerOverlayHandlers(overlayLink);

    if (!app.isPackaged) {
      overlayWindow.webContents.openDevTools({ mode: 'detach' });
    }

    unityLifecycle.start().catch((err) => {
      console.error('[main] Unity start failed:', err);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    unsubscribeUnityIpc?.();
    unsubscribeUnityIpc = null;
    unsubscribeOverlayIpc?.();
    unsubscribeOverlayIpc = null;
    overlayLink?.dispose();
    overlayLink = null;
    overlayWindow = null;
  });
};

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('ready', () => {
  registerAppInfoHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let isShuttingDown = false;
app.on('before-quit', async (event) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();
  try {
    await unityLifecycle.shutdown();
  } catch (err) {
    console.error('[main] Unity shutdown error:', err);
  }
  app.exit(0);
});
