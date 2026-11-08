import 'reflect-metadata';
import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserRole } from '../../identity-access/domain/user-role.js';
import {
  BffAuthService,
  CsrfRejectedError,
  LoginRejected,
} from '../application/bff-auth.service.js';
import { configureApp } from '../../../shared/http/configure-app.js';
import { AuthController } from './auth.controller.js';
import { AuthCookies } from './auth-cookies.js';

describe('AuthController', () => {
  const auth = {
    login: jest.fn(async () => ({
      kind: 'session' as const,
      sessionId: 'session-id',
      csrfToken: 'csrf-token',
      user: {
        id: 'user-1',
        email: 'usuario@empresa.com',
        roles: [UserRole.SPECIALIST],
      },
    })),
    challenge: jest.fn(),
    logout: jest.fn(async () => undefined),
    readSession: jest.fn(async () => ({ authenticated: false as const })),
  };

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthCookies,
        { provide: BffAuthService, useValue: auth },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'nodeEnv' ? 'test' : undefined),
            getOrThrow: (key: string) =>
              ({
                frontendOrigin: 'http://localhost:5173',
                sessionAbsoluteTtlSeconds: 3600,
                cookieSecure: false,
                cookieName: 'enercol_session',
                cookieSameSite: 'lax',
                nodeEnv: 'test',
              })[key],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { frontendOrigin: 'http://localhost:5173' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects login from another origin and returns only the session user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'usuario@empresa.com', password: 'secret-password' })
      .expect(403);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'usuario@empresa.com', password: 'secret-password' })
      .expect(200);

    expect(response.body).toEqual({
      authenticated: true,
      csrfToken: 'csrf-token',
      user: {
        id: 'user-1',
        email: 'usuario@empresa.com',
        roles: [UserRole.SPECIALIST],
      },
    });
    const cookies = response.headers['set-cookie'];
    expect(cookies?.join(';')).toContain('enercol_session=session-id');
    expect(cookies?.join(';')).toContain('HttpOnly');
    expect(JSON.stringify(response.body)).not.toMatch(
      /accessToken|refreshToken|idToken/i,
    );
  });

  it('returns a generic unauthorized response when Cognito rejects the password', async () => {
    auth.login.mockRejectedValueOnce(new LoginRejected('rejected'));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'usuario@empresa.com', password: 'wrong' })
      .expect(401);

    expect(response.body.message).toBe('No fue posible iniciar sesión');
  });

  it('returns an unauthenticated session without creating one', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .expect(200);
    expect(response.body).toEqual({ authenticated: false });
    expect(auth.readSession).toHaveBeenCalledWith(undefined);
  });

  it('rejects logout from another origin and a CSRF mismatch', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);

    auth.logout.mockRejectedValueOnce(new CsrfRejectedError());
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', 'enercol_session=session-id')
      .set('X-CSRF-Token', 'wrong')
      .expect(403);
  });
});
