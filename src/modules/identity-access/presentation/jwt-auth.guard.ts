import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import {
  SESSION_AUTHENTICATOR,
  SessionRejectedError,
  type SessionAuthenticator,
} from '../application/session-authenticator.js';
import {
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../application/token-verifier.js';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  type AuthenticatedRequest,
} from './current-user.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export const AUTHENTICATION_FAILED_MESSAGE =
  'No fue posible autenticar la solicitud';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER)
    private readonly tokenVerifier: TokenVerifier,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authenticator = this.sessionAuthenticator();
    if (authenticator) {
      try {
        const user = await authenticator.authenticateFromRequest(request);
        if (user) {
          request.user = user;
          return true;
        }
      } catch (error) {
        if (error instanceof SessionRejectedError) {
          throw new UnauthorizedException(AUTHENTICATION_FAILED_MESSAGE);
        }
        throw error;
      }
    }

    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }

    try {
      request.user = await this.tokenVerifier.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException(AUTHENTICATION_FAILED_MESSAGE);
    }
  }

  private sessionAuthenticator(): SessionAuthenticator | undefined {
    if (!this.moduleRef) {
      return undefined;
    }

    try {
      return this.moduleRef.get<SessionAuthenticator>(SESSION_AUTHENTICATOR, {
        strict: false,
      });
    } catch {
      return undefined;
    }
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}

function readBearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
