import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_PASSWORD_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const ATTEMPT_LIMIT = 10;
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
export const SESSION_ACTIVITY_TOUCH_MS = 60_000;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function secretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): string {
  return createHmac('sha256', clientSecret)
    .update(`${username}${clientId}`)
    .digest('base64');
}

export function csrfCookieName(sessionCookieName: string): string {
  return `${sessionCookieName}_csrf`;
}

export function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
