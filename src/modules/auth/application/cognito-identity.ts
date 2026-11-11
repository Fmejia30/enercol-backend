import type { SupportedChallenge } from '../domain/auth-challenge.js';

export interface CognitoTokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshedCognitoTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface CognitoChallenge {
  name: SupportedChallenge;
  session: string;
  username: string;
  requiredAttributes: string[];
}

export type CognitoAuthOutcome =
  | { kind: 'tokens'; tokens: CognitoTokenSet }
  | { kind: 'challenge'; challenge: CognitoChallenge }
  | { kind: 'rejected' }
  | { kind: 'invalid_password' }
  | { kind: 'invalid_parameter' }
  | { kind: 'session_expired' }
  | { kind: 'throttled' }
  | { kind: 'unavailable' };

export interface CognitoIdentityGateway {
  initiatePasswordAuth(input: {
    email: string;
    password: string;
  }): Promise<CognitoAuthOutcome>;
  respondToChallenge(input: {
    challengeName: SupportedChallenge;
    session: string;
    username: string;
    responses: Record<string, string>;
  }): Promise<CognitoAuthOutcome>;
  associateSoftwareToken(
    session: string,
  ): Promise<{ secretCode: string; session: string } | null>;
  verifySoftwareToken(input: {
    session: string;
    code: string;
  }): Promise<string | null>;
  refresh(
    refreshToken: string,
  ): Promise<
    | { kind: 'tokens'; tokens: RefreshedCognitoTokens }
    | { kind: 'rejected' }
    | { kind: 'unavailable' }
  >;
  revoke(refreshToken: string): Promise<void>;
}

export const COGNITO_IDENTITY = Symbol('COGNITO_IDENTITY');
