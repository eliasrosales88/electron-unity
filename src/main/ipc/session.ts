import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc-contract';
import { sessionManager } from '../session/manager';

export function registerSessionHandlers(window: BrowserWindow): () => void {
  const handleGetState = () => sessionManager.getState();
  const handleCreate = async (_event: unknown, title: unknown) => {
    await sessionManager.create(typeof title === 'string' ? title : '');
  };
  const handleJoin = async (_event: unknown, code: unknown) => {
    if (typeof code !== 'string') throw new Error('Session code must be a string.');
    await sessionManager.join(code);
  };
  const handleLeave = async () => { await sessionManager.leave(); };

  const handlePublishPose = (_event: unknown, yaw: unknown, pitch: unknown, roll: unknown) => {
    if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch) || !isFiniteNumber(roll)) return;
    sessionManager.publishPose(yaw, pitch, roll);
  };

  ipcMain.handle(IpcChannels.SessionGetState, handleGetState);
  ipcMain.handle(IpcChannels.SessionCreate, handleCreate);
  ipcMain.handle(IpcChannels.SessionJoin, handleJoin);
  ipcMain.handle(IpcChannels.SessionLeave, handleLeave);
  ipcMain.on(IpcChannels.SessionPublishPose, handlePublishPose);

  const unsubscribeState = sessionManager.onState((state) => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.SessionState, state);
  });

  const unsubscribePose = sessionManager.onRemotePose((pose) => {
    if (window.isDestroyed()) return;
    window.webContents.send(IpcChannels.SessionRemotePose, pose);
  });

  return () => {
    ipcMain.removeHandler(IpcChannels.SessionGetState);
    ipcMain.removeHandler(IpcChannels.SessionCreate);
    ipcMain.removeHandler(IpcChannels.SessionJoin);
    ipcMain.removeHandler(IpcChannels.SessionLeave);
    ipcMain.removeListener(IpcChannels.SessionPublishPose, handlePublishPose);
    unsubscribeState();
    unsubscribePose();
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
