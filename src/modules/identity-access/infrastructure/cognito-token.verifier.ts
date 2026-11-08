import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuthenticationRejectedError,
  type TokenVerifier,
} from '../application/token-verifier.js';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import { mapCognitoGroupsToRoles } from '../domain/cognito-group-mapping.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from './access-token-verifier.js';
import {
  describeTokenVerificationFailure,
  InsufficientAccessTokenClaimsError,
} from './token-verification-failure.js';

@Injectable()
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly logger = new Logger(CognitoTokenVerifier.name);

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly accessTokenVerifier: AccessTokenVerifier,
  ) {}

  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.accessTokenVerifier.verify(token);
      if (payload.token_use !== 'access' || payload.sub.trim().length === 0) {
        throw new InsufficientAccessTokenClaimsError();
      }

      return {
        userId: payload.sub,
        roles: mapCognitoGroupsToRoles(payload['cognito:groups']),
      };
    } catch (error) {
      const failure = describeTokenVerificationFailure(error);
      this.logger.warn(
        `Access token verification failed at stage=${failure.stage} exception=${failure.exceptionType} message=${failure.message}`,
      );
      throw new AuthenticationRejectedError(error);
    }
  }
}
