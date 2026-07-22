import crypto from 'node:crypto';
import os from 'node:os';
import { loadSignalRConfig } from './config';
import { SignalRClient } from './client';
import { SignalRRest } from './rest';
import {
  ANNOUNCE_INTERVAL_MS,
  HELLO_INTERVAL_MS,
  LOBBY_ENTRY_TTL_MS,
  LOBBY_GROUP,
  SESSION_PROTOCOL_VERSION,
  VIEWER_TTL_MS,
  type LobbyEntry,
  type RemotePose,
  type SessionState,
} from '../../shared/session-contract';

/** Unambiguous alphabet: no O/0, I/1, so codes survive being read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
/** Drives both TTL pruning and the batched flush of counters/errors. */
const TICK_INTERVAL_MS = 500;

type StateListener = (state: SessionState) => void;
type PoseListener = (pose: RemotePose) => void;

interface SessionMessage {
  sv?: number;
  k?: string;
  code?: string;
  from?: string;
  title?: string;
  host?: string;
  name?: string;
  yaw?: number;
  pitch?: number;
  roll?: number;
  seq?: number;
  at?: number;
}

/**
 * Owns the presenter/viewer session state.
 *
 * Group layout is deliberately asymmetric so nobody pays for messages they do
 * not need — remember that billing counts messages the service pushes *out*:
 *   `s.<CODE>` — viewers join, presenter publishes poses. The presenter stays
 *                out so its own 30 Hz stream is not echoed back to it.
 *   `p.<CODE>` — presenter joins, viewers publish presence. Mirror image.
 *   `lobby`    — everyone joins; presenters advertise open sessions.
 */
export class SessionManager {
  /**
   * Per-process, deliberately not persisted: two instances on one machine share
   * a userData directory, and a shared id would make each drop the other's
   * messages as its own echo. Nothing needs it to survive a restart — group
   * membership is re-established on every connect anyway.
   */
  private readonly clientId = crypto.randomUUID();
  private readonly hostName = `${os.hostname()}#${process.pid}`;
  private sessionTitle = 'Panel session';

  private client: SignalRClient | null = null;
  private rest: SignalRRest | null = null;

  private readonly stateListeners = new Set<StateListener>();
  private readonly poseListeners = new Set<PoseListener>();

  private readonly lobby = new Map<string, LobbyEntry>();
  private readonly viewers = new Map<string, number>();
  private joinedGroups = new Set<string>();

  private announceTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  /** Set by the hot path; drained by the tick so IPC stays at 2 Hz, not 25. */
  private diagnosticsDirty = false;

  private outboundSeq = 0;
  private lastAppliedSeq = -1;

  private state: SessionState = {
    role: 'idle',
    connection: 'unconfigured',
    code: null,
    presenter: null,
    viewerCount: 0,
    lobby: [],
    counters: { sent: 0, received: 0, failed: 0 },
    error: null,
  };

