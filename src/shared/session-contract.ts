/**
 * Presenter/viewer sessions over Azure SignalR (Serverless mode).
 *
 * Serverless means the socket is receive-only: clients get messages pushed over
 * the WebSocket but publish through the data-plane REST API instead. Everything
 * that touches the AccessKey lives in the main process; the renderer only ever
 * sees the state below.
 */

/** Wire version of the session protocol, independent of Unity's protocol v1. */
export const SESSION_PROTOCOL_VERSION = 1;

/** Group every instance joins so presenters can advertise open sessions. */
export const LOBBY_GROUP = 'lobby';

/** Presenter announces this often; entries older than LOBBY_ENTRY_TTL_MS are dropped. */
export const ANNOUNCE_INTERVAL_MS = 5_000;
export const LOBBY_ENTRY_TTL_MS = 12_000;

/** Viewers heartbeat their presence to the presenter at the same cadence. */
export const HELLO_INTERVAL_MS = 5_000;
export const VIEWER_TTL_MS = 12_000;

export type SessionRole = 'idle' | 'presenting' | 'viewing';

export type SessionConnectionState =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/** A session advertised on the lobby, as seen by a prospective viewer. */
export interface LobbyEntry {
  code: string;
  title: string;
  host: string;
  /** Local clock, when we last heard an announce for this session. */
  lastSeen: number;
}

export interface SessionCounters {
  /** Outbound messages we asked the service to fan out, since app start. */
  sent: number;
  /** Messages delivered to us over the socket, since app start. */
  received: number;
  /** Failed REST publishes (quota exhaustion shows up here). */
  failed: number;
}

export interface SessionState {
  role: SessionRole;
  connection: SessionConnectionState;
  /** Code of the session we host or watch, or null when idle. */
  code: string | null;
  /** Display name of the presenter while viewing. */
  presenter: string | null;
  /** Live viewers while presenting (excludes the presenter). */
  viewerCount: number;
  lobby: LobbyEntry[];
  counters: SessionCounters;
  /** Last error surfaced to the panel; cleared on the next successful action. */
  error: string | null;
}

/** Pose handed to the renderer, which interpolates it before feeding Unity. */
export interface RemotePose {
  yaw: number;
  pitch: number;
  roll: number;
  /** Presenter's monotonic sequence number, used to drop out-of-order poses. */
  seq: number;
  /** Presenter's Date.now() at send time, for the latency readout. */
  at: number;
}

export interface SessionApi {
  getState(): Promise<SessionState>;
  onState(cb: (state: SessionState) => void): () => void;
  onRemotePose(cb: (pose: RemotePose) => void): () => void;
  create(title: string): Promise<void>;
  join(code: string): Promise<void>;
  leave(): Promise<void>;
  /** Fire-and-forget: at 30 Hz we do not want a promise per pose. */
  publishPose(yaw: number, pitch: number, roll: number): void;
}
