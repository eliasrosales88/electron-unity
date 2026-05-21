export const IpcChannels = {
  AppVersion: 'app:version',
} as const;

export interface ElectronAPI {
  getAppVersion(): Promise<string>;
}
