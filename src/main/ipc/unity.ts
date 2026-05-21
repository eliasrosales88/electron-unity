import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc-contract';
import { unityLifecycle } from '../unity/lifecycle';

export function registerUnityHandlers(window: BrowserWindow): () => void {
  const handleGetStatus = () => unityLifecycle.getStatus();
  const handleRestart = async () => { await unityLifecycle.restart(); };

  ipcMain.handle(IpcChannels.UnityGetStatus, handleGetStatus);
  ipcMain.handle(IpcChannels.UnityRestart, handleRestart);

  const unsubscribe = unityLifecycle.onStatus((status) => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.UnityStatus, status);
  });

  return () => {
    ipcMain.removeHandler(IpcChannels.UnityGetStatus);
    ipcMain.removeHandler(IpcChannels.UnityRestart);
    unsubscribe();
  };
}
