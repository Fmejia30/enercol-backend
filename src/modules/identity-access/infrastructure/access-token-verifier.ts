import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export interface AccessTokenVerifier {
  verify(token: string): Promise<CognitoAccessTokenPayload>;
}
