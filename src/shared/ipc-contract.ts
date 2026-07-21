export const IpcChannels = {
  AppVersion: 'app:version',
  UnityStatus: 'unity:status',
  UnityGetStatus: 'unity:get-status',
  UnityRestart: 'unity:restart',
  OverlaySetLayout: 'overlay:set-layout',
} as const;

export type PanelSide = 'left' | 'right';

/**
 * 'push'    — Unity is inset by the panel width, so the two never overlap.
 * 'overlay' — the panel is drawn on top of the scene, which keeps its size.
 */
export type PanelMode = 'push' | 'overlay';

export interface PanelLayout {
  side: PanelSide;
  mode: PanelMode;
  /** Visible width in DIP. 0 means the panel claims no region at all. */
  width: number;
}

export interface OverlayLayout {
  /** Unity is not up yet: the whole window stays interactive for loading/error UI. */
  modal: boolean;
  panels: PanelLayout[];
}

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
    setLayout(layout: OverlayLayout): void;
  };
}
