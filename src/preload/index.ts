import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type ElectronAPI, type UnityStatus, type OverlayLayout } from '../shared/ipc-contract';
import type { RemotePose, SessionState } from '../shared/session-contract';

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
    setLayout: (layout: OverlayLayout) => {
      ipcRenderer.send(IpcChannels.OverlaySetLayout, layout);
    },
  },
  session: {
    getState: () => ipcRenderer.invoke(IpcChannels.SessionGetState),
    onState: (cb: (state: SessionState) => void) => {
      const listener = (_event: unknown, state: SessionState) => cb(state);
      ipcRenderer.on(IpcChannels.SessionState, listener);
      return () => { ipcRenderer.removeListener(IpcChannels.SessionState, listener); };
    },
    onRemotePose: (cb: (pose: RemotePose) => void) => {
      const listener = (_event: unknown, pose: RemotePose) => cb(pose);
      ipcRenderer.on(IpcChannels.SessionRemotePose, listener);
      return () => { ipcRenderer.removeListener(IpcChannels.SessionRemotePose, listener); };
    },
    create: (title: string) => ipcRenderer.invoke(IpcChannels.SessionCreate, title),
    join: (code: string) => ipcRenderer.invoke(IpcChannels.SessionJoin, code),
    leave: () => ipcRenderer.invoke(IpcChannels.SessionLeave),
    publishPose: (yaw: number, pitch: number, roll: number) => {
      ipcRenderer.send(IpcChannels.SessionPublishPose, yaw, pitch, roll);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
