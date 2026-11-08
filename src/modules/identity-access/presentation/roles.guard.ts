import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { formatSecurityEvent } from '../../../shared/observability/security-event.js';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  type AuthenticatedRequest,
} from './current-user.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import {
  ACCESS_REQUIREMENT_KEY,
  type AccessRequirement,
} from './roles.decorator.js';

export const ACCESS_DENIED_MESSAGE =
  'No tiene permiso para realizar esta acción';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }

    const requirement = this.reflector.getAllAndOverride<AccessRequirement>(
      ACCESS_REQUIREMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requirement?.kind === 'authenticated') {
      return true;
    }

    if (
      requirement?.kind === 'roles' &&
      requirement.roles.some((role) => user.roles.includes(role))
    ) {
      return true;
    }

    this.deny(request, user.userId);
  }

  private deny(request: AuthenticatedRequest, userId: string): never {
    const userAgent = request.headers['user-agent'];
    this.logger.warn(
      formatSecurityEvent({
        event: 'ACCESS_DENIED',
        result: 'failure',
        userId,
        ip: request.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      }),
    );
    throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
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
