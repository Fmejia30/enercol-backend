import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../identity-access/presentation/public.decorator.js';
import {
  AuthUnavailableError,
  BffAuthService,
  CsrfRejectedError,
  LoginRejected,
  RateLimitedError,
  type ClientContext,
} from '../application/bff-auth.service.js';
import {
  CSRF_HEADER_NAME,
  headerValue,
  readCookie,
} from '../domain/bff-cookies.js';
import { isCookieOriginAllowed } from '../../../shared/http/origin-policy.js';
import { AuthCookies } from './auth-cookies.js';
import { ChallengeDto, LoginDto } from './dto/login.dto.js';
import {
  AuthContinuationDto,
  SessionResponseDto,
} from './dto/session-response.dto.js';

const LOGIN_FAILED_MESSAGE = 'No fue posible iniciar sesión';
const ORIGIN_REJECTED_MESSAGE =
  'No fue posible validar el origen de la solicitud';
const CSRF_REJECTED_MESSAGE = 'No fue posible validar la solicitud';
const RATE_LIMIT_MESSAGE = 'Demasiados intentos. Inténtelo más tarde.';
const UNAVAILABLE_MESSAGE =
  'No fue posible completar la autenticación. Inténtelo más tarde.';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: BffAuthService,
    private readonly cookies: AuthCookies,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Autentica al usuario con correo electrónico y contraseña mediante Amazon Cognito.',
  })
  @ApiOkResponse({ type: AuthContinuationDto })
  @ApiUnauthorizedResponse({ description: LOGIN_FAILED_MESSAGE })
  @ApiTooManyRequestsResponse({ description: RATE_LIMIT_MESSAGE })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthContinuationDto> {
    this.assertOrigin(request);
    try {
      const result = await this.auth.login({
        email: body.email,
        password: body.password,
        previousSessionId: this.sessionId(request),
        client: clientContext(request),
      });
      return this.present(result, response);
    } catch (error) {
      throw this.authError(error);
    }
  }

  @Public()
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Procesa los desafíos de autenticación adicionales requeridos por Amazon Cognito, mediante un identificador opaco.',
  })
  @ApiOkResponse({ type: AuthContinuationDto })
  async challenge(
    @Body() body: ChallengeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthContinuationDto> {
    this.assertOrigin(request);
    const attributes = stringAttributes(body.attributes);
    try {
      const result = await this.auth.challenge({
        challengeId: body.challengeId,
        code: body.code,
        newPassword: body.newPassword,
        attributes,
        previousSessionId: this.sessionId(request),
        client: clientContext(request),
      });
      return this.present(result, response);
    } catch (error) {
      throw this.authError(error);
    }
  }

  @Public()
  @Get('session')
  @ApiOperation({
    summary:
      'Consulta el estado de la sesión autenticada y devuelve información del usuario, sin exponer tokens de Cognito.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async session(@Req() request: Request): Promise<SessionResponseDto> {
    return this.auth.readSession(this.sessionId(request));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cierra la sesión local e intenta revocar el refresh token de Amazon Cognito.',
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ statusCode: number; message: string }> {
    this.assertOrigin(request, true);

    try {
      await this.auth.logout({
        sessionId: this.sessionId(request),
        csrfToken: headerValue(request.headers[CSRF_HEADER_NAME]),
        client: clientContext(request),
      });

      this.cookies.clear(response);

      return {
        statusCode: HttpStatus.OK,
        message: 'La sesión se cerró correctamente.',
      };
    } catch (error) {
      if (error instanceof CsrfRejectedError) {
        throw new ForbiddenException(CSRF_REJECTED_MESSAGE);
      }
      throw error;
    }
  }

  private present(
    result: Awaited<ReturnType<BffAuthService['login']>>,
    response: Response,
  ): AuthContinuationDto {
    if (result.kind === 'challenge') {
      return {
        authenticated: false,
        challenge: {
          id: result.challengeId,
          name: result.challengeName,
          requiredAttributes: result.requiredAttributes,
          ...(result.secretCode ? { secretCode: result.secretCode } : {}),
        },
      };
    }
    this.cookies.attach(response, result.sessionId, result.csrfToken);
    return {
      authenticated: true,
      csrfToken: result.csrfToken,
      user: result.user,
    };
  }

  private assertOrigin(request: Request, csrfFallback = false): void {
    const origin = headerValue(request.headers.origin);
    const sessionId = this.sessionId(request);
    if (
      isCookieOriginAllowed({
        nodeEnv: this.configService.get<string>('nodeEnv'),
        origin,
        frontendOrigin: this.configService.getOrThrow<string>('frontendOrigin'),
        csrfFallback: csrfFallback
          ? {
              headerPresent: Boolean(
                headerValue(request.headers[CSRF_HEADER_NAME]),
              ),
              sessionPresent: Boolean(sessionId),
            }
          : undefined,
      })
    ) {
      return;
    }
    throw new ForbiddenException(ORIGIN_REJECTED_MESSAGE);
  }

  private sessionId(request: Request): string | undefined {
    return readCookie(
      request.headers.cookie,
      this.configService.getOrThrow<string>('cookieName'),
    );
  }

  private authError(error: unknown): Error {
    if (error instanceof RateLimitedError) {
      return new HttpException(
        RATE_LIMIT_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (error instanceof AuthUnavailableError) {
      return new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }
    if (error instanceof LoginRejected) {
      return new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }
    return error instanceof Error ? error : new Error('Authentication failed');
  }
}

function clientContext(request: Request): ClientContext {
  const userAgent = request.header('user-agent');
  return {
    ip: request.ip,
    userAgent: userAgent ? userAgent.slice(0, 512) : undefined,
  };
}

function stringAttributes(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  const attributes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      attributes[key] = entry;
    }
  }
  return attributes;
}
