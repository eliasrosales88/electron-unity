import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import dotenv from 'dotenv';

export interface SignalRConfig {
  /** e.g. https://session-channel.service.signalr.net (no trailing slash) */
  endpoint: string;
  accessKey: string;
  hub: string;
}

const DEFAULT_HUB = 'panelsync';

let cached: SignalRConfig | null | undefined;

/**
 * Resolves the Azure SignalR credentials.
 *
 * In development the connection string comes from a gitignored `.env` at the
 * repo root; in a packaged build from `<userData>/session.json`, which is the
 * only writable location we can count on. Returns null when nothing is
 * configured — the panel then explains itself instead of the app failing to
 * boot.
 */
export function loadSignalRConfig(): SignalRConfig | null {
  if (cached !== undefined) return cached;
  cached = resolve();
  return cached;
}

function resolve(): SignalRConfig | null {
  const raw = readConnectionString();
  if (!raw) return null;

  let parsed: SignalRConfig | null = null;
  try {
    parsed = parseConnectionString(raw, readHub());
  } catch (err) {
    console.error('[session] invalid SignalR connection string:', (err as Error).message);
    return null;
  }
  return parsed;
}

function readConnectionString(): string | null {
  if (!app.isPackaged) {
    dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
    const fromEnv = process.env.SIGNALR_CONNECTION_STRING?.trim();
    if (fromEnv) return fromEnv;
  }

  const fromEnv = process.env.SIGNALR_CONNECTION_STRING?.trim();
  if (fromEnv) return fromEnv;

  try {
    const file = path.join(app.getPath('userData'), 'session.json');
    const contents = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const value = contents.connectionString;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch { /* not configured */ }

  return null;
}

function readHub(): string {
  const hub = process.env.SIGNALR_HUB?.trim();
  return hub || DEFAULT_HUB;
}

/**
 * Parses `Endpoint=https://x.service.signalr.net;AccessKey=...;Version=1.0;`.
 * Exported for tests and for validating user-supplied strings.
 */
export function parseConnectionString(value: string, hub: string): SignalRConfig {
  const parts = new Map<string, string>();
  for (const segment of value.split(';')) {
    const idx = segment.indexOf('=');
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim().toLowerCase();
    // AccessKey values are base64 and can themselves contain '=' padding.
    parts.set(key, segment.slice(idx + 1).trim());
  }

  const endpoint = parts.get('endpoint');
  const accessKey = parts.get('accesskey');
  if (!endpoint) throw new Error('missing Endpoint');
  if (!accessKey) throw new Error('missing AccessKey');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(hub)) {
    throw new Error(`invalid hub name '${hub}': must start with a letter and be alphanumeric/underscore`);
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    accessKey,
    hub,
  };
}
