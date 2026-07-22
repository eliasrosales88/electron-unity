import { app, BrowserWindow } from 'electron';
import { registerAppInfoHandlers } from './ipc/app-info';
import { registerUnityHandlers } from './ipc/unity';
import { registerOverlayHandlers } from './ipc/overlay';
import { registerSessionHandlers } from './ipc/session';
import { sessionManager } from './session/manager';
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

// Testing presenter/viewer sessions needs two apps side by side, which the
// single-instance lock forbids. Opt out explicitly for that, never by default.
const allowMultipleInstances = process.env.ELECTRON_UNITY_ALLOW_MULTI === '1';
if (!allowMultipleInstances) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  }
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayLink: OverlayLink | null = null;
let unsubscribeUnityIpc: (() => void) | null = null;
let unsubscribeOverlayIpc: (() => void) | null = null;
let unsubscribeSessionIpc: (() => void) | null = null;

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
    unsubscribeSessionIpc = registerSessionHandlers(overlayWindow);

    if (!app.isPackaged) {
      overlayWindow.webContents.openDevTools({ mode: 'detach' });
    }

    unityLifecycle.start().catch((err) => {
      console.error('[main] Unity start failed:', err);
    });

    // Independent of Unity: an unconfigured or unreachable SignalR must leave
    // the rest of the app working, so this never rejects into the boot path.
    sessionManager.start().catch((err) => {
      console.error('[main] SignalR session start failed:', err);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    unsubscribeUnityIpc?.();
    unsubscribeUnityIpc = null;
    unsubscribeOverlayIpc?.();
    unsubscribeOverlayIpc = null;
    unsubscribeSessionIpc?.();
    unsubscribeSessionIpc = null;
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
  // Tear the session down first so viewers get 'end' / presenters get 'bye'
  // while the network stack is still up.
  try {
    await sessionManager.dispose();
  } catch (err) {
    console.error('[main] session shutdown error:', err);
  }
  try {
    await unityLifecycle.shutdown();
  } catch (err) {
    console.error('[main] Unity shutdown error:', err);
  }
  app.exit(0);
});
