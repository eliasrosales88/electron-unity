import WebSocket from 'ws';

export interface HandshakeResult {
  snapshotPayload: string;
}

export class HandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandshakeError';
  }
}

export async function awaitUnitySnapshot(port: number, timeoutMs: number): Promise<HandshakeResult> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const payload = await tryConnectAndAwaitSnapshot(port, Math.max(500, deadline - Date.now()));
      return { snapshotPayload: payload };
    } catch (err) {
      lastError = err as Error;
      await sleep(200);
    }
  }
  throw new HandshakeError(
    `Timed out after ${timeoutMs}ms waiting for Unity snapshot on ws://127.0.0.1:${port}/` +
    (lastError ? ` (last error: ${lastError.message})` : '')
  );
}

function tryConnectAndAwaitSnapshot(port: number, perAttemptTimeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('per-attempt timeout'));
    }, perAttemptTimeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* noop */ }
    };

    ws.once('open', () => {
      try {
        const sock = (ws as any)._socket as { setNoDelay?: (b: boolean) => void } | undefined;
        sock?.setNoDelay?.(true);
      } catch { /* noop */ }
    });

    ws.once('message', (data) => {
      const text = data.toString('utf8');
      cleanup();
      resolve(text);
    });

    ws.once('error', (err) => {
      cleanup();
      reject(err);
    });

    ws.once('close', () => {
      cleanup();
      reject(new Error('socket closed before snapshot'));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
