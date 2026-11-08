import 'reflect-metadata';
import { jest } from '@jest/globals';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type ModuleRef, Reflector } from '@nestjs/core';
import type { TokenVerifier } from '../application/token-verifier.js';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import { UserRole } from '../domain/user-role.js';
import { SessionRejectedError } from '../application/session-authenticator.js';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  type AuthenticatedRequest,
} from './current-user.decorator.js';
import {
  AUTHENTICATION_FAILED_MESSAGE,
  JwtAuthGuard,
} from './jwt-auth.guard.js';
import { Public } from './public.decorator.js';
import { Roles } from './roles.decorator.js';

class ProbeController {
  @Public()
  open() {}

  @Roles(UserRole.SPECIALIST)
  specialist() {}
}

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();

  it('skips verification on a public route', async () => {
    const verify = jest.fn<TokenVerifier['verify']>();
    const guard = new JwtAuthGuard(reflector, { verify });

    await expect(
      guard.canActivate(httpContext('open', { headers: {} })),
    ).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token with 401', async () => {
    const guard = new JwtAuthGuard(reflector, {
      verify: jest.fn<TokenVerifier['verify']>(),
    });

    await expect(
      guard.canActivate(
        httpContext('specialist', {
          headers: { 'x-role': UserRole.VALIDATOR },
        }),
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: AUTHENTICATION_REQUIRED_MESSAGE,
    });
  });

  it('stores only the user returned by the token verifier', async () => {
    const authenticatedUser: AuthenticatedUser = {
      userId: 'specialist-1',
      roles: [UserRole.SPECIALIST],
    };
    const verify = jest
      .fn<TokenVerifier['verify']>()
      .mockResolvedValue(authenticatedUser);
    const guard = new JwtAuthGuard(reflector, { verify });
    const request = {
      headers: {
        authorization: 'Bearer access-token',
        'x-role': UserRole.VALIDATOR,
      },
    };

    await expect(
      guard.canActivate(httpContext('specialist', request)),
    ).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('access-token');
    expect(request.user).toEqual(authenticatedUser);
  });

  it.each([
    ['invalid signature for secret-token', 'secret-token'],
    ['Token expired at 2020-01-01T00:00:00.000Z', 'expired-token'],
  ])(
    'returns 401 for %s without exposing the verifier error',
    async (failure, token) => {
      const guard = new JwtAuthGuard(reflector, {
        verify: jest
          .fn<TokenVerifier['verify']>()
          .mockRejectedValue(new Error(failure)),
      });

      const rejection: unknown = await guard
        .canActivate(
          httpContext('specialist', {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(UnauthorizedException);
      expect(rejection).toMatchObject({
        status: 401,
        message: AUTHENTICATION_FAILED_MESSAGE,
      });
      expect(JSON.stringify(rejection)).not.toContain(token);
      expect(JSON.stringify(rejection)).not.toContain(failure);
    },
  );

  it('accepts a BFF session without verifying a bearer token', async () => {
    const verify = jest.fn<TokenVerifier['verify']>();
    const request = {
      headers: {
        cookie: 'enercol_session=session-id',
        authorization: 'Bearer access-token',
      },
    };
    const guard = new JwtAuthGuard(
      reflector,
      { verify },
      moduleRef({
        authenticateFromRequest: async () => ({
          userId: 'session-user',
          roles: [UserRole.SPECIALIST],
        }),
      }),
    );

    await expect(
      guard.canActivate(httpContext('specialist', request)),
    ).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(request.user).toEqual({
      userId: 'session-user',
      roles: [UserRole.SPECIALIST],
    });
  });

  it('returns 401 when the session cookie is rejected and ignores the bearer token', async () => {
    const verify = jest.fn<TokenVerifier['verify']>();
    const guard = new JwtAuthGuard(
      reflector,
      { verify },
      moduleRef({
        authenticateFromRequest: async () => {
          throw new SessionRejectedError();
        },
      }),
    );

    await expect(
      guard.canActivate(
        httpContext('specialist', {
          headers: {
            cookie: 'enercol_session=expired',
            authorization: 'Bearer access-token',
          },
        }),
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: AUTHENTICATION_FAILED_MESSAGE,
    });
    expect(verify).not.toHaveBeenCalled();
  });
});

function moduleRef(authenticator: {
  authenticateFromRequest: () => Promise<AuthenticatedUser>;
}): ModuleRef {
  return {
    get: () => authenticator,
  } as unknown as ModuleRef;
}

function httpContext(
  handlerName: keyof ProbeController,
  request: Pick<AuthenticatedRequest, 'headers'> & { user?: AuthenticatedUser },
): ExecutionContext {
  return {
    getHandler: () => ProbeController.prototype[handlerName],
    getClass: () => ProbeController,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
