import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from '../../identity-access/presentation/current-user.decorator.js';
import {
  BffAuthService,
  CSRF_REJECTED_MESSAGE,
  CsrfRejectedError,
} from '../application/bff-auth.service.js';
import {
  CSRF_HEADER_NAME,
  headerValue,
  readCookie,
} from '../domain/bff-cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly auth: BffAuthService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authenticatedBySession) {
      return true;
    }
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const sessionId = readCookie(
      request.headers.cookie,
      this.configService.getOrThrow<string>('cookieName'),
    );
    if (!sessionId) {
      throw new ForbiddenException(CSRF_REJECTED_MESSAGE);
    }

    try {
      await this.auth.assertCsrf(
        sessionId,
        headerValue(request.headers[CSRF_HEADER_NAME]),
      );
      return true;
    } catch (error) {
      if (error instanceof CsrfRejectedError) {
        throw new ForbiddenException(CSRF_REJECTED_MESSAGE);
      }
      throw error;
    }
  }
}
