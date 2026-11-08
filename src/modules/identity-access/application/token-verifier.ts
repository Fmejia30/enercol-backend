import type { AuthenticatedUser } from '../domain/authenticated-user.js';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedUser>;
}

export class AuthenticationRejectedError extends Error {
  constructor(cause?: unknown) {
    super(
      'Authentication rejected',
      cause === undefined ? undefined : { cause },
    );
    this.name = 'AuthenticationRejectedError';
  }
}
