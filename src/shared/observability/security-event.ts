export const SECURITY_EVENTS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_EXPIRED',
  'ACCESS_DENIED',
  'AUTH_CHALLENGE_REQUIRED',
  'AUTH_CHALLENGE_SUCCEEDED',
  'AUTH_CHALLENGE_FAILED',
  'TOKEN_REFRESH_SUCCEEDED',
  'TOKEN_REFRESH_FAILED',
] as const;

export type SecurityEventName = (typeof SECURITY_EVENTS)[number];

export interface SecurityEvent {
  event: SecurityEventName;
  result: 'success' | 'failure';
  userId?: string;
  ip?: string;
  userAgent?: string;
  reason?: string;
}

export function formatSecurityEvent(
  event: SecurityEvent,
  now = new Date(),
): string {
  return JSON.stringify({
    source: 'enercol.auth',
    event: event.event,
    result: event.result,
    occurredAt: now.toISOString(),
    ...(event.userId ? { userId: event.userId } : {}),
    ...(event.ip ? { ip: event.ip } : {}),
    ...(event.userAgent ? { userAgent: event.userAgent.slice(0, 512) } : {}),
    ...(event.reason ? { reason: event.reason } : {}),
  });
}
