import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../domain/authenticated-user.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const AUTHENTICATION_REQUIRED_MESSAGE = 'Se requiere autenticación';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException(AUTHENTICATION_REQUIRED_MESSAGE);
    }
    return request.user;
  },
);
