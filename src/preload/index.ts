import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type ElectronAPI, type UnityStatus } from '../shared/ipc-contract';

const api: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke(IpcChannels.AppVersion),
  unity: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.UnityGetStatus),
    onStatus: (cb: (status: UnityStatus) => void) => {
      const listener = (_event: unknown, status: UnityStatus) => cb(status);
      ipcRenderer.on(IpcChannels.UnityStatus, listener);
      return () => { ipcRenderer.removeListener(IpcChannels.UnityStatus, listener); };
    },
    restart: () => ipcRenderer.invoke(IpcChannels.UnityRestart),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
