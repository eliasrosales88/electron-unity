import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc-contract';

export function registerAppInfoHandlers(): void {
  ipcMain.handle(IpcChannels.AppVersion, () => app.getVersion());
}
