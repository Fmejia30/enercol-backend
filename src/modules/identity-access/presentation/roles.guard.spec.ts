import 'reflect-metadata';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';
import { UserRole } from '../domain/user-role.js';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  type AuthenticatedRequest,
} from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import { Authenticated, Roles } from './roles.decorator.js';
import { ACCESS_DENIED_MESSAGE, RolesGuard } from './roles.guard.js';

class ProbeController {
  @Roles(UserRole.SPECIALIST)
  specialist() {}

  @Roles(UserRole.VALIDATOR)
  validator() {}

  @Roles(UserRole.SPECIALIST, UserRole.VALIDATOR)
  eitherRole() {}

  @Roles()
  emptyRoleList() {}

  @Authenticated()
  authenticatedOnly() {}

  @Public()
  open() {}

  unmarked() {}
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a public route without a user', () => {
    expect(guard.canActivate(httpContext('open', { headers: {} }))).toBe(true);
  });

  it('allows the specialist role and denies the validator role with 403', () => {
    expect(
      guard.canActivate(
        httpContext('specialist', {
          headers: { 'x-role': UserRole.VALIDATOR },
          user: user('specialist-1', [UserRole.SPECIALIST]),
        }),
      ),
    ).toBe(true);

    expect(() =>
      guard.canActivate(
        httpContext('validator', {
          headers: {},
          user: user('specialist-1', [UserRole.SPECIALIST]),
        }),
      ),
    ).toThrow(expectStatus(403, ACCESS_DENIED_MESSAGE));
  });

  it('keeps both roles and accepts either declared requirement', () => {
    const both = user('both-1', [UserRole.SPECIALIST, UserRole.VALIDATOR]);

    expect(
      guard.canActivate(httpContext('eitherRole', { headers: {}, user: both })),
    ).toBe(true);
    expect(
      guard.canActivate(httpContext('validator', { headers: {}, user: both })),
    ).toBe(true);
    expect(
      guard.canActivate(httpContext('specialist', { headers: {}, user: both })),
    ).toBe(true);
  });

  it('denies an authenticated user without a recognized role on a role endpoint', () => {
    expect(() =>
      guard.canActivate(
        httpContext('specialist', {
          headers: {},
          user: user('empty-1', []),
        }),
      ),
    ).toThrow(expectStatus(403, ACCESS_DENIED_MESSAGE));
  });

  it('allows any authenticated user when the route only requires authentication', () => {
    expect(
      guard.canActivate(
        httpContext('authenticatedOnly', {
          headers: {},
          user: user('empty-1', []),
        }),
      ),
    ).toBe(true);
  });

  it('denies a protected route that does not declare an access requirement', () => {
    expect(() =>
      guard.canActivate(
        httpContext('unmarked', {
          headers: {},
          user: user('specialist-1', [UserRole.SPECIALIST]),
        }),
      ),
    ).toThrow(expectStatus(403, ACCESS_DENIED_MESSAGE));
  });

  it('does not open a route whose role list is empty', () => {
    expect(() =>
      guard.canActivate(
        httpContext('emptyRoleList', {
          headers: {},
          user: user('specialist-1', [UserRole.SPECIALIST]),
        }),
      ),
    ).toThrow(expectStatus(403, ACCESS_DENIED_MESSAGE));
  });

  it('returns 401 when a protected operation has no authenticated user', () => {
    const handlers = ['specialist', 'authenticatedOnly', 'unmarked'] as const;

    for (const handlerName of handlers) {
      expect(() =>
        guard.canActivate(httpContext(handlerName, { headers: {} })),
      ).toThrow(expectStatus(401, AUTHENTICATION_REQUIRED_MESSAGE));
    }
  });
});

function expectStatus(status: number, message: string) {
  return expect.objectContaining({
    status,
    message,
  });
}

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
