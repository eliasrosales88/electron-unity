import { app, BrowserWindow } from 'electron';
import { registerAppInfoHandlers } from './ipc/app-info';
import { registerUnityHandlers } from './ipc/unity';
import { unityLifecycle } from './unity/lifecycle';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let unsubscribeUnityIpc: (() => void) | null = null;

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

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  unityLifecycle.attachWindow(mainWindow);
  unsubscribeUnityIpc = registerUnityHandlers(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    unityLifecycle.start().catch((err) => {
      console.error('[main] Unity start failed:', err);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    unsubscribeUnityIpc?.();
    unsubscribeUnityIpc = null;
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
