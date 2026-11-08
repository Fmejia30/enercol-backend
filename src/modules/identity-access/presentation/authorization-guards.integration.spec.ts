import 'reflect-metadata';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import { UserRole } from '../domain/user-role.js';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  type AuthenticatedRequest,
} from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { Authenticated, Roles } from './roles.decorator.js';
import { ACCESS_DENIED_MESSAGE, RolesGuard } from './roles.guard.js';

class ProbeController {
  @Roles(UserRole.SPECIALIST)
  specialist() {}

  @Roles(UserRole.VALIDATOR)
  validator() {}

  @Authenticated()
  authenticatedOnly() {}

  unmarked() {}
}

describe('JwtAuthGuard and RolesGuard', () => {
  const reflector = new Reflector();

  it('rejects a missing token with 401 before authorization', async () => {
    const request = { headers: { 'x-role': UserRole.VALIDATOR } };
    const context = httpContext('validator', request);
    const authGuard = new JwtAuthGuard(reflector, {
      verify: async () => user('specialist-1', [UserRole.SPECIALIST]),
    });
    const rolesGuard = new RolesGuard(reflector);

    await expect(authGuard.canActivate(context)).rejects.toMatchObject({
      status: 401,
      message: AUTHENTICATION_REQUIRED_MESSAGE,
    });
    expect(request).not.toHaveProperty('user');
    expect(() => rolesGuard.canActivate(context)).toThrow(
      expect.objectContaining({
        status: 401,
        message: AUTHENTICATION_REQUIRED_MESSAGE,
      }),
    );
  });

  it('authenticates the access token and then denies the missing role', async () => {
    const request = {
      headers: {
        authorization: 'Bearer access-token',
        'x-role': UserRole.VALIDATOR,
      },
    };
    const context = httpContext('validator', request);
    const authGuard = new JwtAuthGuard(reflector, {
      verify: async () => user('specialist-1', [UserRole.SPECIALIST]),
    });
    const rolesGuard = new RolesGuard(reflector);

    await expect(authGuard.canActivate(context)).resolves.toBe(true);
    expect(request.user?.roles).toEqual([UserRole.SPECIALIST]);
    expect(() => rolesGuard.canActivate(context)).toThrow(
      expect.objectContaining({ status: 403, message: ACCESS_DENIED_MESSAGE }),
    );
  });

  it('allows an authenticated user without roles only where no role is required', async () => {
    const request = {
      headers: { authorization: 'Bearer access-token' },
    };
    const authGuard = new JwtAuthGuard(reflector, {
      verify: async () => user('empty-1', []),
    });
    const rolesGuard = new RolesGuard(reflector);
    const identityContext = httpContext('authenticatedOnly', request);
    const roleContext = httpContext('specialist', request);

    await expect(authGuard.canActivate(identityContext)).resolves.toBe(true);
    expect(rolesGuard.canActivate(identityContext)).toBe(true);
    expect(() => rolesGuard.canActivate(roleContext)).toThrow(
      expect.objectContaining({ status: 403, message: ACCESS_DENIED_MESSAGE }),
    );
  });

  it('denies an authenticated request on a protected route without an access declaration', async () => {
    const request = {
      headers: { authorization: 'Bearer access-token' },
    };
    const context = httpContext('unmarked', request);
    const authGuard = new JwtAuthGuard(reflector, {
      verify: async () =>
        user('both-1', [UserRole.SPECIALIST, UserRole.VALIDATOR]),
    });
    const rolesGuard = new RolesGuard(reflector);

    await expect(authGuard.canActivate(context)).resolves.toBe(true);
    expect(request.user?.roles).toEqual([
      UserRole.SPECIALIST,
      UserRole.VALIDATOR,
    ]);
    expect(() => rolesGuard.canActivate(context)).toThrow(
      expect.objectContaining({ status: 403, message: ACCESS_DENIED_MESSAGE }),
    );
  });
});

function user(userId: string, roles: readonly UserRole[]): AuthenticatedUser {
  return { userId, roles };
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
