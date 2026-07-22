import * as signalR from '@microsoft/signalr';
import type { SignalRConfig } from './config';
import { clientToken } from './token';
import type { SessionConnectionState } from '../../shared/session-contract';

export interface SignalRClientEvents {
  onState: (state: SessionConnectionState) => void;
  /** Called after every (re)connect so group membership can be re-established. */
  onConnected: () => void | Promise<void>;
  onMessage: (payload: unknown) => void;
}

/**
 * Receive side of the session channel.
 *
 * Serverless clients are in LISTEN mode: they may never invoke a hub method
 * (the service drops the connection if they do), so this class only ever
 * subscribes. Everything outbound goes through {@link SignalRRest}.
 */
export class SignalRClient {
  private connection: signalR.HubConnection | null = null;
  private state: SessionConnectionState = 'disconnected';

  constructor(
    private readonly config: SignalRConfig,
    private readonly userId: string,
    private readonly events: SignalRClientEvents,
  ) {}

  getState(): SessionConnectionState {
    return this.state;
  }

  /** Connect URL and client-token audience are the same string, query included. */
  private get connectUrl(): string {
    return `${this.config.endpoint}/client/?hub=${encodeURIComponent(this.config.hub)}`;
  }

  async start(): Promise<void> {
    if (this.connection) return;

    const url = this.connectUrl;
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(url, {
        accessTokenFactory: () => clientToken(this.config.accessKey, url, this.userId),
        // No negotiate endpoint exists without an app server, so we go straight
        // to the service over WebSockets with a self-minted token.
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // The block body is load-bearing: a concise arrow would return the
    // handler's value, and the client would then try to send a result back for
    // a message the service never asked one for — one console error per pose.
    connection.on('sync', (payload: unknown) => {
      this.events.onMessage(payload);
    });

    connection.onreconnecting(() => this.setState('reconnecting'));
    connection.onreconnected(() => {
      this.setState('connected');
      // Group membership is tied to the connection that was just replaced, so
      // without this the session and lobby would go silently deaf.
      void this.events.onConnected();
    });
    connection.onclose(() => this.setState('disconnected'));

    this.connection = connection;
    this.setState('connecting');

    try {
      await connection.start();
    } catch (err) {
      this.connection = null;
      this.setState('error');
      throw err;
    }

    this.setState('connected');
    await this.events.onConnected();
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (!connection) return;
    try { await connection.stop(); } catch { /* already gone */ }
    this.setState('disconnected');
  }

  private setState(state: SessionConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onState(state);
  }
}
