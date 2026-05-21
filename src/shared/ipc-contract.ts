export const IpcChannels = {
  AppVersion: 'app:version',
  UnityStatus: 'unity:status',
  UnityGetStatus: 'unity:get-status',
  UnityRestart: 'unity:restart',
  OverlaySetBounds: 'overlay:set-bounds',
} as const;

export type OverlayBoundsRequest =
  | { mode: 'modal' }
  | { mode: 'compact'; width: number; height: number; marginX?: number; marginY?: number };

export interface UnityBuildMetadata {
  executable: string;
  buildTimestamp: string;
  gitCommit: string;
  unityVersion: string;
  protocolVersion: number;
  buildTarget: string;
}

export interface UnityStatus {
  ready: boolean;
  wsPort: number | null;
  error: string | null;
  logPath: string | null;
  metadata: UnityBuildMetadata | null;
}

export interface ElectronAPI {
  getAppVersion(): Promise<string>;
  unity: {
    getStatus(): Promise<UnityStatus>;
    onStatus(cb: (status: UnityStatus) => void): () => void;
    restart(): Promise<void>;
  };
  overlay: {
    setBounds(req: OverlayBoundsRequest): void;
  };
}
