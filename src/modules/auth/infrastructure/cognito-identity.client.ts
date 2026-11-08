import {
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  GetTokensFromRefreshTokenCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
  type ChallengeNameType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CognitoAuthOutcome,
  CognitoIdentityGateway,
  CognitoTokenSet,
  RefreshedCognitoTokens,
} from '../application/cognito-identity.js';
import {
  isSupportedChallenge,
  type SupportedChallenge,
} from '../domain/auth-challenge.js';
import { secretHash } from '../domain/auth-crypto.js';

const REJECTED_EXCEPTIONS = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'UserNotConfirmedException',
  'PasswordResetRequiredException',
  'InvalidPasswordException',
  'CodeMismatchException',
  'ExpiredCodeException',
  'EnableSoftwareTokenMFAException',
]);

@Injectable()
export class CognitoIdentityClient implements CognitoIdentityGateway {
  private readonly logger = new Logger(CognitoIdentityClient.name);
  private readonly client: CognitoIdentityProviderClient;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(configService: ConfigService) {
    this.client = new CognitoIdentityProviderClient({
      region: configService.getOrThrow<string>('cognitoRegion'),
    });
    this.clientId = configService.getOrThrow<string>('cognitoClientId');
    this.clientSecret = configService.getOrThrow<string>('cognitoClientSecret');
  }

  async initiatePasswordAuth(input: {
    email: string;
    password: string;
  }): Promise<CognitoAuthOutcome> {
    try {
      const response = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.clientId,
          AuthParameters: {
            USERNAME: input.email,
            PASSWORD: input.password,
            SECRET_HASH: secretHash(
              input.email,
              this.clientId,
              this.clientSecret,
            ),
          },
        }),
      );
      return this.mapAuthResponse(response, input.email);
    } catch (error) {
      return this.mapFailure(error);
    }
  }

  async respondToChallenge(input: {
    challengeName: SupportedChallenge;
    session: string;
    username: string;
    responses: Record<string, string>;
  }): Promise<CognitoAuthOutcome> {
    try {
      const response = await this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.clientId,
          ChallengeName: input.challengeName as ChallengeNameType,
          Session: input.session,
          ChallengeResponses: {
            USERNAME: input.username,
            SECRET_HASH: secretHash(
              input.username,
              this.clientId,
              this.clientSecret,
            ),
            ...input.responses,
          },
        }),
      );
      return this.mapAuthResponse(response, input.username);
    } catch (error) {
      return this.mapFailure(error);
    }
  }

  async associateSoftwareToken(
    session: string,
  ): Promise<{ secretCode: string; session: string } | null> {
    try {
      const response = await this.client.send(
        new AssociateSoftwareTokenCommand({ Session: session }),
      );
      if (!response.SecretCode || !response.Session) return null;
      return { secretCode: response.SecretCode, session: response.Session };
    } catch (error) {
      this.mapFailure(error);
      return null;
    }
  }

  async verifySoftwareToken(input: {
    session: string;
    code: string;
  }): Promise<string | null> {
    try {
      const response = await this.client.send(
        new VerifySoftwareTokenCommand({
          Session: input.session,
          UserCode: input.code,
        }),
      );
      return response.Status === 'SUCCESS' ? (response.Session ?? null) : null;
    } catch (error) {
      this.mapFailure(error);
      return null;
    }
  }

  async refresh(
    refreshToken: string,
  ): Promise<
    | { kind: 'tokens'; tokens: RefreshedCognitoTokens }
    | { kind: 'rejected' }
    | { kind: 'unavailable' }
  > {
    try {
      const response = await this.client.send(
        new GetTokensFromRefreshTokenCommand({
          RefreshToken: refreshToken,
          ClientId: this.clientId,
          ClientSecret: this.clientSecret,
        }),
      );
      const tokens = this.mapRefresh(response.AuthenticationResult);
      return tokens ? { kind: 'tokens', tokens } : { kind: 'rejected' };
    } catch (error) {
      const failure = this.mapFailure(error);
      return failure.kind === 'rejected' || failure.kind === 'throttled'
        ? { kind: 'rejected' }
        : { kind: 'unavailable' };
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.client.send(
      new RevokeTokenCommand({
        Token: refreshToken,
        ClientId: this.clientId,
        ClientSecret: this.clientSecret,
      }),
    );
  }

  private mapAuthResponse(
    response: {
      AuthenticationResult?: AuthenticationResultType;
      ChallengeName?: string;
      Session?: string;
      ChallengeParameters?: Record<string, string>;
    },
    username: string,
  ): CognitoAuthOutcome {
    const tokens = this.mapTokenSet(response.AuthenticationResult);
    if (tokens) return { kind: 'tokens', tokens };
    if (!response.ChallengeName || !response.Session)
      return { kind: 'rejected' };
    if (!isSupportedChallenge(response.ChallengeName)) {
      this.logger.warn('Cognito devolvió un desafío no implementado');
      return { kind: 'rejected' };
    }
    const parameters = response.ChallengeParameters ?? {};
    return {
      kind: 'challenge',
      challenge: {
        name: response.ChallengeName,
        session: response.Session,
        username: parameters.USERNAME || username,
        requiredAttributes: parseRequiredAttributes(
          parameters.requiredAttributes,
        ),
      },
    };
  }

  private mapTokenSet(
    result: AuthenticationResultType | undefined,
  ): CognitoTokenSet | null {
    if (
      !result?.AccessToken ||
      !result.IdToken ||
      !result.RefreshToken ||
      !result.ExpiresIn
    ) {
      return null;
    }
    return {
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn,
    };
  }

  private mapRefresh(
    result: AuthenticationResultType | undefined,
  ): RefreshedCognitoTokens | null {
    if (!result?.AccessToken || !result.ExpiresIn) return null;
    return {
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn,
    };
  }

  private mapFailure(error: unknown): CognitoAuthOutcome {
    const name = error instanceof Error ? error.name : 'Unknown';
    if (/^[A-Za-z]+Exception$/.test(name)) {
      this.logger.warn(`Cognito rechazó la operación: ${name}`);
    } else {
      this.logger.warn('Cognito no pudo completar la operación');
    }
    if (REJECTED_EXCEPTIONS.has(name)) return { kind: 'rejected' };
    if (
      name === 'TooManyRequestsException' ||
      name === 'LimitExceededException'
    ) {
      return { kind: 'throttled' };
    }
    return { kind: 'unavailable' };
  }
}

function parseRequiredAttributes(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (attribute): attribute is string =>
        typeof attribute === 'string' && /^[\w:.]{1,64}$/.test(attribute),
    );
  } catch {
    return [];
  }
}