  getState(): SessionState {
    return { ...this.state, lobby: [...this.state.lobby], counters: { ...this.state.counters } };
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  onRemotePose(listener: PoseListener): () => void {
    this.poseListeners.add(listener);
    return () => { this.poseListeners.delete(listener); };
  }

  async start(): Promise<void> {
    const config = loadSignalRConfig();
    if (!config) {
      this.patch({
        connection: 'unconfigured',
        error: 'SignalR is not configured. Add SIGNALR_CONNECTION_STRING to .env and restart.',
      });
      return;
    }

    this.rest = new SignalRRest(config, {
      onSent: () => this.bumpCounter('sent'),
      onFailed: (err) => {
        this.bumpCounter('failed');
        this.noteError(`Publish failed: ${err.message}`);
      },
    });

    console.log(`[session] endpoint=${config.endpoint} hub=${config.hub} clientId=${this.clientId}`);

    this.client = new SignalRClient(config, this.clientId, {
      onState: (connection) => {
        console.log(`[session] connection → ${connection}`);
        this.patch({ connection });
      },
      onConnected: () => this.rejoinGroups(),
      onMessage: (payload) => this.handleMessage(payload),
    });

    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    try {
      await this.client.start();
      this.patch({ error: null });
    } catch (err) {
      this.patch({ error: `Could not connect to SignalR: ${(err as Error).message}` });
    }
  }

  async dispose(): Promise<void> {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    try { await this.leave(); } catch { /* best effort on shutdown */ }
    this.stopTimers();
    await this.client?.stop();
    this.client = null;
    this.rest?.dispose();
    this.rest = null;
  }

  // -------- Commands --------

  async create(title: string): Promise<void> {
    this.requireReady();
    await this.leave();

    this.sessionTitle = title.trim() || 'Panel session';
    const code = generateCode();
    this.outboundSeq = 0;
    // Presence only: viewers publish here, we listen. We stay out of `s.<CODE>`
    // so our own pose stream is not billed straight back to us.
    await this.joinGroup(presenceGroup(code));

    console.log(`[session] presenting '${this.sessionTitle}' as ${code}`);
    this.patch({ role: 'presenting', code, presenter: null, viewerCount: 0, error: null });

    await this.announce();
    this.announceTimer = setInterval(() => { void this.announce(); }, ANNOUNCE_INTERVAL_MS);
  }

  async join(code: string): Promise<void> {
    this.requireReady();
    const normalized = normalizeCode(code);
    if (!normalized) throw new Error('Enter a 6-character session code.');

    await this.leave();
    this.lastAppliedSeq = -1;
    await this.joinGroup(sessionGroup(normalized));

    const known = this.lobby.get(normalized);
    this.patch({
      role: 'viewing',
      code: normalized,
      presenter: known?.host ?? null,
      viewerCount: 0,
      error: null,
    });

    await this.hello();
    this.helloTimer = setInterval(() => { void this.hello(); }, HELLO_INTERVAL_MS);
  }

  async leave(): Promise<void> {
    const { role, code } = this.state;
    if (role === 'idle' || !code) return;

    this.stopTimers();

    try {
      if (role === 'presenting') {
        await this.publish(LOBBY_GROUP, { k: 'unannounce', code });
        await this.publish(sessionGroup(code), { k: 'end', code });
        await this.leaveGroup(presenceGroup(code));
      } else {
        await this.publish(presenceGroup(code), { k: 'bye', code });
        await this.leaveGroup(sessionGroup(code));
      }
    } catch (err) {
      // Leaving must always land locally, even if the network is gone.
      console.warn('[session] leave cleanup failed:', (err as Error).message);
    }

    this.viewers.clear();
    this.patch({ role: 'idle', code: null, presenter: null, viewerCount: 0 });
  }

  /** Hot path: called at Unity's broadcast rate while presenting. */
  publishPose(yaw: number, pitch: number, roll: number): void {
    const { role, code } = this.state;
    if (role !== 'presenting' || !code || !this.rest) return;

    this.rest.publishLatest(sessionGroup(code), {
      sv: SESSION_PROTOCOL_VERSION,
      k: 'pose',
      code,
      from: this.clientId,
      yaw: round2(yaw),
      pitch: round2(pitch),
      roll: round2(roll),
      seq: ++this.outboundSeq,
      at: Date.now(),
    });
  }

  // -------- Inbound --------

  private handleMessage(payload: unknown): void {
    this.bumpCounter('received');
    if (typeof payload !== 'object' || payload === null) return;
    const msg = payload as SessionMessage;
    if (msg.sv !== SESSION_PROTOCOL_VERSION) return;
    if (msg.from === this.clientId) return;

    switch (msg.k) {
      case 'announce': return this.onAnnounce(msg);
      case 'unannounce': return this.onUnannounce(msg);
      case 'pose': return this.onPose(msg);
      case 'hello': return this.onHello(msg);
      case 'bye': return this.onBye(msg);
      case 'end': return this.onEnd(msg);
      default: return;
    }
  }

  private onAnnounce(msg: SessionMessage): void {
    if (!msg.code) return;
    this.lobby.set(msg.code, {
      code: msg.code,
      title: msg.title || 'Untitled session',
      host: msg.host || 'unknown',
      lastSeen: Date.now(),
    });
    this.publishLobby();
  }

  private onUnannounce(msg: SessionMessage): void {
    if (!msg.code) return;
    if (this.lobby.delete(msg.code)) this.publishLobby();
  }

  private onPose(msg: SessionMessage): void {
    if (this.state.role !== 'viewing') return;
    if (msg.code !== this.state.code) return;
    if (typeof msg.yaw !== 'number' || typeof msg.pitch !== 'number' || typeof msg.roll !== 'number') return;

    // The REST agent keeps one socket so poses arrive in order, but a reconnect
    // can still replay an old one; never let it drag the panel backwards.
    const seq = typeof msg.seq === 'number' ? msg.seq : this.lastAppliedSeq + 1;
    if (seq <= this.lastAppliedSeq) return;
    this.lastAppliedSeq = seq;

    const pose: RemotePose = {
      yaw: msg.yaw,
      pitch: msg.pitch,
      roll: msg.roll,
      seq,
      at: typeof msg.at === 'number' ? msg.at : Date.now(),
    };
    for (const listener of this.poseListeners) {
      try { listener(pose); } catch { /* a bad listener must not stall the stream */ }
    }
  }

  private onHello(msg: SessionMessage): void {
    if (this.state.role !== 'presenting') return;
    if (msg.code !== this.state.code || !msg.from) return;
    this.viewers.set(msg.from, Date.now());
    this.patch({ viewerCount: this.viewers.size });
  }

  private onBye(msg: SessionMessage): void {
    if (this.state.role !== 'presenting' || !msg.from) return;
    if (this.viewers.delete(msg.from)) this.patch({ viewerCount: this.viewers.size });
  }

  private onEnd(msg: SessionMessage): void {
    if (this.state.role !== 'viewing' || msg.code !== this.state.code) return;
    void this.leave().then(() => {
      this.patch({ error: 'The presenter ended the session.' });
    });
  }

  // -------- Plumbing --------

  private async announce(): Promise<void> {
    const { code, role } = this.state;
    if (role !== 'presenting' || !code) return;
    await this.publish(LOBBY_GROUP, {
      k: 'announce',
      code,
      title: this.sessionTitle,
      host: this.hostName,
    });
  }

  private async hello(): Promise<void> {
    const { code, role } = this.state;
    if (role !== 'viewing' || !code) return;
    await this.publish(presenceGroup(code), { k: 'hello', code, name: this.hostName });
  }

  private async publish(group: string, body: Record<string, unknown>): Promise<void> {
    if (!this.rest) return;
    try {
      await this.rest.sendToGroup(group, {
        sv: SESSION_PROTOCOL_VERSION,
        from: this.clientId,
        ...body,
      });
    } catch (err) {
      this.bumpCounter('failed');
      this.noteError(`Publish failed: ${(err as Error).message}`);
    }
  }

  private async joinGroup(group: string): Promise<void> {
    if (!this.rest) return;
    this.joinedGroups.add(group);
    await this.rest.addUserToGroup(group, this.clientId);
  }

  private async leaveGroup(group: string): Promise<void> {
    this.joinedGroups.delete(group);
    if (!this.rest) return;
    await this.rest.removeUserFromGroup(group, this.clientId);
  }

  /**
   * Group membership lives on the connection, so a reconnect silently drops it.
   * Re-issuing every join here is what keeps a session alive across a network
   * blip instead of going quietly deaf.
   */
  private async rejoinGroups(): Promise<void> {
    if (!this.rest) return;
    this.joinedGroups.add(LOBBY_GROUP);
    for (const group of this.joinedGroups) {
      try {
        await this.rest.addUserToGroup(group, this.clientId);
      } catch (err) {
        this.patch({ error: `Could not join '${group}': ${(err as Error).message}` });
      }
    }
  }

  /**
   * Single heartbeat: expires stale lobby/viewer entries and flushes the
   * diagnostics the hot path accumulated. Counters must not go through
   * {@link patch} directly — that would push a full state object over IPC on
   * every single pose.
   */
  private tick(): void {
    this.prune();
    if (this.diagnosticsDirty) {
      this.diagnosticsDirty = false;
      this.patch({ counters: { ...this.state.counters } });
    }
  }

  private prune(): void {
    const now = Date.now();
    let lobbyChanged = false;
    for (const [code, entry] of this.lobby) {
      if (now - entry.lastSeen > LOBBY_ENTRY_TTL_MS) {
        this.lobby.delete(code);
        lobbyChanged = true;
      }
    }
    if (lobbyChanged) this.publishLobby();

    if (this.state.role === 'presenting') {
      let viewersChanged = false;
      for (const [id, lastSeen] of this.viewers) {
        if (now - lastSeen > VIEWER_TTL_MS) {
          this.viewers.delete(id);
          viewersChanged = true;
        }
      }
      if (viewersChanged) this.patch({ viewerCount: this.viewers.size });
    }
  }

  private publishLobby(): void {
    const entries = [...this.lobby.values()]
      .filter(e => e.code !== this.state.code)
      .sort((a, b) => a.title.localeCompare(b.title));
    this.patch({ lobby: entries });
  }

  private stopTimers(): void {
    if (this.announceTimer) { clearInterval(this.announceTimer); this.announceTimer = null; }
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
  }

  private requireReady(): void {
    if (!this.rest || !this.client) {
      throw new Error('SignalR is not configured.');
    }
    if (this.client.getState() !== 'connected') {
      throw new Error('Not connected to SignalR yet.');
    }
  }

  /** Hot path: mutate in place and let the tick publish it. */
  private bumpCounter(key: 'sent' | 'received' | 'failed'): void {
    this.state.counters[key]++;
    this.diagnosticsDirty = true;
  }

  /** Also batched: a sustained failure would otherwise emit state per pose. */
  private noteError(message: string): void {
    if (this.state.error === message) return;
    this.state.error = message;
    this.diagnosticsDirty = true;
  }

  private patch(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.stateListeners) {
      try { listener(snapshot); } catch { /* noop */ }
    }
  }
}

function sessionGroup(code: string): string { return `s.${code}`; }
function presenceGroup(code: string): string { return `p.${code}`; }

function normalizeCode(code: string): string | null {
  const upper = code.trim().toUpperCase();
  if (upper.length !== CODE_LENGTH) return null;
  for (const ch of upper) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return upper;
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const sessionManager = new SessionManager();
