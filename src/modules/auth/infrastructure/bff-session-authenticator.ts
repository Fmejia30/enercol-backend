import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import {
  type SessionAuthenticationRequest,
  type SessionAuthenticator,
} from '../../identity-access/application/session-authenticator.js';
import { BffAuthService } from '../application/bff-auth.service.js';
import { readCookie } from '../domain/bff-cookies.js';

@Injectable()
export class BffSessionAuthenticator implements SessionAuthenticator {
  constructor(
    @Inject(BffAuthService) private readonly auth: BffAuthService,
    private readonly configService: ConfigService,
  ) {}

  async authenticateFromRequest(
    request: SessionAuthenticationRequest,
  ): Promise<AuthenticatedUser | undefined> {
    const sessionId = readCookie(
      request.headers.cookie,
      this.configService.getOrThrow<string>('cookieName'),
    );
    if (!sessionId) {
      return undefined;
    }
    return this.auth.authenticate(sessionId);
  }
}
