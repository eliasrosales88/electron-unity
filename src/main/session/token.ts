import crypto from 'node:crypto';

const DEFAULT_LIFETIME_SEC = 60 * 60;

/**
 * Mints the HS256 JWTs Azure SignalR expects, signed with the instance
 * AccessKey.
 *
 * The `aud` rules differ between the two token kinds and getting them wrong is
 * the usual cause of a 401:
 *  - REST tokens   → the request URL *without* query string or trailing slash.
 *  - Client tokens → the connect URL *with* its `?hub=` query string, plus a
 *                    `nameid` claim, which is what makes the user- and
 *                    group-by-user REST APIs able to find the connection.
 */
export function signToken(
  accessKey: string,
  audience: string,
  extraClaims: Record<string, string> = {},
  lifetimeSec = DEFAULT_LIFETIME_SEC,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    ...extraClaims,
    aud: audience,
    iat: now,
    exp: now + lifetimeSec,
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', accessKey)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

/** Token for a data-plane REST call. `url` must already be the final request URL. */
export function apiToken(accessKey: string, url: string): string {
  return signToken(accessKey, restAudience(url));
}

/** Token for a client WebSocket connection, identifying it as `userId`. */
export function clientToken(accessKey: string, connectUrl: string, userId: string): string {
  return signToken(accessKey, connectUrl, { nameid: userId });
}

/** Strips the query string and any trailing slash, per the REST auth spec. */
export function restAudience(url: string): string {
  const withoutQuery = url.split('?')[0];
  return withoutQuery.replace(/\/+$/, '');
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
