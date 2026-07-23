import https from 'node:https';
import { URL } from 'node:url';
import type { SignalRConfig } from './config';
import { apiToken } from './token';

/** SignalR's PayloadMessage: the client receives `target(...arguments)`. */
interface PayloadMessage {
  target: string;
  arguments: unknown[];
}

export interface RestEvents {
  /** Fired per successful publish with the number of recipients we asked for. */
  onSent?: () => void;
  onFailed?: (error: Error) => void;
}

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Data-plane REST client. In Serverless mode the WebSocket is receive-only, so
 * every outbound message is an HTTPS POST that the service then fans out over
 * the sockets it holds.
 *
 * The keep-alive agent is not an optimisation, it is a requirement: without it
 * each pose would pay a fresh TLS handshake and the stream would collapse.
 */
export class SignalRRest {
  private readonly agent = new https.Agent({
    keepAlive: true,
    // One socket keeps publishes strictly ordered, which matters because a
    // stale pose overtaking a fresh one would visibly jump the panel back.
    maxSockets: 1,
    keepAliveMsecs: 30_000,
  });

  /** Latest-wins pacing state, keyed by group. */
  private readonly inFlight = new Set<string>();
  private readonly pending = new Map<string, PayloadMessage>();

  constructor(
    private readonly config: SignalRConfig,
    private readonly events: RestEvents = {},
  ) {}

  dispose(): void {
    this.pending.clear();
    this.inFlight.clear();
    this.agent.destroy();
  }

  /** Awaited publish. Use for low-rate control messages. */
  async sendToGroup(group: string, payload: unknown): Promise<void> {
    await this.request('POST', this.groupUrl(group), { target: 'sync', arguments: [payload] });
    this.events.onSent?.();
  }

  /**
   * Publish paced by the round trip: while a POST is in flight for this group,
   * only the newest payload is kept and it goes out as soon as the previous one
   * completes. Bounds the request rate to 1/RTT and, more importantly, stops
   * stale poses from queueing up into visible lag.
   */
  publishLatest(group: string, payload: unknown): void {
    this.pending.set(group, { target: 'sync', arguments: [payload] });
    if (this.inFlight.has(group)) return;
    void this.drain(group);
  }

  private async drain(group: string): Promise<void> {
    this.inFlight.add(group);
    try {
      for (;;) {
        const message = this.pending.get(group);
        if (!message) return;
        this.pending.delete(group);
        try {
          await this.request('POST', this.groupUrl(group), message);
          this.events.onSent?.();
        } catch (err) {
          this.events.onFailed?.(err as Error);
        }
      }
    } finally {
      this.inFlight.delete(group);
    }
  }

  /**
   * Adds every connection of `userId` to `group`. Membership is bound to the
   * live connections, so this must be re-issued after every reconnect.
   */
  async addUserToGroup(group: string, userId: string, ttlSec = 3600): Promise<void> {
    const url = `${this.groupUrl(group)}/users/${encodeURIComponent(userId)}?ttl=${ttlSec}`;
    await this.request('PUT', url, null);
  }

  async removeUserFromGroup(group: string, userId: string): Promise<void> {
    const url = `${this.groupUrl(group)}/users/${encodeURIComponent(userId)}`;
    await this.request('DELETE', url, null);
  }

  private groupUrl(group: string): string {
    const { endpoint, hub } = this.config;
    return `${endpoint}/api/v1/hubs/${encodeURIComponent(hub)}/groups/${encodeURIComponent(group)}`;
  }

  private request(method: string, url: string, body: unknown): Promise<void> {
    const target = new URL(url);
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const token = apiToken(this.config.accessKey, url);

    return new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          agent: this.agent,
          method,
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(payload
              ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
              : { 'Content-Length': 0 }),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => { if (chunks.length < 8) chunks.push(c); });
          res.on('end', () => {
            if (status >= 200 && status < 300) {
              resolve();
              return;
            }
            const detail = Buffer.concat(chunks).toString('utf8').slice(0, 300);
            reject(new Error(`${method} ${target.pathname} → ${status}${detail ? `: ${detail}` : ''}`));
          });
        },
      );

      req.on('timeout', () => { req.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`)); });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
