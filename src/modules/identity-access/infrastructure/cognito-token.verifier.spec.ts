import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  CognitoJwtInvalidClientIdError,
  CognitoJwtInvalidTokenUseError,
  FetchError,
  JwtExpiredError,
  ParameterValidationError,
} from 'aws-jwt-verify/error';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { AuthenticationRejectedError } from '../application/token-verifier.js';
import { UserRole } from '../domain/user-role.js';
import type { AccessTokenVerifier } from './access-token-verifier.js';
import { CognitoTokenVerifier } from './cognito-token.verifier.js';
import { InsufficientAccessTokenClaimsError } from './token-verification-failure.js';

describe('CognitoTokenVerifier', () => {
  const token = 'header.payload.signature';
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});

  afterEach(() => {
    warn.mockClear();
  });

  afterAll(() => {
    warn.mockRestore();
  });

  function createVerifier(verify: AccessTokenVerifier['verify']) {
    return new CognitoTokenVerifier({ verify });
  }

  it('maps a verified access token to the internal user and drops unknown groups', async () => {
    const verifier = createVerifier(
      jest.fn<AccessTokenVerifier['verify']>().mockResolvedValue(
        accessToken({
          sub: 'user-1',
          'cognito:groups': ['ESPECIALISTA_TECNICO', 'ADMIN'],
        }),
      ),
    );

    await expect(verifier.verify(token)).resolves.toEqual({
      userId: 'user-1',
      roles: [UserRole.SPECIALIST],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the public rejection generic while preserving and logging the original cause', async () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4';
    const original = new Error(`signature failed for ${jwt}`);
    const verifier = createVerifier(
      jest.fn<AccessTokenVerifier['verify']>().mockRejectedValue(original),
    );

    const rejection = await verifier
      .verify(token)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(AuthenticationRejectedError);
    expect(rejection).toMatchObject({
      message: 'Authentication rejected',
      cause: original,
    });
    expect(loggedWarning()).toContain('stage=verification');
    expect(loggedWarning()).toContain('exception=Error');
    expect(loggedWarning()).toContain('[redacted-jwt]');
    expect(loggedWarning()).not.toContain(jwt);
    expect(loggedWarning()).not.toContain(token);
  });

  it('logs the Cognito client id failure even though the library error name stays Error', async () => {
    const original = new CognitoJwtInvalidClientIdError(
      'Client ID not allowed: other-client. Expected: configured-client',
      'other-client',
      'configured-client',
    );
    expect(original.name).toBe('Error');
    const verifier = createVerifier(
      jest.fn<AccessTokenVerifier['verify']>().mockRejectedValue(original),
    );

    await expect(verifier.verify(token)).rejects.toMatchObject({
      cause: original,
    });

    expect(loggedWarning()).toContain('stage=client_id');
    expect(loggedWarning()).toContain(
      'exception=CognitoJwtInvalidClientIdError',
    );
    expect(loggedWarning()).toContain(
      'Client ID not allowed: other-client. Expected: configured-client',
    );
  });

  it('classifies issuer, token use, expiry and jwks failures without dropping the message', async () => {
    const cases = [
      {
        error: new ParameterValidationError(
          'issuer not configured: https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Other',
        ),
        stage: 'issuer',
        exceptionType: 'ParameterValidationError',
      },
      {
        error: new CognitoJwtInvalidTokenUseError(
          'Token use not allowed: id. Expected: access',
          'id',
          'access',
        ),
        stage: 'token_use',
        exceptionType: 'CognitoJwtInvalidTokenUseError',
      },
      {
        error: new JwtExpiredError(
          'Token expired at 2020-01-01T00:00:00.000Z',
          1,
        ),
        stage: 'expiration',
        exceptionType: 'JwtExpiredError',
      },
      {
        error: new FetchError(
          'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_pool/.well-known/jwks.json',
          'network down',
        ),
        stage: 'jwks',
        exceptionType: 'FetchError',
      },
    ];

    for (const testCase of cases) {
      warn.mockClear();
      const verifier = createVerifier(
        jest
          .fn<AccessTokenVerifier['verify']>()
          .mockRejectedValue(testCase.error),
      );

      await expect(verifier.verify(token)).rejects.toMatchObject({
        message: 'Authentication rejected',
        cause: testCase.error,
      });
      expect(loggedWarning()).toContain(`stage=${testCase.stage}`);
      expect(loggedWarning()).toContain(`exception=${testCase.exceptionType}`);
      expect(loggedWarning()).toContain(testCase.error.message);
    }
  });

  it('rejects an access token without a subject and records the claims stage', async () => {
    const verifier = createVerifier(
      jest
        .fn<AccessTokenVerifier['verify']>()
        .mockResolvedValue(accessToken({ sub: '   ' })),
    );

    await expect(verifier.verify(token)).rejects.toMatchObject({
      message: 'Authentication rejected',
      cause: expect.any(InsufficientAccessTokenClaimsError),
    });
    expect(loggedWarning()).toContain('stage=claims');
    expect(loggedWarning()).toContain(
      'exception=InsufficientAccessTokenClaimsError',
    );
    expect(loggedWarning()).not.toContain(token);
  });
});

function loggedWarning(): string {
  const [message] = jest.mocked(Logger.prototype.warn).mock.calls.at(-1) ?? [];
  return String(message);
}

function accessToken(
  overrides: Partial<CognitoAccessTokenPayload>,
): CognitoAccessTokenPayload {
  return {
    token_use: 'access',
    sub: 'user-1',
    client_id: 'client',
    username: 'enercol-user',
    scope: 'openid',
    version: 2,
    iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool01',
    exp: 1,
    iat: 1,
    auth_time: 1,
    jti: 'jti',
    origin_jti: 'origin',
    ...overrides,
  };
}
