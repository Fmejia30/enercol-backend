import type { CookieOptions, Response } from 'express';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { csrfCookieName } from '../domain/auth-crypto.js';

@Injectable()
export class AuthCookies {
  constructor(private readonly configService: ConfigService) {}

  attach(response: Response, sessionId: string, csrfToken: string): void {
    const maxAge =
      this.configService.getOrThrow<number>('sessionAbsoluteTtlSeconds') * 1000;
    response.cookie(this.sessionName(), sessionId, {
      ...this.baseOptions(maxAge),
      httpOnly: true,
    });
    response.cookie(csrfCookieName(this.sessionName()), csrfToken, {
      ...this.baseOptions(maxAge),
      httpOnly: false,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.sessionName(), {
      ...this.baseOptions(0),
      httpOnly: true,
    });
    response.clearCookie(csrfCookieName(this.sessionName()), {
      ...this.baseOptions(0),
      httpOnly: false,
    });
  }

  private sessionName(): string {
    return this.configService.getOrThrow<string>('cookieName');
  }

  private baseOptions(maxAge: number): CookieOptions {
    return {
      secure: this.configService.getOrThrow<boolean>('cookieSecure'),
      sameSite:
        this.configService.getOrThrow<CookieOptions['sameSite']>(
          'cookieSameSite',
        ),
      path: '/',
      maxAge,
    };
  }
}
