import 'reflect-metadata';
import { beforeEach, jest } from '@jest/globals';
import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  CSRF_REJECTED_MESSAGE,
  type BffAuthService,
  CsrfRejectedError,
} from '../application/bff-auth.service.js';
import type { AuthenticatedRequest } from '../../identity-access/presentation/current-user.decorator.js';
import { CsrfGuard } from './csrf.guard.js';

describe('CsrfGuard', () => {
  const assertCsrf = jest.fn<BffAuthService['assertCsrf']>();
  const guard = new CsrfGuard(
    { assertCsrf } as unknown as BffAuthService,
    {
      getOrThrow: () => 'enercol_session',
    } as unknown as ConfigService,
  );

  beforeEach(() => {
    assertCsrf.mockReset();
  });

  it('allows a bearer-authenticated mutation without a CSRF token', async () => {
    await expect(
      guard.canActivate(context({ method: 'POST', headers: {} })),
    ).resolves.toBe(true);
    expect(assertCsrf).not.toHaveBeenCalled();
  });

  it('allows a cookie-authenticated read without a CSRF token', async () => {
    await expect(
      guard.canActivate(
        context({
          method: 'GET',
          headers: { cookie: 'enercol_session=session-id' },
          authenticatedBySession: true,
        }),
      ),
    ).resolves.toBe(true);
    expect(assertCsrf).not.toHaveBeenCalled();
  });

  it('rejects a cookie-authenticated mutation without a CSRF token', async () => {
    assertCsrf.mockRejectedValue(new CsrfRejectedError());

    await expect(
      guard.canActivate(sessionPost()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(sessionPost())).rejects.toMatchObject({
      status: 403,
      message: CSRF_REJECTED_MESSAGE,
    });
    expect(assertCsrf).toHaveBeenCalledWith('session-id', undefined);
  });

  it('rejects a cookie-authenticated mutation with an invalid CSRF token', async () => {
    assertCsrf.mockRejectedValue(new CsrfRejectedError());

    const rejection: unknown = await guard
      .canActivate(sessionPost('incorrect-token'))
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ForbiddenException);
    expect(rejection).toMatchObject({
      status: 403,
      message: CSRF_REJECTED_MESSAGE,
    });
    expect(JSON.stringify(rejection)).not.toContain('incorrect-token');
    expect(assertCsrf).toHaveBeenCalledWith('session-id', 'incorrect-token');
  });

  it('accepts a cookie-authenticated mutation with the session CSRF token', async () => {
    assertCsrf.mockResolvedValue(undefined);

    await expect(
      guard.canActivate(sessionPost('session-csrf-token')),
    ).resolves.toBe(true);
    expect(assertCsrf).toHaveBeenCalledWith(
      'session-id',
      'session-csrf-token',
    );
  });
});

function sessionPost(csrfToken?: string): ExecutionContext {
  return context({
    method: 'POST',
    headers: {
      cookie: 'enercol_session=session-id',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    authenticatedBySession: true,
  });
}

function context(
  request: Pick<AuthenticatedRequest, 'headers' | 'method'> & {
    authenticatedBySession?: boolean;
  },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
