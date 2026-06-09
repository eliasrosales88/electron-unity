import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type ElectronAPI, type UnityStatus, type OverlayBoundsRequest } from '../shared/ipc-contract';

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
  overlay: {
    setBounds: (req: OverlayBoundsRequest) => {
      ipcRenderer.send(IpcChannels.OverlaySetBounds, req);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
