import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type ElectronAPI } from '../shared/ipc-contract';

const api: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke(IpcChannels.AppVersion),
};

contextBridge.exposeInMainWorld('electronAPI', api);
