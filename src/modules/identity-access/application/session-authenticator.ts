import type { AuthenticatedUser } from '../domain/authenticated-user.js';

export interface SessionAuthenticationRequest {
  headers: {
    cookie?: string | string[];
  };
}

export interface SessionAuthenticator {
  authenticateFromRequest(
    request: SessionAuthenticationRequest,
  ): Promise<AuthenticatedUser | undefined>;
}

export const SESSION_AUTHENTICATOR = Symbol('SESSION_AUTHENTICATOR');

export class SessionRejectedError extends Error {
  constructor() {
    super('Session rejected');
    this.name = 'SessionRejectedError';
  }
}
